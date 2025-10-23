# Generate private key
openssl genrsa -out private_key.pem 2048

# Extract public key
openssl rsa -in private_key.pem -pubout -out public_key.pem

# Replace newlines with \n for environment variable usage
$privateKeyPem = Get-Content -Raw -Path private_key.pem
$privateKeyPemEscaped = $privateKeyPem -replace "`r`n", "\n"
Set-Content -Path private_key_escaped.pem -Value $privateKeyPemEscaped

$publicKeyPem = Get-Content -Raw -Path public_key.pem
$publicKeyPemEscaped = $publicKeyPem -replace "`r`n", "\n"
Set-Content -Path public_key_escaped.pem -Value $publicKeyPemEscaped

# Delete original key files
Remove-Item private_key.pem
Remove-Item public_key.pem

Write-Host "Private and public keys generated and escaped for environment variable usage."