# Publish Brain AI Beta to public repo (from Premium checkout)
$ErrorActionPreference = "Stop"
$Root = Split-Path $PSScriptRoot -Parent
$Export = Join-Path $Root ".brain-beta-export"
$BetaRepo = "https://github.com/dhxc420/brain-ai-beta.git"

Write-Host "Export Beta -> $Export"
if (Test-Path $Export) { Remove-Item $Export -Recurse -Force }
New-Item -ItemType Directory -Path $Export | Out-Null

$Include = @(
  "app", "static", "scripts", "docs", "examples",
  "requirements.txt", "LICENSE", ".env.example", ".gitignore"
)

foreach ($item in $Include) {
  $src = Join-Path $Root $item
  if (Test-Path $src) {
    Copy-Item $src (Join-Path $Export $item) -Recurse -Force
  }
}

$betaReadme = Join-Path $Root "README.beta.md"
if (Test-Path $betaReadme) {
  Copy-Item $betaReadme (Join-Path $Export "README.md") -Force
} else {
  Write-Warning "README.beta.md not found - export may have wrong README."
}

$envExample = Join-Path $Export ".env.example"
@(
  "BRAIN_EDITION=beta",
  "BRAIN_DEFAULT_MODEL=qwen2.5-coder:7b",
  "BRAIN_EMBED_MODEL=nomic-embed-text",
  "BRAIN_ALLOW_HEAVY_MODELS=false"
) | Set-Content $envExample -Encoding UTF8

Push-Location $Export
if (-not (Test-Path ".git")) {
  git init
  git branch -M main
}
git add -A
git status
$msg = "chore: sync beta from premium $(Get-Date -Format 'yyyy-MM-dd')"
git commit -m $msg 2>$null
if ($LASTEXITCODE -ne 0) {
  Write-Host "Nothing new to commit."
}
$hasOrigin = $false
try {
  $null = git remote get-url origin 2>$null
  if ($LASTEXITCODE -eq 0) { $hasOrigin = $true }
} catch { $hasOrigin = $false }
if (-not $hasOrigin) {
  git remote add origin $BetaRepo
} else {
  git remote set-url origin $BetaRepo
}
git push -u origin main --force
Pop-Location

Write-Host "Beta published: $BetaRepo"
