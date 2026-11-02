param(
  [Parameter(Mandatory=$true)][string]$Msi,
  [Parameter(Mandatory=$true)][ValidatePattern('^[a-f0-9]{64}$')][string]$ExpectedSha256,
  [Parameter(Mandatory=$true)][string]$Enrollment
)
$ErrorActionPreference='Stop'
$principal=New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
if(-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  function Q([string]$Value) { "'"+$Value.Replace("'","''")+"'" }
  $command='& '+(Q $PSCommandPath)+' -Msi '+(Q $Msi)+' -ExpectedSha256 '+(Q $ExpectedSha256)+' -Enrollment '+(Q $Enrollment)
  $encoded=[Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($command))
  try {
    $child=Start-Process -FilePath powershell.exe -Verb RunAs -WindowStyle Hidden -ArgumentList @('-NoProfile','-ExecutionPolicy','Bypass','-EncodedCommand',$encoded) -Wait -PassThru
    exit $child.ExitCode
  } catch { exit 1223 }
}
$mutex=New-Object Threading.Mutex($false,'Global\MycelliosDesktopRuntimeInstall')
$acquired=$false
try {
  $acquired=$mutex.WaitOne(0)
  if(-not $acquired){exit 23}
  $config=Join-Path $env:ProgramData 'Mycellios\Configuration\node.json'
  if(Test-Path -LiteralPath $config){exit 22}
  $msiItem=Get-Item -LiteralPath $Msi
  $grantItem=Get-Item -LiteralPath $Enrollment
  if(($msiItem.Attributes -band [IO.FileAttributes]::ReparsePoint) -or ($grantItem.Attributes -band [IO.FileAttributes]::ReparsePoint) -or $grantItem.Length -gt 4096){exit 24}
  if((Get-FileHash -LiteralPath $Msi -Algorithm SHA256).Hash.ToLowerInvariant() -ne $ExpectedSha256){exit 25}
  $root=Join-Path $env:ProgramFiles 'Mycellios'
  $node=Join-Path $root 'bin\node.exe'
  $install=Join-Path $root 'app\node\install-main.js'
  # Reuse an existing unpaired runtime too: Desktop must not downgrade it.
  if(-not (Test-Path -LiteralPath $node) -or -not (Test-Path -LiteralPath $install)){
    $installed=Start-Process -FilePath msiexec.exe -WindowStyle Hidden -ArgumentList @('/i',('"'+$Msi+'"'),'/qn','/norestart') -Wait -PassThru
    if($installed.ExitCode -ne 0){exit $installed.ExitCode}
  }
  # Re-check after the MSI: no existing identity, configuration or service may be replaced.
  if(Test-Path -LiteralPath $config){exit 22}
  $root=Join-Path $env:ProgramFiles 'Mycellios'
  $node=Join-Path $root 'bin\node.exe'
  $install=Join-Path $root 'app\node\install-main.js'
  if(-not (Test-Path -LiteralPath $node) -or -not (Test-Path -LiteralPath $install)){exit 26}
  & $node $install --install-root $root --enrollment $Enrollment
  if($LASTEXITCODE -ne 0){exit $LASTEXITCODE}
  if(-not (Test-Path -LiteralPath $config)){exit 27}
  $service=Get-Service -Name MycelliosNode -ErrorAction Stop
  if($service.Status -ne 'Running'){exit 28}
  & (Join-Path $PSScriptRoot 'describe-runtime.ps1')
  if($LASTEXITCODE -ne 0){exit $LASTEXITCODE}
  exit 0
} catch { exit 1 }
finally { if($acquired){$mutex.ReleaseMutex()}; $mutex.Dispose() }
