param([Parameter(Mandatory=$true)][string]$Candidate,[Parameter(Mandatory=$true)][string]$Installation,[Parameter(Mandatory=$true)][string]$Result)
$ErrorActionPreference='Stop'
if($env:GITHUB_ACTIONS -ne 'true'){throw 'Installer timing requires an isolated hosted Windows runner'}
$root=[IO.Path]::GetFullPath($Installation)
$allowed=[IO.Path]::GetFullPath($env:RUNNER_TEMP).TrimEnd('\')+'\'
if(!$root.StartsWith($allowed,[StringComparison]::OrdinalIgnoreCase) -or [IO.Path]::GetFileName($root) -ne 'mycellios-desktop'){throw 'Installer qualification scope differs'}
$watch=[Diagnostics.Stopwatch]::StartNew()
$process=Start-Process -FilePath $Candidate -ArgumentList @('/S',('/D='+$root)) -WindowStyle Hidden -PassThru -Wait
$watch.Stop()
@{exitCode=$process.ExitCode;elapsedMs=$watch.Elapsed.TotalMilliseconds;installation=$root}|ConvertTo-Json|Set-Content -LiteralPath $Result -Encoding UTF8
if($process.ExitCode -ne 0){exit 1}
