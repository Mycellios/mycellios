# Unified speech supervisor (specs/speech-replica). Starts ONE speech service
# process for every configured model and each model's existing worker process.
# It replaces running deploy/kokoro-start.ps1 and deploy/transcription-start.ps1
# side by side; install it only after qualifying it on that node.
#
# speech-launcher.json beside this script (no secrets; credentials stay in each
# worker's own State folder):
# {
#   "python": "C:\\Program Files\\Mycellios\\runtime\\python.exe",
#   "node": "C:\\Program Files\\Mycellios\\bin\\node.exe",
#   "pythonPath": ["<cuda site-packages>", "<speech venv site-packages>"],
#   "hfHome": "<offline Hugging Face cache>", "tiktokenCache": "<tiktoken cache>",
#   "memoryCeilingGB": 6,
#   "sources": { "speech_service.py": "<sha256>", "transcription_engine.py": "<sha256>",
#                "replica_gpu_guard.py": "<sha256>", "kokoro_engine.py": "<sha256>" },
#   "service": { "port": 8895, "models": {
#       "mycellios-whisper-small": { "legacyPort": 8892, "gpuConfig": "...", "artifacts": "...", "modelPath": "...",
#                                    "privateQualification": "...", "artifactIdentity": "sha256:..." },
#       "mycellios-kokoro-es": { "legacyPort": 8890, "artifactIdentity": "sha256:..." } } },
#   "workers": [ { "name": "kokoro", "root": "<replica folder>", "entry": "app\\dist\\worker\\main.js",
#                  "workingDirectory": "app", "enrollment": true } ]
# }
$ErrorActionPreference='Stop'
$ProgressPreference='SilentlyContinue'
$root=$PSScriptRoot
$cfg=Get-Content -LiteralPath (Join-Path $root 'speech-launcher.json') -Raw|ConvertFrom-Json
$models=$cfg.service.models.PSObject.Properties.Name
if(-not $models){throw 'No speech model is configured'}

