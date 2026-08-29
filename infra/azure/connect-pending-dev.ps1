param(
    [string]$ResourceGroup = 'rg-nexus-dev',
    [string]$Environment = 'dev',
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

function Step([string]$Text) {
    Write-Host ''
    Write-Host "=== $Text ===" -ForegroundColor Cyan
}

function Need([string]$Command) {
    if (-not (Get-Command $Command -ErrorAction SilentlyContinue)) {
        throw "Required command '$Command' was not found."
    }
}

function Required([string]$Name, [string]$Value) {
    if ([string]::IsNullOrWhiteSpace($Value)) { throw "Could not resolve $Name." }
    return $Value.Trim()
}

function AzTsv([string[]]$Args) {
    $value = & az @Args 2>$null
    if ($LASTEXITCODE -ne 0) { return '' }
    return (($value | Out-String).Trim())
}

function ExistingIdentity([string]$Name) {
    $json = & az identity show -g $ResourceGroup -n $Name -o json 2>$null
    if ($LASTEXITCODE -ne 0 -or -not $json) { return $null }
    return ($json | ConvertFrom-Json)
}

function EnsureIdentity([string]$Name, [string]$Location) {
    $identity = ExistingIdentity $Name
    if ($identity) {
        Write-Host "[OK] Managed identity: $Name" -ForegroundColor Green
        return $identity
    }
    if (-not $Apply) {
        Write-Warning "Managed identity '$Name' is missing. APPLY mode can create it."
        return $null
    }
    Write-Host "Creating managed identity $Name ..." -ForegroundColor Yellow
    return (& az identity create -g $ResourceGroup -n $Name -l $Location -o json | ConvertFrom-Json)
}

function EnsureRole([string]$PrincipalId, [string]$Role, [string]$Scope) {
    if (-not $PrincipalId) { return }
    $count = AzTsv @('role','assignment','list','--assignee-object-id',$PrincipalId,'--scope',$Scope,'--query',"[?roleDefinitionName=='$Role'] | length(@)",'-o','tsv')
    if ($count -and [int]$count -gt 0) {
        Write-Host "[OK] $Role" -ForegroundColor Green
        return
    }
    if (-not $Apply) {
        Write-Host "[DRY-RUN] Would assign $Role" -ForegroundColor Yellow
        return
    }
    & az role assignment create --assignee-object-id $PrincipalId --assignee-principal-type ServicePrincipal --role $Role --scope $Scope -o none
    if ($LASTEXITCODE -ne 0) {
        throw "Could not assign '$Role'. An Azure Owner/User Access Administrator may be required."
    }
}

function ArmParams([string]$Path, [hashtable]$Values) {
    $parameters = @{}
    foreach ($key in $Values.Keys) { $parameters[$key] = @{ value = $Values[$key] } }
    @{
        '$schema' = 'https://schema.management.azure.com/schemas/2019-04-01/deploymentParameters.json#'
        contentVersion = '1.0.0.0'
        parameters = $parameters
    } | ConvertTo-Json -Depth 20 | Set-Content -Path $Path -Encoding utf8
}

function WhatIf([string]$Name, [string]$Template, [string]$Params, [string[]]$Extra = @()) {
    $args = @('deployment','group','what-if','-g',$ResourceGroup,'-n',$Name,'--template-file',$Template,'--parameters',"@$Params") + $Extra + @('--no-pretty-print')
    & az @args
    if ($LASTEXITCODE -ne 0) { throw "Azure what-if failed: $Name" }
}

function Deploy([string]$Name, [string]$Template, [string]$Params, [string[]]$Extra = @()) {
    if (-not $Apply) {
        Write-Host "[DRY-RUN] Deployment '$Name' not applied." -ForegroundColor Yellow
        return
    }
    $args = @('deployment','group','create','-g',$ResourceGroup,'-n',$Name,'--template-file',$Template,'--parameters',"@$Params") + $Extra + @('-o','none')
    & az @args
    if ($LASTEXITCODE -ne 0) { throw "Azure deployment failed: $Name" }
}

function WaitMigration([string]$JobName) {
    if (-not $Apply) { return }
    $execution = Required 'migration execution' (AzTsv @('containerapp','job','start','-g',$ResourceGroup,'-n',$JobName,'--query','name','-o','tsv'))
    Write-Host "Migration execution: $execution"
    for ($i = 1; $i -le 90; $i++) {
        $status = AzTsv @('containerapp','job','execution','show','-g',$ResourceGroup,'-n',$JobName,'--job-execution-name',$execution,'--query','properties.status','-o','tsv')
        if ($status) { Write-Host "Migration: $status" }
        if ($status -eq 'Succeeded') { return }
        if ($status -in @('Failed','Stopped')) { throw "Migration ended with status $status." }
        Start-Sleep 10
    }
    throw 'Migration did not finish within 15 minutes.'
}

function VerifyApi([string]$Fqdn) {
    if (-not $Apply) { return }
    $base = "https://$Fqdn"
    $ready = $false
    for ($i = 1; $i -le 36; $i++) {
        try {
            $live = (Invoke-WebRequest "$base/health/live" -SkipHttpErrorCheck -TimeoutSec 10).StatusCode
            $db = (Invoke-WebRequest "$base/health/ready" -SkipHttpErrorCheck -TimeoutSec 10).StatusCode
            Write-Host "Health ${i}: live=$live ready=$db"
            if ($live -eq 200 -and $db -eq 200) { $ready = $true; break }
        } catch { Write-Host "Health ${i}: waiting" }
        Start-Sleep 10
    }
    if (-not $ready) { throw 'API health checks did not reach HTTP 200.' }
    $session = (Invoke-WebRequest "$base/api/v1/session" -SkipHttpErrorCheck -TimeoutSec 10).StatusCode
    if ($session -ne 401) { throw "Unauthenticated /api/v1/session returned $session instead of 401." }
    Write-Host "[OK] API ready and authentication fail-closed: $base" -ForegroundColor Green
}

Need az
Need git
if ($ValidateCode) { Need npm }

Step 'Account and source'
$account = (& az account show -o json | ConvertFrom-Json)
$subscriptionId = Required 'Azure subscription' ([string]$account.id)
$tenantId = Required 'Entra tenant' ([string]$account.tenantId)
$location = Required 'resource group location' (AzTsv @('group','show','-n',$ResourceGroup,'--query','location','-o','tsv'))
$branch = (git branch --show-current).Trim()
$commit = (git rev-parse HEAD).Trim()
if ((git status --porcelain)) { throw 'Git working tree must be clean before Azure image builds.' }
Write-Host "Subscription : $subscriptionId"
Write-Host "Tenant       : $tenantId"
Write-Host "ResourceGroup: $ResourceGroup ($location)"
Write-Host "Branch       : $branch"
Write-Host "Commit       : $commit"
Write-Host "Mode         : $(if ($Apply) { 'APPLY' } else { 'DRY-RUN / WHAT-IF' })"

if ($EnableM365Availability -and -not $GrantGraphAvailability) {
    throw '-EnableM365Availability requires -GrantGraphAvailability in the same idempotent run.'
}
if ($EnableM365CalendarSync -and -not $GrantGraphCalendar) {
    throw '-EnableM365CalendarSync requires -GrantGraphCalendar in the same idempotent run.'
}

Step 'Existing DEV foundation'
$acrName = Required 'ACR' (AzTsv @('acr','list','-g',$ResourceGroup,'--query','[0].name','-o','tsv'))
$acrId = Required 'ACR resource id' (AzTsv @('acr','show','-g',$ResourceGroup,'-n',$acrName,'--query','id','-o','tsv'))
$loginServer = Required 'ACR login server' (AzTsv @('acr','show','-g',$ResourceGroup,'-n',$acrName,'--query','loginServer','-o','tsv'))
$vaultName = Required 'Key Vault' (AzTsv @('keyvault','list','-g',$ResourceGroup,'--query','[0].name','-o','tsv'))
$vaultId = Required 'Key Vault resource id' (AzTsv @('keyvault','show','-g',$ResourceGroup,'-n',$vaultName,'--query','id','-o','tsv'))
$storageName = Required 'Storage account' (AzTsv @('storage','account','list','-g',$ResourceGroup,'--query','[0].name','-o','tsv'))
$caeId = Required 'Container Apps Environment' (AzTsv @('resource','list','-g',$ResourceGroup,'--resource-type','Microsoft.App/managedEnvironments','--query','[0].id','-o','tsv'))
$postgresName = Required 'PostgreSQL Flexible Server' (AzTsv @('postgres','flexible-server','list','-g',$ResourceGroup,'--query','[0].name','-o','tsv'))
$publicAccess = AzTsv @('postgres','flexible-server','show','-g',$ResourceGroup,'-n',$postgresName,'--query','network.publicNetworkAccess','-o','tsv')
if ($publicAccess -ne 'Disabled') { throw "PostgreSQL publicNetworkAccess='$publicAccess'; expected Disabled." }

# ARM metadata only. This proves secret child resources exist and never reads values.
foreach ($secret in @('admin-database-url','runtime-database-url')) {
    $secretId = "$vaultId/secrets/$secret"
    $id = AzTsv @('resource','show','--ids',$secretId,'--api-version','2023-07-01','--query','id','-o','tsv')
    if (-not $id) { throw "Key Vault secret resource '$secret' is missing." }
}
Write-Host "[OK] ACR        $acrName" -ForegroundColor Green
Write-Host "[OK] Key Vault  $vaultName" -ForegroundColor Green
Write-Host "[OK] Storage    $storageName" -ForegroundColor Green
Write-Host "[OK] PostgreSQL $postgresName private" -ForegroundColor Green

Step 'Managed identities and runtime RBAC'
$apiMi = EnsureIdentity "nexus-$Environment-api-mi" $location
$automationMi = EnsureIdentity "nexus-$Environment-automation-mi" $location
$notificationMi = EnsureIdentity "nexus-$Environment-notifications-mi" $location
if (-not $apiMi) { throw 'API managed identity is required and should already exist in the DEV foundation.' }
EnsureRole $apiMi.principalId 'AcrPull' $acrId
EnsureRole $apiMi.principalId 'Key Vault Secrets User' $vaultId
if ($automationMi) { EnsureRole $automationMi.principalId 'AcrPull' $acrId; EnsureRole $automationMi.principalId 'Key Vault Secrets User' $vaultId }
if ($notificationMi) { EnsureRole $notificationMi.principalId 'AcrPull' $acrId; EnsureRole $notificationMi.principalId 'Key Vault Secrets User' $vaultId }

Step 'Bicep validation'
foreach ($template in @('infra/azure/main.bicep','infra/azure/async-messaging.bicep','infra/azure/api-runtime.bicep','infra/azure/meeting-calendar-runtime.bicep')) {
    & az bicep build --file $template --stdout *> $null
    if ($LASTEXITCODE -ne 0) { throw "Bicep build failed: $template" }
    Write-Host "[OK] $template"
}

if ($ValidateCode) {
    Step 'Prisma, TypeScript, tests and build'
    & npm ci
    if ($LASTEXITCODE -ne 0) { throw 'npm ci failed.' }
    foreach ($script in @('prisma:validate','prisma:generate','typecheck','test','build')) {
        & npm run $script
        if ($LASTEXITCODE -ne 0) { throw "npm run $script failed. Azure changes stopped." }
    }
    Write-Host '[OK] Source validation complete.' -ForegroundColor Green
}

if (-not $EntraApiClientId) {
    $EntraApiClientId = AzTsv @('ad','app','list','--display-name','bridata-api-dev','--query','[0].appId','-o','tsv')
}
if (-not $EntraApiClientId -and ($DeployCoreRuntime -or $DeployMeetingWorker)) {
    throw 'Entra API app is missing. Run infra/azure/bootstrap-entra-api-dev.ps1 first or pass -EntraApiClientId.'
}

$tag = if ($ImageTag) { $ImageTag.Trim() } else { $commit }
if ($BuildImages) {
    Step 'ACR build: immutable runtime and migration pair'
    if (-not $Apply) {
        Write-Host "[DRY-RUN] Would build bridata-api:$tag and bridata-migrate:$tag in $acrName."
    } else {
        & az acr build -r $acrName -g $ResourceGroup -f Dockerfile.api --target runtime -t "bridata-api:$tag" .
        if ($LASTEXITCODE -ne 0) { throw 'Runtime ACR build failed.' }
        & az acr build -r $acrName -g $ResourceGroup -f Dockerfile.api --target migrate -t "bridata-migrate:$tag" .
        if ($LASTEXITCODE -ne 0) { throw 'Migration ACR build failed.' }
    }
}

$apiDigest = AzTsv @('acr','repository','show','-n',$acrName,'--image',"bridata-api:$tag",'--query','digest','-o','tsv')
$migrateDigest = AzTsv @('acr','repository','show','-n',$acrName,'--image',"bridata-migrate:$tag",'--query','digest','-o','tsv')
if (($DeployCoreRuntime -or $DeployMeetingWorker) -and (-not $apiDigest -or -not $migrateDigest)) {
    throw "Image pair '$tag' not found in ACR. Use -BuildImages -Apply first."
}
$apiImage = if ($apiDigest) { "$loginServer/bridata-api@$apiDigest" } else { '' }
$migrateImage = if ($migrateDigest) { "$loginServer/bridata-migrate@$migrateDigest" } else { '' }

$temp = Join-Path ([IO.Path]::GetTempPath()) "bridata-$([guid]::NewGuid().ToString('N'))"
New-Item -ItemType Directory -Path $temp | Out-Null
try {
    if ($DeployCoreRuntime) {
        if (-not $automationMi -or -not $notificationMi) { throw 'Automation/notification identities are required for core worker deployment.' }
        $tags = @{ product='Bridata Project'; technicalPlatform='Nexus Core'; environment=$Environment; managedBy='PowerShell+Bicep' }

        Step 'Service Bus topic and worker subscriptions'
        $async = Join-Path $temp 'async.json'
        ArmParams $async @{
            location=$location; environment=$Environment; tags=$tags
            runtimeIdentityPrincipalId=$apiMi.principalId
            automationIdentityPrincipalId=$automationMi.principalId
            notificationIdentityPrincipalId=$notificationMi.principalId
            topicName='bridata-domain-events'; automationSubscriptionName='automation-v1'; notificationSubscriptionName='notifications-v1'
            deployAutomationConsumer=$true; deployNotificationConsumer=$true
        }
        WhatIf "bridata-$Environment-async-preflight" 'infra/azure/async-messaging.bicep' $async
        Deploy "bridata-$Environment-async" 'infra/azure/async-messaging.bicep' $async
        if (-not $Apply) {
            Write-Warning 'Core runtime dry-run stops after the Service Bus what-if because its namespace may not exist yet. Apply that phase first, then re-run for runtime what-if.'
        } else {
            $sb = Required 'Service Bus namespace' (AzTsv @('deployment','group','show','-g',$ResourceGroup,'-n',"bridata-$Environment-async",'--query','properties.outputs.namespaceName.value','-o','tsv'))
            $runtime = Join-Path $temp 'runtime.json'
            ArmParams $runtime @{
                location=$location; environment=$Environment; tags=$tags; managedEnvironmentId=$caeId; registryServer=$loginServer
                apiIdentityResourceId=$apiMi.id; apiIdentityClientId=$apiMi.clientId
                automationIdentityResourceId=$automationMi.id; automationIdentityClientId=$automationMi.clientId
                notificationIdentityResourceId=$notificationMi.id; notificationIdentityClientId=$notificationMi.clientId
                apiImage=$apiImage; migrationImage=$migrateImage
                runtimeDatabaseSecretUri="https://$vaultName.vault.azure.net/secrets/runtime-database-url"
                adminDatabaseSecretUri="https://$vaultName.vault.azure.net/secrets/admin-database-url"
                entraApiClientId=$EntraApiClientId; entraTenantId=$tenantId; corsOrigins=$CorsOrigins
                serviceBusNamespaceFqdn="$sb.servicebus.windows.net"; serviceBusTopicName='bridata-domain-events'
                serviceBusAutomationSubscriptionName='automation-v1'; serviceBusNotificationSubscriptionName='notifications-v1'
                m365GraphDeliveryEnabled=$false; m365AvailabilityEnabled=$false
            }

            Step 'Migration job'
            WhatIf "bridata-$Environment-migrate-preflight" 'infra/azure/api-runtime.bicep' $runtime @('deployApi=false','deployMigrationJob=true','deployOutboxWorker=false','deployAutomationWorker=false','deployNotificationWorker=false')
            Deploy "bridata-$Environment-migrate" 'infra/azure/api-runtime.bicep' $runtime @('deployApi=false','deployMigrationJob=true','deployOutboxWorker=false','deployAutomationWorker=false','deployNotificationWorker=false')
            WaitMigration "nexus-$Environment-migrate"

            Step 'API + outbox + automation + notification workers'
            WhatIf "bridata-$Environment-runtime-preflight" 'infra/azure/api-runtime.bicep' $runtime @('deployApi=true','deployMigrationJob=false','deployOutboxWorker=true','deployAutomationWorker=true','deployNotificationWorker=true')
            Deploy "bridata-$Environment-runtime" 'infra/azure/api-runtime.bicep' $runtime @('deployApi=true','deployMigrationJob=false','deployOutboxWorker=true','deployAutomationWorker=true','deployNotificationWorker=true')
            $fqdn = Required 'API FQDN' (AzTsv @('containerapp','show','-g',$ResourceGroup,'-n',"nexus-$Environment-api",'--query','properties.configuration.ingress.fqdn','-o','tsv'))
            VerifyApi $fqdn
        }
    }

    if ($DeployMeetingWorker) {
        if (-not $Apply) {
            Write-Host '[DRY-RUN] Meeting worker requires an existing Service Bus namespace and image pair; no resources changed.' -ForegroundColor Yellow
        } else {
            Step 'Meeting Calendar worker'
            $sb = Required 'Service Bus namespace' (AzTsv @('servicebus','namespace','list','-g',$ResourceGroup,'--query','[0].name','-o','tsv'))
            $meeting = Join-Path $temp 'meeting.json'
            ArmParams $meeting @{
                deployMeetingCalendarWorker=$true; location=$location; environment=$Environment
                tags=@{ product='Bridata Project'; technicalPlatform='Nexus Core'; environment=$Environment; managedBy='PowerShell+Bicep' }
                managedEnvironmentId=$caeId; registryResourceId=$acrId; registryServer=$loginServer; keyVaultResourceId=$vaultId
                apiImage=$apiImage; runtimeDatabaseSecretUri="https://$vaultName.vault.azure.net/secrets/runtime-database-url"
                entraApiClientId=$EntraApiClientId; entraTenantId=$tenantId; serviceBusNamespaceName=$sb
                serviceBusTopicName='bridata-domain-events'; meetingSubscriptionName='meetings-v1'
                m365CalendarSyncEnabled=$false
            }
            WhatIf "bridata-$Environment-meetings-preflight" 'infra/azure/meeting-calendar-runtime.bicep' $meeting
            Deploy "bridata-$Environment-meetings" 'infra/azure/meeting-calendar-runtime.bicep' $meeting
        }
    }

    if ($GrantGraphAvailability -or $GrantGraphCalendar -or $EnableM365Availability -or $EnableM365CalendarSync) {
        if (-not $MailboxScopeConfigured) {
            throw 'Graph calendar application access is blocked until -MailboxScopeConfigured is explicitly supplied after Exchange mailbox scoping is actually configured.'
        }
    }

    if ($GrantGraphAvailability) {
        Step 'Graph free/busy permission'
        $args = @('-ResourceGroup',$ResourceGroup,'-IdentityName',"nexus-$Environment-api-mi")
        if ($Apply) { $args += '-Apply' }
        & ./infra/azure/grant-meeting-availability-graph.ps1 @args
        if ($LASTEXITCODE -ne 0) { throw 'Graph availability permission step failed.' }
    }

    if ($GrantGraphCalendar) {
        Step 'Graph Calendars.ReadWrite permission'
        $meetingPrincipal = Required 'meeting MI principal' (AzTsv @('identity','show','-g',$ResourceGroup,'-n',"nexus-$Environment-meetings-mi",'--query','principalId','-o','tsv'))
        $args = @('-MeetingManagedIdentityPrincipalId',$meetingPrincipal)
        if ($Apply) { $args += '-Apply' }
        & ./infra/azure/grant-meeting-calendar-graph.ps1 @args
        if ($LASTEXITCODE -ne 0) { throw 'Graph calendar permission step failed.' }
    }

    if ($EnableM365Availability) {
        Step 'Enable M365 availability flag'
        if ($Apply) {
            & az containerapp update -g $ResourceGroup -n "nexus-$Environment-api" --set-env-vars 'M365_AVAILABILITY_ENABLED=true' -o none
            if ($LASTEXITCODE -ne 0) { throw 'Could not enable M365_AVAILABILITY_ENABLED.' }
        } else { Write-Host '[DRY-RUN] Would enable M365_AVAILABILITY_ENABLED=true.' }
    }

    if ($EnableM365CalendarSync) {
        Step 'Enable M365 calendar capability'
        $args = @('-ResourceGroup',$ResourceGroup,'-Environment',$Environment,'-Mode','Enable')
        if ($Apply) { $args += '-Apply' }
        & ./infra/azure/set-meeting-calendar-capability.ps1 @args
        if ($LASTEXITCODE -ne 0) { throw 'Meeting calendar capability step failed.' }
    }
} finally {
    Remove-Item $temp -Recurse -Force -ErrorAction SilentlyContinue
}

Step 'Boundary'
Write-Host 'Backend path covered: PostgreSQL/Key Vault -> migrations -> API -> Service Bus -> outbox/automation/notification -> meeting worker.'
Write-Host 'Graph free/busy and calendar writes remain explicit admin-controlled steps.'
Write-Warning 'Web deployment is intentionally blocked for now: ApiBootstrap calls the Entra-protected API before a browser access-token provider is configured. Finish Entra SPA/PKCE first; then publish the SPA and set API CORS to its exact Azure origin.'
Write-Host "Source commit/image tag: $commit / $tag"
