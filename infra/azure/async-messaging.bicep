targetScope = 'resourceGroup'

param location string
param environment string
param tags object
param runtimeIdentityPrincipalId string
param topicName string = 'bridata-domain-events'

var baseName = 'nexus-${environment}'
var suffix = uniqueString(resourceGroup().id)
var namespaceName = take(toLower('${baseName}-${suffix}-sb'), 50)
var serviceBusDataSenderRoleId = subscriptionResourceId(
  'Microsoft.Authorization/roleDefinitions',
  '69a216fc-b8fb-44d8-bc22-1f3c2cd27a39'
)

resource serviceBus 'Microsoft.ServiceBus/namespaces@2024-01-01' = {
  name: namespaceName
  location: location
  tags: tags
  sku: {
    name: 'Standard'
    tier: 'Standard'
  }
  properties: {
    disableLocalAuth: true
    minimumTlsVersion: '1.2'
    publicNetworkAccess: 'Enabled'
  }
}

resource domainEventsTopic 'Microsoft.ServiceBus/namespaces/topics@2024-01-01' = {
  parent: serviceBus
  name: topicName
  properties: {
    defaultMessageTimeToLive: 'P14D'
    duplicateDetectionHistoryTimeWindow: 'PT1H'
    enableBatchedOperations: true
    enableExpress: false
    enablePartitioning: false
    maxSizeInMegabytes: 1024
    requiresDuplicateDetection: true
    supportOrdering: true
  }
}

resource platformCoreSubscription 'Microsoft.ServiceBus/namespaces/topics/subscriptions@2024-01-01' = {
  parent: domainEventsTopic
  name: 'platform-core-v1'
  properties: {
    deadLetteringOnMessageExpiration: true
    defaultMessageTimeToLive: 'P14D'
    enableBatchedOperations: true
    lockDuration: 'PT1M'
    maxDeliveryCount: 10
    requiresSession: false
  }
}

resource runtimeSenderRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  scope: serviceBus
  name: guid(serviceBus.id, runtimeIdentityPrincipalId, serviceBusDataSenderRoleId)
  properties: {
    principalId: runtimeIdentityPrincipalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: serviceBusDataSenderRoleId
  }
}

output namespaceName string = serviceBus.name
output namespaceFqdn string = '${serviceBus.name}.servicebus.windows.net'
output topicName string = domainEventsTopic.name
output coreSubscriptionName string = platformCoreSubscription.name
