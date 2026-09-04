param(
    [string]$ResourceGroup = 'rg-nexus-dev',
    [string]$RegistryName = '',
    [string]$ImageTag = '',
    [string]$Platform = 'linux/amd64',
    [switch]$NoCache,
    [switch]$IncludeWeb,
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

function AzTsv([string[]]$AzArgs) {
    $value = & az @AzArgs 2>$null
    if ($LASTEXITCODE -ne 0) { return '' }
    return (($value | Out-String).Trim())
}

Need 'az'
Need 'git'
Need 'docker'

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
Push-Location $repoRoot
try {
    Step 'Local source'
    $branch = (& git branch --show-current).Trim()
    $commit = (& git rev-parse HEAD).Trim()
    if (-not $commit) { throw 'Could not resolve Git commit.' }

    $dirty = (& git status --porcelain | Out-String).Trim()
    if ($dirty) {
        & git status --short
        throw 'Git working tree must be clean before immutable image builds.'
    }

    $tag = if ($ImageTag) { $ImageTag.Trim() } else { $commit }
    Write-Host "Branch   : $branch"
    Write-Host "Commit   : $commit"
    Write-Host "Image tag: $tag"
    Write-Host "Platform : $Platform"
    Write-Host "Mode     : $(if ($Apply) { 'APPLY' } else { 'DRY-RUN' })"

    Step 'Azure Container Registry'
    $accountId = AzTsv @('account','show','--query','id','-o','tsv')
    if (-not $accountId) { throw 'Azure CLI is not authenticated. Run az login first.' }

    $acrName = if ($RegistryName) {
        $RegistryName.Trim()
    } else {
        AzTsv @('acr','list','-g',$ResourceGroup,'--query','[0].name','-o','tsv')
    }
    if (-not $acrName) { throw "No ACR found in resource group '$ResourceGroup'." }

    $loginServer = AzTsv @('acr','show','-g',$ResourceGroup,'-n',$acrName,'--query','loginServer','-o','tsv')
    if (-not $loginServer) { throw "Could not resolve login server for ACR '$acrName'." }

    $apiTag = "$loginServer/bridata-api:$tag"
    $migrateTag = "$loginServer/bridata-migrate:$tag"
    $webTag = "$loginServer/bridata-web:$tag"

    Write-Host "Registry : $acrName"
    Write-Host "Server   : $loginServer"
    Write-Host "API      : $apiTag"
    Write-Host "Migration: $migrateTag"
    if ($IncludeWeb) { Write-Host "Web      : $webTag" }

    if (-not $Apply) {
        Write-Host ''
        $targets = if ($IncludeWeb) { 'Dockerfile.api (runtime + migrate) and Dockerfile.web' } else { 'both Dockerfile.api targets' }
        Write-Host "[DRY-RUN] Would authenticate Docker to ACR, build $targets, and push all immutable tags." -ForegroundColor Yellow
        Write-Host 'Re-run with -Apply to perform the build and push.'
        return
    }

    Step 'Docker engine'
    & docker info *> $null
    if ($LASTEXITCODE -ne 0) {
        throw 'Docker daemon is not available. Run this script from a machine with Docker Desktop/Engine running; Azure Cloud Shell does not provide a Docker daemon.'
    }
    Write-Host '[OK] Docker daemon available' -ForegroundColor Green

    Step 'ACR login'
    & az acr login -n $acrName -o none
    if ($LASTEXITCODE -ne 0) { throw 'ACR login failed.' }
    Write-Host '[OK] Docker authenticated to ACR' -ForegroundColor Green

    $commonBuildArgs = @('build','--platform',$Platform,'--file','Dockerfile.api')
    if ($NoCache) { $commonBuildArgs += '--no-cache' }

    Step 'Build runtime image'
    $runtimeArgs = $commonBuildArgs + @('--target','runtime','--tag',$apiTag,'.')
    & docker @runtimeArgs
    if ($LASTEXITCODE -ne 0) { throw 'Local runtime Docker build failed.' }

    Step 'Build migration image'
    $migrationArgs = $commonBuildArgs + @('--target','migrate','--tag',$migrateTag,'.')
    & docker @migrationArgs
    if ($LASTEXITCODE -ne 0) { throw 'Local migration Docker build failed.' }

    Step 'Push runtime image'
    & docker push $apiTag
    if ($LASTEXITCODE -ne 0) { throw 'Runtime image push failed.' }

    Step 'Push migration image'
    & docker push $migrateTag
    if ($LASTEXITCODE -ne 0) { throw 'Migration image push failed.' }

    if ($IncludeWeb) {
        Step 'Build web image'
        $webBuildArgs = @('build','--platform',$Platform,'--file','Dockerfile.web','--tag',$webTag,'.')
        if ($NoCache) { $webBuildArgs += '--no-cache' }
        & docker @webBuildArgs
        if ($LASTEXITCODE -ne 0) { throw 'Local web Docker build failed.' }

        Step 'Push web image'
        & docker push $webTag
        if ($LASTEXITCODE -ne 0) { throw 'Web image push failed.' }
    }

    Step 'Verify immutable images in ACR'
    $apiDigest = AzTsv @('acr','repository','show','-n',$acrName,'--image',"bridata-api:$tag",'--query','digest','-o','tsv')
    $migrateDigest = AzTsv @('acr','repository','show','-n',$acrName,'--image',"bridata-migrate:$tag",'--query','digest','-o','tsv')

    if (-not $apiDigest -or -not $migrateDigest) {
        throw 'Push completed but one or both API/migration image digests could not be resolved from ACR.'
    }

    $webDigest = if ($IncludeWeb) {
        AzTsv @('acr','repository','show','-n',$acrName,'--image',"bridata-web:$tag",'--query','digest','-o','tsv')
    } else { '' }

    if ($IncludeWeb -and -not $webDigest) {
        throw 'Web push completed but digest could not be resolved from ACR.'
    }

    Write-Host '[OK] Images are available in ACR.' -ForegroundColor Green
    Write-Host ''
    Write-Host "Image tag       : $tag"
    Write-Host "Runtime digest  : $apiDigest"
    Write-Host "Migration digest: $migrateDigest"
    if ($IncludeWeb) { Write-Host "Web digest      : $webDigest" }
    Write-Host ''
    Write-Host 'Immutable references:'
    Write-Host "$loginServer/bridata-api@$apiDigest"
    Write-Host "$loginServer/bridata-migrate@$migrateDigest"
    if ($IncludeWeb) { Write-Host "$loginServer/bridata-web@$webDigest" }
    Write-Host ''
    Write-Host 'You can now run connect-pending-dev.ps1 with -DeployCoreRuntime and the same -ImageTag.' -ForegroundColor Green
    if ($IncludeWeb) {
        Write-Host 'Web image is ready. Use the Azure DEV Runtime Deploy workflow with entra_web_client_id to deploy it.' -ForegroundColor Green
    }
}
finally {
    Pop-Location
}
