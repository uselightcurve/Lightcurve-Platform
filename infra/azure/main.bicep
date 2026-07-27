targetScope = 'resourceGroup'

@description('Short application name used as a resource prefix.')
@minLength(3)
param appName string = 'lightcurve'

@description('Azure region for all resources.')
param location string = resourceGroup().location

@description('Azure Container Registry name. Create this first if you want to build images before the full deployment.')
param containerRegistryName string = take(replace('${appName}${uniqueString(resourceGroup().id, appName)}', '-', ''), 50)

@description('Container image for the public Next.js app.')
param webImage string

@description('Container image for the MOS service.')
param mosImage string

@description('Container image for the embedding service.')
param embeddingImage string

@description('Container image for the private conversation evaluation service.')
param modelOrbitImage string

@description('Container image for the private open-source voice cloning service.')
param voiceCloneImage string

@description('Versioned private reasoning image with Qwen weights included.')
param qwenImage string

@description('Versioned Speaches image with the approved STT and TTS models included.')
param speechImage string

@description('Public app URL. Use your custom domain when available; otherwise redeploy with the emitted webUrl after first deployment.')
param nextPublicAppUrl string = ''

@secure()
param postgresAdminPassword string

@secure()
param clerkSecretKey string

param clerkPublishableKey string = ''

@secure()
param lightcurveCredentialSecret string

@secure()
param speechServiceToken string = ''

@secure()
param mosServiceToken string

@secure()
param embeddingServiceToken string

@secure()
param modelOrbitServiceToken string

@secure()
param voiceCloneServiceToken string

@secure()
param scoringIngestToken string

@secure()
param adminCreditsToken string

@secure()
param livekitApiKey string = ''

@secure()
param livekitApiSecret string = ''

@secure()
param livekitUrl string = ''

@secure()
param dodoPaymentsApiKey string = ''

@secure()
param dodoWebhookKey string = ''

param dodoEnvironment string = 'test_mode'
param dodoProProductId string = ''
param dodoReturnUrl string = ''
param dodoWebhookUrl string = ''

param lightcurveStunUrl string = 'stun:stun.uselightcurve.com:3478'
param lightcurveTurnUrl string = ''
param lightcurveTurnUsername string = ''

@secure()
param lightcurveTurnCredential string = ''

var suffix = uniqueString(resourceGroup().id, appName)
var acrName = containerRegistryName
var storageName = take(replace('${appName}${suffix}st', '-', ''), 24)
var postgresName = '${appName}-pg-${suffix}'
var databaseName = 'lightcurve'
var storageContainerName = 'lightcurve-audio'
var postgresUser = 'lightcurve'

resource logWorkspace 'Microsoft.OperationalInsights/workspaces@2023-09-01' = {
  name: '${appName}-logs-${suffix}'
  location: location
  properties: {
    sku: {
      name: 'PerGB2018'
    }
    retentionInDays: 30
  }
}

resource acr 'Microsoft.ContainerRegistry/registries@2023-07-01' = {
  name: acrName
  location: location
  sku: {
    name: 'Basic'
  }
  properties: {
    adminUserEnabled: true
  }
}

resource storage 'Microsoft.Storage/storageAccounts@2023-05-01' = {
  #disable-next-line BCP334
  name: storageName
  location: location
  sku: {
    name: 'Standard_LRS'
  }
  kind: 'StorageV2'
  properties: {
    allowBlobPublicAccess: false
    minimumTlsVersion: 'TLS1_2'
    supportsHttpsTrafficOnly: true
  }
}

resource blobService 'Microsoft.Storage/storageAccounts/blobServices@2023-05-01' = {
  name: 'default'
  parent: storage
}

resource audioContainer 'Microsoft.Storage/storageAccounts/blobServices/containers@2023-05-01' = {
  name: storageContainerName
  parent: blobService
  properties: {
    publicAccess: 'None'
  }
}

