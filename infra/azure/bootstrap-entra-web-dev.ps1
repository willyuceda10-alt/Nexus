param(
    [string]$DisplayName = 'bridata-web-dev',
    [Parameter(Mandatory = $true)]
    [string]$ApiClientId,
    [string]$ApiScopeValue = 'access_as_user',
    [string[]]$RedirectUris = @('http://localhost:3000/'),
    [switch]$Apply
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

function Require-Value([string]$Name, [string]$Value) {
    if ([string]::IsNullOrWhiteSpace($Value)) {
        throw "Could not resolve $Name."
    }
    return $Value.Trim()
}

$tenantId = Require-Value 'active Azure tenant' (az account show --query tenantId -o tsv)
$apiClientId = Require-Value 'Bridata API client id' $ApiClientId
$scope = "api://$apiClientId/$ApiScopeValue"

Write-Host ''
Write-Host 'Bridata Project Web - Microsoft Entra SPA bootstrap' -ForegroundColor Cyan
Write-Host "Tenant       : $tenantId"
Write-Host "Display name : $DisplayName"
Write-Host "API scope    : $scope"
Write-Host 'Redirect URIs:'
$RedirectUris | ForEach-Object { Write-Host "  - $_" }
Write-Host "Mode         : $(if ($Apply) { 'APPLY' } else { 'DRY-RUN' })"
Write-Host ''

$appJson = az ad app list --display-name $DisplayName --query '[0]' -o json
$app = $null
if (-not [string]::IsNullOrWhiteSpace($appJson) -and $appJson.Trim() -ne 'null') {
    $app = $appJson | ConvertFrom-Json
}

if ($null -eq $app) {
    if (-not $Apply) {
        Write-Host "[DRY-RUN] Would create SPA App Registration '$DisplayName'." -ForegroundColor Yellow
        Write-Host '[DRY-RUN] Re-run with -Apply to create it.'
        exit 0
    }

    Write-Host "Creating Entra SPA application $DisplayName ..." -ForegroundColor Yellow
    $createArgs = @(
        'ad', 'app', 'create',
        '--display-name', $DisplayName,
        '--sign-in-audience', 'AzureADMyOrg',
        '-o', 'json'
    )
    $app = (& az @createArgs) | ConvertFrom-Json
} else {
    Write-Host "Using existing Entra application $DisplayName" -ForegroundColor Green
}

$objectId = Require-Value 'web application object id' ([string]$app.id)
$clientId = Require-Value 'web application client id' ([string]$app.appId)

$dollar = [char]36
$apiAppUri = "https://graph.microsoft.com/v1.0/applications?$($dollar)filter=appId%20eq%20'$apiClientId'&$($dollar)select=id,api"
$apiApp = (& az rest --method GET --uri $apiAppUri -o json) | ConvertFrom-Json
$apiApplication = @($apiApp.value) | Select-Object -First 1

if (-not $apiApplication) {
    throw "Bridata API application '$apiClientId' was not found."
}

$delegatedScope = @($apiApplication.api.oauth2PermissionScopes) |
    Where-Object { $_.value -eq $ApiScopeValue -and $_.isEnabled -eq $true } |
    Select-Object -First 1

if (-not $delegatedScope) {
    throw "Delegated API scope '$ApiScopeValue' was not found on Bridata API app '$apiClientId'."
}

$redirectPayload = @(
    $RedirectUris |
        ForEach-Object {
            $value = $_.Trim()
            if (-not [Uri]::IsWellFormedUriString($value, [UriKind]::Absolute)) {
                throw "Invalid SPA redirect URI: $value"
            }
            $value
        } |
        Sort-Object -Unique
)

$patch = @{
    spa = @{
        redirectUris = $redirectPayload
    }
    requiredResourceAccess = @(
        @{
            resourceAppId = $apiClientId
            resourceAccess = @(
                @{
                    id = [string]$delegatedScope.id
                    type = 'Scope'
                }
            )
        }
    )
}

if (-not $Apply) {
    Write-Host '[DRY-RUN] Existing app would be updated with SPA redirect URIs and delegated API access.' -ForegroundColor Yellow
    Write-Host "Web client id: $clientId"
    exit 0
}

$body = $patch | ConvertTo-Json -Depth 10 -Compress
& az rest --method PATCH --uri "https://graph.microsoft.com/v1.0/applications/$objectId" --headers 'Content-Type=application/json' --body $body -o none
if ($LASTEXITCODE -ne 0) {
    throw 'Could not update the Bridata Web App Registration.'
}

$spJson = az ad sp list --filter "appId eq '$clientId'" --query '[0]' -o json
if ([string]::IsNullOrWhiteSpace($spJson) -or $spJson.Trim() -eq 'null') {
    & az ad sp create --id $clientId -o none
    if ($LASTEXITCODE -ne 0) {
        throw 'Could not create the Bridata Web service principal.'
    }
}

Write-Host ''
Write-Host 'ENTRA WEB SPA READY' -ForegroundColor Green
Write-Host "Tenant ID : $tenantId"
Write-Host "Client ID : $clientId"
Write-Host "API scope : $scope"
Write-Host ''
Write-Host 'Frontend runtime variables:'
Write-Host 'VITE_AUTH_MODE=entra'
Write-Host "VITE_ENTRA_TENANT_ID=$tenantId"
Write-Host "VITE_ENTRA_WEB_CLIENT_ID=$clientId"
Write-Host "VITE_ENTRA_API_SCOPE=$scope"
Write-Host ''
Write-Warning 'Do not create a client secret for the SPA. Bridata Web uses Authorization Code + PKCE.'
