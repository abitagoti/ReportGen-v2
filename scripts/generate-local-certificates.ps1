param(
  [string]$HostName = "reportgen.local",
  [string]$OutputDir = "$PSScriptRoot\..\config\certificates",
  [string]$PfxPassword = $env:REPORTGEN_SETUP_PFX_PASSWORD
)
$ErrorActionPreference = "Stop"
if ($PfxPassword.Length -lt 12) { throw "PFX password must contain at least 12 characters." }
New-Item -ItemType Directory -Force -Path $OutputDir | Out-Null
$caSubject = "CN=ReportGen Local CA"
$serverSubject = "CN=$HostName"
$existingCa = Get-ChildItem "Cert:\CurrentUser\My" | Where-Object { $_.Subject -eq $caSubject -and $_.HasPrivateKey -and $_.NotAfter -gt (Get-Date).AddDays(30) } | Sort-Object NotAfter -Descending | Select-Object -First 1
if ($existingCa) { $ca = $existingCa } else {
  $ca = New-SelfSignedCertificate -Type Custom -Subject $caSubject -FriendlyName "ReportGen Local CA" -CertStoreLocation "Cert:\CurrentUser\My" -KeyAlgorithm RSA -KeyLength 3072 -HashAlgorithm SHA256 -KeyExportPolicy Exportable -KeyUsage CertSign,CRLSign,DigitalSignature -NotAfter (Get-Date).AddYears(10) -TextExtension @("2.5.29.19={text}CA=true&pathlength=1")
}
$server = New-SelfSignedCertificate -Type Custom -Subject $serverSubject -FriendlyName "ReportGen HTTPS ($HostName)" -DnsName $HostName,"localhost" -Signer $ca -CertStoreLocation "Cert:\CurrentUser\My" -KeyAlgorithm RSA -KeyLength 2048 -HashAlgorithm SHA256 -KeyExportPolicy Exportable -NotAfter (Get-Date).AddDays(365) -KeyUsage DigitalSignature,KeyEncipherment
$caPath = Join-Path $OutputDir "reportgen-local-ca.cer"
$pfxPath = Join-Path $OutputDir "reportgen-local-server.pfx"
Export-Certificate -Cert $ca -FilePath $caPath -Force | Out-Null
Import-Certificate -FilePath $caPath -CertStoreLocation "Cert:\CurrentUser\Root" | Out-Null
$secure = ConvertTo-SecureString -String $PfxPassword -AsPlainText -Force
Export-PfxCertificate -Cert $server -FilePath $pfxPath -Password $secure -Force | Out-Null
($secure | ConvertFrom-SecureString) | Set-Content (Join-Path $OutputDir "reportgen-local-pfx.credential") -Encoding ASCII -Force
@{ hostname=$HostName; generatedAt=(Get-Date).ToUniversalTime().ToString("o"); caPath=$caPath; pfxPath=$pfxPath } | ConvertTo-Json | Set-Content (Join-Path $OutputDir "reportgen-local-certificate.json") -Encoding UTF8
Write-Host "ReportGen certificates created."
Write-Host "CA: $caPath"
Write-Host "Server PFX: $pfxPath"
Write-Host "Distribute ONLY the .cer file."
