$ErrorActionPreference = 'Stop'

$repositoryRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$qaHome = if ($env:GLOBY_QA_HOME) { [IO.Path]::GetFullPath($env:GLOBY_QA_HOME) } else { Join-Path $env:LOCALAPPDATA 'GlobyEdu-QA' }
$qaHome = [IO.Path]::GetFullPath($qaHome)
$qaFiles = @{
  GLOBY_SCHOOLS_FILE = Join-Path $qaHome 'schools.json'
  GLOBY_AUDIT_FILE = Join-Path $qaHome 'audit-logs.json'
  GLOBY_PASSWORD_RESET_TOKENS_FILE = Join-Path $qaHome 'password-reset-tokens.json'
}

if (-not (Test-Path -LiteralPath $qaFiles.GLOBY_SCHOOLS_FILE -PathType Leaf) -or
    -not (Test-Path -LiteralPath $qaFiles.GLOBY_AUDIT_FILE -PathType Leaf) -or
    -not (Test-Path -LiteralPath $qaFiles.GLOBY_PASSWORD_RESET_TOKENS_FILE -PathType Leaf)) {
  throw "Isolated QA data is incomplete under $qaHome. Run npm run qa:provision once; existing files are never overwritten."
}

foreach ($file in $qaFiles.Values) {
  $resolvedFile = [IO.Path]::GetFullPath($file)
  if (-not $resolvedFile.StartsWith($qaHome.TrimEnd('\') + '\', [StringComparison]::OrdinalIgnoreCase)) {
    throw 'QA data files must be inside GLOBY_QA_HOME.'
  }
}

$client = [System.Net.Sockets.TcpClient]::new()
$connect = $client.BeginConnect('127.0.0.1', 4001, $null, $null)
$portInUse = $connect.AsyncWaitHandle.WaitOne(500) -and $client.Connected
$client.Close()
if ($portInUse) {
  throw 'Port 4001 is already in use. Refusing to start a duplicate QA server.'
}

$env:NODE_ENV = 'development'
$env:GLOBY_QA_MODE = 'true'
$env:DATA_STORE_MODE = 'json'
$env:PORT = '4001'
$env:GLOBY_QA_HOME = $qaHome
$env:GLOBY_SCHOOLS_FILE = $qaFiles.GLOBY_SCHOOLS_FILE
$env:GLOBY_AUDIT_FILE = $qaFiles.GLOBY_AUDIT_FILE
$env:GLOBY_PASSWORD_RESET_TOKENS_FILE = $qaFiles.GLOBY_PASSWORD_RESET_TOKENS_FILE
$env:DATABASE_URL = ''
$env:USE_REAL_DATABASE = ''
$env:APP_URL = 'http://127.0.0.1:4001'
$externalServiceVariables = @(
  'FIREBASE_PROJECT_ID', 'FIREBASE_CLIENT_EMAIL', 'FIREBASE_PRIVATE_KEY',
  'FIREBASE_API_KEY', 'FIREBASE_AUTH_DOMAIN', 'FIREBASE_APP_ID',
  'GCLOUD_PROJECT', 'GOOGLE_CLOUD_PROJECT', 'GOOGLE_APPLICATION_CREDENTIALS',
  'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY',
  'CLOUDFLARE_R2_ACCOUNT_ID', 'CLOUDFLARE_R2_ENDPOINT',
  'CLOUDFLARE_R2_ACCESS_KEY_ID', 'CLOUDFLARE_R2_SECRET_ACCESS_KEY',
  'CLOUDFLARE_R2_BUCKET', 'PAYSTACK_SECRET_KEY', 'PAYSTACK_WEBHOOK_SECRET',
  'SMTP_HOST', 'SMTP_USER', 'SMTP_PASSWORD', 'RESEND_API_KEY', 'BREVO_API_KEY',
  'SENDGRID_API_KEY', 'MAILGUN_API_KEY', 'AWS_ACCESS_KEY_ID',
  'AWS_SECRET_ACCESS_KEY', 'AWS_SESSION_TOKEN'
)
foreach ($variable in $externalServiceVariables) {
  Set-Item -Path "Env:$variable" -Value ''
}
$random = [System.Security.Cryptography.RandomNumberGenerator]::Create()
$accessSecret = New-Object byte[] 48
$refreshSecret = New-Object byte[] 48
$random.GetBytes($accessSecret)
$random.GetBytes($refreshSecret)
$env:JWT_ACCESS_SECRET = [Convert]::ToBase64String($accessSecret)
$env:JWT_REFRESH_SECRET = [Convert]::ToBase64String($refreshSecret)
$random.Dispose()

Write-Host 'Starting isolated local QA server at http://127.0.0.1:4001/'
Write-Host "QA data root: $qaHome"
Push-Location $repositoryRoot
try {
  node backend/server.js
  if ($LASTEXITCODE -ne 0) { throw "QA server exited with code $LASTEXITCODE." }
} finally {
  Pop-Location
}
