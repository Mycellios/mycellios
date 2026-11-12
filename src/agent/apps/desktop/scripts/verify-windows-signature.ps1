param(
 [Parameter(Mandatory)][string]$Directory,
 [Parameter(Mandatory)][ValidatePattern('^\d+\.\d+\.\d+$')][string]$Version,
 [string]$Publisher,
 [switch]$Preview,
 [switch]$InstallerOnly,
 [string]$Receipt
)
$ErrorActionPreference='Stop'
if($env:OS -ne 'Windows_NT'){throw 'Authenticode verification requires Windows'}
if(!$Preview -and [string]::IsNullOrWhiteSpace($Publisher)){throw 'Expected publisher is required'}
$root=(Resolve-Path -LiteralPath $Directory).Path.TrimEnd([char[]]'\/')
$files=@([pscustomobject]@{role='installer';path=(Join-Path $root "Mycellios-Desktop-$Version-windows-x64-pilot.exe")})
if(!$InstallerOnly){
 $main=Join-Path $root 'win-unpacked/Mycellios Desktop.exe'
 $files+= [pscustomobject]@{role='application';path=$main}
 if(!$Preview){
  $files+=Get-ChildItem -LiteralPath (Join-Path $root 'win-unpacked') -Filter '*.exe' -File -Recurse |
    Where-Object {$_.FullName -ne $main} | ForEach-Object {[pscustomobject]@{role='payload';path=$_.FullName}}
 }
}
$observed=@(foreach($file in $files){
 $item=Get-Item -LiteralPath $file.path
 if($item.PSIsContainer -or ($item.Attributes -band [IO.FileAttributes]::ReparsePoint)){throw 'Expected a regular packaged executable'}
 $signature=Get-AuthenticodeSignature -LiteralPath $item.FullName
 $name=$null;$subject=$null;$thumbprint=$null;$timestamp=$null
 if($Preview){
  if([string]$signature.Status -ne 'NotSigned'){throw 'Unsigned preview unexpectedly contains a signature or an invalid executable'}
 } else {
  if([string]$signature.Status -ne 'Valid' -or !$signature.SignerCertificate -or !$signature.TimeStamperCertificate){throw "Untrusted or untimestamped executable: $($item.Name)"}
  if($signature.SignerCertificate.Subject -eq $signature.SignerCertificate.Issuer){throw 'Self-issued publisher certificates are not accepted'}
  $name=$signature.SignerCertificate.GetNameInfo([Security.Cryptography.X509Certificates.X509NameType]::SimpleName,$false)
  if($file.role -ne 'payload' -and $name -cne $Publisher){throw "Unexpected publisher on $($item.Name)"}
  $subject=$signature.SignerCertificate.Subject;$thumbprint=$signature.SignerCertificate.Thumbprint
  $timestamp=$signature.TimeStamperCertificate.Subject
 }
 [pscustomobject]@{role=$file.role;path=$item.FullName.Substring($root.Length).TrimStart([char[]]'\/');
   sha256=(Get-FileHash -LiteralPath $item.FullName -Algorithm SHA256).Hash.ToLowerInvariant();
   status=[string]$signature.Status;publisher=$name;subject=$subject;thumbprint=$thumbprint;timestampSubject=$timestamp}
})
$report=[ordered]@{schema='mycellios-windows-signature/1';mode=$(if($Preview){'unsigned-preview'}else{'authenticode'});
 publisher=$(if($Preview){$null}else{$Publisher});files=$observed}
if(!$Receipt){$Receipt=Join-Path $root 'windows-signature.json'}
[IO.File]::WriteAllText($Receipt,($report|ConvertTo-Json -Depth 6),[Text.UTF8Encoding]::new($false))
Write-Output ('Verified {0} executable signatures ({1})' -f $observed.Count,$report.mode)
