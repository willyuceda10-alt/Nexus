targetScope = 'resourceGroup'

param location string
param environment string
param tags object
param managedEnvironmentId string
param registryServer string
param apiIdentityResourceId string
param apiIdentityClientId string

@description('Identity for the migration job, which alone needs the admin database credential. Defaults to the API identity for backward compatibility; pass a dedicated identity (see grant-dev-rbac.ps1) so the API container cannot read admin-database-url.')
param migrateIdentityResourceId string = ''
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

@description('Public URL of the web app, used in invitation emails to tell the recipient where to sign in.')
param webAppBaseUrl string = ''
param documentStorageAccountName string = toLower('nexus${environment}${uniqueString(resourceGroup().id)}')
param documentContainerName string = 'bridata-documents'
param integrationContainerName string = 'bridata-imports'
param deployApi bool = true
param deployMigrationJob bool = true
param deployOutboxWorker bool = false
param deployAutomationWorker bool = false
param deployNotificationWorker bool = false

@description('Creates the scheduled Bridata Project Risk Monitor V1G9 job.')
param deployProjectRiskMonitorJob bool = false

@description('UTC cron expression used by Project Risk Monitor V1G9.')
param projectRiskMonitorCron string = '*/15 * * * *'

@minValue(15)
@maxValue(1440)
@description('Maximum accepted age in minutes of the last Project Risk Monitor completion.')
param projectRiskMonitorStaleMinutes int = 45

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
            { name: 'WEB_APP_BASE_URL', value: webAppBaseUrl }
            { name: 'AUTH_MODE', value: 'entra' }
            { name: 'ENTRA_API_CLIENT_ID', value: entraApiClientId }
            { name: 'ENTRA_TENANT_ID', value: entraTenantId }
            { name: 'ENTRA_REQUIRED_SCOPE', value: 'access_as_user' }
            { name: 'API_RATE_LIMIT_ENABLED', value: 'true' }
            { name: 'API_RATE_LIMIT_MAX_REQUESTS', value: environment == 'prod' ? '300' : '600' }
            { name: 'API_RATE_LIMIT_WINDOW_SECONDS', value: '60' }
            { name: 'API_RATE_LIMIT_MAX_KEYS', value: '20000' }
            { name: 'API_TRUST_PROXY_HOPS', value: '1' }
            { name: 'PROJECT_RISK_MONITOR_EXPECTED', value: deployProjectRiskMonitorJob ? 'true' : 'false' }
            { name: 'PROJECT_RISK_MONITOR_STALE_MINUTES', value: string(projectRiskMonitorStaleMinutes) }
            { name: 'NOTIFICATION_WORKER_AVAILABLE', value: deployNotificationWorker ? 'true' : 'false' }
            { name: 'M365_GRAPH_DELIVERY_ENABLED', value: m365GraphDeliveryEnabled ? 'true' : 'false' }
            { name: 'M365_AVAILABILITY_ENABLED', value: m365AvailabilityEnabled ? 'true' : 'false' }
            { name: 'M365_OUTLOOK_SENDER_USER', value: m365OutlookSenderUser }
            { name: 'M365_TEAMS_ACTIVITY_TYPE', value: m365TeamsActivityType }
            { name: 'M365_TEAMS_TOPIC_WEB_URL', value: m365TeamsTopicWebUrl }
            { name: 'M365_TEAMS_TOPIC_VALUE', value: m365TeamsTopicValue }
            { name: 'AZURE_CLIENT_ID', value: apiIdentityClientId }
            { name: 'DOCUMENT_STORAGE_MODE', value: 'azure' }
            { name: 'AZURE_STORAGE_ACCOUNT_NAME', value: documentStorageAccountName }
            { name: 'AZURE_DOCUMENT_CONTAINER', value: documentContainerName }
            { name: 'DOCUMENT_MAX_FILE_BYTES', value: '26214400' }
            { name: 'INTEGRATION_STORAGE_MODE', value: 'azure' }
            { name: 'AZURE_INTEGRATION_CONTAINER', value: integrationContainerName }
            { name: 'INTEGRATION_MAX_FILE_BYTES', value: '52428800' }
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
            // Ternary, not string(): Bicep renders a bool as 'True'/'False', which fails
            // the API's z.enum(['true','false']) parse and crashes the worker at startup.
            { name: 'M365_GRAPH_DELIVERY_ENABLED', value: m365GraphDeliveryEnabled ? 'true' : 'false' }
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


resource projectRiskMonitorJob 'Microsoft.App/jobs@2024-03-01' = if (deployProjectRiskMonitorJob) {
  name: '${baseName}-risk-monitor'
  location: location
  tags: tags

  identity: {
    type: 'UserAssigned'
    userAssignedIdentities: {
      '${automationIdentityResourceId}': {}
    }
  }

  properties: {
    environmentId: managedEnvironmentId

    configuration: {
      triggerType: 'Schedule'
      replicaTimeout: 900
      replicaRetryLimit: 1

      scheduleTriggerConfig: {
        cronExpression: projectRiskMonitorCron
        parallelism: 1
        replicaCompletionCount: 1
      }

      registries: [
        {
          server: registryServer
          identity: automationIdentityResourceId
        }
      ]

      secrets: [
        {
          name: 'runtime-database-url'
          keyVaultUrl: runtimeDatabaseSecretUri
          identity: automationIdentityResourceId
        }
      ]
    }

    template: {
      containers: [
        {
          name: 'risk-monitor'
          image: apiImage

          command: [
            'node'
          ]

          args: [
            'apps/api/dist/project-risk-monitor-job-v1g9.js'
          ]

          env: [
            {
              name: 'NODE_ENV'
              value: 'production'
            }
            {
              name: 'LOG_LEVEL'
              value: environment == 'prod' ? 'info' : 'debug'
            }
            {
              name: 'DATABASE_URL'
              secretRef: 'runtime-database-url'
            }
            {
              name: 'AZURE_CLIENT_ID'
              value: automationIdentityClientId
            }
          ]

          resources: {
            cpu: json('0.25')
            memory: '0.5Gi'
          }
        }
      ]
    }
  }
}

var migrationIdentity = empty(migrateIdentityResourceId) ? apiIdentityResourceId : migrateIdentityResourceId

resource migrations 'Microsoft.App/jobs@2024-03-01' = if (deployMigrationJob) {
  name: '${baseName}-migrate'
  location: location
  tags: tags
  identity: {
    type: 'UserAssigned'
    userAssignedIdentities: { '${migrationIdentity}': {} }
  }
  properties: {
    environmentId: managedEnvironmentId
    configuration: {
      triggerType: 'Manual'
      // A failed migration cannot succeed on retry — prisma migrate deploy refuses to
      // proceed past a migration recorded as failed — so a retry only doubles the wait
      // before the pipeline reports the failure that a human must resolve.
      replicaTimeout: 1800
      replicaRetryLimit: 0
      manualTriggerConfig: { parallelism: 1, replicaCompletionCount: 1 }
      registries: [{ server: registryServer, identity: migrationIdentity }]
      secrets: [
        { name: 'admin-database-url', keyVaultUrl: adminDatabaseSecretUri, identity: migrationIdentity }
        { name: 'runtime-database-url', keyVaultUrl: runtimeDatabaseSecretUri, identity: migrationIdentity }
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
output projectRiskMonitorJobName string = deployProjectRiskMonitorJob ? projectRiskMonitorJob.name : ''
output migrationJobName string = deployMigrationJob ? migrations.name : ''
