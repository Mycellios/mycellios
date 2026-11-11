$ErrorActionPreference='Stop'
$ProgressPreference='SilentlyContinue'
$root=Split-Path -Parent $MyInvocation.MyCommand.Path
$cfg=Get-Content -LiteralPath (Join-Path $root 'gpu-config.json') -Raw|ConvertFrom-Json
foreach($item in @(@{name='transcription_engine.py';sha=$cfg.gpuCoreSourceSha256},@{name='replica_gpu_guard.py';sha=$cfg.guardSourceSha256})){
 if((Get-FileHash -LiteralPath (Join-Path $root $item.name) -Algorithm SHA256).Hash.ToLowerInvariant() -ne $item.sha){throw 'Transcription source identity changed'}
}
$proof=Get-Content -LiteralPath (Join-Path $root 'private-qualification.json') -Raw|ConvertFrom-Json
if($proof.sourceSha256 -ne $cfg.gpuCoreSourceSha256 -or $proof.modelDigest -ne $cfg.modelDigest -or $proof.rows.Count -ne 6 -or $proof.backend -ne 'cuda' -or $proof.tf32 -ne $false){throw 'Transcription private qualification missing'}
$env:PYTHONPATH='C:\ProgramData\Mycellios\mcg\cuda\Lib\site-packages;C:\ProgramData\Mycellios\Kokoro\venv\Lib\site-packages;'+$root
$env:PYTHONNOUSERSITE='1';$env:OMP_NUM_THREADS='2';$env:HF_HUB_OFFLINE='1'
$env:MYCELLIOS_TRANSCRIPTION_GPU_CONFIG=Join-Path $root 'gpu-config.json'
$env:MYCELLIOS_TRANSCRIPTION_ARTIFACTS=Join-Path $root 'transcription-artifacts.json'
$env:MYCELLIOS_TRANSCRIPTION_MODEL_PATH=Join-Path $root 'model'
$env:GPU_MESH_WORKER_CONFIG=Join-Path $root 'worker.json'
$env:MYCELLIOS_WORKER_CREDENTIAL_PATH=Join-Path $root 'State\admission.json'
$engine=$null;$worker=$null
try {
 $engine=Start-Process -FilePath 'C:\Program Files\Mycellios\runtime\python.exe' -ArgumentList @('-u',(Join-Path $root 'transcription_engine.py')) -WorkingDirectory $root -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $root 'Logs\engine.stdout.log') -RedirectStandardError (Join-Path $root 'Logs\engine.stderr.log')
 $engine.PriorityClass='Normal'
 $deadline=[DateTime]::UtcNow.AddSeconds(120);$ready=$false
 while(-not $engine.HasExited -and [DateTime]::UtcNow -lt $deadline){
  $engine.Refresh();if($engine.WorkingSet64 -gt 3GB){throw 'Transcription process memory ceiling exceeded'}
  try{$health=Invoke-RestMethod 'http://127.0.0.1:8892/health' -TimeoutSec 5;if($health.status -eq 'ready' -and $health.artifact_identity -eq $cfg.modelDigest){$ready=$true;break}}catch{}
  Start-Sleep -Seconds 1
 }
 if(-not $ready){throw 'Transcription engine did not become ready'}
 $entry=Join-Path $root 'Runtime\dist\worker\transcription-main.js'
 if(Test-Path -LiteralPath $entry){
  $worker=Start-Process -FilePath 'C:\Program Files\Mycellios\bin\node.exe' -ArgumentList @('--max-old-space-size=256',$entry) -WorkingDirectory (Join-Path $root 'Runtime') -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $root 'Logs\worker.stdout.log') -RedirectStandardError (Join-Path $root 'Logs\worker.stderr.log')
  $worker.PriorityClass='Normal'
 }
 while(-not $engine.HasExited -and (-not $worker -or -not $worker.HasExited)){
  $engine.Refresh();if($worker){$worker.Refresh()}
  if(($engine.WorkingSet64+$(if($worker){$worker.WorkingSet64}else{0})) -gt 3GB){throw 'Transcription processes exceeded their 3 GB memory ceiling'}
  Start-Sleep -Seconds 1
 }
 throw 'Transcription process exited'
}finally{
 foreach($child in @($worker,$engine)){if($child -and -not $child.HasExited){Stop-Process -Id $child.Id -Force -ErrorAction SilentlyContinue}}
}

