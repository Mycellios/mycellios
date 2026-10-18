$ErrorActionPreference='Stop'
$ProgressPreference='SilentlyContinue'
$root=$PSScriptRoot
$env:HF_HOME=Join-Path $root 'Cache\huggingface'
$env:TIKTOKEN_CACHE_DIR=Join-Path $root 'Cache\tiktoken'
$env:MYCELLIOS_SPEECH_THREADS='2'
$env:HF_HUB_OFFLINE='1'
$env:PYTHONPATH=Join-Path $root 'venv\Lib\site-packages'
$env:PYTHONNOUSERSITE='1'
$env:GPU_MESH_WORKER_CONFIG=Join-Path $root 'worker.json'
$env:GPU_MESH_COORDINATOR='https://www.mycellios.com/'
$env:MYCELLIOS_WORKER_CREDENTIAL_PATH=Join-Path $root 'State\admission.json'
$env:MYCELLIOS_WORKER_ENROLLMENT_PATH=Join-Path $root 'State\enrollment.json'
$python='C:\Program Files\Mycellios\runtime\python.exe'
$node='C:\Program Files\Mycellios\bin\node.exe'
$engine=$null
$worker=$null
try {
    New-Item -ItemType Directory -Force -Path (Join-Path $root 'Logs'),(Join-Path $root 'State'),(Join-Path $root 'Cache\tiktoken') | Out-Null
    $occupied=Get-NetTCPConnection -LocalPort 8890 -State Listen -ErrorAction SilentlyContinue
    if($occupied){throw 'Kokoro loopback port is already owned by another process'}
    $engine=Start-Process -FilePath $python -ArgumentList @('-u',(Join-Path $root 'kokoro_engine.py')) -WorkingDirectory $root -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $root 'Logs\engine.stdout.log') -RedirectStandardError (Join-Path $root 'Logs\engine.stderr.log')
    $engine.PriorityClass='BelowNormal'
    $ready=$false
    $deadline=[DateTime]::UtcNow.AddMinutes(15)
    while([DateTime]::UtcNow -lt $deadline){
        if($engine.HasExited){throw ('Kokoro engine exited: '+$engine.ExitCode)}
        try {
            $health=Invoke-RestMethod 'http://127.0.0.1:8890/health' -TimeoutSec 3
            if($health.status -eq 'ready' -and $health.artifact_identity -eq 'sha256:496dba118d1a58f5f3db2efc88dbdc216e0483fc89fe6e47ee1f2c53f18ad1e4'){$ready=$true;break}
        } catch {}
        Start-Sleep -Seconds 2
    }
    if(!$ready){throw 'Kokoro warmup deadline exceeded'}
    $worker=Start-Process -FilePath $node -ArgumentList @('--max-old-space-size=256',(Join-Path $root 'app\dist\worker\main.js')) -WorkingDirectory (Join-Path $root 'app') -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $root 'Logs\worker.stdout.log') -RedirectStandardError (Join-Path $root 'Logs\worker.stderr.log')
    $worker.PriorityClass='BelowNormal'
    while(!$engine.HasExited -and !$worker.HasExited){
        $engine.Refresh();$worker.Refresh()
        if(($engine.WorkingSet64+$worker.WorkingSet64) -gt 3GB){throw 'Kokoro exceeded its 3 GB process memory ceiling'}
        Start-Sleep -Seconds 2
    }
    throw 'Kokoro child process stopped; service recovery will restart the replica'
} finally {
    foreach($child in @($worker,$engine)){
        if($child -and !$child.HasExited){Stop-Process -Id $child.Id -Force -ErrorAction SilentlyContinue}
    }
}
