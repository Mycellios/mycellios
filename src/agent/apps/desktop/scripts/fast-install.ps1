param(
 [Parameter(Mandatory=$true)][ValidateSet('check','prepare','commit','rollback')][string]$Operation,
 [Parameter(Mandatory=$true)][string]$Installation,
 [Parameter(Mandatory=$true)][string]$Journal,
 [string]$Uninstaller,
 [string]$InstallRegistryKey,
 [string]$UninstallRegistryKey,
 [string]$TargetVersion
)
$ErrorActionPreference='Stop'
# The installer may be started from the installation directory. A directory
# cannot be renamed while it is a process's current directory, so always work
# from a neutral one.
Set-Location -LiteralPath $env:TEMP
$installationPath=[IO.Path]::GetFullPath($Installation).TrimEnd('\')
$parent=[IO.Path]::GetDirectoryName($installationPath)
$backupRoot=Join-Path $parent 'mycellios-desktop-upgrade-backups'
$exeName='Mycellios Desktop.exe'
$reg=Join-Path $env:SystemRoot 'System32\reg.exe'

function Hash-File([string]$file) {
 $stream=[IO.File]::OpenRead($file)
 $algorithm=[Security.Cryptography.SHA256]::Create()
 try{return ([BitConverter]::ToString($algorithm.ComputeHash($stream))).Replace('-','')}
 finally{$algorithm.Dispose();$stream.Dispose()}
}

function Assert-Installation {
 if([IO.Path]::GetFileName($installationPath) -ne 'mycellios-desktop' -or
    $installationPath.StartsWith('\\') -or $parent.Length -lt 4){throw 'Unsupported installation scope'}
 for($item=$installationPath;$item.Length -gt 3;$item=[IO.Path]::GetDirectoryName($item)){
  if((Test-Path -LiteralPath $item) -and ((Get-Item -LiteralPath $item -Force).Attributes -band [IO.FileAttributes]::ReparsePoint)){throw 'Installation scope contains a reparse point'}
 }
}
function Assert-Idle {
 $paths=@((Join-Path $installationPath $exeName))
 if($script:state -and $script:state.backup){$paths+=Join-Path $script:state.backup $exeName}
 if(@(Get-CimInstance Win32_Process -Filter "name='Mycellios Desktop.exe'"|Where-Object {$_.ExecutablePath -in $paths}).Count){throw 'Close Mycellios normally before updating'}
}
function Save-State {
 $temporary=$Journal+'.tmp'
 $script:state|ConvertTo-Json -Depth 6|Set-Content -LiteralPath $temporary -Encoding UTF8
 Move-Item -LiteralPath $temporary -Destination $Journal -Force
 if($script:state.backup){
  $folder=[IO.Path]::GetDirectoryName($script:state.backup)
  if(Test-Path -LiteralPath $folder){Copy-Item -LiteralPath $Journal -Destination (Join-Path $folder 'receipt.json') -Force}
 }
}
function Read-State {
 if(!(Test-Path -LiteralPath $Journal)){return $null}
 $value=Get-Content -LiteralPath $Journal -Raw -Encoding UTF8|ConvertFrom-Json
 if($value.schema -ne 'mycellios-fast-install/1' -or $value.installation -ne $installationPath){throw 'Update journal scope differs'}
 if($value.backup){
  $resolved=[IO.Path]::GetFullPath($value.backup)
  if(!$resolved.StartsWith($backupRoot+'\',[StringComparison]::OrdinalIgnoreCase) -or
     [IO.Path]::GetFileName($resolved) -ne 'installation'){throw 'Update backup scope differs'}
 }
 return $value
}
function Restore-Previous {
 if(!$script:state -or !$script:state.backup -or !(Test-Path -LiteralPath $script:state.backup)){return}
 Assert-Idle
 $oldExe=Join-Path $script:state.backup $exeName
 if(!(Test-Path -LiteralPath $oldExe) -or (Get-Item -LiteralPath $oldExe).VersionInfo.ProductName -ne 'Mycellios Desktop'){throw 'Previous installation identity differs'}
 if(Test-Path -LiteralPath $installationPath){
  $failed=Join-Path ([IO.Path]::GetDirectoryName($script:state.backup)) ('failed-'+[Guid]::NewGuid().ToString('N'))
  if(!$failed.StartsWith($backupRoot+'\',[StringComparison]::OrdinalIgnoreCase)){throw 'Failed-installation scope differs'}
  Move-Item -LiteralPath $installationPath -Destination $failed
 }
 Move-Item -LiteralPath $script:state.backup -Destination $installationPath
 foreach($entry in $script:state.registry){
  $file=Join-Path ([IO.Path]::GetDirectoryName($script:state.backup)) $entry.file
  if((Hash-File $file) -ne $entry.sha256){throw 'Registry recovery receipt changed'}
  & $reg import $file|Out-Null
  if($LASTEXITCODE -ne 0){throw 'Could not restore installation registration'}
 }
 foreach($shortcut in $script:state.shortcuts){
  $from=Join-Path ([IO.Path]::GetDirectoryName($script:state.backup)) $shortcut.file
  if((Hash-File $from) -ne $shortcut.sha256){throw 'Shortcut recovery receipt changed'}
  # Respect a shortcut edited while the installer was running.
  if(!(Test-Path -LiteralPath $shortcut.path)){Copy-Item -LiteralPath $from -Destination $shortcut.path}
 }
 $script:state.phase='restored';Save-State
}

function Restore-InterruptedExtraction([string]$version) {
 if(!(Test-Path -LiteralPath $backupRoot -PathType Container) -or
    ((Get-Item -LiteralPath $backupRoot -Force).Attributes -band [IO.FileAttributes]::ReparsePoint)){return}
 $receipts=@(foreach($folder in Get-ChildItem -LiteralPath $backupRoot -Directory){
  if($folder.Name -notmatch '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$' -or
     ($folder.Attributes -band [IO.FileAttributes]::ReparsePoint)){continue}
  $file=Join-Path $folder.FullName 'receipt.json'
  if(!(Test-Path -LiteralPath $file -PathType Leaf)){continue}
  try{$saved=Get-Content -LiteralPath $file -Raw -Encoding UTF8|ConvertFrom-Json}catch{continue}
  if($saved.schema -eq 'mycellios-fast-install/1' -and $saved.phase -eq 'prepared' -and
     $saved.target -eq $version -and $saved.installation -eq $installationPath -and
     $saved.backup -eq (Join-Path $folder.FullName 'installation')){$saved}
 })
 if($receipts.Count -eq 0){return}
 if($receipts.Count -ne 1){throw 'Interrupted installation recovery is ambiguous'}
 $saved=$receipts[0]
 $folder=[IO.Path]::GetDirectoryName($saved.backup)
 $old=Get-Item -LiteralPath $saved.backup -Force
 if(!$old.PSIsContainer -or ($old.Attributes -band [IO.FileAttributes]::ReparsePoint) -or
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
 $shortcutPaths=@((Join-Path ([Environment]::GetFolderPath('Desktop')) 'Mycellios Desktop.lnk'),(Join-Path ([Environment]::GetFolderPath('Programs')) 'Mycellios Desktop.lnk'))
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
  $manifest=Get-Content -LiteralPath (Join-Path $installationPath 'resources\desktop-build.json') -Raw|ConvertFrom-Json
  if($manifest.schema -ne 'mycellios-desktop-build/1' -or $manifest.platform -ne 'windows-x64' -or $manifest.version -notmatch '^\d+\.\d+\.\d+$'){throw 'Installed build identity differs'}
  if([IO.Path]::GetFileName($Uninstaller) -ne $Uninstaller -or $Uninstaller -ne 'Uninstall Mycellios Desktop.exe'){throw 'Installed uninstaller differs'}
  foreach($key in @($InstallRegistryKey,$UninstallRegistryKey)){
   if($key -notmatch '^Software\\(?:Microsoft\\Windows\\CurrentVersion\\Uninstall\\)?\{?[0-9a-fA-F-]{36}\}?$'){throw 'Installation registration scope differs'}
  }
  $fresh=$script:state
  $uninstallPath=Join-Path $installationPath $Uninstaller
  if(!(Test-Path -LiteralPath $uninstallPath -PathType Leaf)){
   Restore-InterruptedExtraction $manifest.version
   if(!(Test-Path -LiteralPath $uninstallPath -PathType Leaf)){throw 'Installed uninstaller differs'}
   $script:state=$fresh
  }
  $folder=Join-Path $backupRoot ([Guid]::NewGuid().ToString())
  New-Item -ItemType Directory -Path $folder -Force|Out-Null
  $sid=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value
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
  $shortcutPaths=@((Join-Path ([Environment]::GetFolderPath('Desktop')) 'Mycellios Desktop.lnk'),(Join-Path ([Environment]::GetFolderPath('Programs')) 'Mycellios Desktop.lnk'))
  $index=0
  foreach($shortcut in $shortcutPaths){if(Test-Path -LiteralPath $shortcut){
   $name='shortcut-'+$index+'.lnk';$file=Join-Path $folder $name
   Copy-Item -LiteralPath $shortcut -Destination $file
   $script:state.shortcuts+=@{file=$name;path=$shortcut;sha256=(Hash-File $file)};$index++
  }}
  Save-State
  Assert-Idle
  # Keep the installation at its path: the taskbar pin and the Start Menu
  # shortcut target this directory, and renaming it makes Windows drop the pin.
  # A same-volume copy still gives us a rollback without changing the path.
  & robocopy $installationPath $script:state.backup /E /COPY:DAT /DCOPY:DAT /XJ /R:2 /W:1 /NFL /NDL /NP /NJH /NJS | Out-Null
  if($LASTEXITCODE -ge 8){throw 'Could not snapshot the installation'}
  $script:state.phase='prepared';Save-State
 } else {
  $script:state=Read-State
  if(!$script:state){exit 0}
  if($Operation -eq 'rollback'){Restore-Previous}
  else {
   $newExe=Join-Path $installationPath $exeName
   $manifest=Get-Content -LiteralPath (Join-Path $installationPath 'resources\desktop-build.json') -Raw|ConvertFrom-Json
   if(!(Test-Path -LiteralPath $newExe) -or $manifest.version -ne $script:state.target -or
      ([Version](Get-Item -LiteralPath $newExe).VersionInfo.ProductVersion).ToString(3) -ne $script:state.target){throw 'New installation is incomplete'}
   $script:state.phase='committed';Save-State
   if($script:state.backup){Copy-Item -LiteralPath $Journal -Destination (Join-Path ([IO.Path]::GetDirectoryName($script:state.backup)) 'receipt.json')}
  }
 }
 exit 0
} catch {
 $failure=$_.Exception.Message
 if($Operation -eq 'prepare'){try{Restore-Previous}catch{}}
 Write-Error ('Desktop update was not applied: '+$failure) -ErrorAction Continue
 exit 1
}
