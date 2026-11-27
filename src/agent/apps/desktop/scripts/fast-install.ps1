param(
 [Parameter(Mandatory=$true)][ValidateSet('check','prepare','commit','rollback')][string]$Operation,
 [Parameter(Mandatory=$true)][string]$Installation,
 [Parameter(Mandatory=$true)][string]$Journal,
 [string]$Uninstaller,
 [string]$InstallRegistryKey,
 [string]$UninstallRegistryKey,
 [string]$TargetVersion
)
# This script must also run in PowerShell's ConstrainedLanguage mode, which WDAC and
# AppLocker impose on unsigned scripts (common on managed work PCs). That mode refuses
# method calls on .NET types other than core ones ([IO.Path]::..., [Guid]::NewGuid(),
# SHA256.Create(), ...). Use cmdlets, string methods and Windows executables only;
# fast-install.test.mjs runs every case in both language modes.
$ErrorActionPreference='Stop'
# New-Guid, ConvertTo-Json and the other utility cmdlets come from Windows PowerShell's own
# module folder. Command discovery can miss them when the module path was inherited from
# another PowerShell (a PowerShell 7 terminal or CI step): load them from $PSHOME explicitly.
Import-Module (Join-Path $PSHOME 'Modules\Microsoft.PowerShell.Utility\Microsoft.PowerShell.Utility.psd1')
$exeName='Mycellios Desktop.exe'
$appRunning='Close Mycellios normally before updating'
# Settled recovery copies (a committed update, or one already rolled back) only serve a manual
# rollback. Keep the newest ones so each successful update does not leave another full copy of
# the application (about 1.5-2 GB) behind.
$retainedRecoveries=2
$reg=Join-Path $env:SystemRoot 'System32\reg.exe'
$certutil=Join-Path $env:SystemRoot 'System32\certutil.exe'
$cmd=Join-Path $env:SystemRoot 'System32\cmd.exe'
$whoami=Join-Path $env:SystemRoot 'System32\whoami.exe'

