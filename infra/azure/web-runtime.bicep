targetScope = 'resourceGroup'

param location string
param environment string
param tags object
param managedEnvironmentId string
param registryServer string
param webIdentityResourceId string
param webImage string

@description('Runtime configuration injected by docker-entrypoint-web.sh at container start.')
param apiBaseUrl string
param entraWebClientId string
param entraTenantId string
param entraApiScope string

var baseName = 'nexus-${environment}'

resource web 'Microsoft.App/containerApps@2024-03-01' = {
  name: '${baseName}-web'
  location: location
  tags: tags
  identity: {
    type: 'UserAssigned'
    userAssignedIdentities: {
      '${webIdentityResourceId}': {}
    }
  }
  properties: {
    managedEnvironmentId: managedEnvironmentId
    configuration: {
      activeRevisionsMode: 'Single'
      ingress: {
        external: true
        targetPort: 80
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
          identity: webIdentityResourceId
        }
      ]
    }
    template: {
      containers: [
        {
          name: 'web'
          image: webImage
          env: [
            { name: 'BRIDATA_DATA_MODE', value: 'api' }
            { name: 'BRIDATA_AUTH_MODE', value: 'entra' }
            { name: 'BRIDATA_API_BASE_URL', value: apiBaseUrl }
            { name: 'BRIDATA_ENTRA_WEB_CLIENT_ID', value: entraWebClientId }
            { name: 'BRIDATA_ENTRA_TENANT_ID', value: entraTenantId }
            { name: 'BRIDATA_ENTRA_API_SCOPE', value: entraApiScope }
          ]
          probes: [
            {
              type: 'Liveness'
              httpGet: { path: '/health', port: 80, scheme: 'HTTP' }
              initialDelaySeconds: 5
              periodSeconds: 30
              timeoutSeconds: 3
              failureThreshold: 3
              successThreshold: 1
            }
            {
              type: 'Readiness'
              httpGet: { path: '/health', port: 80, scheme: 'HTTP' }
              initialDelaySeconds: 3
              periodSeconds: 10
              timeoutSeconds: 3
              failureThreshold: 4
              successThreshold: 1
            }
          ]
          resources: { cpu: json('0.25'), memory: '0.5Gi' }
        }
      ]
      scale: {
        minReplicas: environment == 'prod' ? 1 : 0
        maxReplicas: environment == 'prod' ? 4 : 2
        rules: [
          {
            name: 'http'
            http: { metadata: { concurrentRequests: '100' } }
          }
        ]
      }
    }
  }
}

output webName string = web.name
output webFqdn string = web.properties.configuration.ingress.fqdn