# Every Python source the service imports must match its pinned hash.
foreach($source in $cfg.sources.PSObject.Properties){
  $path=Join-Path $root $source.Name
  if((Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash.ToLowerInvariant() -ne $source.Value){throw ('Speech source identity changed: '+$source.Name)}
}
if(-not $cfg.sources.'speech_service.py'){throw 'speech_service.py must be pinned'}
$whisper=$cfg.service.models.'mycellios-whisper-small'
if($whisper){
  # Same gate as transcription-start.ps1: the GPU replica serves only with its private qualification.
  $gpu=Get-Content -LiteralPath $whisper.gpuConfig -Raw|ConvertFrom-Json
  if($cfg.sources.'transcription_engine.py' -ne $gpu.gpuCoreSourceSha256 -or $cfg.sources.'replica_gpu_guard.py' -ne $gpu.guardSourceSha256){throw 'Transcription sources differ from the GPU configuration'}
  $proof=Get-Content -LiteralPath $whisper.privateQualification -Raw|ConvertFrom-Json
  if($proof.sourceSha256 -ne $gpu.gpuCoreSourceSha256 -or $proof.modelDigest -ne $gpu.modelDigest -or $proof.rows.Count -ne 6 -or $proof.backend -ne 'cuda' -or $proof.tf32 -ne $false){throw 'Transcription private qualification missing'}
}
if($cfg.service.models.'mycellios-kokoro-es' -and -not $cfg.sources.'kokoro_engine.py'){throw 'kokoro_engine.py must be pinned'}

$ports=@($cfg.service.port)+@($models|ForEach-Object{$cfg.service.models.$_.legacyPort}|Where-Object{$_})
foreach($port in $ports){
  if(Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue){throw ('Speech loopback port '+$port+' is already owned by another process')}
}

New-Item -ItemType Directory -Force -Path (Join-Path $root 'Logs'),(Join-Path $root 'State') | Out-Null
$serviceConfig=Join-Path $root 'State\speech-service.json'
$cfg.service|ConvertTo-Json -Depth 6|Set-Content -LiteralPath $serviceConfig -Encoding utf8
$env:MYCELLIOS_SPEECH_SERVICE_CONFIG=$serviceConfig
$env:PYTHONPATH=(@($cfg.pythonPath)+@($root)) -join ';'
$env:PYTHONNOUSERSITE='1';$env:HF_HUB_OFFLINE='1';$env:OMP_NUM_THREADS='2';$env:MYCELLIOS_SPEECH_THREADS='2'
$env:HF_HOME=$cfg.hfHome;$env:TIKTOKEN_CACHE_DIR=$cfg.tiktokenCache
$ceiling=[int64]$cfg.memoryCeilingGB*1GB
$children=@()
try {
  # Stdout is discarded: the Kokoro phonemizer prints words of the requested
  # text, and request content must never reach this PC's disk
  # (specs/node-owner-privacy, D6). Errors stay in service.stderr.log.
  $service=Start-Process -FilePath $cfg.python -ArgumentList @('-u',(Join-Path $root 'speech_service.py')) -WorkingDirectory $root -WindowStyle Hidden -PassThru -RedirectStandardOutput 'NUL' -RedirectStandardError (Join-Path $root 'Logs\service.stderr.log')
  $service.PriorityClass='Normal'
  $children+=$service
  $deadline=[DateTime]::UtcNow.AddMinutes(15)
  $pending=[System.Collections.Generic.List[string]]::new([string[]]$models)
  while($pending.Count -and [DateTime]::UtcNow -lt $deadline){
    if($service.HasExited){throw ('Speech service exited: '+$service.ExitCode)}
    $service.Refresh();if($service.WorkingSet64 -gt $ceiling){throw 'Speech service exceeded its memory ceiling'}
    foreach($model in @($pending)){
      try{
        $health=Invoke-RestMethod ('http://127.0.0.1:'+$cfg.service.port+'/models/'+$model+'/health') -TimeoutSec 5
        if($health.status -eq 'ready' -and $health.artifact_identity -eq $cfg.service.models.$model.artifactIdentity){[void]$pending.Remove($model)}
      }catch{}
    }
    Start-Sleep -Seconds 2
  }
  if($pending.Count){throw ('Speech models did not become ready: '+($pending -join ', '))}

  foreach($worker in $cfg.workers){
    $env:GPU_MESH_WORKER_CONFIG=Join-Path $worker.root 'worker.json'
    $env:GPU_MESH_COORDINATOR='https://www.mycellios.com/'
    $env:MYCELLIOS_WORKER_CREDENTIAL_PATH=Join-Path $worker.root 'State\admission.json'
    if($worker.enrollment){$env:MYCELLIOS_WORKER_ENROLLMENT_PATH=Join-Path $worker.root 'State\enrollment.json'}else{Remove-Item Env:MYCELLIOS_WORKER_ENROLLMENT_PATH -ErrorAction SilentlyContinue}
    $logs=Join-Path $root ('Logs\worker-'+$worker.name)
    $process=Start-Process -FilePath $cfg.node -ArgumentList @('--max-old-space-size=256',(Join-Path $worker.root $worker.entry)) -WorkingDirectory (Join-Path $worker.root $worker.workingDirectory) -WindowStyle Hidden -PassThru -RedirectStandardOutput ($logs+'.stdout.log') -RedirectStandardError ($logs+'.stderr.log')
    $process.PriorityClass='Normal'
    $children+=$process
  }

  while(-not ($children|Where-Object{$_.HasExited})){
    $total=0;foreach($child in $children){$child.Refresh();$total+=$child.WorkingSet64}
    if($total -gt $ceiling){throw 'Speech processes exceeded their memory ceiling'}
    Start-Sleep -Seconds 2
  }
  throw 'A speech process stopped; service recovery will restart the replica'
} finally {
  [array]::Reverse($children)
  foreach($child in $children){if($child -and -not $child.HasExited){Stop-Process -Id $child.Id -Force -ErrorAction SilentlyContinue}}
}
