targetScope = 'resourceGroup'

param location string
param environment string
param tags object
param managedEnvironmentId string
param registryServer string
param apiIdentityResourceId string
param apiIdentityClientId string
param automationIdentityResourceId string
param automationIdentityClientId string
param notificationIdentityResourceId string
param notificationIdentityClientId string
param apiImage string
param migrationImage string
param runtimeDatabaseSecretUri string
param adminDatabaseSecretUri string
param entraApiClientId string
param entraTenantId string
param corsOrigins string
param documentStorageAccountName string = toLower('nexus${environment}${uniqueString(resourceGroup().id)}')
param documentContainerName string = 'bridata-documents'
param deployApi bool = true
param deployMigrationJob bool = true
param deployOutboxWorker bool = false
param deployAutomationWorker bool = false
param deployNotificationWorker bool = false
param serviceBusNamespaceFqdn string = ''
param serviceBusTopicName string = 'bridata-domain-events'
param serviceBusAutomationSubscriptionName string = 'automation-v1'
param serviceBusNotificationSubscriptionName string = 'notifications-v1'
param m365GraphDeliveryEnabled bool = false
param m365AvailabilityEnabled bool = false
param m365OutlookSenderUser string = ''
param m365TeamsActivityType string = ''
param m365TeamsTopicWebUrl string = ''
param m365TeamsTopicValue string = 'Bridata'

var baseName = 'nexus-${environment}'

resource api 'Microsoft.App/containerApps@2024-03-01' = if (deployApi) {
  name: '${baseName}-api'
  location: location
  tags: tags
  identity: {
    type: 'UserAssigned'
    userAssignedIdentities: {
      '${apiIdentityResourceId}': {}
    }
  }
  properties: {
    managedEnvironmentId: managedEnvironmentId
    configuration: {
      activeRevisionsMode: 'Single'
      ingress: {
        external: true
        targetPort: 8080
        transport: 'auto'
        allowInsecure: false
        traffic: [
          {
            latestRevision: true
            weight: 100
          }
        ]
      }
      registries: [
        {
          server: registryServer
          identity: apiIdentityResourceId
        }
      ]
      secrets: [
        {
          name: 'runtime-database-url'
          keyVaultUrl: runtimeDatabaseSecretUri
          identity: apiIdentityResourceId
        }
      ]
    }
    template: {
      containers: [
        {
          name: 'api'
          image: apiImage
          env: [
            { name: 'NODE_ENV', value: 'production' }
            { name: 'HOST', value: '0.0.0.0' }
            { name: 'PORT', value: '8080' }
            { name: 'LOG_LEVEL', value: environment == 'prod' ? 'info' : 'debug' }
            { name: 'DATABASE_URL', secretRef: 'runtime-database-url' }
            { name: 'CORS_ORIGINS', value: corsOrigins }
            { name: 'AUTH_MODE', value: 'entra' }
            { name: 'ENTRA_API_CLIENT_ID', value: entraApiClientId }
            { name: 'ENTRA_TENANT_ID', value: entraTenantId }
            { name: 'ENTRA_REQUIRED_SCOPE', value: 'access_as_user' }
            { name: 'NOTIFICATION_WORKER_AVAILABLE', value: string(deployNotificationWorker) }
            { name: 'M365_GRAPH_DELIVERY_ENABLED', value: string(m365GraphDeliveryEnabled) }
            { name: 'M365_AVAILABILITY_ENABLED', value: string(m365AvailabilityEnabled) }
            { name: 'M365_OUTLOOK_SENDER_USER', value: m365OutlookSenderUser }
            { name: 'M365_TEAMS_ACTIVITY_TYPE', value: m365TeamsActivityType }
            { name: 'M365_TEAMS_TOPIC_WEB_URL', value: m365TeamsTopicWebUrl }
            { name: 'M365_TEAMS_TOPIC_VALUE', value: m365TeamsTopicValue }
            { name: 'AZURE_CLIENT_ID', value: apiIdentityClientId }
            { name: 'DOCUMENT_STORAGE_MODE', value: 'azure' }
            { name: 'AZURE_STORAGE_ACCOUNT_NAME', value: documentStorageAccountName }
            { name: 'AZURE_DOCUMENT_CONTAINER', value: documentContainerName }
            { name: 'DOCUMENT_MAX_FILE_BYTES', value: '26214400' }
          ]
          probes: [
            {
              type: 'Liveness'
              httpGet: { path: '/health/live', port: 8080, scheme: 'HTTP' }
              initialDelaySeconds: 10
              periodSeconds: 30
              timeoutSeconds: 5
              failureThreshold: 3
              successThreshold: 1
            }
            {
              type: 'Readiness'
              httpGet: { path: '/health/ready', port: 8080, scheme: 'HTTP' }
              initialDelaySeconds: 5
              periodSeconds: 10
              timeoutSeconds: 5
              failureThreshold: 6
              successThreshold: 1
            }
          ]
          resources: { cpu: json('0.25'), memory: '0.5Gi' }
        }
      ]
      scale: {
        minReplicas: environment == 'prod' ? 1 : 0
        maxReplicas: environment == 'prod' ? 10 : 2
        rules: [
          {
            name: 'http'
            http: { metadata: { concurrentRequests: '50' } }
          }
        ]
      }
    }
  }
}

