param(
    [Parameter(Mandatory = $true)]
    [string]$MeetingManagedIdentityPrincipalId,

    [switch]$Apply
)

$ErrorActionPreference = 'Stop'

# Microsoft Graph service principal / application.
$graphAppId = '00000003-0000-0000-c000-000000000000'
# Microsoft Graph application permission: Calendars.ReadWrite.
$calendarReadWriteAppRoleId = 'ef54d2bf-783f-4e0f-bca1-3210c0444d99'

Write-Host 'Bridata Meeting Calendar - Microsoft Graph permission bootstrap'
Write-Host "Meeting Managed Identity principal: $MeetingManagedIdentityPrincipalId"
Write-Host 'Permission: Calendars.ReadWrite (application)'
Write-Host ''
Write-Warning 'Calendars.ReadWrite application permission is tenant-wide unless Exchange Online Application RBAC / an access policy restricts mailbox scope.'
Write-Warning 'Run this only with an Entra administrator account authorized to assign Microsoft Graph app roles.'

$graphSpResult = az rest `
    --method GET `
    --url "https://graph.microsoft.com/v1.0/servicePrincipals?`$filter=appId%20eq%20'$graphAppId'&`$select=id,appId,displayName" `
    -o json | ConvertFrom-Json

$graphSp = @($graphSpResult.value) | Select-Object -First 1
if (-not $graphSp -or -not $graphSp.id) {
    throw 'Microsoft Graph service principal was not found in this Entra tenant.'
}

$principal = az rest `
    --method GET `
    --url "https://graph.microsoft.com/v1.0/servicePrincipals/$MeetingManagedIdentityPrincipalId?`$select=id,displayName,servicePrincipalType" `
    -o json | ConvertFrom-Json

if (-not $principal.id) {
    throw 'Meeting Managed Identity service principal was not found.'
}

Write-Host "Target identity: $($principal.displayName)"
Write-Host "Microsoft Graph SP: $($graphSp.id)"

$assignments = az rest `
    --method GET `
    --url "https://graph.microsoft.com/v1.0/servicePrincipals/$MeetingManagedIdentityPrincipalId/appRoleAssignments?`$select=id,resourceId,appRoleId" `
    -o json | ConvertFrom-Json

$existing = @($assignments.value) | Where-Object {
    $_.resourceId -eq $graphSp.id -and $_.appRoleId -eq $calendarReadWriteAppRoleId
} | Select-Object -First 1

if ($existing) {
    Write-Host 'Calendars.ReadWrite is already assigned. No change required.'
    exit 0
}

if (-not $Apply) {
    Write-Host ''
    Write-Host '[DRY RUN] No directory change was made.'
    Write-Host 'Re-run with -Apply after the mailbox scope/security design has been approved.'
    exit 0
}

$payload = @{
    principalId = $MeetingManagedIdentityPrincipalId
    resourceId  = $graphSp.id
    appRoleId   = $calendarReadWriteAppRoleId
} | ConvertTo-Json -Compress

az rest `
    --method POST `
    --url "https://graph.microsoft.com/v1.0/servicePrincipals/$($graphSp.id)/appRoleAssignedTo" `
    --headers 'Content-Type=application/json' `
    --body $payload `
    -o none

Write-Host 'Calendars.ReadWrite assigned successfully.'
Write-Host ''
Write-Warning 'Next: restrict the identity to the approved organizer mailboxes using Exchange Online Application RBAC (preferred) or an Application Access Policy before enabling M365_CALENDAR_SYNC_ENABLED.'
