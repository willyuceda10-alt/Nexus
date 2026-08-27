param(
    [string]$ResourceGroup = 'rg-nexus-dev',
    [string]$Environment = 'dev',
    [string]$ExpectedBranch = 'feature/azure-dev-cli-connect-v1',
    [string]$EntraApiClientId = '',
    [string]$CorsOrigins = 'https://not-configured.invalid',
    [string]$ImageTag = '',
    [bool]$ValidateCode = $true,
    [switch]$BuildImages,
    [switch]$DeployCoreRuntime,
    [switch]$DeployMeetingWorker,
    [switch]$GrantGraphAvailability,
    [switch]$GrantGraphCalendar,
    [switch]$MailboxScopeConfigured,
    [switch]$EnableM365Availability,
    [switch]$EnableM365CalendarSync,
    [switch]$Apply
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

function Write-Step([string]$Text) {
    Write-Host ''
    Write-Host "=== $Text ===" -ForegroundColor Cyan
}

function Require-Command([string]$Name) {
    if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
        throw "Required command '$Name' was not found."
    }
}

function Require-Value([string]$Name, [string]$Value) {
    if ([string]::IsNullOrWhiteSpace($Value)) { throw "Could not resolve $Name." }
    return $Value.Trim()
}

function Invoke-AzTsv([string[]]$Arguments) {
    $value = & az @Arguments 2>$null
    if ($LASTEXITCODE -ne 0) { return '' }
    return (($value | Out-String).Trim())
}

function Ensure-Identity {
    param([string]$Name, [string]$Location)
    $json = & az identity show --resource-group $ResourceGroup --name $Name -o json 2>$null
    if ($LASTEXITCODE -eq 0 -and $json) { return ($json | ConvertFrom-Json) }
    if (-not $Apply) {
        Write-Warning "Managed identity '$Name' is missing. APPLY mode would create it."
        return $null
    }
    Write-Host "Creating managed identity $Name ..." -ForegroundColor Yellow
    return (& az identity create --resource-group $ResourceGroup --name $Name --location $Location -o json | ConvertFrom-Json)
}

function Ensure-RoleAssignment {
    param(
        [string]$PrincipalId,
        [string]$Role,
        [string]$Scope
    )
    if (-not $PrincipalId) { return }
    $count = Invoke-AzTsv @('role','assignment','list','--assignee-object-id',$PrincipalId,'--scope',$Scope,'--query',"[?roleDefinitionName=='$Role'] | length(@)",'--output','tsv')
    if ($count -and [int]$count -gt 0) {
        Write-Host "[OK] $Role already assigned" -ForegroundColor Green
        return
    }
    if (-not $Apply) {
        Write-Host "[DRY-RUN] Would assign $Role to $PrincipalId" -ForegroundColor Yellow
        return
    }
    Write-Host "Assigning $Role ..." -ForegroundColor Yellow
    & az role assignment create --assignee-object-id $PrincipalId --assignee-principal-type ServicePrincipal --role $Role --scope $Scope -o none
    if ($LASTEXITCODE -ne 0) { throw "Could not assign role '$Role'. Run with an Azure Owner/User Access Administrator if required." }
}

function Write-ArmParameters([string]$Path, [hashtable]$Parameters) {
    $wrapped = @{}
    foreach ($key in $Parameters.Keys) { $wrapped[$key] = @{ value = $Parameters[$key] } }
    @{
        '$schema' = 'https://schema.management.azure.com/schemas/2019-04-01/deploymentParameters.json#'
        contentVersion = '1.0.0.0'
        parameters = $wrapped
    } | ConvertTo-Json -Depth 20 | Set-Content -Path $Path -Encoding utf8
}

function Run-WhatIf([string]$Name, [string]$Template, [string]$ParameterFile, [string[]]$ExtraParameters = @()) {
    $args = @('deployment','group','what-if','--name',$Name,'--resource-group',$ResourceGroup,'--template-file',$Template,'--parameters',"@$ParameterFile") + $ExtraParameters + @('--no-pretty-print')
    & az @args
    if ($LASTEXITCODE -ne 0) { throw "Azure what-if failed for $Name." }
}

