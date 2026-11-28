# Unified speech supervisor (specs/speech-replica). Starts ONE speech service
# process for every configured model and each model's existing worker process.
# It replaces running deploy/kokoro-start.ps1 (or a node's CUDA Kokoro
# launcher) and deploy/transcription-start.ps1 side by side; install it only
# after qualifying it on that node.
#
# The service never exits because a reservation lapsed: a GPU model is loaded
# only while its committed reservation is confirmed and is reloaded when one is
# confirmed again. A model's worker starts the first time that model reports
# ready with its pinned artifact identity, and keeps running across unloads.
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
#                "replica_gpu_guard.py": "<sha256>", "kokoro_engine.py": "<sha256, CPU Kokoro only>" },
#   "service": { "port": 8895, "models": {
#       "mycellios-whisper-small": { "legacyPort": 8892, "gpuConfig": "...", "artifacts": "...", "modelPath": "...",
#                                    "privateQualification": "...", "artifactIdentity": "sha256:..." },
#       "mycellios-kokoro-es": { "legacyPort": 8890, "artifactIdentity": "sha256:...",
#                                "gpuConfig": "<CUDA only: gpu-reservation.json>",
#                                "core": "<CUDA only: qualified kokoro_cuda_core.py>" } } },
#   "workers": [ { "name": "kokoro", "model": "mycellios-kokoro-es", "root": "<replica folder>",
#                  "entry": "app\\dist\\worker\\main.js", "entrySha256": "<sha256>",
#                  "workingDirectory": "app", "enrollment": true,
#                  "environment": { "MYCELLIOS_TRANSCRIPTION_GPU_CONFIG": "<only names starting MYCELLIOS_>" } } ]
# }
$ErrorActionPreference='Stop'
$ProgressPreference='SilentlyContinue'
$root=$PSScriptRoot
$cfg=Get-Content -LiteralPath (Join-Path $root 'speech-launcher.json') -Raw|ConvertFrom-Json
$models=@($cfg.service.models.PSObject.Properties.Name)
if(-not $models){throw 'No speech model is configured'}
function Get-Sha256($path){(Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash.ToLowerInvariant()}

# Every Python source the service imports must match its pinned hash.
foreach($source in $cfg.sources.PSObject.Properties){
  if((Get-Sha256 (Join-Path $root $source.Name)) -ne $source.Value){throw ('Speech source identity changed: '+$source.Name)}
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
$kokoro=$cfg.service.models.'mycellios-kokoro-es'
if($kokoro -and $kokoro.gpuConfig){
  # CUDA Kokoro: the qualified core and guard must be the ones its reservation canary pins.
  $kgpu=Get-Content -LiteralPath $kokoro.gpuConfig -Raw|ConvertFrom-Json
  if((Get-Sha256 $kokoro.core) -ne $kgpu.gpuCoreSourceSha256){throw 'Kokoro CUDA core differs from its GPU reservation'}
  if(-not $kgpu.guardSourceSha256 -or $cfg.sources.'replica_gpu_guard.py' -ne $kgpu.guardSourceSha256){throw 'Kokoro reservation guard differs from its GPU reservation'}
  if($kgpu.memoryMiB -ne 2048 -or $kgpu.modelId -ne 'mycellios-kokoro-es'){throw 'Kokoro GPU reservation is not the qualified 2048 MiB budget'}
}elseif($kokoro -and -not $cfg.sources.'kokoro_engine.py'){throw 'kokoro_engine.py must be pinned'}

foreach($worker in @($cfg.workers)){
  if($models -notcontains $worker.model){throw ('Speech worker has no configured model: '+$worker.name)}
  if($worker.entrySha256 -and (Get-Sha256 (Join-Path $worker.root $worker.entry)) -ne $worker.entrySha256){throw ('Speech worker entry changed: '+$worker.name)}
  if($worker.environment){foreach($name in $worker.environment.PSObject.Properties.Name){if($name -cnotmatch '^MYCELLIOS_[A-Z0-9_]+$'){throw ('Speech worker environment name refused: '+$name)}}}
}

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
  # (specs/node-owner-privacy, D6). Lease and load events (codes only) stay in
  # service.stderr.log.
  $service=Start-Process -FilePath $cfg.python -ArgumentList @('-u',(Join-Path $root 'speech_service.py')) -WorkingDirectory $root -WindowStyle Hidden -PassThru -RedirectStandardOutput 'NUL' -RedirectStandardError (Join-Path $root 'Logs\service.stderr.log')
  $service.PriorityClass='Normal'
  $children+=$service
  # The service answers /health as soon as its loopback ports are bound; models load afterwards.
  $deadline=[DateTime]::UtcNow.AddMinutes(2);$listening=$false
  while(-not $listening -and [DateTime]::UtcNow -lt $deadline){
    if($service.HasExited){throw ('Speech service exited: '+$service.ExitCode)}
    try{$health=Invoke-RestMethod ('http://127.0.0.1:'+$cfg.service.port+'/health') -TimeoutSec 5;$listening=($health.status -eq 'ready' -and $health.runtime -eq 'mycellios-speech/1')}catch{}
    if(-not $listening){Start-Sleep -Seconds 2}
  }
  if(-not $listening){throw 'Speech service did not bind its loopback API'}

  $started=@{}
  while($true){
    foreach($child in $children){if($child.HasExited){throw 'A speech process stopped; service recovery will restart the replica'}}
    $total=0;foreach($child in $children){$child.Refresh();$total+=$child.WorkingSet64}
    if($total -gt $ceiling){throw 'Speech processes exceeded their memory ceiling'}
    foreach($worker in @($cfg.workers)){
      if($started[$worker.name]){continue}
      $ready=$false
      try{
        $health=Invoke-RestMethod ('http://127.0.0.1:'+$cfg.service.port+'/models/'+$worker.model+'/health') -TimeoutSec 10
        $ready=($health.status -eq 'ready' -and $health.artifact_identity -eq $cfg.service.models.($worker.model).artifactIdentity)
      }catch{}
      if(-not $ready){continue}  # Waits for its reservation; the service keeps polling it.
      $env:GPU_MESH_WORKER_CONFIG=Join-Path $worker.root 'worker.json'
      $env:GPU_MESH_COORDINATOR='https://www.mycellios.com/'
      $env:MYCELLIOS_WORKER_CREDENTIAL_PATH=Join-Path $worker.root 'State\admission.json'
      if($worker.enrollment){$env:MYCELLIOS_WORKER_ENROLLMENT_PATH=Join-Path $worker.root 'State\enrollment.json'}else{Remove-Item Env:MYCELLIOS_WORKER_ENROLLMENT_PATH -ErrorAction SilentlyContinue}
      $names=@();if($worker.environment){foreach($item in $worker.environment.PSObject.Properties){Set-Item -LiteralPath ('Env:'+$item.Name) -Value $item.Value;$names+=$item.Name}}
      $logs=Join-Path $root ('Logs\worker-'+$worker.name)
      try{
        $process=Start-Process -FilePath $cfg.node -ArgumentList @('--max-old-space-size=256',(Join-Path $worker.root $worker.entry)) -WorkingDirectory (Join-Path $worker.root $worker.workingDirectory) -WindowStyle Hidden -PassThru -RedirectStandardOutput ($logs+'.stdout.log') -RedirectStandardError ($logs+'.stderr.log')
      }finally{
        foreach($name in $names){Remove-Item -LiteralPath ('Env:'+$name) -ErrorAction SilentlyContinue}
      }
      $process.PriorityClass='Normal'
      $children+=$process
      $started[$worker.name]=$true
    }
    Start-Sleep -Seconds 5
  }
} finally {
  [array]::Reverse($children)
  foreach($child in $children){if($child -and -not $child.HasExited){Stop-Process -Id $child.Id -Force -ErrorAction SilentlyContinue}}
}
