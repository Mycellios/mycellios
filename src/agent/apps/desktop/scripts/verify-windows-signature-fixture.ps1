# Isolated verification fixtures, never a Mycellios signing identity or release.
$ErrorActionPreference='Stop'
$temporary=Join-Path ([IO.Path]::GetTempPath()) ('mycellios-publisher-test-'+[Guid]::NewGuid().ToString('N'))
$null=New-Item -ItemType Directory -Path $temporary
try{
 $node=(Get-Command node).Source
 $original=Get-AuthenticodeSignature -LiteralPath $node
 if([string]$original.Status -ne 'Valid' -or !$original.TimeStamperCertificate){throw 'The official Node verification fixture is not signed and timestamped'}
 $publisher=$original.SignerCertificate.GetNameInfo([Security.Cryptography.X509Certificates.X509NameType]::SimpleName,$false)
 $file=Join-Path $temporary 'Mycellios-Desktop-0.0.1-windows-x64-pilot.exe'
 Copy-Item -LiteralPath $node -Destination $file
 $verifier=Join-Path $PSScriptRoot 'verify-windows-signature.ps1'
 & $verifier -Directory $temporary -Version 0.0.1 -InstallerOnly -Publisher $publisher
 $receipt=Get-Content (Join-Path $temporary 'windows-signature.json') -Raw|ConvertFrom-Json
 if($receipt.files[0].publisher -cne $publisher -or $receipt.files[0].status -ne 'Valid'){throw 'Trusted vendor signature was not verified'}
 $rejected=$false
 try{& $verifier -Directory $temporary -Version 0.0.1 -InstallerOnly -Publisher 'Wrong publisher fixture'}catch{$rejected=$true}
 if(!$rejected){throw 'Wrong publisher was accepted'}
 $bytes=[IO.File]::ReadAllBytes($file);$bytes[1024]=$bytes[1024] -bxor 1;[IO.File]::WriteAllBytes($file,$bytes)
 $rejected=$false
 try{& $verifier -Directory $temporary -Version 0.0.1 -InstallerOnly -Publisher $publisher}catch{$rejected=$true}
 if(!$rejected){throw 'Tampered executable was accepted'}
 [IO.File]::WriteAllText($file,'Unsigned executable fixture')
 $rejected=$false
 try{& $verifier -Directory $temporary -Version 0.0.1 -InstallerOnly -Publisher $publisher}catch{$rejected=$true}
 if(!$rejected){throw 'Unsigned executable was accepted'}
 Write-Output 'Authenticode verification passed: trusted vendor fixture, wrong publisher, tampering and unsigned rejection. No Mycellios binary was signed.'
}finally{
 # This task-created, fixed-prefix temporary directory contains only test copies.
 $resolved=[IO.Path]::GetFullPath($temporary)
 if($resolved.StartsWith([IO.Path]::GetTempPath(),[StringComparison]::OrdinalIgnoreCase) -and ([IO.Path]::GetFileName($resolved)).StartsWith('mycellios-publisher-test-')){
  Remove-Item -LiteralPath $resolved -Recurse -Force
 }
}