resource postgres 'Microsoft.DBforPostgreSQL/flexibleServers@2023-06-01-preview' = {
  name: postgresName
  location: location
  sku: {
    name: 'Standard_B1ms'
    tier: 'Burstable'
  }
  properties: {
    administratorLogin: postgresUser
    administratorLoginPassword: postgresAdminPassword
    version: '16'
    storage: {
      storageSizeGB: 32
    }
    backup: {
      backupRetentionDays: 7
      geoRedundantBackup: 'Disabled'
    }
    highAvailability: {
      mode: 'Disabled'
    }
  }
}

resource database 'Microsoft.DBforPostgreSQL/flexibleServers/databases@2023-06-01-preview' = {
  name: databaseName
  parent: postgres
  properties: {
    charset: 'UTF8'
    collation: 'en_US.utf8'
  }
}

resource allowAzureServices 'Microsoft.DBforPostgreSQL/flexibleServers/firewallRules@2023-06-01-preview' = {
  name: 'allow-azure-services'
  parent: postgres
  properties: {
    startIpAddress: '0.0.0.0'
    endIpAddress: '0.0.0.0'
  }
}

resource env 'Microsoft.App/managedEnvironments@2024-03-01' = {
  name: '${appName}-env-${suffix}'
  location: location
  properties: {
    appLogsConfiguration: {
      destination: 'log-analytics'
      logAnalyticsConfiguration: {
        customerId: logWorkspace.properties.customerId
        sharedKey: logWorkspace.listKeys().primarySharedKey
      }
    }
  }
}

resource qwen 'Microsoft.App/containerApps@2024-03-01' = {
  name: 'qwen'
  location: location
  properties: {
    managedEnvironmentId: env.id
    configuration: {
      activeRevisionsMode: 'Single'
      ingress: {
        external: false
        targetPort: 8000
        transport: 'auto'
      }
      registries: [
        {
          server: acr.properties.loginServer
          username: acr.name
          passwordSecretRef: 'acr-password'
        }
      ]
      secrets: [
        {
          name: 'acr-password'
          value: acr.listCredentials().passwords[0].value
        }
      ]
    }
    template: {
      containers: [
        {
          name: 'qwen'
          image: qwenImage
          args: [
            '-m'
            '/models/qwen3-4b-q4_k_m.gguf'
            '--alias'
            'lightcurve-reasoner'
            '--host'
            '0.0.0.0'
            '--port'
            '8000'
            '--ctx-size'
            '8192'
            '--threads'
            '4'
            '--jinja'
          ]
          resources: {
            cpu: json('4.0')
            memory: '8Gi'
          }
        }
      ]
      scale: {
        minReplicas: 1
        maxReplicas: 1
      }
    }
  }
}

var acrPassword = acr.listCredentials().passwords[0].value
var storageKey = storage.listKeys().keys[0].value
var storageConnectionString = 'DefaultEndpointsProtocol=https;AccountName=${storage.name};AccountKey=${storageKey};EndpointSuffix=${environment().suffixes.storage}'
var databaseUrl = 'postgresql://${postgresUser}:${postgresAdminPassword}@${postgres.name}.postgres.database.azure.com:5432/${databaseName}?sslmode=require'

resource speech 'Microsoft.App/containerApps@2024-03-01' = {
  name: 'speech'
  location: location
  properties: {
    managedEnvironmentId: env.id
    configuration: {
      activeRevisionsMode: 'Single'
      ingress: {
        external: false
        targetPort: 8000
        transport: 'auto'
      }
      registries: [
        {
          server: acr.properties.loginServer
          username: acr.name
          passwordSecretRef: 'acr-password'
        }
      ]
      secrets: [
        {
          name: 'acr-password'
          value: acrPassword
        }
        {
          name: 'speech-service-token'
          value: speechServiceToken
        }
      ]
    }
    template: {
      containers: [
        {
          name: 'speech'
          image: speechImage
          resources: {
            cpu: json('4.0')
            memory: '8Gi'
          }
          env: [
            {
              name: 'STT_MODEL'
              value: 'distil-large-v3'
            }
            {
              name: 'STT_QUALITY_MODEL'
              value: 'large-v3-turbo'
            }
            {
              name: 'TTS_MODEL'
              value: 'kokoro'
            }
            {
              name: 'TTS_FALLBACK_MODEL'
              value: 'piper'
            }
            {
              name: 'TTS_VOICE'
              value: 'af_heart'
            }
          ]
        }
      ]
      scale: {
        minReplicas: 1
        maxReplicas: 1
      }
    }
  }
}

