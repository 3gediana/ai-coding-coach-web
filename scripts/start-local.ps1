param(
  [int]$Port = 3333,
  [switch]$Public,
  [switch]$SkipInstall,
  [string]$HostName = ""
)

$ErrorActionPreference = "Stop"

$Root = Resolve-Path (Join-Path $PSScriptRoot "..")
Set-Location $Root

function Write-Step($Message) {
  Write-Host "[AI Coding Coach] $Message" -ForegroundColor Cyan
}

function Assert-Command($Name, $InstallHint) {
  if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
    throw "Missing command '$Name'. $InstallHint"
  }
}

Assert-Command "node" "Install Node.js 20 LTS or newer: https://nodejs.org/"
Assert-Command "npm" "Install npm with Node.js."

$nodeVersionText = (& node -v).Trim()
$nodeMajor = [int]($nodeVersionText.TrimStart('v').Split('.')[0])
if ($nodeMajor -lt 18) {
  throw "Node.js $nodeVersionText is too old. Please use Node.js 20 LTS or at least Node.js 18."
}

if (-not (Test-Path ".env.local") -and (Test-Path ".env.example")) {
  Write-Step "Creating .env.local from .env.example. Fill API keys later if needed."
  Copy-Item ".env.example" ".env.local"
}

if (-not $SkipInstall -and -not (Test-Path "node_modules")) {
  Write-Step "node_modules not found; running npm install."
  npm install
}

$bindHost = if ($HostName) { $HostName } elseif ($Public) { "0.0.0.0" } else { "127.0.0.1" }
$localUrl = "http://127.0.0.1:$Port/"

Write-Host ""
Write-Step "Starting AI Coding Coach demo server"
Write-Host "  Project : $Root"
Write-Host "  Bind    : $bindHost`:$Port"
Write-Host "  Open    : $localUrl"
Write-Host ""
Write-Host "Public demo URL:" -ForegroundColor Yellow
Write-Host "  If your tunnel maps to 127.0.0.1:$Port, share the tunnel HTTP/S URL."
Write-Host ""
if ($Public) {
  Write-Host "Public mode enabled. Use your tunnel tool to expose port $Port." -ForegroundColor Yellow
  Write-Host "For public demos, show the core platform features only. OJ Tampermonkey import/fill is intended for your local browser." -ForegroundColor Yellow
  Write-Host ""
}

npm run dev -- --host $bindHost --port $Port
