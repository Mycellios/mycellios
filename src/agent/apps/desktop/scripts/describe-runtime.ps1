$ErrorActionPreference='Stop'
$principal=New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
if(-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  $command="& '"+$PSCommandPath.Replace("'","''")+"'"
  $encoded=[Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($command))
  try {
    $child=Start-Process -FilePath powershell.exe -Verb RunAs -WindowStyle Hidden -ArgumentList @('-NoProfile','-ExecutionPolicy','Bypass','-EncodedCommand',$encoded) -Wait -PassThru
    exit $child.ExitCode
  } catch { exit 1223 }
}
$root=Join-Path $env:ProgramFiles 'Mycellios'
$node=Join-Path $root 'bin/node.exe'
$nonce=[guid]::NewGuid().ToString()
$task='MycelliosDesktopStatus-'+$nonce
$helper=Join-Path $root ('.desktop-status-helper-'+$nonce+'.cjs')
$receipt=Join-Path $root ('.desktop-status-receipt-'+$nonce+'.json')
$created=$false
try {
  # The service config deliberately permits only SYSTEM/LocalService. Keep that
  # ACL intact: a one-shot SYSTEM reader publishes only the public node ID.
  # Its code lives in the protected install root, not a writable user directory.
  Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'runtime-public-status.cjs') -Destination $helper -ErrorAction Stop
  $action=New-ScheduledTaskAction -Execute $node -Argument ('"'+$helper+'" --receipt "'+$receipt+'"')
  $principal=New-ScheduledTaskPrincipal -UserId 'S-1-5-18' -LogonType ServiceAccount -RunLevel Highest
  $settings=New-ScheduledTaskSettingsSet -ExecutionTimeLimit (New-TimeSpan -Minutes 1) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -Hidden
  Register-ScheduledTask -TaskName $task -Action $action -Principal $principal -Settings $settings | Out-Null
  $created=$true
  Start-ScheduledTask -TaskName $task
  $deadline=[DateTime]::UtcNow.AddSeconds(60)
  while([DateTime]::UtcNow -lt $deadline){
    if(Test-Path -LiteralPath $receipt){exit 0}
    Start-Sleep -Milliseconds 500
  }
  exit 28
} catch { exit 1 }
finally {
  if($created){
    Stop-ScheduledTask -TaskName $task -ErrorAction SilentlyContinue
    Unregister-ScheduledTask -TaskName $task -Confirm:$false -ErrorAction SilentlyContinue
  }
  Remove-Item -LiteralPath $helper,$receipt -Force -ErrorAction SilentlyContinue
}
