# Starts the portable development Redis from tools/redis (see setup-redis-windows.ps1).
$ErrorActionPreference = 'Stop'
$dir = Join-Path (Split-Path -Parent $PSScriptRoot) 'tools\redis'
if (-not (Test-Path (Join-Path $dir 'redis-server.exe'))) { throw 'Run scripts\setup-redis-windows.ps1 first' }
Push-Location $dir
try { & .\redis-server.exe .\vita-redis.conf } finally { Pop-Location }
