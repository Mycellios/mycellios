param([Parameter(Mandatory=$true)][string]$ConfigFile)
$ErrorActionPreference='Stop'
$job=[IO.Path]::GetDirectoryName([IO.Path]::GetFullPath($ConfigFile))
$result=Join-Path $job 'result.json'
$config=Get-Content -LiteralPath $ConfigFile -Raw -Encoding UTF8|ConvertFrom-Json
$profile=[IO.Path]::GetFullPath($config.profile)
$executable=[IO.Path]::GetFullPath($config.executable)
$installation=[IO.Path]::GetDirectoryName($executable)
$installer=[IO.Path]::GetFullPath($config.installer)
$backup=Join-Path $job 'backup'
$phase='preflight'
$installerLock=$null
function Progress([string]$value){$script:phase=$value;@{phase=$value}|ConvertTo-Json|Set-Content -LiteralPath (Join-Path $job 'progress.json') -Encoding UTF8}
function Copy-Safe([string]$source,[string]$destination,[string[]]$exclude=@()){
 $arguments=@($source,$destination,'/E','/COPY:DAT','/DCOPY:DAT','/XJ','/R:1','/W:1','/NFL','/NDL','/NP','/NJH','/NJS')
 if($exclude.Count){$arguments+=@('/XD');$arguments+=$exclude}
 & robocopy @arguments >> (Join-Path $job 'copy.log')
 if($LASTEXITCODE -ge 8){throw 'Could not make a recoverable backup'}
}
function Installer-Valid {
 $file=Get-Item -LiteralPath $installer
 if(($file.Attributes -band [IO.FileAttributes]::ReparsePoint) -or $file.Length -ne $config.bytes){throw 'Installer size or location changed'}
 $algorithm=[Security.Cryptography.SHA256]::Create()
 try {$installerLock.Position=0;$digest=([BitConverter]::ToString($algorithm.ComputeHash($installerLock))).Replace('-','').ToLowerInvariant();$installerLock.Position=0}finally{$algorithm.Dispose()}
 if($digest -ne $config.sha256){throw 'Installer checksum changed'}
}
function Draft-Stores {
 $folders=@((Join-Path $profile 'Local Storage'),(Join-Path $profile 'Session Storage'),(Join-Path $profile 'IndexedDB'),(Join-Path $profile 'WebStorage'))
 if(Test-Path -LiteralPath (Join-Path $profile 'Partitions')){foreach($partition in Get-ChildItem -LiteralPath (Join-Path $profile 'Partitions') -Directory){foreach($name in @('Local Storage','Session Storage','IndexedDB','WebStorage')){$folders+=Join-Path $partition.FullName $name}}}
 $entries=@{}
 foreach($folder in $folders){if(Test-Path -LiteralPath $folder){foreach($file in Get-ChildItem -LiteralPath $folder -File -Recurse){$entries[$file.FullName.Substring($profile.Length+1)]=(Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash}}}
 return $entries
}
function Installed-Process {
 return ,@(Get-CimInstance Win32_Process -Filter "name='Mycellios Desktop.exe'"|Where-Object {$_.ExecutablePath -and $_.ExecutablePath.Equals($executable,[StringComparison]::OrdinalIgnoreCase)})
}
function Reopen {
 if($config.reopen -eq $false){return}
 if($config.reopenUrl){$url=[Uri]$config.reopenUrl;if($url.Scheme -notin @('http','https') -or $url.UserInfo){throw 'Invalid saved app location'};$env:RAKAZO_WEB_URL=$url.AbsoluteUri}
 Start-Process -FilePath $executable -WindowStyle Hidden | Out-Null
}
try {
 if($config.schema -ne 'mycellios-manual-update/1' -or $config.version -notmatch '^\d{1,6}\.\d{1,6}\.\d{1,6}$' -or $config.sha256 -notmatch '^[a-f0-9]{64}$'){throw 'Invalid native update request'}
 if([IO.Path]::GetFileName($executable) -ne 'Mycellios Desktop.exe' -or $profile.Length -lt 10 -or !$job.StartsWith((Join-Path $profile 'updates')+'\',[StringComparison]::OrdinalIgnoreCase)){throw 'Invalid update scope'}
 if(!$installer.StartsWith((Join-Path $profile 'updates')+'\',[StringComparison]::OrdinalIgnoreCase) -or [IO.Path]::GetFileName($installer) -ne ('Mycellios-Desktop-'+$config.version+'-windows-x64-pilot.exe')){throw 'Invalid installer scope'}
 $installerLock=[IO.File]::Open($installer,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::Read)
 Installer-Valid
 $old=Get-Process -Id $config.oldPid -ErrorAction SilentlyContinue
 if($old){
  if(!$old.Path.Equals($executable,[StringComparison]::OrdinalIgnoreCase)){throw 'The previous process identity changed'}
  $started=$old.StartTime.ToUniversalTime().ToFileTimeUtc()
  Progress 'waiting-for-app'
  if($config.legacyShutdown -eq $true){
   $commit=Get-Content -LiteralPath (Join-Path $job 'commit.json') -Raw -Encoding UTF8|ConvertFrom-Json
   if($commit.approved -ne $true){throw 'The native install request was not committed'}
   # Compatibility handoff for installed versions without the integrated helper.
   # Register only the exact app process, never files or other applications.
   Add-Type -TypeDefinition @'
using System; using System.Text; using System.Runtime.InteropServices;
public static class MycelliosRestartManager {
 [StructLayout(LayoutKind.Sequential)] public struct ProcessIdentity { public uint pid; public System.Runtime.InteropServices.ComTypes.FILETIME started; }
 [DllImport("rstrtmgr.dll",CharSet=CharSet.Unicode)] static extern int RmStartSession(out uint handle,int flags,StringBuilder key);
 [DllImport("rstrtmgr.dll",CharSet=CharSet.Unicode)] static extern int RmRegisterResources(uint handle,uint files,string[] fileNames,uint apps,ProcessIdentity[] processes,uint services,string[] serviceNames);
 [DllImport("rstrtmgr.dll")] static extern int RmShutdown(uint handle,uint flags,IntPtr callback);
 [DllImport("rstrtmgr.dll")] static extern int RmEndSession(uint handle);
 public static int Close(uint pid,long started) {
  uint handle; int code=RmStartSession(out handle,0,new StringBuilder(33)); if(code!=0)return code;
  try { var item=new ProcessIdentity {pid=pid,started=new System.Runtime.InteropServices.ComTypes.FILETIME {dwLowDateTime=(int)started,dwHighDateTime=(int)(started>>32)}};
   code=RmRegisterResources(handle,0,null,1,new[]{item},0,null); return code==0 ? RmShutdown(handle,0,IntPtr.Zero) : code;
  } finally {RmEndSession(handle);}
 }
}
'@
   $closed=[MycelliosRestartManager]::Close([uint32]$config.oldPid,[long]$started)
   if($closed -ne 0){throw 'Windows could not close the previous app gracefully; no forced shutdown was attempted'}
  }
  $deadline=(Get-Date).AddMinutes(5)
  while($true){$current=Get-Process -Id $config.oldPid -ErrorAction SilentlyContinue;if(!$current -or $current.StartTime.ToUniversalTime().ToFileTimeUtc() -ne $started){break};if((Get-Date) -gt $deadline){throw 'The previous app has not finished saving; update was not applied'};Start-Sleep -Milliseconds 250}
 }
 $childrenDeadline=(Get-Date).AddSeconds(30)
 while((Installed-Process).Count){if((Get-Date) -gt $childrenDeadline){throw 'Another instance is using this installation'};Start-Sleep -Milliseconds 250}
 $commit=Get-Content -LiteralPath (Join-Path $job 'commit.json') -Raw -Encoding UTF8|ConvertFrom-Json
 if($commit.approved -ne $true){throw 'The native install request was not committed'}
 Progress 'backing-up'
 if(Test-Path -LiteralPath $backup){throw 'A previous backup already exists for this request'}
 New-Item -ItemType Directory -Path $backup | Out-Null
 $sid=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value
 & icacls $backup '/inheritance:r' '/grant:r' "*${sid}:(OI)(CI)F" '*S-1-5-18:(OI)(CI)F' >> (Join-Path $job 'copy.log')
 if($LASTEXITCODE -ne 0){throw 'Could not protect the private backup'}
 if((Get-PSDrive -Name ([IO.Path]::GetPathRoot($installation).Substring(0,1))).Free -lt 6GB){throw 'Not enough free space for a recoverable update'}
 Copy-Safe $installation (Join-Path $backup 'installation')
 $excluded=@('Cache','Code Cache','GPUCache','DawnGraphiteCache','DawnWebGPUCache','GPUPersistentCache','GrShaderCache','ShaderCache')
 $excluded+=@('updates','computers','local-data','local-web','apps-local-backups','upgrade-backups')|ForEach-Object {Join-Path $profile $_}
 Copy-Safe $profile (Join-Path $backup 'profile') $excluded
 $drafts=Draft-Stores
 $drafts|ConvertTo-Json|Set-Content -LiteralPath (Join-Path $backup 'draft-stores.json') -Encoding UTF8
 Installer-Valid
 if((Installed-Process).Count){throw 'The previous application reopened before installation'}
 Progress 'installing'
 $setup=Start-Process -FilePath $installer -ArgumentList '/S' -WindowStyle Hidden -PassThru -Wait
 if($setup.ExitCode -ne 0){throw 'The installer did not finish successfully'}
 if((Installed-Process).Count){throw 'Unexpected app startup during installation; saved state must be inspected'}
 $version=([Version](Get-Item -LiteralPath $executable).VersionInfo.ProductVersion).ToString(3)
 if($version -ne $config.version){throw 'Installed version does not match the verified release'}
 $after=Draft-Stores
 if($drafts.Count -ne $after.Count){throw 'Saved draft stores changed during installation'}
 foreach($entry in $drafts.GetEnumerator()){if($after[$entry.Key] -ne $entry.Value){throw 'Saved draft stores changed during installation'}}
 Progress 'reopening'
 Reopen
 @{installed=$true;version=$version;draftStoresPreserved=$true;draftStoreFiles=$drafts.Count;backup=$backup;reopened=($config.reopen -ne $false)}|ConvertTo-Json|Set-Content -LiteralPath $result -Encoding UTF8
 exit 0
} catch {
 $failedPhase=$phase
 if($phase -eq 'installing' -and (Test-Path -LiteralPath (Join-Path $backup 'installation')) -and !(Installed-Process).Count){
  try {Copy-Safe (Join-Path $backup 'installation') $installation;Reopen}catch{}
 } elseif((Test-Path -LiteralPath $executable) -and !(Installed-Process).Count){try{Reopen}catch{}}
 @{installed=$false;phase=$failedPhase;error=$_.Exception.Message;backup=$backup}|ConvertTo-Json|Set-Content -LiteralPath $result -Encoding UTF8
 exit 1
} finally {if($installerLock){$installerLock.Dispose()}}
