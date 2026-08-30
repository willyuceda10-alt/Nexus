targetScope = 'resourceGroup'

@description('Stable technical prefix used in Azure resource names.')
param namePrefix string = 'nexus'

@allowed([
  'dev'
  'staging'
  'prod'
])
param environment string = 'dev'

@description('Azure Static Web Apps control-plane location. Keep separate from the main workload region when needed.')
param location string = 'eastus2'

@allowed([
  'Free'
  'Standard'
])
@description('Free is sufficient for the Bridata DEV visual environment.')
param skuName string = 'Free'

param tags object = {
  product: 'Bridata Project'
  technicalPlatform: 'Nexus Core'
  environment: environment
  workload: 'web'
  managedBy: 'Bicep'
}

var baseName = '${namePrefix}-${environment}'

resource staticWebApp 'Microsoft.Web/staticSites@2023-12-01' = {
  name: '${baseName}-web'
  location: location
  tags: tags
  sku: {
    name: skuName
    tier: skuName
  }
  properties: {}
}

output staticWebAppName string = staticWebApp.name
output defaultHostname string = staticWebApp.properties.defaultHostname
output webUrl string = 'https://${staticWebApp.properties.defaultHostname}'
