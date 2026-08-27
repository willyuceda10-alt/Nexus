param(
    [string]$ResourceGroup = 'rg-nexus-dev',
    [string]$Environment = 'dev',
    [string]$ApiContainerAppName = '',
    [string]$MeetingWorkerName = '',
    [ValidateSet('Enable', 'Disable')]
    [string]$Mode = 'Enable',
    [switch]$Apply
)

$ErrorActionPreference = 'Stop'

if (-not $ApiContainerAppName) { $ApiContainerAppName = "nexus-$Environment-api" }
if (-not $MeetingWorkerName) { $MeetingWorkerName = "nexus-$Environment-meetings" }

Write-Host 'Bridata Meeting Calendar capability switch'
Write-Host "Resource group: $ResourceGroup"
Write-Host "API:            $ApiContainerAppName"
Write-Host "Meeting worker: $MeetingWorkerName"
Write-Host "Mode:           $Mode"
Write-Host ''

$api = az containerapp show `
    --resource-group $ResourceGroup `
    --name $ApiContainerAppName `
    --query '{name:name,provisioningState:properties.provisioningState}' `
    -o json | ConvertFrom-Json

if (-not $api.name) { throw 'Bridata API Container App was not found.' }

if ($Mode -eq 'Enable') {
    $worker = az containerapp show `
        --resource-group $ResourceGroup `
        --name $MeetingWorkerName `
        --query '{name:name,provisioningState:properties.provisioningState,runningStatus:properties.runningStatus}' `
        -o json | ConvertFrom-Json

    if (-not $worker.name) { throw 'Meeting Calendar worker was not found. Do not advertise M365 calendar capability before the worker exists.' }
    if ($worker.provisioningState -ne 'Succeeded') {
        throw "Meeting Calendar worker provisioning state is '$($worker.provisioningState)', not Succeeded."
    }
}

$available = if ($Mode -eq 'Enable') { 'true' } else { 'false' }
$syncEnabled = $available

Write-Host "MEETING_CALENDAR_WORKER_AVAILABLE=$available"
Write-Host "M365_CALENDAR_SYNC_ENABLED=$syncEnabled"

if (-not $Apply) {
    Write-Host ''
    Write-Host '[DRY RUN] No Container App revision was created.'
    Write-Host 'Re-run with -Apply only after Graph Calendars.ReadWrite and mailbox scoping have been validated.'
    exit 0
}

az containerapp update `
    --resource-group $ResourceGroup `
    --name $ApiContainerAppName `
    --set-env-vars `
        "MEETING_CALENDAR_WORKER_AVAILABLE=$available" `
        "M365_CALENDAR_SYNC_ENABLED=$syncEnabled" `
    -o none

Write-Host 'Bridata API capability flags updated.'
if ($Mode -eq 'Enable') {
    Write-Warning 'Verify /api/v1/meetings-v1/capabilities and perform one controlled test meeting before broader use.'
}
