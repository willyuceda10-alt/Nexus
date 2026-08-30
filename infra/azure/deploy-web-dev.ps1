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

$webName = "$NamePrefix-$Environment-web"
$templateFile = './infra/azure/web-dev.bicep'

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

Write-Host '[4/6] Instalando dependencias frontend y compilando...' -ForegroundColor Cyan
# Azure Cloud Shell clouddrive is backed by Azure Files and does not support the
# workspace symlink npm creates for apps/api. The web build only needs root deps,
# so workspaces are intentionally excluded for this visual DEV deployment.
if (Test-Path './package-lock.json') {
  Invoke-Checked -FailureMessage 'npm ci del frontend falló.' -Command { npm ci --workspaces=false }
} else {
  Invoke-Checked -FailureMessage 'npm install del frontend falló.' -Command { npm install --workspaces=false }
}

$previousDataMode = $env:VITE_DATA_MODE
$previousApiBaseUrl = $env:VITE_API_BASE_URL

try {
  $env:VITE_DATA_MODE = $DataMode
  if ($DataMode -eq 'api') {
    $env:VITE_API_BASE_URL = $ApiBaseUrl.TrimEnd('/')
  } else {
    Remove-Item Env:VITE_API_BASE_URL -ErrorAction SilentlyContinue
  }

  Invoke-Checked -FailureMessage 'El build web de Bridata falló.' -Command { npm run build:web }
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
}

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
