param(
  [Parameter(Mandatory=$true)][string]$Msi,
  [Parameter(Mandatory=$true)][ValidatePattern('^[a-f0-9]{64}$')][string]$ExpectedSha256
)
# One-time hop for a node enrolled before signed component updates
# (specs/node-runtime-auto-update, Activation step 5). It replaces only the
# product files through the MSI MajorUpgrade. The identity, configuration and
# service definition in ProgramData are never created, replaced or removed.
$ErrorActionPreference='Stop'
$principal=New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
if(-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  function Q([string]$Value) { "'"+$Value.Replace("'","''")+"'" }
  $command='& '+(Q $PSCommandPath)+' -Msi '+(Q $Msi)+' -ExpectedSha256 '+(Q $ExpectedSha256)
  $encoded=[Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($command))
  try {
    $child=Start-Process -FilePath powershell.exe -Verb RunAs -WindowStyle Hidden -ArgumentList @('-NoProfile','-ExecutionPolicy','Bypass','-EncodedCommand',$encoded) -Wait -PassThru
    exit $child.ExitCode
  } catch { exit 1223 }
}
$mutex=New-Object Threading.Mutex($false,'Global\MycelliosDesktopRuntimeInstall')
$acquired=$false
$stopped=$false
try {
  $acquired=$mutex.WaitOne(0)
  if(-not $acquired){exit 23}
  $root=Join-Path $env:ProgramFiles 'Mycellios'
  $config=Join-Path $env:ProgramData 'Mycellios\Configuration\node.json'
  $trust=Join-Path $root 'app\component-update-trust.json'
  # Only an existing enrolled runtime is upgraded; enrollment stays install-runtime.ps1.
  if(-not (Test-Path -LiteralPath $config)){exit 31}
  if(-not (Test-Path -LiteralPath (Join-Path $root 'bin\node.exe'))){exit 32}
  if(Test-Path -LiteralPath $trust){exit 0}
  $msiItem=Get-Item -LiteralPath $Msi
  if($msiItem.Attributes -band [IO.FileAttributes]::ReparsePoint){exit 24}
  if((Get-FileHash -LiteralPath $Msi -Algorithm SHA256).Hash.ToLowerInvariant() -ne $ExpectedSha256){exit 25}
  $service=Get-Service -Name MycelliosNode -ErrorAction Stop
  if($service.Status -ne 'Stopped'){
    Stop-Service -Name MycelliosNode -Force -ErrorAction Stop
    $service.WaitForStatus('Stopped',[TimeSpan]::FromSeconds(120))
  }
  $stopped=$true
  $installed=Start-Process -FilePath msiexec.exe -WindowStyle Hidden -ArgumentList @('/i',('"'+$Msi+'"'),'/qn','/norestart') -Wait -PassThru
  if($installed.ExitCode -ne 0 -and $installed.ExitCode -ne 3010){exit $installed.ExitCode}
  if(-not (Test-Path -LiteralPath $config)){exit 27}
  if(-not (Test-Path -LiteralPath $trust)){exit 33}
  Start-Service -Name MycelliosNode -ErrorAction Stop
  $stopped=$false
  (Get-Service -Name MycelliosNode).WaitForStatus('Running',[TimeSpan]::FromSeconds(120))
  exit 0
} catch { exit 1 }
finally {
  # A failed MSI rolls itself back; the previous runtime must keep contributing.
  if($stopped){Start-Service -Name MycelliosNode -ErrorAction SilentlyContinue}
  if($acquired){$mutex.ReleaseMutex()}
  $mutex.Dispose()
}
