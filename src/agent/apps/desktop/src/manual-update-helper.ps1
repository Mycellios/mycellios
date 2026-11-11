param([Parameter(Mandatory=$true)][string]$ConfigFile,[switch]$Launch)
$ErrorActionPreference='Stop'
# Never inherit the installation directory as the working directory: Windows
# cannot rename a directory that is a process's current directory, and the
# installer's fast-install step renames it.
Set-Location -LiteralPath $env:TEMP
$job=[IO.Path]::GetDirectoryName([IO.Path]::GetFullPath($ConfigFile))
if($Launch){
 # PowerShell 5.1 needs a console to initialize. The hidden launcher starts
 # another process so the update worker outlives Electron's direct-child job.
 $argsForWorker=@('-NoLogo','-NoProfile','-NonInteractive','-File',('"' + $PSCommandPath + '"'),'-ConfigFile',('"' + $ConfigFile + '"'))
 $worker=Start-Process -FilePath (Join-Path $PSHOME 'powershell.exe') -ArgumentList $argsForWorker -WindowStyle Hidden -WorkingDirectory $env:TEMP -RedirectStandardOutput (Join-Path $job 'helper.log') -RedirectStandardError (Join-Path $job 'helper-error.log') -PassThru
 # Windows PowerShell can lose the native process handle returned by
 # Start-Process. Retain it before waiting so exit/acknowledgement is real.
 $null=$worker.Handle
 $worker.WaitForExit()
 $worker.Refresh()
 exit $worker.ExitCode
}
$result=Join-Path $job 'result.json'
$backup=Join-Path $job 'backup'
$phase='preflight'
$installerLock=$null
$updateLock=$null
$canReopen=$false
$verifiedVersion=$null
function Progress([string]$value){$script:phase=$value;@{phase=$value}|ConvertTo-Json|Set-Content -LiteralPath (Join-Path $job 'progress.json') -Encoding UTF8}
function Write-Result($receipt){
 $temporary=$result+'.tmp'
 $receipt|ConvertTo-Json|Set-Content -LiteralPath $temporary -Encoding UTF8
 [IO.File]::Move($temporary,$result)
}
function Copy-Safe([string]$source,[string]$destination,[string[]]$exclude=@(),[string[]]$excludeFiles=@()){
 $arguments=@($source,$destination,'/E','/COPY:DAT','/DCOPY:DAT','/XJ','/R:10','/W:2','/NFL','/NDL','/NP','/NJH','/NJS')
 if($exclude.Count){$arguments+=@('/XD');$arguments+=$exclude}
 if($excludeFiles.Count){$arguments+=@('/XF');$arguments+=$excludeFiles}
 & robocopy @arguments >> (Join-Path $job 'copy.log')
 if($LASTEXITCODE -ge 8){throw 'Could not make a recoverable backup'}
}
function Get-Sha256([IO.Stream]$stream) {
 $algorithm=[Security.Cryptography.SHA256]::Create()
 try {return ([BitConverter]::ToString($algorithm.ComputeHash($stream))).Replace('-','').ToLowerInvariant()}
 finally {$algorithm.Dispose()}
}
function Installer-Valid {
 $file=Get-Item -LiteralPath $installer
 if(($file.Attributes -band [IO.FileAttributes]::ReparsePoint) -or $file.Length -ne $config.bytes){throw 'Installer size or location changed'}
 $installerLock.Position=0
 $digest=Get-Sha256 $installerLock
 $installerLock.Position=0
 if($digest -ne $config.sha256){throw 'Installer checksum changed'}
}
function Draft-Stores {
 $folders=@((Join-Path $profile 'Local Storage'),(Join-Path $profile 'Session Storage'),(Join-Path $profile 'IndexedDB'),(Join-Path $profile 'WebStorage'))
 if(Test-Path -LiteralPath (Join-Path $profile 'Partitions')){foreach($partition in Get-ChildItem -LiteralPath (Join-Path $profile 'Partitions') -Directory){foreach($name in @('Local Storage','Session Storage','IndexedDB','WebStorage')){$folders+=Join-Path $partition.FullName $name}}}
 $entries=@{}
 foreach($folder in $folders){
  if(!(Test-Path -LiteralPath $folder)){continue}
  foreach($file in Get-ChildItem -LiteralPath $folder -File -Recurse){
   $stream=[IO.File]::OpenRead($file.FullName)
   try {$entries[$file.FullName.Substring($profile.Length+1)]=Get-Sha256 $stream}
   finally {$stream.Dispose()}
  }
 }
 return $entries
}
function Installed-Process {
 return ,@(Get-CimInstance Win32_Process -Filter "name='Mycellios Desktop.exe'"|Where-Object {$_.ExecutablePath -and $_.ExecutablePath.Equals($executable,[StringComparison]::OrdinalIgnoreCase)})
}
function Reopen([switch]$Confirm) {
 if($config.reopen -eq $false){return}
 if($config.reopenUrl){$url=[Uri]$config.reopenUrl;if($url.Scheme -notin @('http','https') -or $url.UserInfo){throw 'Invalid saved app location'};$env:RAKAZO_WEB_URL=$url.AbsoluteUri}
 if(!$Confirm){Start-Process -FilePath $executable -WindowStyle Normal | Out-Null;return}
 $app=Start-Process -FilePath $executable -ArgumentList ('--manual-update-job='+[IO.Path]::GetFileName($job)) -WindowStyle Normal -PassThru
 $null=$app.Handle
 $launch=Join-Path $job 'launch.json'
 $deadline=(Get-Date).AddMinutes(2)
 do {
  if(Test-Path -LiteralPath $launch){
   $receipt=Get-Content -LiteralPath $launch -Raw -Encoding UTF8|ConvertFrom-Json
   if($receipt.version -eq $config.version -and $receipt.pid -eq $app.Id -and !$app.HasExited){return}
  }
  if($app.HasExited){throw 'The installed app exited before confirming startup'}
  Start-Sleep -Milliseconds 250
 } while((Get-Date) -lt $deadline)
 throw 'The installed app did not confirm startup'
}
try {
 $config=Get-Content -LiteralPath $ConfigFile -Raw -Encoding UTF8|ConvertFrom-Json
 $profile=[IO.Path]::GetFullPath($config.profile)
 $executable=[IO.Path]::GetFullPath($config.executable)
 $installation=[IO.Path]::GetDirectoryName($executable)
 $installer=[IO.Path]::GetFullPath($config.installer)
 if($config.schema -ne 'mycellios-manual-update/1' -or $config.version -notmatch '^\d{1,6}\.\d{1,6}\.\d{1,6}$' -or $config.sha256 -notmatch '^[a-f0-9]{64}$'){throw 'Invalid native update request'}
 if([IO.Path]::GetFileName($executable) -ne 'Mycellios Desktop.exe' -or $profile.Length -lt 10 -or !$job.StartsWith((Join-Path $profile 'updates')+'\',[StringComparison]::OrdinalIgnoreCase)){throw 'Invalid update scope'}
 if(!$installer.StartsWith((Join-Path $profile 'updates')+'\',[StringComparison]::OrdinalIgnoreCase) -or [IO.Path]::GetFileName($installer) -ne ('Mycellios-Desktop-'+$config.version+'-windows-x64-pilot.exe')){throw 'Invalid installer scope'}
 # A second app instance must not start a competing install while a worker is
 # waiting for Windows, backing up or replacing this profile's installation.
 $updateLock=[IO.File]::Open((Join-Path (Split-Path $job -Parent) 'active-install.lock'),[IO.FileMode]::OpenOrCreate,[IO.FileAccess]::ReadWrite,[IO.FileShare]::None)
 $installerLock=[IO.File]::Open($installer,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::Read)
 Installer-Valid
 $old=Get-Process -Id $config.oldPid -ErrorAction SilentlyContinue
 if($old){
  if(!$old.Path.Equals($executable,[StringComparison]::OrdinalIgnoreCase)){throw 'The previous process identity changed'}
  $started=$old.StartTime.ToUniversalTime().ToFileTimeUtc()
  Progress 'waiting-for-app'
  $deadline=(Get-Date).AddMinutes(5)
  while($true){$current=Get-Process -Id $config.oldPid -ErrorAction SilentlyContinue;if(!$current -or $current.StartTime.ToUniversalTime().ToFileTimeUtc() -ne $started){break};if((Get-Date) -gt $deadline){throw 'The previous app has not finished saving; update was not applied'};Start-Sleep -Milliseconds 250}
 }
 $childrenDeadline=(Get-Date).AddSeconds(30)
 while((Installed-Process).Count){if((Get-Date) -gt $childrenDeadline){throw 'Another instance is using this installation'};Start-Sleep -Milliseconds 250}
 $commit=Get-Content -LiteralPath (Join-Path $job 'commit.json') -Raw -Encoding UTF8|ConvertFrom-Json
 if($commit.approved -ne $true){throw 'The native install request was not committed'}
 $canReopen=$true
 Progress 'backing-up'
 foreach($location in @($installation,$profile)){
  if((Get-PSDrive -Name ([IO.Path]::GetPathRoot($location).Substring(0,1))).Free -lt 6GB){throw 'Not enough free space for a recoverable update'}
 }
 if(Test-Path -LiteralPath $backup){throw 'A previous backup already exists for this request'}
 New-Item -ItemType Directory -Path $backup | Out-Null
 $sid=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value
 & icacls $backup '/inheritance:r' '/grant:r' "*${sid}:(OI)(CI)F" '*S-1-5-18:(OI)(CI)F' >> (Join-Path $job 'copy.log')
 if($LASTEXITCODE -ne 0){throw 'Could not protect the private backup'}
 Copy-Safe $installation (Join-Path $backup 'installation')
 $excluded=@('Cache','Code Cache','GPUCache','DawnGraphiteCache','DawnWebGPUCache','GPUPersistentCache','GrShaderCache','ShaderCache')
 $excluded+=@('updates','computers','local-data','local-web','apps-local-backups','upgrade-backups')|ForEach-Object {Join-Path $profile $_}
 Copy-Safe $profile (Join-Path $backup 'profile') $excluded @('Cookies','Cookies-journal')
 $drafts=Draft-Stores
 $drafts|ConvertTo-Json|Set-Content -LiteralPath (Join-Path $backup 'draft-stores.json') -Encoding UTF8
 Installer-Valid
 if((Installed-Process).Count){throw 'The previous application reopened before installation'}
 Progress 'starting-installer'
 # Wait for NSIS itself. Start-Process -Wait waits for its whole process tree,
 # which can keep the helper in "installing" after the installer has exited.
 # Keep normal Windows downloaded-file checks visible. Hiding this launch can
 # leave the app closed behind a shell/security prompt with no installer PID.
 $setup=Start-Process -FilePath $installer -ArgumentList '/S' -WindowStyle Normal -WorkingDirectory $env:TEMP -PassThru
 $null=$setup.Handle
 Progress 'installing'
 if(!$setup.WaitForExit(600000)){
  # An installer still running may own files. Leave it and its recovery data alone.
  $canReopen=$false
  Progress 'installer-timeout'
  throw 'The installer is still running after ten minutes'
 }
 $setup.Refresh()
 if($setup.ExitCode -ne 0){throw 'The installer did not finish successfully'}
 if((Installed-Process).Count){throw 'Unexpected app startup during installation; saved state must be inspected'}
 $version=([Version](Get-Item -LiteralPath $executable).VersionInfo.ProductVersion).ToString(3)
 if($version -ne $config.version){throw 'Installed version does not match the verified release'}
 $after=Draft-Stores
 if($drafts.Count -ne $after.Count){throw 'Saved draft stores changed during installation'}
 foreach($entry in $drafts.GetEnumerator()){if($after[$entry.Key] -ne $entry.Value){throw 'Saved draft stores changed during installation'}}
 $verifiedVersion=$version
 Progress 'reopening'
 Reopen -Confirm
 Write-Result @{installed=$true;version=$version;draftStoresPreserved=$true;draftStoreFiles=$drafts.Count;backup=$backup;reopened=($config.reopen -ne $false)}
 exit 0
} catch {
 $failedPhase=$phase
 if($phase -eq 'installing' -and (Test-Path -LiteralPath (Join-Path $backup 'installation')) -and !(Installed-Process).Count){
  try {Copy-Safe (Join-Path $backup 'installation') $installation;Reopen}catch{}
 } elseif(!$verifiedVersion -and $canReopen -and (Test-Path -LiteralPath $executable) -and !(Installed-Process).Count){try{Reopen}catch{}}
 Write-Result @{installed=($null -ne $verifiedVersion);version=$verifiedVersion;reopened=$false;phase=$failedPhase;error=$_.Exception.Message;backup=$backup}
 exit 1
} finally {if($installerLock){$installerLock.Dispose()};if($updateLock){$updateLock.Dispose()}}
