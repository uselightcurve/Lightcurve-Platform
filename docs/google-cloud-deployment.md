# Google Cloud Production Deployment

Lightcurve is deployed to Google Cloud Run from GitHub Actions. The live production service is:

- Project: `lightcurve-platform`
- Region: `us-central1`
- Cloud Run service: `lightcurve`
- Public URL: `https://lightcurve-rvdvu6z2zq-uc.a.run.app`
- Artifact Registry repo: `lightcurve`
- Web image: `lightcurve-web`
- Migration image: `lightcurve-migrate`
- Migration job: `lightcurve-db-push`
- Cloud SQL connection: `lightcurve-platform:us-central1:lightcurve-prod-database`
- Storage bucket: `lightcurve-platform-artifacts`
- Cloud Tasks queue: `lightcurve-evals`

## CI/CD behavior

- Pull requests run `npm ci`, lint advisory, and `npm run build`.
- Pushes to `main` build the web and migration Docker images.
- The migration image runs through the Cloud Run job before the service is updated.
- The service deploys to Cloud Run with the Cloud SQL connector attached.
- Public access is preserved with `gcloud run services update lightcurve --no-invoker-iam-check`.
- `npm run smoke:production` verifies `/`, `/api/integrations/status`, `/api/scenarios`, and `/api/experiments`.

## GitHub repository setup

The repository must be connected to GitHub before the workflow can run. Add these repository variables:

```text
GCP_PROJECT_ID=lightcurve-platform
GCP_REGION=us-central1
SERVICE_NAME=lightcurve
AR_REPOSITORY=lightcurve
NEXT_PUBLIC_APP_URL=https://lightcurve-rvdvu6z2zq-uc.a.run.app
GCS_BUCKET=lightcurve-platform-artifacts
CLOUD_TASKS_QUEUE=lightcurve-evals
CLOUD_SQL_CONNECTION_NAME=lightcurve-platform:us-central1:lightcurve-prod-database
```

`MOS_SERVICE_URL` is optional and should only be set when that service exists.

Add these repository secrets after running the Workload Identity setup:

```text
GCP_WORKLOAD_IDENTITY_PROVIDER=projects/PROJECT_NUMBER/locations/global/workloadIdentityPools/github-actions/providers/github
GCP_DEPLOYER_SERVICE_ACCOUNT=github-deployer@lightcurve-platform.iam.gserviceaccount.com
```

## One-time Workload Identity setup

Use Workload Identity Federation instead of a downloaded service account key. From an authenticated Google Cloud CLI session:

```bash
PROJECT_ID=lightcurve-platform GITHUB_REPOSITORY=OWNER/REPO bash scripts/gcp-github-oidc-setup.sh
```

Replace `OWNER/REPO` with the real GitHub repository, for example `uselightcurve/lightcurve`.

The script creates or reuses:

- service account: `github-deployer@lightcurve-platform.iam.gserviceaccount.com`
- Workload Identity pool: `github-actions`
- provider: `github`
- repository-scoped identity binding

It grants the deployer:

- `roles/run.admin`
- `roles/artifactregistry.writer`
- `roles/iam.serviceAccountUser`
- `roles/secretmanager.viewer`
- `roles/secretmanager.secretAccessor`
- `roles/cloudsql.viewer`

## Secret Manager

`DATABASE_URL` is required. Optional provider secrets are attached only when they exist, so deploys do not fail while integrations are still being added.

Required:

```bash
gcloud secrets describe DATABASE_URL --project lightcurve-platform
```

Optional:

```text
GEMINI_API_KEY
DAILY_API_KEY
VAPI_API_KEY
VAPI_ASSISTANT_ID
RETELL_API_KEY
RETELL_AGENT_ID
ELEVENLABS_API_KEY
ELEVENLABS_AGENT_ID
LIVEKIT_URL
LIVEKIT_API_KEY
LIVEKIT_API_SECRET
PIPECAT_AGENT_URL
PIPECAT_AUTH_TOKEN
CUSTOM_WEBRTC_WSS_URL
HUGGINGFACE_TOKEN
```

Add a secret version with:

```bash
printf "VALUE" | gcloud secrets versions add SECRET_NAME --project lightcurve-platform --data-file=-
```

## Manual production check

Run this if you need to verify the live service outside GitHub Actions:

```bash
SMOKE_BASE_URL=https://lightcurve-rvdvu6z2zq-uc.a.run.app npm run smoke:production
```

## Direct local deploy fallback

The GitHub workflow is the preferred production path. If GitHub Actions is unavailable, use:

```powershell
.\scripts\gcp-deploy.ps1 -ProjectId "lightcurve-platform" -Region "us-central1" -CloudSqlInstance "lightcurve-platform:us-central1:lightcurve-prod-database"
```

This local fallback builds and pushes the web image from the workstation, uploads non-empty `.env` secrets to Secret Manager, attaches Cloud SQL, and prints the smoke test command.
