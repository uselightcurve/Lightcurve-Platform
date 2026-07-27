# Azure Deployment

Lightcurve now uses Azure only for infrastructure. Speech stays self-hosted and open source:

- STT: Speaches with faster-whisper, default `distil-large-v3`
- TTS: Speaches with Kokoro-82M, fallback Piper
- Voice variants: private Chatterbox Turbo container with explicit consent
- Call evaluation: private open-source voice measurement container plus stored Lightcurve evaluation records
- Reasoning: self-hosted Qwen3-4B Q4 in a versioned private image on a CPU scale-to-zero service; Qwen3-8B GPU is the upgrade path after GPU quota approval
- Storage: private Azure Blob container using `azblob://` object URIs

Do not enable Azure Speech, Azure AI Speech, Azure OpenAI audio, or Foundry speech tools for this deployment.

## Local Parity

Copy the example env and fill in Clerk and app secrets. Qwen and the speech models do not need external API keys:

```powershell
Copy-Item .env.azure.example .env.azure
```

Start the Azure-shaped local stack:

```powershell
docker compose --env-file .env.azure -f docker-compose.azure.yml up --build
```

Run database setup:

```powershell
docker compose --env-file .env.azure -f docker-compose.azure.yml --profile tools run --rm migrate
```

Local services:

- Web: `http://localhost:8080`
- Speech: `http://localhost:8000`
- Blob emulator: Azurite on `http://localhost:10000`
- Postgres: internal Docker service `postgres`
- Evaluate and voice-clone services: private Docker services used by the web app

## Azure Resources

The Bicep template creates:

- Azure Container Registry
- Azure Container Apps managed environment
- Public `web` Container App
- Internal `speech`, `mos`, `embedding`, `evaluate`, and `voice-clone` Container Apps
- Azure Database for PostgreSQL Flexible Server
- Private Azure Blob Storage container
- Log Analytics workspace

## Build Images

Create the resource group:

```powershell
az group create --name lightcurve-rg --location eastus
```

Create ACR first so image builds have somewhere to land. Use the same name later as `containerRegistryName` in Bicep:

```powershell
$acrName = "lightcurveregistry123"
$appUrl = "https://app.uselightcurve.com"
$clerkPublishableKey = "pk_live_replace_me"
az acr create --resource-group lightcurve-rg --name $acrName --sku Basic --admin-enabled true
$acr = "$acrName.azurecr.io"

az acr build `
  --registry $acrName `
  --image lightcurve-web:latest `
  --build-arg NEXT_PUBLIC_APP_URL=$appUrl `
  --build-arg NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=$clerkPublishableKey `
  --build-arg NEXT_PUBLIC_CLERK_SIGN_IN_URL=/sign-in `
  --build-arg NEXT_PUBLIC_CLERK_SIGN_UP_URL=/sign-up `
  --build-arg NEXT_PUBLIC_CLERK_SIGN_IN_FALLBACK_REDIRECT_URL=/ `
  --build-arg NEXT_PUBLIC_CLERK_SIGN_UP_FALLBACK_REDIRECT_URL=/ `
  .
az acr build --registry $acrName --image lightcurve-mos:latest ./mos_service
az acr build --registry $acrName --image lightcurve-embedding:latest ./embedding_service
az acr build --registry $acrName --image lightcurve-evaluate:latest ./modelorbit_service
az acr build --registry $acrName --image lightcurve-voice-clone:latest ./voice_clone_service
```

`NEXT_PUBLIC_*` values are baked into the browser bundle during `next build`, so rebuild the web image whenever the public app URL or Clerk publishable key changes.

Use the resulting image names:

```text
<acr>.azurecr.io/lightcurve-web:latest
<acr>.azurecr.io/lightcurve-mos:latest
<acr>.azurecr.io/lightcurve-embedding:latest
<acr>.azurecr.io/lightcurve-evaluate:latest
<acr>.azurecr.io/lightcurve-voice-clone:latest
```

## Deploy

Create a parameter file outside git, for example `infra/azure/main.local.bicepparam`, and set:

- `webImage`
- `mosImage`
- `embeddingImage`
- `modelOrbitImage`
- `voiceCloneImage`
- `postgresAdminPassword`
- `clerkSecretKey`
- `clerkPublishableKey`
- `nextPublicAppUrl` (`https://app.uselightcurve.com` for production)
- `qwenImage` (optional; defaults to the vLLM OpenAI-compatible image)
- `lightcurveCredentialSecret`
- `mosServiceToken`
- `embeddingServiceToken`
- `modelOrbitServiceToken`
- `voiceCloneServiceToken`
- `scoringIngestToken`
- `adminCreditsToken`

Deploy:

```powershell
az deployment group create `
  --resource-group lightcurve-rg `
  --template-file infra/azure/main.bicep `
  --parameters infra/azure/main.local.bicepparam
```

The first deployment outputs `webUrl`. Redeploy with `nextPublicAppUrl` set to that value, or set it to your custom domain.

## Migrations

Run migrations from a one-off local command or a temporary Container Apps job with the deployed `DATABASE_URL`:

```powershell
npm run db:push
npm run db:migrate
```

## Health Checks

Check public app health by opening the emitted `webUrl`.

Internal service checks from inside the Container Apps environment should hit:

- `${SPEECH_SERVICE_URL}/health`
- `${MOS_SERVICE_URL}/health`
- `${EMBEDDING_SERVICE_URL}/health`
- `${MODELORBIT_SERVICE_URL}/health`
- `${VOICE_CLONE_SERVICE_URL}/health`
- `${LIGHTCURVE_LLM_BASE_URL}/health`

## Model Notes

Speaches uses OpenAI-compatible endpoints:

- STT: `POST /v1/audio/transcriptions`
- TTS: `POST /v1/audio/speech`

The app maps friendly defaults to Speaches model IDs:

- `distil-large-v3` -> `Systran/faster-distil-whisper-large-v3`
- `kokoro` -> `speaches-ai/Kokoro-82M-v1.0-ONNX`

The production speech image is built from `speech_service/Dockerfile`. It includes both approved models so container restarts do not return a model-not-found response.

Keep `SPEECH_SERVICE_URL`, `MOS_SERVICE_URL`, `EMBEDDING_SERVICE_URL`, `MODELORBIT_SERVICE_URL`, and `VOICE_CLONE_SERVICE_URL` internal-only in Azure.

The Evaluate service does not need an external model API key. Set a long random `MODELORBIT_SERVICE_TOKEN` so only the Lightcurve web container can call it. The same applies to `VOICE_CLONE_SERVICE_TOKEN`.
