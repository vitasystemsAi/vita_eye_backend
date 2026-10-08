# Downloads a portable Redis build for Windows into tools/redis and writes a development config
# (port 6390, localhost only). Use when no Redis >= 6.2 is available (BullMQ requirement).
# Production deployments should use the official Redis container (see docker-compose.yml).
param([string]$Version = '8.10.2', [int]$Port = 6390)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$target = Join-Path $root 'tools\redis'
if (Test-Path (Join-Path $target 'redis-server.exe')) { Write-Host "Redis already present in $target"; exit 0 }

New-Item -ItemType Directory -Force -Path (Join-Path $root 'tools') | Out-Null
$zip = Join-Path $root 'tools\redis.zip'
$url = "https://github.com/redis-windows/redis-windows/releases/download/$Version/Redis-$Version-Windows-x64-msys2.zip"
Write-Host "Downloading $url"
Invoke-WebRequest -Uri $url -OutFile $zip -UseBasicParsing
$extract = Join-Path $root 'tools\redis-extract'
Expand-Archive $zip -DestinationPath $extract -Force
Move-Item (Join-Path $extract "Redis-$Version-Windows-x64-msys2") $target
Remove-Item $zip, $extract -Recurse -Force
New-Item -ItemType Directory -Force -Path (Join-Path $target 'data') | Out-Null
@"
# VITA EYE local development Redis (portable build). Not for production use.
bind 127.0.0.1
port $Port
protected-mode yes
dir ./data
appendonly yes
appendfsync everysec
maxmemory-policy noeviction
"@ | Set-Content (Join-Path $target 'vita-redis.conf') -Encoding ascii
Write-Host "Done. Start with: scripts\start-redis-windows.ps1  (then set REDIS_URL=redis://localhost:$Port)"