function Run-Deployment([string]$Name, [string]$Template, [string]$ParameterFile, [string[]]$ExtraParameters = @()) {
    if (-not $Apply) {
        Write-Host "[DRY-RUN] Deployment '$Name' not applied." -ForegroundColor Yellow
        return
    }
    $args = @('deployment','group','create','--name',$Name,'--resource-group',$ResourceGroup,'--template-file',$Template,'--parameters',"@$ParameterFile") + $ExtraParameters + @('--output','none')
    & az @args
    if ($LASTEXITCODE -ne 0) { throw "Azure deployment failed for $Name." }
}

function Wait-Migration([string]$JobName) {
    if (-not $Apply) { return }
    $execution = Require-Value 'migration execution name' (Invoke-AzTsv @('containerapp','job','start','--name',$JobName,'--resource-group',$ResourceGroup,'--query','name','--output','tsv'))
    Write-Host "Migration execution: $execution"
    for ($attempt = 1; $attempt -le 90; $attempt++) {
        $status = Invoke-AzTsv @('containerapp','job','execution','show','--name',$JobName,'--resource-group',$ResourceGroup,'--job-execution-name',$execution,'--query','properties.status','--output','tsv')
        if ($status) { Write-Host "Migration: $status" }
        if ($status -eq 'Succeeded') { return }
        if ($status -in @('Failed','Stopped')) { throw "Migration job ended with status $status." }
        Start-Sleep -Seconds 10
    }
    throw 'Migration job did not finish within 15 minutes.'
}

function Test-ApiHealth([string]$Fqdn) {
    if (-not $Apply) { return }
    $baseUrl = "https://$Fqdn"
    Write-Host "Checking $baseUrl ..."
    $ready = $false
    for ($attempt = 1; $attempt -le 36; $attempt++) {
        try {
            $live = (Invoke-WebRequest -Uri "$baseUrl/health/live" -Method Get -SkipHttpErrorCheck -TimeoutSec 10).StatusCode
            $db = (Invoke-WebRequest -Uri "$baseUrl/health/ready" -Method Get -SkipHttpErrorCheck -TimeoutSec 10).StatusCode
            Write-Host "Health $attempt: live=$live ready=$db"
            if ($live -eq 200 -and $db -eq 200) { $ready = $true; break }
        } catch {
            Write-Host "Health $attempt: waiting"
        }
        Start-Sleep -Seconds 10
    }
    if (-not $ready) { throw 'API liveness/readiness did not both return 200.' }
    $session = (Invoke-WebRequest -Uri "$baseUrl/api/v1/session" -Method Get -SkipHttpErrorCheck -TimeoutSec 10).StatusCode
    if ($session -ne 401) { throw "Unauthenticated session returned HTTP $session instead of 401." }
    Write-Host "[OK] API healthy and fail-closed at $baseUrl" -ForegroundColor Green
}

Require-Command az
Require-Command git
if ($ValidateCode) { Require-Command npm }

Write-Step 'Azure account and repository'
$account = (& az account show -o json | ConvertFrom-Json)
$subscriptionId = Require-Value 'subscription id' ([string]$account.id)
$tenantId = Require-Value 'tenant id' ([string]$account.tenantId)
$location = Require-Value 'resource group location' (Invoke-AzTsv @('group','show','--name',$ResourceGroup,'--query','location','--output','tsv'))
$currentBranch = (git branch --show-current).Trim()
$commitSha = (git rev-parse HEAD).Trim()
if ($ExpectedBranch -and $currentBranch -ne $ExpectedBranch) {
    Write-Warning "Current branch is '$currentBranch'. Expected '$ExpectedBranch'."
}
if ((git status --porcelain)) {
    throw 'Git working tree is not clean. Commit or discard local changes before building Azure images.'
}
Write-Host "Subscription : $subscriptionId"
Write-Host "Tenant       : $tenantId"
Write-Host "ResourceGroup: $ResourceGroup ($location)"
Write-Host "Branch       : $currentBranch"
Write-Host "Commit       : $commitSha"
Write-Host "Mode         : $(if ($Apply) { 'APPLY' } else { 'DRY-RUN / WHAT-IF' })"

