param(
  [string]$ResourceGroup = 'rg-nexus-dev',
  [string]$NamePrefix = 'nexus',
  [ValidateSet('dev', 'staging', 'prod')]
  [string]$Environment = 'dev',
  [string]$StaticWebLocation = 'eastus2',
  [ValidateSet('mock', 'api')]
  [string]$DataMode = 'mock',
  [string]$ApiBaseUrl = ''
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

function Test-SymlinkSupport {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Path
  )

  $probeRoot = Join-Path $Path ".bridata-symlink-probe-$PID"
  try {
    New-Item -ItemType Directory -Force -Path $probeRoot | Out-Null
    $target = Join-Path $probeRoot 'target.txt'
    $link = Join-Path $probeRoot 'link.txt'
    Set-Content -Path $target -Value 'ok' -NoNewline
    New-Item -ItemType SymbolicLink -Path $link -Target $target -ErrorAction Stop | Out-Null
    return (Test-Path $link)
  } catch {
    return $false
  } finally {
    Remove-Item -Recurse -Force $probeRoot -ErrorAction SilentlyContinue
  }
}

function New-WebBuildSnapshot {
  param(
    [Parameter(Mandatory = $true)]
    [string]$SourceRoot,
    [Parameter(Mandatory = $true)]
    [string]$DestinationRoot
  )

  if (-not (Get-Command tar -ErrorAction SilentlyContinue)) {
    throw 'tar es obligatorio para copiar el snapshot a almacenamiento temporal en Cloud Shell.'
  }

  $archive = Join-Path ([System.IO.Path]::GetTempPath()) "bridata-web-source-$PID.tar"
  Remove-Item -Force $archive -ErrorAction SilentlyContinue
  Remove-Item -Recurse -Force $DestinationRoot -ErrorAction SilentlyContinue
  New-Item -ItemType Directory -Force -Path $DestinationRoot | Out-Null

  try {
    Push-Location $SourceRoot
    try {
      Invoke-Checked -FailureMessage 'No se pudo crear el snapshot temporal del frontend.' -Command {
        tar -cf $archive `
          --exclude='.git' `
          --exclude='node_modules' `
          --exclude='*/node_modules' `
          --exclude='dist' `
          --exclude='*/dist' `
          --exclude='coverage' `
          --exclude='*/coverage' `
          .
      }
    } finally {
      Pop-Location
    }

    Invoke-Checked -FailureMessage 'No se pudo extraer el snapshot temporal del frontend.' -Command {
      tar -xf $archive -C $DestinationRoot
    }
  } finally {
    Remove-Item -Force $archive -ErrorAction SilentlyContinue
  }
}

if (-not (Get-Command az -ErrorAction SilentlyContinue)) {
  throw 'Azure CLI (az) no está disponible en esta sesión.'
}

if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
  throw 'npm no está disponible en esta sesión.'
}

if (-not (Test-Path './package.json')) {
  throw 'Ejecuta este script desde la raíz del repositorio Nexus.'
}

if ($DataMode -eq 'api' -and [string]::IsNullOrWhiteSpace($ApiBaseUrl)) {
  throw 'ApiBaseUrl es obligatorio cuando DataMode=api.'
}

$sourceRoot = (Get-Location).Path
$webName = "$NamePrefix-$Environment-web"
$templateFile = Join-Path $sourceRoot 'infra/azure/web-dev.bicep'
$tempRoot = [System.IO.Path]::GetTempPath()
$buildRoot = $sourceRoot
$stagedBuild = $false
$npmCacheRoot = Join-Path $tempRoot "bridata-npm-cache-$PID"

Write-Host ''
Write-Host '=== BRIDATA WEB DEV / AZURE STATIC WEB APPS ===' -ForegroundColor Green
Write-Host "Resource Group : $ResourceGroup"
Write-Host "Web            : $webName"
Write-Host "Location       : $StaticWebLocation"
Write-Host "Data mode      : $DataMode"
Write-Host ''

Invoke-Checked -FailureMessage 'No hay una sesión válida de Azure CLI. Ejecuta az login si corresponde.' -Command {
  az account show --only-show-errors --output none
}

Write-Host '[1/6] Registrando Microsoft.Web...' -ForegroundColor Cyan
Invoke-Checked -FailureMessage 'No se pudo registrar Microsoft.Web.' -Command {
  az provider register --namespace Microsoft.Web --wait --only-show-errors --output none
}

Write-Host '[2/6] Validando Bicep...' -ForegroundColor Cyan
Invoke-Checked -FailureMessage 'El archivo web-dev.bicep no compila.' -Command {
  az bicep build --file $templateFile --stdout | Out-Null
}