# A drive-rooted Windows path without "." or ".." segments, backslashes only and no
# trailing separator. Paths come from the installer or from this script's own journal.
function Get-NormalPath([string]$path) {
 $value=($path -replace '/','\') -replace '(?<!^)\\{2,}','\'
 if($value -notmatch '^[A-Za-z]:\\' -or $value -match '(^|\\)\.{1,2}(\\|$)'){throw 'Unsupported installation scope'}
 if($value.Length -gt 3){$value=$value.TrimEnd('\')}
 return $value
}
function Test-Under([string]$path,[string]$root) {
 $prefix=$root+'\'
 return $path.Length -gt $prefix.Length -and $path.Substring(0,$prefix.Length) -eq $prefix
}
function Test-Reparse($item) { return "$($item.Attributes)" -match 'ReparsePoint' }
function New-Id { return (New-Guid).Guid }
function Hash-File([string]$file) {
 # Native tools may write to stderr; inside these helpers that is not a PowerShell error.
 $ErrorActionPreference='Continue'
 $lines=@(& $certutil -hashfile $file SHA256 2>$null)
 if($LASTEXITCODE -ne 0){throw 'Could not hash a recovery file'}
 $hash=(@($lines|Where-Object {"$_" -match '^[0-9A-Fa-f ]{64,95}$'})[0] -replace ' ','')
 if($hash -notmatch '^[0-9A-Fa-f]{64}$'){throw 'Could not hash a recovery file'}
 return $hash.ToUpperInvariant()
}
# Folders as Explorer resolves them for this user (the same values as Environment.GetFolderPath).
function Get-ShellFolder([string]$name,[string]$fallback) {
 try{
  $value=Get-ItemPropertyValue -LiteralPath 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Explorer\Shell Folders' -Name $name
  if($value){return $value}
 }catch{}
 return $fallback
}
function Get-ShortcutPaths {
 $desktop=Get-ShellFolder 'Desktop' (Join-Path $env:USERPROFILE 'Desktop')
 $programs=Get-ShellFolder 'Programs' (Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs')
 return @((Join-Path $desktop 'Mycellios Desktop.lnk'),(Join-Path $programs 'Mycellios Desktop.lnk'))
}
# rmdir removes a directory link without following it, unlike Remove-Item -Recurse in
# Windows PowerShell 5.1.
function Remove-Tree([string]$path) {
 $ErrorActionPreference='Continue'
 & $cmd /d /c rmdir /s /q "$path" 2>$null|Out-Null
 if(Test-Path -LiteralPath $path){throw 'Could not remove a recovery copy'}
}

function Assert-Installation {
 if((Split-Path -Leaf $installationPath) -ne 'mycellios-desktop' -or $parent.Length -lt 4){throw 'Unsupported installation scope'}
 for($item=$installationPath;$item.Length -gt 3;$item=Split-Path -Parent $item){
  if((Test-Path -LiteralPath $item) -and (Test-Reparse (Get-Item -LiteralPath $item -Force))){throw 'Installation scope contains a reparse point'}
 }
}
function Assert-Idle {
 $paths=@((Join-Path $installationPath $exeName))
 if($script:state -and $script:state.backup){$paths+=Join-Path $script:state.backup $exeName}
 if(@(Get-CimInstance Win32_Process -Filter "name='Mycellios Desktop.exe'"|Where-Object {$_.ExecutablePath -in $paths}).Count){throw $appRunning}
}
function Save-State {
 $temporary=$Journal+'.tmp'
 $script:state|ConvertTo-Json -Depth 6|Set-Content -LiteralPath $temporary -Encoding UTF8
 Move-Item -LiteralPath $temporary -Destination $Journal -Force
 if($script:state.backup){
  $folder=Split-Path -Parent $script:state.backup
  if(Test-Path -LiteralPath $folder){Copy-Item -LiteralPath $Journal -Destination (Join-Path $folder 'receipt.json') -Force}
 }
}
function Read-State {
 if(!(Test-Path -LiteralPath $Journal)){return $null}
 $value=Get-Content -LiteralPath $Journal -Raw -Encoding UTF8|ConvertFrom-Json
 if($value.schema -ne 'mycellios-fast-install/1' -or $value.installation -ne $installationPath){throw 'Update journal scope differs'}
 if($value.backup){
  $resolved=Get-NormalPath $value.backup
  if(!(Test-Under $resolved $backupRoot) -or (Split-Path -Leaf $resolved) -ne 'installation'){throw 'Update backup scope differs'}
 }
 return $value
}
function Restore-Previous {
 if(!$script:state -or !$script:state.backup -or !(Test-Path -LiteralPath $script:state.backup)){return}
 Assert-Idle
 $oldExe=Join-Path $script:state.backup $exeName
 if(!(Test-Path -LiteralPath $oldExe) -or (Get-Item -LiteralPath $oldExe).VersionInfo.ProductName -ne 'Mycellios Desktop'){throw 'Previous installation identity differs'}
 $folder=Split-Path -Parent $script:state.backup
 if(Test-Path -LiteralPath $installationPath){
  $failed=Join-Path $folder ('failed-'+((New-Id) -replace '-',''))
  if(!(Test-Under $failed $backupRoot)){throw 'Failed-installation scope differs'}
  Move-Item -LiteralPath $installationPath -Destination $failed
 }
 Move-Item -LiteralPath $script:state.backup -Destination $installationPath
 foreach($entry in $script:state.registry){
  $file=Join-Path $folder $entry.file
  if((Hash-File $file) -ne $entry.sha256){throw 'Registry recovery receipt changed'}
  & $reg import $file|Out-Null
  if($LASTEXITCODE -ne 0){throw 'Could not restore installation registration'}
 }
 foreach($shortcut in $script:state.shortcuts){
  $from=Join-Path $folder $shortcut.file
  if((Hash-File $from) -ne $shortcut.sha256){throw 'Shortcut recovery receipt changed'}
  # Respect a shortcut edited while the installer was running.
  if(!(Test-Path -LiteralPath $shortcut.path)){Copy-Item -LiteralPath $from -Destination $shortcut.path}
 }
 $script:state.phase='restored';Save-State
}

# Only settled receipts for this installation are removed; a 'prepared' or 'preparing' one may still
# be needed to recover an interrupted extraction, so it always stays.
function Remove-SettledRecoveries {
 if(!(Test-Path -LiteralPath $backupRoot -PathType Container) -or (Test-Reparse (Get-Item -LiteralPath $backupRoot -Force))){return}
 $settled=@(foreach($folder in Get-ChildItem -LiteralPath $backupRoot -Directory -Force){
  if($folder.Name -notmatch '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$' -or (Test-Reparse $folder)){continue}
  $file=Join-Path $folder.FullName 'receipt.json'
  if(!(Test-Path -LiteralPath $file -PathType Leaf)){continue}
  try{$saved=Get-Content -LiteralPath $file -Raw -Encoding UTF8|ConvertFrom-Json}catch{continue}
  if($saved.schema -eq 'mycellios-fast-install/1' -and $saved.phase -in @('committed','restored') -and
     $saved.installation -eq $installationPath -and
     $saved.backup -eq (Join-Path $folder.FullName 'installation')){
   @{Path=$folder.FullName;At=(Get-Item -LiteralPath $file).LastWriteTimeUtc}
  }
 })
 foreach($old in @($settled|Sort-Object {$_.At} -Descending|Select-Object -Skip $retainedRecoveries)){
  # The application copy goes first and the receipt last, so a copy that cannot be
  # removed now is still recognised and retried on the next update.
  try{
   $copy=Join-Path $old.Path 'installation'
   if(Test-Path -LiteralPath $copy){Remove-Tree $copy}
   Remove-Tree $old.Path
  }catch{}
 }
}

function Read-Manifest {
 try{return Get-Content -LiteralPath (Join-Path $installationPath 'resources\desktop-build.json') -Raw|ConvertFrom-Json}catch{return $null}
}
# An interrupted extraction leaves a partial new version in place, so the receipt
# is matched by installation and backup scope, not by the version it targeted.
function Restore-InterruptedExtraction {
 if(!(Test-Path -LiteralPath $backupRoot -PathType Container) -or (Test-Reparse (Get-Item -LiteralPath $backupRoot -Force))){return}
 $receipts=@(foreach($folder in Get-ChildItem -LiteralPath $backupRoot -Directory){
  if($folder.Name -notmatch '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$' -or (Test-Reparse $folder)){continue}
  $file=Join-Path $folder.FullName 'receipt.json'
  if(!(Test-Path -LiteralPath $file -PathType Leaf)){continue}
  try{$saved=Get-Content -LiteralPath $file -Raw -Encoding UTF8|ConvertFrom-Json}catch{continue}
  if($saved.schema -eq 'mycellios-fast-install/1' -and $saved.phase -eq 'prepared' -and
     $saved.installation -eq $installationPath -and
     $saved.backup -eq (Join-Path $folder.FullName 'installation')){$saved}
 })
 if($receipts.Count -eq 0){return}
 if($receipts.Count -ne 1){throw 'Interrupted installation recovery is ambiguous'}
 $saved=$receipts[0]
 $folder=Split-Path -Parent $saved.backup
 $old=Get-Item -LiteralPath $saved.backup -Force
 if(!$old.PSIsContainer -or (Test-Reparse $old) -or
    !(Test-Path -LiteralPath (Join-Path $saved.backup $Uninstaller) -PathType Leaf)){throw 'Incomplete installation recovery'}
 $keys=@($InstallRegistryKey,$UninstallRegistryKey)
 if(@($saved.registry).Count -ne $keys.Count){throw 'Incomplete registration recovery'}
 for($index=0;$index -lt $keys.Count;$index++){
  $entry=$saved.registry[$index]
  if($entry.file -ne ('registration-'+$index+'.reg')){throw 'Unexpected registration recovery file'}
  $file=Join-Path $folder $entry.file
  $headers=@(Get-Content -LiteralPath $file | Where-Object { $_ -match '^\[' })
  if($headers.Count -ne 1 -or $headers[0] -ne ('[HKEY_CURRENT_USER\'+$keys[$index]+']') -or
     (Hash-File $file) -ne $entry.sha256){throw 'Registration recovery scope differs'}
 }
 $shortcutPaths=Get-ShortcutPaths
 $index=0
 foreach($shortcut in $saved.shortcuts){
  if($shortcut.path -notin $shortcutPaths -or $shortcut.file -ne ('shortcut-'+$index+'.lnk') -or
     (Hash-File (Join-Path $folder $shortcut.file)) -ne $shortcut.sha256){throw 'Shortcut recovery scope differs'}
  $index++
 }
 $script:state=$saved
 Restore-Previous
 Remove-Item -LiteralPath $Journal
 $script:state=$null
}

try {
 # The installer may be started from the installation directory. A directory
 # cannot be renamed while it is a process's current directory, so always work
 # from a neutral one.
 Set-Location -LiteralPath $env:TEMP
 $installationPath=Get-NormalPath $Installation
 $parent=Split-Path -Parent $installationPath
 $backupRoot=Join-Path $parent 'mycellios-desktop-upgrade-backups'
 Assert-Installation
 if($Operation -eq 'check'){
  $script:state=Read-State;Assert-Idle;exit 0
 } elseif($Operation -eq 'prepare'){
  if($TargetVersion -notmatch '^\d{1,6}\.\d{1,6}\.\d{1,6}$'){throw 'Invalid target version'}
  if(Test-Path -LiteralPath $Journal){throw 'Update preparation already exists'}
  $script:state=@{schema='mycellios-fast-install/1';installation=$installationPath;backup=$null;target=$TargetVersion;phase='fresh';registry=@();shortcuts=@()}
  Assert-Idle
  $oldExe=Join-Path $installationPath $exeName
  if(!(Test-Path -LiteralPath $oldExe)){Save-State;exit 0}
  if((Get-Item -LiteralPath $oldExe).VersionInfo.ProductName -ne 'Mycellios Desktop'){throw 'Installed product identity differs'}
  if($Uninstaller -ne 'Uninstall Mycellios Desktop.exe'){throw 'Installed uninstaller differs'}
  foreach($key in @($InstallRegistryKey,$UninstallRegistryKey)){
   if($key -notmatch '^Software\\(?:Microsoft\\Windows\\CurrentVersion\\Uninstall\\)?\{?[0-9a-fA-F-]{36}\}?$'){throw 'Installation registration scope differs'}
  }
  $fresh=$script:state
  $uninstallPath=Join-Path $installationPath $Uninstaller
  if(!(Test-Path -LiteralPath $uninstallPath -PathType Leaf) -or !(Read-Manifest)){
   Restore-InterruptedExtraction
   if(!(Test-Path -LiteralPath $uninstallPath -PathType Leaf)){throw 'Installed uninstaller differs'}
   $script:state=$fresh
  }
  $manifest=Get-Content -LiteralPath (Join-Path $installationPath 'resources\desktop-build.json') -Raw|ConvertFrom-Json
  if($manifest.schema -ne 'mycellios-desktop-build/1' -or $manifest.platform -ne 'windows-x64' -or $manifest.version -notmatch '^\d+\.\d+\.\d+$'){throw 'Installed build identity differs'}
  $folder=Join-Path $backupRoot (New-Id)
  New-Item -ItemType Directory -Path $folder -Force|Out-Null
  $sid=((@(& $whoami /user /fo csv /nh)[-1] -split ',')[-1]).Trim('"')
  if($sid -notmatch '^S-1-[0-9-]+$'){throw 'Could not protect installation recovery'}
  & icacls $folder '/inheritance:r' '/grant:r' "*${sid}:(OI)(CI)F" '*S-1-5-18:(OI)(CI)F'|Out-Null
  if($LASTEXITCODE -ne 0){throw 'Could not protect installation recovery'}
  $script:state.backup=Join-Path $folder 'installation'
  Copy-Item -LiteralPath $PSCommandPath -Destination (Join-Path $folder 'restore.ps1')
  $script:state.phase='preparing';Save-State
  $index=0
  foreach($key in @($InstallRegistryKey,$UninstallRegistryKey)){
   $name='registration-'+$index+'.reg';$file=Join-Path $folder $name
   & $reg export ('HKCU\'+$key) $file /y|Out-Null
   if($LASTEXITCODE -ne 0){throw 'Could not preserve installation registration'}
   $script:state.registry+=@{file=$name;sha256=(Hash-File $file)};$index++
  }
  $index=0
  foreach($shortcut in (Get-ShortcutPaths)){if(Test-Path -LiteralPath $shortcut){
   $name='shortcut-'+$index+'.lnk';$file=Join-Path $folder $name
   Copy-Item -LiteralPath $shortcut -Destination $file
   $script:state.shortcuts+=@{file=$name;path=$shortcut;sha256=(Hash-File $file)};$index++
  }}
  Save-State
  Assert-Idle
  # Both resolved paths are siblings on the same volume. No profile path is moved.
  Move-Item -LiteralPath $installationPath -Destination $script:state.backup
  New-Item -ItemType Directory -Path $installationPath|Out-Null
  Copy-Item -LiteralPath (Join-Path $script:state.backup $Uninstaller) -Destination (Join-Path $installationPath $Uninstaller)
  $script:state.phase='prepared';Save-State
 } else {
  $script:state=Read-State
  if(!$script:state){exit 0}
  if($Operation -eq 'rollback'){Restore-Previous}
  else {
   $newExe=Join-Path $installationPath $exeName
   $manifest=Get-Content -LiteralPath (Join-Path $installationPath 'resources\desktop-build.json') -Raw|ConvertFrom-Json
   $installed=if(Test-Path -LiteralPath $newExe){(@((Get-Item -LiteralPath $newExe).VersionInfo.ProductVersion -split '\.')[0..2]) -join '.'}
   if(!$installed -or $manifest.version -ne $script:state.target -or $installed -ne $script:state.target){throw 'New installation is incomplete'}
   $script:state.phase='committed';Save-State
   if($script:state.backup){Copy-Item -LiteralPath $Journal -Destination (Join-Path (Split-Path -Parent $script:state.backup) 'receipt.json')}
   # The update is in place; tidying old copies must never turn it into a failure.
   try{Remove-SettledRecoveries}catch{}
  }
 }
 exit 0
} catch {
 $failure=$_.Exception.Message
 if($Operation -eq 'prepare'){
  try{
   $errorFile=Join-Path $env:TEMP 'mycellios-fast-install-error.txt'
   Set-Content -LiteralPath $errorFile -Value $failure -Encoding UTF8
  }catch{}
  try{Restore-Previous}catch{}
 }
 Write-Error ('Desktop update was not applied: '+$failure) -ErrorAction Continue
 # The installer asks the person to close Mycellios for this one instead of reporting a failed update.
 if($failure -eq $appRunning){exit 3}
 exit 1
}