Write-Step 'Required Azure foundation'
$acrName = Require-Value 'Azure Container Registry' (Invoke-AzTsv @('acr','list','--resource-group',$ResourceGroup,'--query','[0].name','--output','tsv'))
$acrId = Require-Value 'ACR id' (Invoke-AzTsv @('acr','show','--resource-group',$ResourceGroup,'--name',$acrName,'--query','id','--output','tsv'))
$loginServer = Require-Value 'ACR login server' (Invoke-AzTsv @('acr','show','--resource-group',$ResourceGroup,'--name',$acrName,'--query','loginServer','--output','tsv'))
$keyVaultName = Require-Value 'Key Vault' (Invoke-AzTsv @('keyvault','list','--resource-group',$ResourceGroup,'--query','[0].name','--output','tsv'))
$keyVaultId = Require-Value 'Key Vault id' (Invoke-AzTsv @('keyvault','show','--resource-group',$ResourceGroup,'--name',$keyVaultName,'--query','id','--output','tsv'))
$storageName = Require-Value 'Storage account' (Invoke-AzTsv @('storage','account','list','--resource-group',$ResourceGroup,'--query','[0].name','--output','tsv'))
$managedEnvironmentId = Require-Value 'Container Apps Environment' (Invoke-AzTsv @('resource','list','--resource-group',$ResourceGroup,'--resource-type','Microsoft.App/managedEnvironments','--query','[0].id','--output','tsv'))
$postgresName = Require-Value 'PostgreSQL Flexible Server' (Invoke-AzTsv @('postgres','flexible-server','list','--resource-group',$ResourceGroup,'--query','[0].name','--output','tsv'))
$postgresPublic = Invoke-AzTsv @('postgres','flexible-server','show','--resource-group',$ResourceGroup,'--name',$postgresName,'--query','network.publicNetworkAccess','--output','tsv')
if ($postgresPublic -ne 'Disabled') { throw "PostgreSQL publicNetworkAccess is '$postgresPublic', expected Disabled." }
foreach ($secretName in @('admin-database-url','runtime-database-url')) {
    $secretId = Invoke-AzTsv @('keyvault','secret','show','--vault-name',$keyVaultName,'--name',$secretName,'--query','id','--output','tsv')
    if (-not $secretId) { throw "Key Vault secret '$secretName' is missing." }
}
Write-Host "[OK] ACR       : $acrName"
Write-Host "[OK] Key Vault : $keyVaultName"
Write-Host "[OK] Storage   : $storageName"
Write-Host "[OK] PostgreSQL: $postgresName (private)"

Write-Step 'Runtime identities and least privilege RBAC'
$apiIdentity = Ensure-Identity -Name "nexus-$Environment-api-mi" -Location $location
$automationIdentity = Ensure-Identity -Name "nexus-$Environment-automation-mi" -Location $location
$notificationIdentity = Ensure-Identity -Name "nexus-$Environment-notifications-mi" -Location $location
if (-not $apiIdentity) { throw 'API managed identity is required even in dry-run because the foundation should already contain it.' }
Ensure-RoleAssignment -PrincipalId $apiIdentity.principalId -Role 'AcrPull' -Scope $acrId
Ensure-RoleAssignment -PrincipalId $apiIdentity.principalId -Role 'Key Vault Secrets User' -Scope $keyVaultId
if ($automationIdentity) {
    Ensure-RoleAssignment -PrincipalId $automationIdentity.principalId -Role 'AcrPull' -Scope $acrId
    Ensure-RoleAssignment -PrincipalId $automationIdentity.principalId -Role 'Key Vault Secrets User' -Scope $keyVaultId
}
if ($notificationIdentity) {
    Ensure-RoleAssignment -PrincipalId $notificationIdentity.principalId -Role 'AcrPull' -Scope $acrId
    Ensure-RoleAssignment -PrincipalId $notificationIdentity.principalId -Role 'Key Vault Secrets User' -Scope $keyVaultId
}

Write-Step 'Bicep validation'
foreach ($template in @('infra/azure/main.bicep','infra/azure/async-messaging.bicep','infra/azure/api-runtime.bicep','infra/azure/meeting-calendar-runtime.bicep')) {
    & az bicep build --file $template --stdout *> $null
    if ($LASTEXITCODE -ne 0) { throw "Bicep build failed: $template" }
    Write-Host "[OK] $template"
}

