param(
    [string]$DisplayName = 'bridata-api-dev',
    [string]$ScopeValue = 'access_as_user'
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$tenantId = (az account show --query tenantId -o tsv).Trim()
if ([string]::IsNullOrWhiteSpace($tenantId)) {
    throw 'No active Azure tenant was found.'
}

$appJson = az ad app list --display-name $DisplayName --query '[0]' -o json
$app = $null
if (-not [string]::IsNullOrWhiteSpace($appJson) -and $appJson.Trim() -ne 'null') {
    $app = $appJson | ConvertFrom-Json
}

if ($null -eq $app) {
    Write-Host "Creating Entra application $DisplayName ..." -ForegroundColor Yellow
    $app = (az ad app create --display-name $DisplayName --sign-in-audience AzureADMyOrg -o json) | ConvertFrom-Json
} else {
    Write-Host "Using existing Entra application $DisplayName" -ForegroundColor Green
}

$objectId = [string]$app.id
$clientId = [string]$app.appId
if ([string]::IsNullOrWhiteSpace($objectId) -or [string]::IsNullOrWhiteSpace($clientId)) {
    throw 'Could not resolve Entra application identifiers.'
}

$current = (az rest --method GET --uri "https://graph.microsoft.com/v1.0/applications/$objectId" -o json) | ConvertFrom-Json
$scope = $null
if ($null -ne $current.api -and $null -ne $current.api.oauth2PermissionScopes) {
    $scope = $current.api.oauth2PermissionScopes | Where-Object { $_.value -eq $ScopeValue } | Select-Object -First 1
}

$scopeId = if ($null -ne $scope) { [string]$scope.id } else { [guid]::NewGuid().ToString() }

$patch = @{
    identifierUris = @("api://$clientId")
    api = @{
        requestedAccessTokenVersion = 2
        oauth2PermissionScopes = @(
            @{
                id = $scopeId
                adminConsentDescription = 'Allow Bridata Project Web to access the Bridata Project API as the signed-in user.'
                adminConsentDisplayName = 'Access Bridata Project API'
                isEnabled = $true
                type = 'User'
                userConsentDescription = 'Allow Bridata Project to access its API on your behalf.'
                userConsentDisplayName = 'Access Bridata Project API'
                value = $ScopeValue
            }
        )
    }
}

$body = $patch | ConvertTo-Json -Depth 10 -Compress
az rest `
    --method PATCH `
    --uri "https://graph.microsoft.com/v1.0/applications/$objectId" `
    --headers 'Content-Type=application/json' `
    --body $body `
    --output none

$spJson = az ad sp list --filter "appId eq '$clientId'" --query '[0]' -o json
if ([string]::IsNullOrWhiteSpace($spJson) -or $spJson.Trim() -eq 'null') {
    Write-Host 'Creating service principal for the API application ...' -ForegroundColor Yellow
    az ad sp create --id $clientId --output none
}

Write-Host ''
Write-Host 'ENTRA API READY' -ForegroundColor Green
Write-Host "Display name : $DisplayName"
Write-Host "Tenant ID    : $tenantId"
Write-Host "Client ID    : $clientId"
Write-Host "Scope        : api://$clientId/$ScopeValue"
Write-Host ''
Write-Host 'The Client ID is an identifier, not a secret. Use it as the entra_api_client_id input of Azure DEV Runtime Deploy.'
