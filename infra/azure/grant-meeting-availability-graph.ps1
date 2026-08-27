param(
    [Parameter(Mandatory = $true)]
    [string]$ResourceGroup,

    [Parameter(Mandatory = $true)]
    [string]$IdentityName,

    [string]$PermissionValue = 'Calendars.ReadBasic.All',

    [switch]$Apply
)

$ErrorActionPreference = 'Stop'

$graphAppId = '00000003-0000-0000-c000-000000000000'

Write-Host '============================================================'
Write-Host ' Bridata Meeting Availability - Microsoft Graph permission'
Write-Host '============================================================'
Write-Host "Resource group : $ResourceGroup"
Write-Host "Managed identity: $IdentityName"
Write-Host "Permission      : $PermissionValue"
Write-Host "Mode            : $(if ($Apply) { 'APPLY' } else { 'DRY-RUN' })"
Write-Host ''

$identity = az identity show `
    --resource-group $ResourceGroup `
    --name $IdentityName `
    --query '{principalId:principalId,clientId:clientId}' `
    -o json | ConvertFrom-Json

if (-not $identity.principalId) {
    throw "Managed identity '$IdentityName' was not found or has no principalId."
}

$graphSp = az ad sp show --id $graphAppId -o json | ConvertFrom-Json
if (-not $graphSp.id) {
    throw 'Microsoft Graph service principal could not be resolved in this tenant.'
}

$appRole = $graphSp.appRoles |
    Where-Object {
        $_.value -eq $PermissionValue -and
        $_.isEnabled -eq $true -and
        $_.allowedMemberTypes -contains 'Application'
    } |
    Select-Object -First 1

if (-not $appRole) {
    throw "Microsoft Graph application role '$PermissionValue' was not found. Do not substitute a broader role automatically. Check the tenant permission catalog and validate getSchedule requirements first."
}

$assignmentsUri = "https://graph.microsoft.com/v1.0/servicePrincipals/$($identity.principalId)/appRoleAssignments"
$existing = az rest --method GET --uri $assignmentsUri -o json | ConvertFrom-Json
$alreadyAssigned = $existing.value | Where-Object {
    $_.resourceId -eq $graphSp.id -and $_.appRoleId -eq $appRole.id
} | Select-Object -First 1

if ($alreadyAssigned) {
    Write-Host "[OK] $PermissionValue is already assigned to $IdentityName."
    exit 0
}

$body = @{
    principalId = $identity.principalId
    resourceId  = $graphSp.id
    appRoleId   = $appRole.id
} | ConvertTo-Json -Compress

Write-Host "Principal object : $($identity.principalId)"
Write-Host "Graph SP object  : $($graphSp.id)"
Write-Host "App role id      : $($appRole.id)"
Write-Host ''
Write-Warning 'getSchedule permission naming is currently inconsistent across Microsoft Graph documentation. Validate the narrowest working application role in DEV before enabling M365_AVAILABILITY_ENABLED.'
Write-Warning 'Application calendar permissions can cover many mailboxes. Restrict the managed identity to approved mailboxes with Exchange Online Application RBAC / an equivalent supported access policy.'

if (-not $Apply) {
    Write-Host '[DRY-RUN] No Microsoft Graph permission was changed.'
    Write-Host 'Re-run with -Apply only after tenant validation and mailbox scoping are approved.'
    exit 0
}

az rest `
    --method POST `
    --uri $assignmentsUri `
    --headers 'Content-Type=application/json' `
    --body $body `
    -o none

Write-Host "[DONE] Assigned $PermissionValue to $IdentityName."
Write-Host 'Keep M365_AVAILABILITY_ENABLED=false until an actual getSchedule smoke test succeeds.'