if ($ValidateCode) {
    Write-Step 'Source validation before Azure deployment'
    & npm ci
    if ($LASTEXITCODE -ne 0) { throw 'npm ci failed.' }
    foreach ($command in @('prisma:validate','prisma:generate','typecheck','test','build')) {
        Write-Host "npm run $command"
        & npm run $command
        if ($LASTEXITCODE -ne 0) { throw "npm run $command failed. Azure deployment stopped." }
    }
    Write-Host '[OK] Prisma, typecheck, tests and build completed.' -ForegroundColor Green
}

if (-not $EntraApiClientId) {
    $existingApiApp = & az ad app list --display-name bridata-api-dev --query '[0].appId' -o tsv 2>$null
    if ($LASTEXITCODE -eq 0 -and $existingApiApp) { $EntraApiClientId = $existingApiApp.Trim() }
}
if (-not $EntraApiClientId) {
    Write-Warning 'Bridata API Entra App Registration is not resolved. Run infra/azure/bootstrap-entra-api-dev.ps1, then re-run this script with -EntraApiClientId <GUID> before runtime deployment.'
    if ($DeployCoreRuntime) { throw 'Entra API client id is required for the Azure API runtime.' }
}

$tag = if ($ImageTag) { $ImageTag.Trim() } else { $commitSha }
if ($BuildImages) {
    Write-Step 'ACR build: runtime + migration images'
    if (-not $Apply) {
        Write-Host "[DRY-RUN] Would build bridata-api:$tag and bridata-migrate:$tag in $acrName."
    } else {
        & az acr build --registry $acrName --resource-group $ResourceGroup --file Dockerfile.api --target runtime --image "bridata-api:$tag" .
        if ($LASTEXITCODE -ne 0) { throw 'ACR runtime image build failed.' }
        & az acr build --registry $acrName --resource-group $ResourceGroup --file Dockerfile.api --target migrate --image "bridata-migrate:$tag" .
        if ($LASTEXITCODE -ne 0) { throw 'ACR migration image build failed.' }
    }
}

$apiDigest = Invoke-AzTsv @('acr','repository','show','--name',$acrName,'--image',"bridata-api:$tag",'--query','digest','--output','tsv')
$migrationDigest = Invoke-AzTsv @('acr','repository','show','--name',$acrName,'--image',"bridata-migrate:$tag",'--query','digest','--output','tsv')
if (($DeployCoreRuntime -or $DeployMeetingWorker) -and ((-not $apiDigest) -or (-not $migrationDigest))) {
    throw "Immutable image pair for tag '$tag' is unavailable. Re-run with -BuildImages -Apply first."
}
$apiImage = if ($apiDigest) { "$loginServer/bridata-api@$apiDigest" } else { '' }
$migrationImage = if ($migrationDigest) { "$loginServer/bridata-migrate@$migrationDigest" } else { '' }

