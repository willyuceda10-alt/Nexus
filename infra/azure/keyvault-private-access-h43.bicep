targetScope = 'resourceGroup'

@description('Stable technical prefix used by Bridata Project Azure resources.')
param namePrefix string = 'nexus'

@allowed([
  'dev'
  'staging'
  'prod'
])
param environment string = 'dev'

param location string = resourceGroup().location

@description('Opt-in safety switch. When false this file creates no resources and therefore cannot introduce Private Link charges accidentally.')
param deployKeyVaultPrivateEndpoint bool = false

@description('Dedicated subnet prefix for Private Endpoints. It must not overlap the Container Apps or PostgreSQL delegated subnets.')
param privateEndpointSubnetPrefix string = '10.40.3.0/24'

var suffix = uniqueString(resourceGroup().id)
var baseName = '${namePrefix}-${environment}'
var keyVaultName = '${baseName}-${suffix}'
var keyVaultPrivateDnsZoneName = 'privatelink.vaultcore.azure.net'

resource virtualNetwork 'Microsoft.Network/virtualNetworks@2024-05-01' existing = {
  name: '${baseName}-vnet'
}

resource keyVault 'Microsoft.KeyVault/vaults@2023-07-01' existing = {
  name: keyVaultName
}

resource privateEndpointsSubnet 'Microsoft.Network/virtualNetworks/subnets@2024-05-01' = if (deployKeyVaultPrivateEndpoint) {
  parent: virtualNetwork
  name: 'private-endpoints'
  properties: {
    addressPrefix: privateEndpointSubnetPrefix
    privateEndpointNetworkPolicies: 'Disabled'
  }
}

resource keyVaultPrivateDnsZone 'Microsoft.Network/privateDnsZones@2020-06-01' = if (deployKeyVaultPrivateEndpoint) {
  name: keyVaultPrivateDnsZoneName
  location: 'global'
  tags: {
    product: 'Bridata Project'
    technicalPlatform: 'Nexus Core'
    environment: environment
    managedBy: 'Bicep'
  }
}

resource keyVaultPrivateDnsLink 'Microsoft.Network/privateDnsZones/virtualNetworkLinks@2020-06-01' = if (deployKeyVaultPrivateEndpoint) {
  parent: keyVaultPrivateDnsZone
  name: '${baseName}-keyvault-vnet-link'
  location: 'global'
  properties: {
    registrationEnabled: false
    virtualNetwork: {
      id: virtualNetwork.id
    }
  }
}

resource keyVaultPrivateEndpoint 'Microsoft.Network/privateEndpoints@2024-05-01' = if (deployKeyVaultPrivateEndpoint) {
  name: '${baseName}-keyvault-pe'
  location: location
  tags: {
    product: 'Bridata Project'
    technicalPlatform: 'Nexus Core'
    environment: environment
    managedBy: 'Bicep'
  }
  properties: {
    subnet: {
      id: privateEndpointsSubnet.id
    }
    privateLinkServiceConnections: [
      {
        name: '${baseName}-keyvault-pls'
        properties: {
          privateLinkServiceId: keyVault.id
          groupIds: [
            'vault'
          ]
          requestMessage: 'Bridata Project H4.3 private access to Key Vault.'
        }
      }
    ]
  }
  dependsOn: [
    keyVaultPrivateDnsLink
  ]
}

resource keyVaultPrivateDnsZoneGroup 'Microsoft.Network/privateEndpoints/privateDnsZoneGroups@2024-05-01' = if (deployKeyVaultPrivateEndpoint) {
  parent: keyVaultPrivateEndpoint
  name: 'default'
  properties: {
    privateDnsZoneConfigs: [
      {
        name: 'keyvault'
        properties: {
          privateDnsZoneId: keyVaultPrivateDnsZone.id
        }
      }
    ]
  }
}

output deploymentEnabled bool = deployKeyVaultPrivateEndpoint
output privateEndpointSubnetName string = deployKeyVaultPrivateEndpoint ? privateEndpointsSubnet.name : 'not-deployed'
output privateDnsZoneName string = deployKeyVaultPrivateEndpoint ? keyVaultPrivateDnsZone.name : 'not-deployed'
output privateEndpointName string = deployKeyVaultPrivateEndpoint ? keyVaultPrivateEndpoint.name : 'not-deployed'
output keyVaultPublicNetworkCutoverRequired bool = deployKeyVaultPrivateEndpoint
