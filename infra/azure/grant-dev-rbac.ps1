param(
    [string]$ResourceGroup = 'rg-nexus-dev',
    [string]$CiAppDisplayName = 'nexus-github-deploy',
    [string]$ApiIdentityName = 'nexus-dev-api-mi',
    [string]$WebIdentityName = 'nexus-dev-web-mi'
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

function Require-Value([string]$Name, [string]$Value) {
    if ([string]::IsNullOrWhiteSpace($Value)) {
        throw "Could not resolve $Name."
    }
    return $Value.Trim()
}

function Ensure-RoleAssignment {
    param(
        [string]$AssigneeObjectId,
        [string]$Role,
        [string]$Scope,
        [string]$PrincipalType = 'ServicePrincipal'
    )

    $count = az role assignment list `
        --assignee-object-id $AssigneeObjectId `
        --scope $Scope `
        --query "[?roleDefinitionName=='$Role'] | length(@)" `
        --output tsv

    if ([int]$count -gt 0) {
        Write-Host "OK  $Role already assigned" -ForegroundColor Green
        return
    }

    Write-Host "ADD $Role" -ForegroundColor Yellow
    az role assignment create `
        --assignee-object-id $AssigneeObjectId `
        --assignee-principal-type $PrincipalType `
        --role $Role `
        --scope $Scope `
        --output none
}

$subscriptionId = Require-Value 'active subscription' (az account show --query id --output tsv)
$resourceGroupId = Require-Value 'resource group' (az group show --name $ResourceGroup --query id --output tsv)

$acrName = Require-Value 'DEV Azure Container Registry' (az acr list --resource-group $ResourceGroup --query "[0].name" --output tsv)
$acrId = Require-Value 'ACR resource id' (az acr show --resource-group $ResourceGroup --name $acrName --query id --output tsv)

$keyVaultName = Require-Value 'DEV Key Vault' (az keyvault list --resource-group $ResourceGroup --query "[0].name" --output tsv)
$keyVaultId = Require-Value 'Key Vault resource id' (az keyvault show --resource-group $ResourceGroup --name $keyVaultName --query id --output tsv)

$apiPrincipalId = Require-Value 'API managed identity principal' (az identity show --resource-group $ResourceGroup --name $ApiIdentityName --query principalId --output tsv)
$ciPrincipalId = Require-Value 'GitHub deploy service principal' (az ad sp list --display-name $CiAppDisplayName --query "[0].id" --output tsv)

$webPrincipalId = az identity show --resource-group $ResourceGroup --name $WebIdentityName --query principalId --output tsv 2>$null
if ([string]::IsNullOrWhiteSpace($webPrincipalId)) {
    Write-Warning "Web managed identity '$WebIdentityName' was not found — web AcrPull will be skipped. Run again after deploying the web foundation."
    $webPrincipalId = $null
}

Write-Host ""
Write-Host "Bridata Project DEV RBAC" -ForegroundColor Cyan
Write-Host "Subscription : $subscriptionId"
Write-Host "Resource group: $ResourceGroup"
Write-Host "ACR           : $acrName"
Write-Host "Key Vault     : $keyVaultName"
Write-Host "API identity  : $ApiIdentityName"
Write-Host "Web identity  : $(if ($webPrincipalId) { $WebIdentityName } else { '(not found — skipped)' })"
Write-Host "CI identity   : $CiAppDisplayName"
Write-Host ""

# GitHub can push approved images, but receives no Key Vault data-plane access.
Ensure-RoleAssignment -AssigneeObjectId $ciPrincipalId -Role 'AcrPush' -Scope $acrId

# API runtime identity: pull images + read secrets.
Ensure-RoleAssignment -AssigneeObjectId $apiPrincipalId -Role 'AcrPull' -Scope $acrId
Ensure-RoleAssignment -AssigneeObjectId $apiPrincipalId -Role 'Key Vault Secrets User' -Scope $keyVaultId

# Web runtime identity: pull images only (no Key Vault — Entra config arrives via env vars).
if ($webPrincipalId) {
    Ensure-RoleAssignment -AssigneeObjectId $webPrincipalId -Role 'AcrPull' -Scope $acrId -PrincipalType 'ServicePrincipal'
}

Write-Host ""
Write-Host "RBAC READY" -ForegroundColor Green
Write-Host "GitHub CI: AcrPush"
Write-Host "API managed identity: AcrPull + Key Vault Secrets User"
if ($webPrincipalId) { Write-Host "Web managed identity: AcrPull" }
Write-Host "No PostgreSQL administrator role was granted to either runtime identity."