$tempDir = Join-Path ([System.IO.Path]::GetTempPath()) "bridata-azure-$([guid]::NewGuid().ToString('N'))"
New-Item -ItemType Directory -Path $tempDir | Out-Null
try {
    if ($DeployCoreRuntime) {
        Write-Step 'Service Bus + core workers'
        if (-not $automationIdentity -or -not $notificationIdentity) { throw 'Automation and notification managed identities are required.' }
        $tags = @{ product='Bridata Project'; technicalPlatform='Nexus Core'; environment=$Environment; managedBy='PowerShell+Bicep' }
        $asyncParams = Join-Path $tempDir 'async.json'
        Write-ArmParameters -Path $asyncParams -Parameters @{
            location = $location
            environment = $Environment
            tags = $tags
            runtimeIdentityPrincipalId = $apiIdentity.principalId
            automationIdentityPrincipalId = $automationIdentity.principalId
            notificationIdentityPrincipalId = $notificationIdentity.principalId
            topicName = 'bridata-domain-events'
            automationSubscriptionName = 'automation-v1'
            notificationSubscriptionName = 'notifications-v1'
            deployAutomationConsumer = $true
            deployNotificationConsumer = $true
        }
        Run-WhatIf -Name "bridata-$Environment-async-preflight" -Template 'infra/azure/async-messaging.bicep' -ParameterFile $asyncParams
        Run-Deployment -Name "bridata-$Environment-async" -Template 'infra/azure/async-messaging.bicep' -ParameterFile $asyncParams

        $sbNamespace = Require-Value 'Service Bus namespace' (Invoke-AzTsv @('servicebus','namespace','list','--resource-group',$ResourceGroup,'--query','[0].name','--output','tsv'))
        $runtimeParams = Join-Path $tempDir 'runtime.json'
        Write-ArmParameters -Path $runtimeParams -Parameters @{
            location = $location
            environment = $Environment
            tags = $tags
            managedEnvironmentId = $managedEnvironmentId
            registryServer = $loginServer
            apiIdentityResourceId = $apiIdentity.id
            apiIdentityClientId = $apiIdentity.clientId
            automationIdentityResourceId = $automationIdentity.id
            automationIdentityClientId = $automationIdentity.clientId
            notificationIdentityResourceId = $notificationIdentity.id
            notificationIdentityClientId = $notificationIdentity.clientId
            apiImage = $apiImage
            migrationImage = $migrationImage
            runtimeDatabaseSecretUri = "https://$keyVaultName.vault.azure.net/secrets/runtime-database-url"
            adminDatabaseSecretUri = "https://$keyVaultName.vault.azure.net/secrets/admin-database-url"
            entraApiClientId = $EntraApiClientId
            entraTenantId = $tenantId
            corsOrigins = $CorsOrigins
            serviceBusNamespaceFqdn = "$sbNamespace.servicebus.windows.net"
            serviceBusTopicName = 'bridata-domain-events'
            serviceBusAutomationSubscriptionName = 'automation-v1'
            serviceBusNotificationSubscriptionName = 'notifications-v1'
            m365GraphDeliveryEnabled = $false
            m365AvailabilityEnabled = [bool]$EnableM365Availability
        }

        Run-WhatIf -Name "bridata-$Environment-migrate-preflight" -Template 'infra/azure/api-runtime.bicep' -ParameterFile $runtimeParams -ExtraParameters @('deployApi=false','deployMigrationJob=true','deployOutboxWorker=false','deployAutomationWorker=false','deployNotificationWorker=false')
        Run-Deployment -Name "bridata-$Environment-migrate" -Template 'infra/azure/api-runtime.bicep' -ParameterFile $runtimeParams -ExtraParameters @('deployApi=false','deployMigrationJob=true','deployOutboxWorker=false','deployAutomationWorker=false','deployNotificationWorker=false')
        Wait-Migration -JobName "nexus-$Environment-migrate"

        Run-WhatIf -Name "bridata-$Environment-runtime-preflight" -Template 'infra/azure/api-runtime.bicep' -ParameterFile $runtimeParams -ExtraParameters @('deployApi=true','deployMigrationJob=false','deployOutboxWorker=true','deployAutomationWorker=true','deployNotificationWorker=true')
        Run-Deployment -Name "bridata-$Environment-runtime" -Template 'infra/azure/api-runtime.bicep' -ParameterFile $runtimeParams -ExtraParameters @('deployApi=true','deployMigrationJob=false','deployOutboxWorker=true','deployAutomationWorker=true','deployNotificationWorker=true')

        if ($Apply) {
            $apiFqdn = Require-Value 'API FQDN' (Invoke-AzTsv @('containerapp','show','--resource-group',$ResourceGroup,'--name',"nexus-$Environment-api",'--query','properties.configuration.ingress.fqdn','--output','tsv'))
            Test-ApiHealth -Fqdn $apiFqdn
        }
    }

    if ($DeployMeetingWorker) {
        Write-Step 'Meeting Calendar worker and meetings-v1 subscription'
        $sbNamespace = Require-Value 'Service Bus namespace' (Invoke-AzTsv @('servicebus','namespace','list','--resource-group',$ResourceGroup,'--query','[0].name','--output','tsv'))
        $meetingParams = Join-Path $tempDir 'meeting.json'
        Write-ArmParameters -Path $meetingParams -Parameters @{
            deployMeetingCalendarWorker = $true
            location = $location
            environment = $Environment
            tags = @{ product='Bridata Project'; technicalPlatform='Nexus Core'; environment=$Environment; managedBy='PowerShell+Bicep' }
            managedEnvironmentId = $managedEnvironmentId
            registryResourceId = $acrId
            registryServer = $loginServer
            keyVaultResourceId = $keyVaultId
            apiImage = $apiImage
            runtimeDatabaseSecretUri = "https://$keyVaultName.vault.azure.net/secrets/runtime-database-url"
            entraApiClientId = $EntraApiClientId
            entraTenantId = $tenantId
            serviceBusNamespaceName = $sbNamespace
            serviceBusTopicName = 'bridata-domain-events'
            meetingSubscriptionName = 'meetings-v1'
            m365CalendarSyncEnabled = [bool]$EnableM365CalendarSync
        }
        Run-WhatIf -Name "bridata-$Environment-meetings-preflight" -Template 'infra/azure/meeting-calendar-runtime.bicep' -ParameterFile $meetingParams
        Run-Deployment -Name "bridata-$Environment-meetings" -Template 'infra/azure/meeting-calendar-runtime.bicep' -ParameterFile $meetingParams
    }

    if ($GrantGraphAvailability) {
        Write-Step 'Microsoft Graph availability permission'
        if (-not $MailboxScopeConfigured) { throw 'Refusing Graph application permission without -MailboxScopeConfigured.' }
        $args = @('-ResourceGroup',$ResourceGroup,'-IdentityName',"nexus-$Environment-api-mi")
        if ($Apply) { $args += '-Apply' }
        & ./infra/azure/grant-meeting-availability-graph.ps1 @args
        if ($LASTEXITCODE -ne 0) { throw 'Graph availability permission bootstrap failed.' }
    }

    if ($GrantGraphCalendar) {
        Write-Step 'Microsoft Graph calendar write permission'
        if (-not $MailboxScopeConfigured) { throw 'Refusing Calendars.ReadWrite without -MailboxScopeConfigured.' }
        $meetingPrincipalId = Require-Value 'Meeting managed identity principal' (Invoke-AzTsv @('identity','show','--resource-group',$ResourceGroup,'--name',"nexus-$Environment-meetings-mi",'--query','principalId','--output','tsv'))
        $args = @('-MeetingManagedIdentityPrincipalId',$meetingPrincipalId)
        if ($Apply) { $args += '-Apply' }
        & ./infra/azure/grant-meeting-calendar-graph.ps1 @args
        if ($LASTEXITCODE -ne 0) { throw 'Graph calendar permission bootstrap failed.' }
    }

    if ($EnableM365Availability -and $Apply) {
        Write-Step 'Enable M365 free/busy capability on API'
        if (-not $MailboxScopeConfigured) { throw 'Refusing M365 availability enablement without mailbox scope confirmation.' }
        & az containerapp update --resource-group $ResourceGroup --name "nexus-$Environment-api" --set-env-vars 'M365_AVAILABILITY_ENABLED=true' -o none
        if ($LASTEXITCODE -ne 0) { throw 'Could not enable M365_AVAILABILITY_ENABLED.' }
    }

    if ($EnableM365CalendarSync) {
        Write-Step 'Enable meeting calendar capability on API'
        if (-not $MailboxScopeConfigured) { throw 'Refusing M365 calendar sync enablement without mailbox scope confirmation.' }
        $args = @('-ResourceGroup',$ResourceGroup,'-Environment',$Environment,'-Mode','Enable')
        if ($Apply) { $args += '-Apply' }
        & ./infra/azure/set-meeting-calendar-capability.ps1 @args
        if ($LASTEXITCODE -ne 0) { throw 'Meeting calendar capability switch failed.' }
    }
} finally {
    Remove-Item -Recurse -Force $tempDir -ErrorAction SilentlyContinue
}

Write-Step 'Result / remaining controlled boundary'
Write-Host 'Azure backend path covered by this orchestrator:'
Write-Host '  PostgreSQL private + Key Vault -> migration job -> API Container App'
Write-Host '  API outbox -> Service Bus -> Automation / Notification workers'
Write-Host '  meetings-v1 subscription -> Meeting Calendar worker'
Write-Host '  Optional Graph free/busy and calendar roles only after mailbox scope confirmation'
Write-Host ''
Write-Warning 'The React web is intentionally NOT published by this script yet. The repository still calls /bootstrap before an Entra access-token provider is configured in the browser. Publishing VITE_DATA_MODE=api now would produce an authenticated API 401 path. Finish the web Entra/PKCE provider first, then publish the built SPA to Azure Storage/Static Web Apps and set API CORS to that exact origin.'
Write-Host ''
Write-Host "Source commit: $commitSha"
Write-Host "Image tag   : $tag"
Write-Host "Mode        : $(if ($Apply) { 'APPLY' } else { 'DRY-RUN / WHAT-IF' })"