resource mos 'Microsoft.App/containerApps@2024-03-01' = {
  name: 'mos'
  location: location
  properties: {
    managedEnvironmentId: env.id
    configuration: {
      activeRevisionsMode: 'Single'
      ingress: {
        external: false
        targetPort: 8080
        transport: 'auto'
      }
      registries: [
        {
          server: acr.properties.loginServer
          username: acr.name
          passwordSecretRef: 'acr-password'
        }
      ]
      secrets: [
        {
          name: 'acr-password'
          value: acrPassword
        }
        {
          name: 'mos-service-token'
          value: mosServiceToken
        }
        {
          name: 'azure-storage-connection-string'
          value: storageConnectionString
        }
      ]
    }
    template: {
      containers: [
        {
          name: 'mos'
          image: mosImage
          resources: {
            cpu: json('0.5')
            memory: '1Gi'
          }
          env: [
            {
              name: 'MOS_SERVICE_TOKEN'
              secretRef: 'mos-service-token'
            }
            {
              name: 'AZURE_STORAGE_CONNECTION_STRING'
              secretRef: 'azure-storage-connection-string'
            }
          ]
        }
      ]
      scale: {
        minReplicas: 0
        maxReplicas: 1
      }
    }
  }
}

resource embedding 'Microsoft.App/containerApps@2024-03-01' = {
  name: 'embedding'
  location: location
  properties: {
    managedEnvironmentId: env.id
    configuration: {
      activeRevisionsMode: 'Single'
      ingress: {
        external: false
        targetPort: 8080
        transport: 'auto'
      }
      registries: [
        {
          server: acr.properties.loginServer
          username: acr.name
          passwordSecretRef: 'acr-password'
        }
      ]
      secrets: [
        {
          name: 'acr-password'
          value: acrPassword
        }
        {
          name: 'embedding-service-token'
          value: embeddingServiceToken
        }
      ]
    }
    template: {
      containers: [
        {
          name: 'embedding'
          image: embeddingImage
          resources: {
            cpu: json('1.0')
            memory: '2Gi'
          }
          env: [
            {
              name: 'EMBEDDING_MODEL'
              value: 'sentence-transformers/all-MiniLM-L6-v2'
            }
            {
              name: 'EMBEDDING_SERVICE_TOKEN'
              secretRef: 'embedding-service-token'
            }
          ]
        }
      ]
      scale: {
        minReplicas: 1
        maxReplicas: 1
      }
    }
  }
}

resource modelOrbit 'Microsoft.App/containerApps@2024-03-01' = {
  name: 'evaluate'
  location: location
  properties: {
    managedEnvironmentId: env.id
    configuration: {
      activeRevisionsMode: 'Single'
      ingress: {
        external: false
        targetPort: 8080
        transport: 'auto'
      }
      registries: [
        {
          server: acr.properties.loginServer
          username: acr.name
          passwordSecretRef: 'acr-password'
        }
      ]
      secrets: [
        {
          name: 'acr-password'
          value: acrPassword
        }
        {
          name: 'modelorbit-service-token'
          value: modelOrbitServiceToken
        }
      ]
    }
    template: {
      containers: [
        {
          name: 'evaluate'
          image: modelOrbitImage
          resources: {
            cpu: json('0.5')
            memory: '1Gi'
          }
          env: [
            {
              name: 'MODELORBIT_SERVICE_TOKEN'
              secretRef: 'modelorbit-service-token'
            }
          ]
          probes: [
            {
              type: 'Liveness'
              httpGet: {
                path: '/health'
                port: 8080
                scheme: 'HTTP'
              }
              initialDelaySeconds: 5
              periodSeconds: 30
            }
          ]
        }
      ]
      scale: {
        minReplicas: 1
        maxReplicas: 1
      }
    }
  }
}

