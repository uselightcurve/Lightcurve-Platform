#!/usr/bin/env bash
set -Eeuo pipefail

required_env=(
  PROJECT_ID
  REGION
  SERVICE_NAME
  WEB_IMAGE
  MIGRATION_IMAGE
  MIGRATION_JOB
  NEXT_PUBLIC_APP_URL
  GCS_BUCKET
  CLOUD_SQL_CONNECTION_NAME
)

for name in "${required_env[@]}"; do
  if [[ -z "${!name:-}" ]]; then
    echo "Missing required environment variable: $name" >&2
    exit 1
  fi
done

join_by_comma() {
  local IFS=,
  echo "$*"
}

secret_exists() {
  gcloud secrets describe "$1" --project "$PROJECT_ID" >/dev/null 2>&1
}

secret_mappings=()
if ! secret_exists DATABASE_URL; then
  echo "Required Secret Manager secret DATABASE_URL does not exist in project $PROJECT_ID." >&2
  exit 1
fi
secret_mappings+=("DATABASE_URL=DATABASE_URL:latest")

required_secrets=(
  CLERK_SECRET_KEY
  DODO_PAYMENTS_API_KEY
)

for secret_name in "${required_secrets[@]}"; do
  if ! secret_exists "$secret_name"; then
    echo "Required Secret Manager secret $secret_name does not exist in project $PROJECT_ID." >&2
    exit 1
  fi
  secret_mappings+=("$secret_name=$secret_name:latest")
done

optional_secrets=(
  GEMINI_API_KEY
  DODO_WEBHOOK_KEY
  KMS_KEY_NAME
  LIGHTCURVE_TURN_USERNAME
  LIGHTCURVE_TURN_CREDENTIAL
)

for secret_name in "${optional_secrets[@]}"; do
  if secret_exists "$secret_name"; then
    secret_mappings+=("$secret_name=$secret_name:latest")
  else
    echo "Skipping optional secret $secret_name; it does not exist in Secret Manager."
  fi
done

secret_arg="$(join_by_comma "${secret_mappings[@]}")"

env_vars=(
  "NODE_ENV=production"
  "NEXT_PUBLIC_APP_URL=$NEXT_PUBLIC_APP_URL"
  "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=$NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY"
  "NEXT_PUBLIC_CLERK_SIGN_IN_URL=${NEXT_PUBLIC_CLERK_SIGN_IN_URL:-/sign-in}"
  "NEXT_PUBLIC_CLERK_SIGN_UP_URL=${NEXT_PUBLIC_CLERK_SIGN_UP_URL:-/sign-up}"
  "NEXT_PUBLIC_CLERK_AFTER_SIGN_IN_URL=${NEXT_PUBLIC_CLERK_AFTER_SIGN_IN_URL:-/}"
  "NEXT_PUBLIC_CLERK_AFTER_SIGN_UP_URL=${NEXT_PUBLIC_CLERK_AFTER_SIGN_UP_URL:-/}"
  "DODO_ENVIRONMENT=${DODO_ENVIRONMENT:-test_mode}"
  "DODO_PRO_PRODUCT_ID=${DODO_PRO_PRODUCT_ID:-}"
  "DODO_RETURN_URL=${DODO_RETURN_URL:-$NEXT_PUBLIC_APP_URL/settings/billing}"
  "DODO_WEBHOOK_URL=${DODO_WEBHOOK_URL:-$NEXT_PUBLIC_APP_URL/api/webhooks/dodo}"
  "GOOGLE_CLOUD_PROJECT=$PROJECT_ID"
  "GCP_REGION=$REGION"
  "VERTEX_AI_LOCATION=${VERTEX_AI_LOCATION:-$REGION}"
  "GCS_BUCKET=$GCS_BUCKET"
  "LIGHTCURVE_STUN_URL=${LIGHTCURVE_STUN_URL:-stun:stun.uselightcurve.com:3478}"
  "LIGHTCURVE_TURN_URL=${LIGHTCURVE_TURN_URL:-turn:turn.uselightcurve.com:3478}"
)

if [[ -n "${MOS_SERVICE_URL:-}" ]]; then
  env_vars+=("MOS_SERVICE_URL=$MOS_SERVICE_URL")
fi

echo "Deploying migration job $MIGRATION_JOB"
gcloud run jobs deploy "$MIGRATION_JOB" \
  --project "$PROJECT_ID" \
  --region "$REGION" \
  --image "$MIGRATION_IMAGE" \
  --tasks 1 \
  --max-retries 0 \
  --task-timeout 600 \
  --cpu 1 \
  --memory 1Gi \
  --set-secrets "DATABASE_URL=DATABASE_URL:latest" \
  --set-cloudsql-instances "$CLOUD_SQL_CONNECTION_NAME" \
  --quiet

echo "Running database migration"
gcloud run jobs execute "$MIGRATION_JOB" \
  --project "$PROJECT_ID" \
  --region "$REGION" \
  --wait

env_arg="$(join_by_comma "${env_vars[@]}")"

echo "Deploying Cloud Run service $SERVICE_NAME"
gcloud run deploy "$SERVICE_NAME" \
  --project "$PROJECT_ID" \
  --region "$REGION" \
  --image "$WEB_IMAGE" \
  --port 8080 \
  --cpu 1 \
  --memory 1Gi \
  --min-instances 0 \
  --max-instances 10 \
  --timeout 300 \
  --set-env-vars "$env_arg" \
  --set-secrets "$secret_arg" \
  --add-cloudsql-instances "$CLOUD_SQL_CONNECTION_NAME" \
  --quiet

echo "Preserving public Cloud Run access without IAM invoker checks"
gcloud run services update "$SERVICE_NAME" \
  --project "$PROJECT_ID" \
  --region "$REGION" \
  --no-invoker-iam-check \
  --quiet

service_url="$(gcloud run services describe "$SERVICE_NAME" \
  --project "$PROJECT_ID" \
  --region "$REGION" \
  --format='value(status.url)')"

echo "Cloud Run URL: $service_url"
if [[ -n "${GITHUB_OUTPUT:-}" ]]; then
  echo "service_url=$service_url" >> "$GITHUB_OUTPUT"
fi
