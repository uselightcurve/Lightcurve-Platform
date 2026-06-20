# Google Cloud production deployment

Lightcurve deploys the Next.js application and a schema-push migration job to
Cloud Run through `.github/workflows/deploy-cloud-run.yml`.

## Required configuration

Repository variables:

- `GCP_PROJECT_ID`
- `GCP_REGION`
- `SERVICE_NAME`
- `AR_REPOSITORY`
- `NEXT_PUBLIC_APP_URL`
- `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`
- `GCS_BUCKET`
- `CLOUD_SQL_CONNECTION_NAME`
- `LIGHTCURVE_STUN_URL`
- `LIGHTCURVE_TURN_URL`

Repository secrets:

- `GCP_WORKLOAD_IDENTITY_PROVIDER`
- `GCP_DEPLOYER_SERVICE_ACCOUNT`

Secret Manager:

- `DATABASE_URL`
- `CLERK_SECRET_KEY`
- `DODO_PAYMENTS_API_KEY`
- `DODO_WEBHOOK_KEY` when billing webhooks are enabled
- `GEMINI_API_KEY` when graph enrichment is enabled
- `KMS_KEY_NAME` when application encryption is enabled
- `LIGHTCURVE_TURN_USERNAME`
- `LIGHTCURVE_TURN_CREDENTIAL`

There are no telephony-provider, hosted-room, phone-number, or SIP secrets.

## Deployment sequence

1. Build and push web and migration images.
2. Run the destructive-approved schema push before the web deployment.
3. Deploy the web service with Cloud SQL and private secrets attached.
4. Run `npm run smoke:production` against the deployed URL.

The smoke test verifies the application shell, non-telephony SDK transport
status, and authentication on Datasets and Experiments.
