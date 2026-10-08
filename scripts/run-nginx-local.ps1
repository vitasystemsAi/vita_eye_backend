# Runs the production Nginx edge config (infra/nginx/templates/vita-eye.conf.template) on Windows
# against the locally running services, for testing TLS termination, routing, WebSockets and the
# /api/v1/internal block without Docker. Development/testing only.
#
#   scripts\run-nginx-local.ps1            # start on http://localhost:8080 and https://localhost:8443
#   scripts\run-nginx-local.ps1 -Stop
param(
  [int]$HttpPort = 8080,
  [int]$HttpsPort = 8443,
  [int]$BackendPort = 5000,
  [int]$FrontendPort = 3001,
  [string]$Version = '1.30.5',
  [switch]$Stop
)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$nginxDir = Join-Path $root 'tools\nginx'
$exe = Join-Path $nginxDir 'nginx.exe'

if ($Stop) {
  if (Test-Path $exe) { Push-Location $nginxDir; try { & $exe -s quit } finally { Pop-Location } }
  return
}

if (-not (Test-Path $exe)) {
  New-Item -ItemType Directory -Force -Path (Join-Path $root 'tools') | Out-Null
  $zip = Join-Path $root 'tools\nginx.zip'
  Invoke-WebRequest "https://nginx.org/download/nginx-$Version.zip" -OutFile $zip -UseBasicParsing
  Expand-Archive $zip -DestinationPath (Join-Path $root 'tools') -Force
  Move-Item (Join-Path $root "tools\nginx-$Version") $nginxDir
  Remove-Item $zip
}

$certDir = Join-Path $nginxDir 'certs'
New-Item -ItemType Directory -Force -Path $certDir | Out-Null
$cert = Join-Path $certDir 'fullchain.pem'
$key = Join-Path $certDir 'privkey.pem'
if (-not (Test-Path $cert)) {
  $openssl = (Get-Command openssl -ErrorAction SilentlyContinue).Source
  if (-not $openssl) { $openssl = 'C:\Program Files\Git\usr\bin\openssl.exe' }
  if (-not (Test-Path $openssl)) { throw 'openssl not found (install Git for Windows or OpenSSL)' }
  $ErrorActionPreference = 'Continue'
  & $openssl req -x509 -nodes -newkey rsa:2048 -days 30 -subj '/CN=localhost' -addext 'subjectAltName=DNS:localhost,IP:127.0.0.1' -keyout $key -out $cert 2>&1 | Out-Null
  $ErrorActionPreference = 'Stop'
  if ($LASTEXITCODE -ne 0) { throw 'Certificate generation failed' }
}

$fwd = { param($p) ($p -replace '\\', '/') }
$template = Get-Content (Join-Path $root 'infra\nginx\templates\vita-eye.conf.template') -Raw
$site = $template.
  Replace('${NGINX_SERVER_NAME}', 'localhost').
  Replace('server backend:5000;', "server 127.0.0.1:$BackendPort;").
  Replace('server frontend:3001;', "server 127.0.0.1:$FrontendPort;").
  Replace('/etc/nginx/certs/fullchain.pem', ('"' + (& $fwd $cert) + '"')).
  Replace('/etc/nginx/certs/privkey.pem', ('"' + (& $fwd $key) + '"')).
  Replace('return 301 https://$host$request_uri;', "return 301 https://`$host:$HttpsPort`$request_uri;")
$site = $site -replace '(?m)^\s*listen \[::\]:\d+.*\r?\n', ''
$site = $site -replace 'listen 80;', "listen $HttpPort;" -replace 'listen 443 ssl;', "listen $HttpsPort ssl;"
Set-Content (Join-Path $nginxDir 'conf\vita-eye.conf') $site -Encoding ascii

@"
worker_processes 1;
events { worker_connections 1024; }
http {
    include mime.types;
    default_type application/octet-stream;
    include vita-eye.conf;
}
"@ | Set-Content (Join-Path $nginxDir 'conf\nginx.conf') -Encoding ascii

Push-Location $nginxDir
try {
  $ErrorActionPreference = 'Continue'
  & $exe -t 2>&1 | ForEach-Object { "$_" }
  $ErrorActionPreference = 'Stop'
  if ($LASTEXITCODE -ne 0) { throw 'nginx configuration test failed' }
  Start-Process -FilePath $exe -WorkingDirectory $nginxDir -WindowStyle Hidden
  Write-Host "Nginx running: https://localhost:$HttpsPort (self-signed)  |  stop with: scripts\run-nginx-local.ps1 -Stop"
} finally {
  Pop-Location
}