resource voiceClone 'Microsoft.App/containerApps@2024-03-01' = {
  name: 'voice-clone'
  location: location
  properties: {
    managedEnvironmentId: env.id
    configuration: {
      activeRevisionsMode: 'Single'
      ingress: {
        external: false
        targetPort: 8080
        transport: 'auto'
      }
      registries: [
        {
          server: acr.properties.loginServer
          username: acr.name
          passwordSecretRef: 'acr-password'
        }
      ]
      secrets: [
        {
          name: 'acr-password'
          value: acrPassword
        }
        {
          name: 'voice-clone-service-token'
          value: voiceCloneServiceToken
        }
      ]
    }
    template: {
      containers: [
        {
          name: 'voice-clone'
          image: voiceCloneImage
          resources: {
            cpu: json('4.0')
            memory: '8Gi'
          }
          env: [
            {
              name: 'VOICE_CLONE_SERVICE_TOKEN'
              secretRef: 'voice-clone-service-token'
            }
            {
              name: 'VOICE_CLONE_DEVICE'
              value: 'cpu'
            }
          ]
          probes: [
            {
              type: 'Liveness'
              httpGet: {
                path: '/health'
                port: 8080
                scheme: 'HTTP'
              }
              initialDelaySeconds: 15
              periodSeconds: 30
            }
          ]
        }
      ]
      scale: {
        minReplicas: 0
        maxReplicas: 1
      }
    }
  }
}

