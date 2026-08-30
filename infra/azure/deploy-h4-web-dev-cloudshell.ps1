param(
  [string]$Remote = 'origin',
  [string]$Branch = 'feature/bridata-enterprise-pmo-performance-security-v1h4',
  [string]$ResourceGroup = 'rg-nexus-dev',
  [string]$NamePrefix = 'nexus',
  [ValidateSet('dev', 'staging', 'prod')]
  [string]$Environment = 'dev',
  [string]$StaticWebLocation = 'eastus2',
  [ValidateSet('mock', 'api')]
  [string]$DataMode = 'mock',
  [ValidateSet('dev', 'entra')]
  [string]$AuthMode = 'dev',
  [string]$ApiBaseUrl = '',
  [switch]$KeepWorktree
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

function Invoke-Checked {
  param(
    [Parameter(Mandatory = $true)]
    [scriptblock]$Command,
    [Parameter(Mandatory = $true)]
    [string]$FailureMessage
  )

  & $Command
  if ($LASTEXITCODE -ne 0) {
    throw $FailureMessage
  }
}

if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
  throw 'git no está disponible en esta sesión.'
}
if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
  throw 'npm no está disponible en esta sesión.'
}
if (-not (Get-Command az -ErrorAction SilentlyContinue)) {
  throw 'Azure CLI (az) no está disponible en esta sesión.'
}
if ($DataMode -eq 'api' -and [string]::IsNullOrWhiteSpace($ApiBaseUrl)) {
  throw 'ApiBaseUrl es obligatorio cuando DataMode=api.'
}
if ($DataMode -eq 'api' -and $AuthMode -eq 'entra') {
  throw 'H4 ya exige un proveedor real de access token Entra, pero MSAL/SSO todavía no está compilado en la SPA. No se publicará api+entra hasta completar esa integración.'
}

$repoRoot = git rev-parse --show-toplevel 2>$null
if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($repoRoot)) {
  throw 'Ejecuta este script desde cualquier carpeta dentro del repositorio Nexus.'
}
$repoRoot = $repoRoot.Trim()

$tempRoot = [System.IO.Path]::GetTempPath()
$worktreeRoot = Join-Path $tempRoot "nexus-h4-deploy-$PID"
$npmCacheRoot = Join-Path $tempRoot "nexus-h4-deploy-npm-cache-$PID"
$remoteTrackingRef = "refs/remotes/$Remote/$Branch"
$previousDatabaseUrl = $env:DATABASE_URL
$previousNpmCache = $env:npm_config_cache
$previousAuthMode = $env:VITE_AUTH_MODE
$worktreeAdded = $false

Write-Host ''
Write-Host '=== BRIDATA H4 / ISOLATED AZURE WEB DEPLOY ===' -ForegroundColor Green
Write-Host "Repositorio fuente : $repoRoot"
Write-Host "Rama exacta        : $Remote/$Branch"
Write-Host "Resource Group     : $ResourceGroup"
Write-Host "Environment        : $Environment"
Write-Host "Data mode          : $DataMode"
Write-Host "Auth mode          : $AuthMode"
Write-Host "Worktree temporal  : $worktreeRoot"
Write-Host ''
Write-Host 'La carpeta actual NO será cambiada, reseteada, limpiada ni stasheada.' -ForegroundColor Yellow
Write-Host ''

try {
  Remove-Item -Recurse -Force $worktreeRoot -ErrorAction SilentlyContinue
  Remove-Item -Recurse -Force $npmCacheRoot -ErrorAction SilentlyContinue
  New-Item -ItemType Directory -Force -Path $npmCacheRoot | Out-Null
  $env:npm_config_cache = $npmCacheRoot
  $env:VITE_AUTH_MODE = $AuthMode

  Write-Host '[1/6] Obteniendo la rama H4 remota...' -ForegroundColor Cyan
  Push-Location $repoRoot
  try {
    Invoke-Checked -FailureMessage "No se pudo obtener $Remote/$Branch." -Command {
      git fetch $Remote "refs/heads/${Branch}:${remoteTrackingRef}"
    }

    Write-Host '[2/6] Creando worktree H4 limpio en /tmp...' -ForegroundColor Cyan
    Invoke-Checked -FailureMessage 'No se pudo crear el worktree H4 temporal.' -Command {
      git worktree add --detach $worktreeRoot $remoteTrackingRef
    }
    $worktreeAdded = $true
  } finally {
    Pop-Location
  }

  Push-Location $worktreeRoot
  try {
    $commit = git rev-parse HEAD
    if ($LASTEXITCODE -ne 0) { throw 'No se pudo resolver el commit H4 temporal.' }
    Write-Host "Commit a publicar  : $($commit.Trim())"

    Write-Host '[3/6] Instalando dependencias completas...' -ForegroundColor Cyan
    Invoke-Checked -FailureMessage 'npm ci falló en el worktree H4 temporal.' -Command {
      npm ci
    }

    if ([string]::IsNullOrWhiteSpace($env:DATABASE_URL)) {
      $env:DATABASE_URL = 'postgresql://bridata_static:bridata_static@127.0.0.1:5432/bridata_static?schema=public'
    }

    Write-Host '[4/6] Ejecutando gate H4 estático antes de publicar...' -ForegroundColor Cyan
    Invoke-Checked -FailureMessage 'verify:h4:static falló. No se publicará H4.' -Command {
      npm run verify:h4:static
    }

    Write-Host '[5/6] Iniciando despliegue Azure desde el worktree validado...' -ForegroundColor Cyan
    $deployParams = @{
      ResourceGroup = $ResourceGroup
      NamePrefix = $NamePrefix
      Environment = $Environment
      StaticWebLocation = $StaticWebLocation
      DataMode = $DataMode
      ApiBaseUrl = $ApiBaseUrl
    }
    & ./infra/azure/deploy-web-dev.ps1 @deployParams
    if ($LASTEXITCODE -ne 0) {
      throw 'deploy-web-dev.ps1 terminó con error.'
    }

    Write-Host '[6/6] Despliegue H4 terminado.' -ForegroundColor Cyan
    Write-Host ''
    Write-Host 'H4 WEB DEPLOY PASS' -ForegroundColor Green
    Write-Host "Commit publicado: $($commit.Trim())" -ForegroundColor Green
    Write-Host ''
  } finally {
    Pop-Location
  }
} finally {
  if ($null -eq $previousDatabaseUrl) {
    Remove-Item Env:DATABASE_URL -ErrorAction SilentlyContinue
  } else {
    $env:DATABASE_URL = $previousDatabaseUrl
  }

  if ($null -eq $previousNpmCache) {
    Remove-Item Env:npm_config_cache -ErrorAction SilentlyContinue
  } else {
    $env:npm_config_cache = $previousNpmCache
  }

  if ($null -eq $previousAuthMode) {
    Remove-Item Env:VITE_AUTH_MODE -ErrorAction SilentlyContinue
  } else {
    $env:VITE_AUTH_MODE = $previousAuthMode
  }

  Remove-Item -Recurse -Force $npmCacheRoot -ErrorAction SilentlyContinue

  if ($worktreeAdded -and -not $KeepWorktree) {
    Push-Location $repoRoot
    try {
      git worktree remove --force $worktreeRoot 2>$null | Out-Null
      git worktree prune 2>$null | Out-Null
    } finally {
      Pop-Location
    }
  }
}

if ($KeepWorktree -and $worktreeAdded) {
  Write-Host "Worktree conservado en: $worktreeRoot" -ForegroundColor Yellow
}
