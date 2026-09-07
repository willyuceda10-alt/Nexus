targetScope = 'resourceGroup'

@description('Deploys the isolated Bridata Meeting Calendar worker. Keep false in normal validation runs.')
param deployMeetingCalendarWorker bool = false
param location string
param environment string
param tags object
param managedEnvironmentId string
param registryResourceId string
param registryServer string
param keyVaultResourceId string
param apiImage string
param runtimeDatabaseSecretUri string
param entraApiClientId string
param entraTenantId string
param serviceBusNamespaceName string
param serviceBusTopicName string = 'bridata-domain-events'
param meetingSubscriptionName string = 'meetings-v1'
param m365CalendarSyncEnabled bool = false

var baseName = 'nexus-${environment}'
var acrPullRoleId = subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '7f951dda-4ed3-4680-a7ca-43fe172d538d')
var keyVaultSecretsUserRoleId = subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '4633458b-17de-408a-b874-0445c86b69e6')
var serviceBusDataReceiverRoleId = subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '4f6d3b9b-027b-4f4c-9142-0e5a2a2247e0')

resource registry 'Microsoft.ContainerRegistry/registries@2023-07-01' existing = {
  scope: resourceGroup()
  name: last(split(registryResourceId, '/'))
}

resource keyVault 'Microsoft.KeyVault/vaults@2023-07-01' existing = {
  scope: resourceGroup()
  name: last(split(keyVaultResourceId, '/'))
}

resource serviceBus 'Microsoft.ServiceBus/namespaces@2024-01-01' existing = {
  name: serviceBusNamespaceName
}

resource domainEventsTopic 'Microsoft.ServiceBus/namespaces/topics@2024-01-01' existing = {
  parent: serviceBus
  name: serviceBusTopicName
}

resource meetingIdentity 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' = if (deployMeetingCalendarWorker) {
  name: '${baseName}-meetings-mi'
  location: location
  tags: tags
}

resource meetingSubscription 'Microsoft.ServiceBus/namespaces/topics/subscriptions@2024-01-01' = if (deployMeetingCalendarWorker) {
  parent: domainEventsTopic
  name: meetingSubscriptionName
  properties: {
    deadLetteringOnMessageExpiration: true
    defaultMessageTimeToLive: 'P14D'
    enableBatchedOperations: true
    lockDuration: 'PT1M'
    maxDeliveryCount: 10
    requiresSession: false
  }
}

resource meetingReceiverRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = if (deployMeetingCalendarWorker) {
  scope: meetingSubscription
  name: guid(meetingSubscription.id, meetingIdentity.id, serviceBusDataReceiverRoleId)
  properties: {
    principalId: meetingIdentity!.properties.principalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: serviceBusDataReceiverRoleId
  }
}

resource meetingAcrPullRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = if (deployMeetingCalendarWorker) {
  scope: registry
  name: guid(registry.id, meetingIdentity.id, acrPullRoleId)
  properties: {
    principalId: meetingIdentity!.properties.principalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: acrPullRoleId
  }
}

resource meetingKeyVaultRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = if (deployMeetingCalendarWorker) {
  scope: keyVault
  name: guid(keyVault.id, meetingIdentity.id, keyVaultSecretsUserRoleId)
  properties: {
    principalId: meetingIdentity!.properties.principalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: keyVaultSecretsUserRoleId
  }
}

resource meetingWorker 'Microsoft.App/containerApps@2024-03-01' = if (deployMeetingCalendarWorker) {
  name: '${baseName}-meetings'
  location: location
  tags: tags
  identity: {
    type: 'UserAssigned'
    userAssignedIdentities: {
      '${meetingIdentity.id}': {}
    }
  }
  properties: {
    managedEnvironmentId: managedEnvironmentId
    configuration: {
      activeRevisionsMode: 'Single'
      registries: [
        {
          server: registryServer
          identity: meetingIdentity.id
        }
      ]
      secrets: [
        {
          name: 'runtime-database-url'
          keyVaultUrl: runtimeDatabaseSecretUri
          identity: meetingIdentity.id
        }
      ]
    }
    template: {
      containers: [
        {
          name: 'meetings'
          image: apiImage
          command: ['node']
          args: ['apps/api/dist/meeting-calendar-worker.js']
          env: [
            { name: 'NODE_ENV', value: 'production' }
            { name: 'LOG_LEVEL', value: environment == 'prod' ? 'info' : 'debug' }
            { name: 'DATABASE_URL', secretRef: 'runtime-database-url' }
            { name: 'AUTH_MODE', value: 'entra' }
            { name: 'ENTRA_API_CLIENT_ID', value: entraApiClientId }
            { name: 'ENTRA_TENANT_ID', value: entraTenantId }
            { name: 'MEETING_CALENDAR_WORKER_ENABLED', value: 'true' }
            { name: 'MEETING_CALENDAR_WORKER_AVAILABLE', value: 'true' }
            { name: 'SERVICE_BUS_NAMESPACE', value: '${serviceBus.name}.servicebus.windows.net' }
            { name: 'SERVICE_BUS_TOPIC', value: serviceBusTopicName }
            { name: 'SERVICE_BUS_MEETING_SUBSCRIPTION', value: meetingSubscriptionName }
            // Ternary, not string(): Bicep renders a bool as 'True'/'False', which fails
            // the API's z.enum(['true','false']) parse and crashes the worker at startup.
            { name: 'M365_CALENDAR_SYNC_ENABLED', value: m365CalendarSyncEnabled ? 'true' : 'false' }
            { name: 'AZURE_CLIENT_ID', value: meetingIdentity!.properties.clientId }
          ]
          resources: {
            cpu: json('0.25')
            memory: '0.5Gi'
          }
        }
      ]
      scale: {
        minReplicas: 1
        maxReplicas: environment == 'prod' ? 3 : 1
      }
    }
  }
  dependsOn: [
    meetingReceiverRole
    meetingAcrPullRole
    meetingKeyVaultRole
  ]
}

output meetingCalendarWorkerDeployed bool = deployMeetingCalendarWorker
output meetingManagedIdentityName string = deployMeetingCalendarWorker ? meetingIdentity.name : ''
output meetingManagedIdentityPrincipalId string = deployMeetingCalendarWorker ? meetingIdentity!.properties.principalId : ''
output meetingManagedIdentityClientId string = deployMeetingCalendarWorker ? meetingIdentity!.properties.clientId : ''
output meetingSubscription string = deployMeetingCalendarWorker ? meetingSubscription.name : ''
output meetingWorkerName string = deployMeetingCalendarWorker ? meetingWorker.name : ''