Write-Host '[3/6] Creando/actualizando Static Web App Free...' -ForegroundColor Cyan
Invoke-Checked -FailureMessage 'Falló el despliegue del recurso Azure Static Web Apps.' -Command {
  az deployment group create `
    --resource-group $ResourceGroup `
    --template-file $templateFile `
    --parameters namePrefix=$NamePrefix environment=$Environment location=$StaticWebLocation skuName=Free `
    --only-show-errors `
    --output none
}

Write-Host '[4/6] Preparando build y compilando frontend...' -ForegroundColor Cyan
if (-not (Test-SymlinkSupport -Path $sourceRoot)) {
  $buildRoot = Join-Path $tempRoot "bridata-web-build-$PID"
  Write-Host 'El filesystem actual no soporta symlinks. Creando snapshot seguro en almacenamiento temporal...' -ForegroundColor Yellow
  New-WebBuildSnapshot -SourceRoot $sourceRoot -DestinationRoot $buildRoot
  $stagedBuild = $true
}

if (-not (Test-SymlinkSupport -Path $buildRoot)) {
  throw "El directorio de build '$buildRoot' tampoco soporta symlinks. No es seguro continuar con npm."
}

Write-Host "Build root     : $buildRoot"

$previousDataMode = $env:VITE_DATA_MODE
$previousApiBaseUrl = $env:VITE_API_BASE_URL
$previousNpmCache = $env:npm_config_cache

try {
  Remove-Item -Recurse -Force $npmCacheRoot -ErrorAction SilentlyContinue
  New-Item -ItemType Directory -Force -Path $npmCacheRoot | Out-Null
  $env:npm_config_cache = $npmCacheRoot

  Push-Location $buildRoot
  try {
    if (Test-Path './package-lock.json') {
      Invoke-Checked -FailureMessage 'npm ci del frontend falló.' -Command { npm ci --workspaces=false }
    } else {
      Invoke-Checked -FailureMessage 'npm install del frontend falló.' -Command { npm install --workspaces=false }
    }

    $env:VITE_DATA_MODE = $DataMode
    if ($DataMode -eq 'api') {
      $env:VITE_API_BASE_URL = $ApiBaseUrl.TrimEnd('/')
    } else {
      Remove-Item Env:VITE_API_BASE_URL -ErrorAction SilentlyContinue
    }

    Invoke-Checked -FailureMessage 'El build web de Bridata falló.' -Command { npm run build:web }

    if (-not (Test-Path './dist/index.html')) {
      throw 'No se encontró dist/index.html después del build.'
    }

    Write-Host '[5/6] Obteniendo token de despliegue...' -ForegroundColor Cyan
    $deploymentToken = az staticwebapp secrets list `
      --name $webName `
      --resource-group $ResourceGroup `
      --query 'properties.apiKey' `
      --output tsv `
      --only-show-errors

    if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($deploymentToken)) {
      throw 'No se pudo obtener el token de despliegue de Static Web Apps.'
    }

    Write-Host '[6/6] Publicando dist en Azure...' -ForegroundColor Cyan
    try {
      Invoke-Checked -FailureMessage 'La publicación del frontend en Static Web Apps falló.' -Command {
        npx --yes --package @azure/static-web-apps-cli swa deploy ./dist `
          --deployment-token $deploymentToken `
          --env production
      }
    } finally {
      $deploymentToken = $null
    }
  } finally {
    Pop-Location
  }
} finally {
  if ($null -eq $previousDataMode) {
    Remove-Item Env:VITE_DATA_MODE -ErrorAction SilentlyContinue
  } else {
    $env:VITE_DATA_MODE = $previousDataMode
  }

  if ($null -eq $previousApiBaseUrl) {
    Remove-Item Env:VITE_API_BASE_URL -ErrorAction SilentlyContinue
  } else {
    $env:VITE_API_BASE_URL = $previousApiBaseUrl
  }

  if ($null -eq $previousNpmCache) {
    Remove-Item Env:npm_config_cache -ErrorAction SilentlyContinue
  } else {
    $env:npm_config_cache = $previousNpmCache
  }

  Remove-Item -Recurse -Force $npmCacheRoot -ErrorAction SilentlyContinue
  if ($stagedBuild) {
    Remove-Item -Recurse -Force $buildRoot -ErrorAction SilentlyContinue
  }
}

$defaultHostname = az staticwebapp show `
  --name $webName `
  --resource-group $ResourceGroup `
  --query 'defaultHostname' `
  --output tsv `
  --only-show-errors

if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($defaultHostname)) {
  throw 'La web se publicó, pero no se pudo resolver el hostname final.'
}

Write-Host ''
Write-Host 'BRIDATA WEB DEV PUBLICADO' -ForegroundColor Green
Write-Host "https://$defaultHostname" -ForegroundColor Yellow
Write-Host ''