resource web 'Microsoft.App/containerApps@2024-03-01' = {
  name: 'web'
  location: location
  properties: {
    managedEnvironmentId: env.id
    configuration: {
      activeRevisionsMode: 'Single'
      ingress: {
        external: true
        targetPort: 8080
        transport: 'auto'
      }
      registries: [
        {
          server: acr.properties.loginServer
          username: acr.name
          passwordSecretRef: 'acr-password'
        }
      ]
      secrets: [
        {
          name: 'acr-password'
          value: acrPassword
        }
        {
          name: 'database-url'
          #disable-next-line use-secure-value-for-secure-inputs
          value: databaseUrl
        }
        {
          name: 'clerk-secret-key'
          value: clerkSecretKey
        }
        {
          name: 'lightcurve-credential-secret'
          value: lightcurveCredentialSecret
        }
        {
          name: 'speech-service-token'
          value: speechServiceToken
        }
        {
          name: 'mos-service-token'
          value: mosServiceToken
        }
        {
          name: 'embedding-service-token'
          value: embeddingServiceToken
        }
        {
          name: 'modelorbit-service-token'
          value: modelOrbitServiceToken
        }
        {
          name: 'voice-clone-service-token'
          value: voiceCloneServiceToken
        }
        {
          name: 'scoring-ingest-token'
          value: scoringIngestToken
        }
        {
          name: 'admin-credits-token'
          value: adminCreditsToken
        }
        ...(!empty(livekitUrl) ? [{ name: 'livekit-url', value: livekitUrl }] : [])
        ...(!empty(livekitApiKey) ? [{ name: 'livekit-api-key', value: livekitApiKey }] : [])
        ...(!empty(livekitApiSecret) ? [{ name: 'livekit-api-secret', value: livekitApiSecret }] : [])
        {
          name: 'azure-storage-connection-string'
          value: storageConnectionString
        }
        ...(!empty(dodoPaymentsApiKey) ? [{ name: 'dodo-payments-api-key', value: dodoPaymentsApiKey }] : [])
        ...(!empty(dodoWebhookKey) ? [{ name: 'dodo-webhook-key', value: dodoWebhookKey }] : [])
        ...(!empty(lightcurveTurnCredential) ? [{ name: 'turn-credential', value: lightcurveTurnCredential }] : [])
      ]
    }
    template: {
      containers: [
        {
          name: 'web'
          image: webImage
          resources: {
            cpu: json('0.5')
            memory: '1Gi'
          }
          env: [
            {
              name: 'NODE_ENV'
              value: 'production'
            }
            {
              name: 'DATABASE_URL'
              secretRef: 'database-url'
            }
            {
              name: 'NEXT_PUBLIC_APP_URL'
              value: nextPublicAppUrl
            }
            {
              name: 'NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY'
              value: clerkPublishableKey
            }
            {
              name: 'NEXT_PUBLIC_CLERK_SIGN_IN_URL'
              value: '/sign-in'
            }
            {
              name: 'NEXT_PUBLIC_CLERK_SIGN_UP_URL'
              value: '/sign-up'
            }
            {
              name: 'NEXT_PUBLIC_CLERK_SIGN_IN_FALLBACK_REDIRECT_URL'
              value: '/'
            }
            {
              name: 'NEXT_PUBLIC_CLERK_SIGN_UP_FALLBACK_REDIRECT_URL'
              value: '/'
            }
            {
              name: 'CLERK_SECRET_KEY'
              secretRef: 'clerk-secret-key'
            }
            {
              name: 'LIGHTCURVE_LLM_PROVIDER'
              value: 'qwen'
            }
            {
              name: 'LIGHTCURVE_LLM_BASE_URL'
              value: 'https://${qwen.properties.configuration.ingress.fqdn}'
            }
            {
              name: 'LIGHTCURVE_FLASH_JUDGE_MODEL'
              value: 'lightcurve-reasoner'
            }
            {
              name: 'LIGHTCURVE_PRO_JUDGE_MODEL'
              value: 'lightcurve-reasoner'
            }
            {
              name: 'LIGHTCURVE_LLM_TIMEOUT_MS'
              value: '240000'
            }
            {
              name: 'SPEECH_SERVICE_URL'
              value: 'https://${speech.properties.configuration.ingress.fqdn}'
            }
            {
              name: 'SPEECH_SERVICE_TOKEN'
              secretRef: 'speech-service-token'
            }
            {
              name: 'STT_MODEL'
              value: 'distil-large-v3'
            }
            {
              name: 'STT_QUALITY_MODEL'
              value: 'large-v3-turbo'
            }
            {
              name: 'TTS_MODEL'
              value: 'kokoro'
            }
            {
              name: 'TTS_FALLBACK_MODEL'
              value: 'piper'
            }
            {
              name: 'TTS_VOICE'
              value: 'af_heart'
            }
            {
              name: 'EMBEDDING_SERVICE_URL'
              value: 'https://${embedding.properties.configuration.ingress.fqdn}'
            }
            {
              name: 'EMBEDDING_SERVICE_TOKEN'
              secretRef: 'embedding-service-token'
            }
            {
              name: 'LIGHTCURVE_EMBEDDING_MODEL'
              value: 'sentence-transformers/all-MiniLM-L6-v2'
            }
            {
              name: 'MODELORBIT_SERVICE_URL'
              value: 'https://${modelOrbit.properties.configuration.ingress.fqdn}'
            }
            {
              name: 'MODELORBIT_SERVICE_TOKEN'
              secretRef: 'modelorbit-service-token'
            }
            {
              name: 'VOICE_CLONE_SERVICE_URL'
              value: 'https://${voiceClone.properties.configuration.ingress.fqdn}'
            }
            {
              name: 'VOICE_CLONE_SERVICE_TOKEN'
              secretRef: 'voice-clone-service-token'
            }
            {
              name: 'MOS_SERVICE_URL'
              value: 'https://${mos.properties.configuration.ingress.fqdn}'
            }
            {
              name: 'MOS_SERVICE_TOKEN'
              secretRef: 'mos-service-token'
            }
            {
              name: 'SCORING_INGEST_TOKEN'
              secretRef: 'scoring-ingest-token'
            }
            {
              name: 'ADMIN_CREDITS_TOKEN'
              secretRef: 'admin-credits-token'
            }
            ...(!empty(livekitUrl) ? [{ name: 'LIVEKIT_URL', secretRef: 'livekit-url' }] : [])
            ...(!empty(livekitApiKey) ? [{ name: 'LIVEKIT_API_KEY', secretRef: 'livekit-api-key' }] : [])
            ...(!empty(livekitApiSecret) ? [{ name: 'LIVEKIT_API_SECRET', secretRef: 'livekit-api-secret' }] : [])
            {
              name: 'LIGHTCURVE_AUDIO_STORAGE'
              value: 'azure'
            }
            {
              name: 'AZURE_STORAGE_CONNECTION_STRING'
              secretRef: 'azure-storage-connection-string'
            }
            {
              name: 'AZURE_STORAGE_CONTAINER'
              value: storageContainerName
            }
            {
              name: 'LIGHTCURVE_CREDENTIAL_SECRET'
              secretRef: 'lightcurve-credential-secret'
            }
            ...(!empty(dodoPaymentsApiKey) ? [{ name: 'DODO_PAYMENTS_API_KEY', secretRef: 'dodo-payments-api-key' }] : [])
            ...(!empty(dodoWebhookKey) ? [{ name: 'DODO_WEBHOOK_KEY', secretRef: 'dodo-webhook-key' }] : [])
            {
              name: 'DODO_ENVIRONMENT'
              value: dodoEnvironment
            }
            {
              name: 'DODO_PRO_PRODUCT_ID'
              value: dodoProProductId
            }
            {
              name: 'DODO_RETURN_URL'
              value: dodoReturnUrl
            }
            {
              name: 'DODO_WEBHOOK_URL'
              value: dodoWebhookUrl
            }
            {
              name: 'LIGHTCURVE_STUN_URL'
              value: lightcurveStunUrl
            }
            {
              name: 'LIGHTCURVE_TURN_URL'
              value: lightcurveTurnUrl
            }
            {
              name: 'LIGHTCURVE_TURN_USERNAME'
              value: lightcurveTurnUsername
            }
            ...(!empty(lightcurveTurnCredential) ? [{ name: 'LIGHTCURVE_TURN_CREDENTIAL', secretRef: 'turn-credential' }] : [])
            {
              name: 'LIGHTCURVE_GATE_MIN_MOS'
              value: '3.8'
            }
            {
              name: 'LIGHTCURVE_GATE_MIN_TASK'
              value: '0.8'
            }
          ]
        }
      ]
      scale: {
        minReplicas: 1
        maxReplicas: 2
        rules: [
          {
            name: 'http'
            http: {
              metadata: {
                concurrentRequests: '50'
              }
            }
          }
        ]
      }
    }
  }
}

output acrLoginServer string = acr.properties.loginServer
output storageAccountName string = storage.name
output postgresServerName string = postgres.name
output webUrl string = 'https://${web.properties.configuration.ingress.fqdn}'
output speechInternalUrl string = 'https://${speech.properties.configuration.ingress.fqdn}'
output mosInternalUrl string = 'https://${mos.properties.configuration.ingress.fqdn}'
output embeddingInternalUrl string = 'https://${embedding.properties.configuration.ingress.fqdn}'
output evaluateInternalUrl string = 'https://${modelOrbit.properties.configuration.ingress.fqdn}'
output voiceCloneInternalUrl string = 'https://${voiceClone.properties.configuration.ingress.fqdn}'
output qwenInternalUrl string = 'https://${qwen.properties.configuration.ingress.fqdn}'
