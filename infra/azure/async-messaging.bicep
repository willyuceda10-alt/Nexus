targetScope = 'resourceGroup'

param location string
param environment string
param tags object
param runtimeIdentityPrincipalId string
param automationIdentityPrincipalId string
param topicName string = 'bridata-domain-events'
param automationSubscriptionName string = 'automation-v1'
param deployAutomationConsumer bool = false

var baseName = 'nexus-${environment}'
var suffix = uniqueString(resourceGroup().id)
var namespaceName = take(toLower('${baseName}-${suffix}-sb'), 50)
var serviceBusDataSenderRoleId = subscriptionResourceId(
  'Microsoft.Authorization/roleDefinitions',
  '69a216fc-b8fb-44d8-bc22-1f3c2cd27a39'
)
var serviceBusDataReceiverRoleId = subscriptionResourceId(
  'Microsoft.Authorization/roleDefinitions',
  '4f6d3b9b-027b-4f4c-9142-0e5a2a2247e0'
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

resource automationSubscription 'Microsoft.ServiceBus/namespaces/topics/subscriptions@2024-01-01' = if (deployAutomationConsumer) {
  parent: domainEventsTopic
  name: automationSubscriptionName
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
  scope: domainEventsTopic
  name: guid(domainEventsTopic.id, runtimeIdentityPrincipalId, serviceBusDataSenderRoleId)
  properties: {
    principalId: runtimeIdentityPrincipalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: serviceBusDataSenderRoleId
  }
}

resource automationReceiverRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = if (deployAutomationConsumer) {
  scope: automationSubscription
  name: guid(automationSubscription.id, automationIdentityPrincipalId, serviceBusDataReceiverRoleId)
  properties: {
    principalId: automationIdentityPrincipalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: serviceBusDataReceiverRoleId
  }
}

output namespaceName string = serviceBus.name
output namespaceFqdn string = '${serviceBus.name}.servicebus.windows.net'
output topicName string = domainEventsTopic.name
output coreSubscriptionName string = platformCoreSubscription.name
output automationSubscriptionName string = automationSubscription.?name ?? ''
