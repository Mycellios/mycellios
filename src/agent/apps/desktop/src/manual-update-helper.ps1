param([Parameter(Mandatory=$true)][string]$ConfigFile,[switch]$Launch)
$ErrorActionPreference='Stop'
Add-Type -TypeDefinition @'
using System;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
[ComImport,Guid("73db1241-1e85-4581-8e4f-a81e1d0f8c57"),InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface IMycelliosAttachment {
 void SetClientTitle([MarshalAs(UnmanagedType.LPWStr)]string value);
 void SetClientGuid(ref Guid value);
 void SetLocalPath([MarshalAs(UnmanagedType.LPWStr)]string value);
 void SetFileName([MarshalAs(UnmanagedType.LPWStr)]string value);
 void SetSource([MarshalAs(UnmanagedType.LPWStr)]string value);
 void SetReferrer([MarshalAs(UnmanagedType.LPWStr)]string value);
 [PreserveSig]int CheckPolicy();
 [PreserveSig]int Prompt(IntPtr window,int kind,out int action);
 [PreserveSig]int Save();
}
public static class MycelliosAttachment {
 public static void Approve(string file,string source,IntPtr owner) {
  var attachment=(IMycelliosAttachment)Activator.CreateInstance(Type.GetTypeFromCLSID(new Guid("4125dd96-e03a-4103-8f70-e0597d803b9c")));
  try {
   var client=new Guid("1e433c96-ef84-4b21-b6c9-4a8615e0d472");
   attachment.SetClientGuid(ref client);attachment.SetClientTitle("Mycellios");
   attachment.SetLocalPath(file);attachment.SetFileName(System.IO.Path.GetFileName(file));
   if(!String.IsNullOrEmpty(source))attachment.SetSource(source);
   // Windows may scan or quarantine the attachment and update its evidence.
   int saved=attachment.Save();
   if(saved!=0){Marshal.ThrowExceptionForHR(saved);throw new InvalidOperationException("Windows did not validate the installer");}
   int policy=attachment.CheckPolicy();
   if(policy==1){
    if(owner==IntPtr.Zero)throw new InvalidOperationException("Open Mycellios to review the Windows file check before restarting");
    int action;int prompt=attachment.Prompt(owner,2,out action);
    if(prompt!=0){Marshal.ThrowExceptionForHR(prompt);throw new OperationCanceledException("Windows file check was not approved");}
    if(action!=2)throw new OperationCanceledException("Windows file check was cancelled");
   }else if(policy!=0){Marshal.ThrowExceptionForHR(policy);throw new InvalidOperationException("Windows blocked the installer");}
  }finally{Marshal.FinalReleaseComObject(attachment);}
 }
}
public static class MycelliosUpdatePath {
 [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr window,int command);
 [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
 private static extern uint GetLongPathName(string path, StringBuilder result, uint capacity);
 public static string Canonical(string path) {
  path=Path.GetFullPath(path);
  var result=new StringBuilder(32768);
  uint count=GetLongPathName(path,result,(uint)result.Capacity);
  if(count>0 && count<result.Capacity)return result.ToString();
  // During recovery a leaf may not exist yet. Expand its existing ancestors.
  var parent=Path.GetDirectoryName(path);
  return String.IsNullOrEmpty(parent) || parent==path ? path : Path.Combine(Canonical(parent),Path.GetFileName(path));
 }
}
'@
# Never inherit the installation directory as the working directory: Windows
# cannot rename a directory that is a process's current directory, and the
# installer's fast-install step renames it.
Set-Location -LiteralPath $env:TEMP
$job=[IO.Path]::GetDirectoryName([MycelliosUpdatePath]::Canonical($ConfigFile))
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
$window=$null
function Progress([string]$value){$script:phase=$value;$receipt=@{phase=$value;atUtc=(Get-Date).ToUniversalTime().ToString('o');pid=$PID};$receipt|ConvertTo-Json|Set-Content -LiteralPath (Join-Path $job 'progress.json') -Encoding UTF8;$receipt|ConvertTo-Json -Compress|Add-Content -LiteralPath (Join-Path $job 'progress-history.jsonl') -Encoding UTF8}
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
 return ,@(Get-CimInstance Win32_Process -Filter "name='Mycellios Desktop.exe'"|Where-Object {$_.ExecutablePath -and ([MycelliosUpdatePath]::Canonical($_.ExecutablePath)).Equals($executable,[StringComparison]::OrdinalIgnoreCase)})
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
  if($window){[Windows.Forms.Application]::DoEvents()}
  Start-Sleep -Milliseconds 250
 } while((Get-Date) -lt $deadline)
 throw 'The installed app did not confirm startup'
}
try {
 $config=Get-Content -LiteralPath $ConfigFile -Raw -Encoding UTF8|ConvertFrom-Json
 $profile=[MycelliosUpdatePath]::Canonical($config.profile)
 $executable=[MycelliosUpdatePath]::Canonical($config.executable)
 $installation=[IO.Path]::GetDirectoryName($executable)
 $installer=[MycelliosUpdatePath]::Canonical($config.installer)
 if($config.schema -ne 'mycellios-manual-update/1' -or $config.version -notmatch '^\d{1,6}\.\d{1,6}\.\d{1,6}$' -or $config.sha256 -notmatch '^[a-f0-9]{64}$'){throw 'Invalid native update request'}
 if([IO.Path]::GetFileName($executable) -ne 'Mycellios Desktop.exe' -or $profile.Length -lt 10 -or !$job.StartsWith((Join-Path $profile 'updates')+'\',[StringComparison]::OrdinalIgnoreCase)){throw 'Invalid update scope'}
 if(!$installer.StartsWith((Join-Path $profile 'updates')+'\',[StringComparison]::OrdinalIgnoreCase) -or [IO.Path]::GetFileName($installer) -ne ('Mycellios-Desktop-'+$config.version+'-windows-x64-pilot.exe')){throw 'Invalid installer scope'}
 # A second app instance must not start a competing install while a worker is
 # waiting for Windows, backing up or replacing this profile's installation.
 $updateLock=[IO.File]::Open((Join-Path (Split-Path $job -Parent) 'active-install.lock'),[IO.FileMode]::OpenOrCreate,[IO.FileAccess]::ReadWrite,[IO.FileShare]::None)
 $installerLock=[IO.File]::Open($installer,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::Read)
 Installer-Valid
 $old=Get-Process -Id $config.oldPid -ErrorAction SilentlyContinue
 $owner=[IntPtr]::Zero
 if($old){
  if(!([MycelliosUpdatePath]::Canonical($old.Path)).Equals($executable,[StringComparison]::OrdinalIgnoreCase)){throw 'The previous process identity changed'}
  $owner=$old.MainWindowHandle
 }
 # Apply Windows attachment policy and any required owner confirmation BEFORE
 # acknowledging shutdown. A rejected, cancelled or unavailable check keeps
 # the app open. Never remove the Internet zone or auto-approve a prompt.
 Progress 'checking-installer'
 $source=$null
 $zone=Get-Content -LiteralPath ($installer+':Zone.Identifier') -Raw -Encoding UTF8 -ErrorAction SilentlyContinue
 if($zone){
  $zoneNumber=[regex]::Match($zone,'(?m)^ZoneId=([0-4])\s*$')
  $origin=[regex]::Match($zone,'(?m)^HostUrl=([^\r\n]+)')
  if(!$origin.Success -or !$zoneNumber.Success){throw 'The installer download origin is missing; download it again'}
  $source=$origin.Groups[1].Value
  $sourceUri=[Uri]$source
  $localOrigin=$zoneNumber.Groups[1].Value -eq '0' -and $sourceUri.IsFile -and ([MycelliosUpdatePath]::Canonical($sourceUri.LocalPath)).Equals($installer,[StringComparison]::OrdinalIgnoreCase)
  if(($sourceUri.Scheme -ne 'https' -and !$localOrigin) -or $sourceUri.UserInfo){throw 'Invalid installer download origin'}
 }else{throw 'The installer download origin is missing; download it again'}
 # Windows trust services are allowed to update ADS evidence or quarantine a
 # file. Release only its verification handle, then re-open and hash again.
 $installerLock.Dispose();$installerLock=$null
 [MycelliosAttachment]::Approve($installer,$source,$owner)
 $installerLock=[IO.File]::Open($installer,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::Read)
 Installer-Valid
 if($old){
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
 # File checks were approved before shutdown. Keep a responsive progress window
 # while the already-verified per-user installer runs and the app reopens.
 Progress 'preparing-installer-ui'
 Add-Type -AssemblyName System.Windows.Forms
 $window=New-Object Windows.Forms.Form
 $window.Text='Actualizando Mycellios'
 $window.Width=440;$window.Height=140
 $window.StartPosition=[Windows.Forms.FormStartPosition]::CenterScreen
 $window.ControlBox=$false
 $label=New-Object Windows.Forms.Label
 $label.Text=('Instalando la actualizaci'+[char]0xF3+'n. Mycellios se abrir'+[char]0xE1+' al terminar.')
 $label.Dock=[Windows.Forms.DockStyle]::Fill
 $label.Padding=New-Object Windows.Forms.Padding(20)
 $window.Controls.Add($label)
 $window.Show();$window.Activate();[Windows.Forms.Application]::DoEvents()
  # The hidden worker's STARTUPINFO can suppress the first ShowWindow call.
  [MycelliosUpdatePath]::ShowWindow($window.Handle,5)|Out-Null
  [Windows.Forms.Application]::DoEvents()
  $start=New-Object Diagnostics.ProcessStartInfo
  $start.FileName=$installer;$start.Arguments='/S';$start.WorkingDirectory=$env:TEMP
  # Attachment Services already enforced policy, scanning and any owner prompt;
  # the same bytes were rehashed under a read lock. Do not repeat the shell's
  # hidden file-check UI after the app has quit. No unchecked fallback exists.
  $start.UseShellExecute=$false;$start.WindowStyle=[Diagnostics.ProcessWindowStyle]::Normal
  $setup=[Diagnostics.Process]::Start($start)
 $null=$setup.Handle
 Progress 'installing'
 $installDeadline=(Get-Date).AddMinutes(10)
 while(!$setup.WaitForExit(250)){
  [Windows.Forms.Application]::DoEvents()
  if((Get-Date) -gt $installDeadline){
   # An installer still running may own files. Leave it and its recovery data alone.
   $canReopen=$false
   Progress 'installer-timeout'
   throw 'The installer is still running after ten minutes'
  }
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
} finally {if($window){$window.Close();$window.Dispose()};if($installerLock){$installerLock.Dispose()};if($updateLock){$updateLock.Dispose()}}