resource outboxWorker 'Microsoft.App/containerApps@2024-03-01' = if (deployOutboxWorker) {
  name: '${baseName}-outbox'
  location: location
  tags: tags
  identity: {
    type: 'UserAssigned'
    userAssignedIdentities: { '${apiIdentityResourceId}': {} }
  }
  properties: {
    managedEnvironmentId: managedEnvironmentId
    configuration: {
      activeRevisionsMode: 'Single'
      registries: [{ server: registryServer, identity: apiIdentityResourceId }]
      secrets: [{ name: 'runtime-database-url', keyVaultUrl: runtimeDatabaseSecretUri, identity: apiIdentityResourceId }]
    }
    template: {
      containers: [
        {
          name: 'outbox'
          image: apiImage
          command: ['node']
          args: ['apps/api/dist/outbox-worker.js']
          env: [
            { name: 'NODE_ENV', value: 'production' }
            { name: 'LOG_LEVEL', value: environment == 'prod' ? 'info' : 'debug' }
            { name: 'DATABASE_URL', secretRef: 'runtime-database-url' }
            { name: 'AUTH_MODE', value: 'entra' }
            { name: 'ENTRA_API_CLIENT_ID', value: entraApiClientId }
            { name: 'ENTRA_TENANT_ID', value: entraTenantId }
            { name: 'OUTBOX_WORKER_ENABLED', value: 'true' }
            { name: 'SERVICE_BUS_NAMESPACE', value: serviceBusNamespaceFqdn }
            { name: 'SERVICE_BUS_TOPIC', value: serviceBusTopicName }
            { name: 'AZURE_CLIENT_ID', value: apiIdentityClientId }
          ]
          resources: { cpu: json('0.25'), memory: '0.5Gi' }
        }
      ]
      scale: { minReplicas: 1, maxReplicas: 1 }
    }
  }
}

resource automationWorker 'Microsoft.App/containerApps@2024-03-01' = if (deployAutomationWorker) {
  name: '${baseName}-automation'
  location: location
  tags: tags
  identity: {
    type: 'UserAssigned'
    userAssignedIdentities: { '${automationIdentityResourceId}': {} }
  }
  properties: {
    managedEnvironmentId: managedEnvironmentId
    configuration: {
      activeRevisionsMode: 'Single'
      registries: [{ server: registryServer, identity: automationIdentityResourceId }]
      secrets: [{ name: 'runtime-database-url', keyVaultUrl: runtimeDatabaseSecretUri, identity: automationIdentityResourceId }]
    }
    template: {
      containers: [
        {
          name: 'automation'
          image: apiImage
          command: ['node']
          args: ['apps/api/dist/automation-worker.js']
          env: [
            { name: 'NODE_ENV', value: 'production' }
            { name: 'LOG_LEVEL', value: environment == 'prod' ? 'info' : 'debug' }
            { name: 'DATABASE_URL', secretRef: 'runtime-database-url' }
            { name: 'AUTH_MODE', value: 'entra' }
            { name: 'ENTRA_API_CLIENT_ID', value: entraApiClientId }
            { name: 'ENTRA_TENANT_ID', value: entraTenantId }
            { name: 'AUTOMATION_WORKER_ENABLED', value: 'true' }
            { name: 'SERVICE_BUS_NAMESPACE', value: serviceBusNamespaceFqdn }
            { name: 'SERVICE_BUS_TOPIC', value: serviceBusTopicName }
            { name: 'SERVICE_BUS_AUTOMATION_SUBSCRIPTION', value: serviceBusAutomationSubscriptionName }
            { name: 'AZURE_CLIENT_ID', value: automationIdentityClientId }
          ]
          resources: { cpu: json('0.25'), memory: '0.5Gi' }
        }
      ]
      scale: { minReplicas: 1, maxReplicas: environment == 'prod' ? 3 : 1 }
    }
  }
}

