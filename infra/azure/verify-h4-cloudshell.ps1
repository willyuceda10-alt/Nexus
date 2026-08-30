param(
  [string]$Remote = 'origin',
  [string]$Branch = 'feature/bridata-enterprise-pmo-performance-security-v1h4',
  [switch]$Full,
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

$repoRoot = git rev-parse --show-toplevel 2>$null
if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($repoRoot)) {
  throw 'Ejecuta este script desde cualquier carpeta dentro del repositorio Nexus.'
}
$repoRoot = $repoRoot.Trim()

$tempRoot = [System.IO.Path]::GetTempPath()
$worktreeRoot = Join-Path $tempRoot "nexus-h4-verify-$PID"
$npmCacheRoot = Join-Path $tempRoot "nexus-h4-npm-cache-$PID"
$remoteTrackingRef = "refs/remotes/$Remote/$Branch"
$previousDatabaseUrl = $env:DATABASE_URL
$previousNpmCache = $env:npm_config_cache
$worktreeAdded = $false

Write-Host ''
Write-Host '=== BRIDATA H4 / CLOUD SHELL VERIFY ===' -ForegroundColor Green
Write-Host "Repositorio      : $repoRoot"
Write-Host "Rama remota     : $Remote/$Branch"
Write-Host "Modo             : $(if ($Full) { 'COMPLETO' } else { 'ESTÁTICO' })"
Write-Host "Worktree temporal: $worktreeRoot"
Write-Host ''
Write-Host 'La carpeta de trabajo actual NO será cambiada, reseteada ni stasheada.' -ForegroundColor Yellow
Write-Host ''

try {
  Remove-Item -Recurse -Force $worktreeRoot -ErrorAction SilentlyContinue
  Remove-Item -Recurse -Force $npmCacheRoot -ErrorAction SilentlyContinue
  New-Item -ItemType Directory -Force -Path $npmCacheRoot | Out-Null
  $env:npm_config_cache = $npmCacheRoot

  Write-Host '[1/5] Actualizando referencia remota H4...' -ForegroundColor Cyan
  Push-Location $repoRoot
  try {
    Invoke-Checked -FailureMessage "No se pudo obtener $Remote/$Branch." -Command {
      git fetch $Remote "refs/heads/${Branch}:${remoteTrackingRef}"
    }

    Write-Host '[2/5] Creando worktree limpio en /tmp...' -ForegroundColor Cyan
    Invoke-Checked -FailureMessage 'No se pudo crear el worktree temporal de H4.' -Command {
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
    Write-Host "Commit H4        : $($commit.Trim())"

    Write-Host '[3/5] Instalando dependencias en filesystem Linux temporal...' -ForegroundColor Cyan
    Invoke-Checked -FailureMessage 'npm ci falló en el worktree temporal.' -Command {
      npm ci
    }

    if ($Full) {
      if ([string]::IsNullOrWhiteSpace($env:DATABASE_URL)) {
        throw 'El modo -Full requiere DATABASE_URL apuntando a una PostgreSQL de validación accesible.'
      }
      Write-Host '[4/5] Ejecutando gate H4 completo...' -ForegroundColor Cyan
      Invoke-Checked -FailureMessage 'verify:h4 falló. Revisa el primer error reportado arriba.' -Command {
        npm run verify:h4
      }
    } else {
      # prisma validate/generate solo necesitan una URL sintácticamente válida; no se
      # conecta a esta URL durante el gate estático.
      if ([string]::IsNullOrWhiteSpace($env:DATABASE_URL)) {
        $env:DATABASE_URL = 'postgresql://bridata_static:bridata_static@127.0.0.1:5432/bridata_static?schema=public'
      }
      Write-Host '[4/5] Ejecutando gate H4 estático...' -ForegroundColor Cyan
      Invoke-Checked -FailureMessage 'verify:h4:static falló. Revisa el primer error reportado arriba.' -Command {
        npm run verify:h4:static
      }
    }

    Write-Host '[5/5] Verificación terminada.' -ForegroundColor Cyan
    Write-Host ''
    Write-Host 'H4 VERIFY PASS' -ForegroundColor Green
    Write-Host "Commit: $($commit.Trim())" -ForegroundColor Green
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
