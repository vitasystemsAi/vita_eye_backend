# Starts the portable dev Redis only when port 6390 is closed, then returns.
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$dir = Join-Path $root 'tools\redis'

function Test-RedisPort {
  $client = New-Object System.Net.Sockets.TcpClient
  try {
    $client.Connect('127.0.0.1', 6390)
    return $true
  } catch {
    return $false
  } finally {
    $client.Dispose()
  }
}

if (Test-RedisPort) { exit 0 }
$server = Join-Path $dir 'redis-server.exe'
if (-not (Test-Path $server)) { throw 'Run scripts\setup-redis-windows.ps1 first' }
# Windows Redis joins an absolute config path onto its own prefix and fails to open it.
Start-Process -FilePath $server -ArgumentList '.\vita-redis.conf' -WorkingDirectory $dir -WindowStyle Hidden
$deadline = (Get-Date).AddSeconds(20)
do {
  Start-Sleep -Milliseconds 250
} while (-not (Test-RedisPort) -and (Get-Date) -lt $deadline)
if (-not (Test-RedisPort)) { throw 'Redis did not start on port 6390' }