resource notificationWorker 'Microsoft.App/containerApps@2024-03-01' = if (deployNotificationWorker) {
  name: '${baseName}-notifications'
  location: location
  tags: tags
  identity: {
    type: 'UserAssigned'
    userAssignedIdentities: { '${notificationIdentityResourceId}': {} }
  }
  properties: {
    managedEnvironmentId: managedEnvironmentId
    configuration: {
      activeRevisionsMode: 'Single'
      registries: [{ server: registryServer, identity: notificationIdentityResourceId }]
      secrets: [{ name: 'runtime-database-url', keyVaultUrl: runtimeDatabaseSecretUri, identity: notificationIdentityResourceId }]
    }
    template: {
      containers: [
        {
          name: 'notifications'
          image: apiImage
          command: ['node']
          args: ['apps/api/dist/notification-worker.js']
          env: [
            { name: 'NODE_ENV', value: 'production' }
            { name: 'LOG_LEVEL', value: environment == 'prod' ? 'info' : 'debug' }
            { name: 'DATABASE_URL', secretRef: 'runtime-database-url' }
            { name: 'AUTH_MODE', value: 'entra' }
            { name: 'ENTRA_API_CLIENT_ID', value: entraApiClientId }
            { name: 'ENTRA_TENANT_ID', value: entraTenantId }
            { name: 'NOTIFICATION_WORKER_ENABLED', value: 'true' }
            { name: 'NOTIFICATION_WORKER_AVAILABLE', value: 'true' }
            { name: 'SERVICE_BUS_NAMESPACE', value: serviceBusNamespaceFqdn }
            { name: 'SERVICE_BUS_TOPIC', value: serviceBusTopicName }
            { name: 'SERVICE_BUS_NOTIFICATION_SUBSCRIPTION', value: serviceBusNotificationSubscriptionName }
            { name: 'M365_GRAPH_DELIVERY_ENABLED', value: string(m365GraphDeliveryEnabled) }
            { name: 'M365_OUTLOOK_SENDER_USER', value: m365OutlookSenderUser }
            { name: 'M365_TEAMS_ACTIVITY_TYPE', value: m365TeamsActivityType }
            { name: 'M365_TEAMS_TOPIC_WEB_URL', value: m365TeamsTopicWebUrl }
            { name: 'M365_TEAMS_TOPIC_VALUE', value: m365TeamsTopicValue }
            { name: 'AZURE_CLIENT_ID', value: notificationIdentityClientId }
          ]
          resources: { cpu: json('0.25'), memory: '0.5Gi' }
        }
      ]
      scale: { minReplicas: 1, maxReplicas: environment == 'prod' ? 3 : 1 }
    }
  }
}

resource migrations 'Microsoft.App/jobs@2024-03-01' = if (deployMigrationJob) {
  name: '${baseName}-migrate'
  location: location
  tags: tags
  identity: {
    type: 'UserAssigned'
    userAssignedIdentities: { '${apiIdentityResourceId}': {} }
  }
  properties: {
    environmentId: managedEnvironmentId
    configuration: {
      triggerType: 'Manual'
      replicaTimeout: 900
      replicaRetryLimit: 1
      manualTriggerConfig: { parallelism: 1, replicaCompletionCount: 1 }
      registries: [{ server: registryServer, identity: apiIdentityResourceId }]
      secrets: [
        { name: 'admin-database-url', keyVaultUrl: adminDatabaseSecretUri, identity: apiIdentityResourceId }
        { name: 'runtime-database-url', keyVaultUrl: runtimeDatabaseSecretUri, identity: apiIdentityResourceId }
      ]
    }
    template: {
      containers: [
        {
          name: 'migrate'
          image: migrationImage
          env: [
            { name: 'DATABASE_URL', secretRef: 'admin-database-url' }
            { name: 'ADMIN_DATABASE_URL', secretRef: 'admin-database-url' }
            { name: 'RUNTIME_DATABASE_URL', secretRef: 'runtime-database-url' }
          ]
          resources: { cpu: json('0.25'), memory: '0.5Gi' }
        }
      ]
    }
  }
}

output apiName string = deployApi ? api.name : ''
output apiFqdn string = deployApi ? api!.properties.configuration.ingress.fqdn : ''
output outboxWorkerName string = deployOutboxWorker ? outboxWorker.name : ''
output automationWorkerName string = deployAutomationWorker ? automationWorker.name : ''
output notificationWorkerName string = deployNotificationWorker ? notificationWorker.name : ''
output migrationJobName string = deployMigrationJob ? migrations.name : ''
