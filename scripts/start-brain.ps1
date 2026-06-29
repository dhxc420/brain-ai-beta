# Brain AI - arranque limpio (evita zombies de uvicorn --reload en 8787)
$ErrorActionPreference = "SilentlyContinue"
$Root = Split-Path $PSScriptRoot -Parent
$Preferred = if ($env:BRAIN_PORT) { [int]$env:BRAIN_PORT } else { $null }

Write-Host "Deteniendo uvicorn/python de Brain AI..."
Get-CimInstance Win32_Process -Filter "Name='python.exe'" |
  Where-Object { $_.CommandLine -match 'uvicorn|app\.main:app' } |
  ForEach-Object {
    Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
  }
Start-Sleep -Seconds 2

Set-Location $Root
$uvicorn = Join-Path $Root ".venv\Scripts\uvicorn.exe"
if (-not (Test-Path $uvicorn)) {
  Write-Error "No existe $uvicorn"
  exit 1
}

function Test-BrainHealthy($p) {
  try {
    $h = Invoke-RestMethod -Uri "http://127.0.0.1:$p/api/health" -TimeoutSec 2
    return ($h.brain_features.workflow_count -ge 4 -and $h.brain_features.chat_stream -eq $true)
  } catch { return $false }
}

function Port-Listening($p) {
  try {
    $null = Get-NetTCPConnection -LocalPort $p -State Listen -ErrorAction Stop
    return $true
  } catch { return $false }
}

$candidates = @()
if ($Preferred) { $candidates += $Preferred }
$candidates += 8789, 8788, 8790, 8791, 8792, 8787
$candidates = $candidates | Select-Object -Unique

foreach ($p in $candidates) {
  if (Test-BrainHealthy $p) {
    Write-Host "Brain AI OK en http://127.0.0.1:$p ($((Invoke-RestMethod "http://127.0.0.1:$p/api/health").brain_features.workflow_count) workflows, listado local activo)"
    exit 0
  }
}

$Port = $null
foreach ($p in $candidates) {
  if (-not (Port-Listening $p)) {
    $Port = $p
    break
  }
}

if (-not $Port) {
  Write-Host "Puertos 8787-8792 ocupados (posibles zombies). Usando 8789 - si falla, reinicia Windows."
  $Port = 8789
}

Write-Host "Iniciando Brain AI en http://127.0.0.1:$Port (sin --reload)"
Write-Host "Si 8787 te da respuestas viejas, usa esta URL."
& $uvicorn app.main:app --host 127.0.0.1 --port $Port
