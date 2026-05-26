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
  CLOUD_TASKS_QUEUE
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

optional_secrets=(
  GEMINI_API_KEY
  DAILY_API_KEY
  VAPI_API_KEY
  VAPI_ASSISTANT_ID
  VAPI_PHONE_NUMBER_ID
  VAPI_CALLER_PHONE_NUMBER
  VAPI_TEST_CUSTOMER_NUMBER
  VAPI_TARGET_AGENT_NUMBER
  VAPI_CALLER_ASSISTANT_ID
  VAPI_CALLER_VOICE_PROVIDER
  VAPI_CALLER_VOICE_ID
  RETELL_API_KEY
  RETELL_AGENT_ID
  RETELL_FROM_NUMBER
  RETELL_TEST_CUSTOMER_NUMBER
  ELEVENLABS_API_KEY
  ELEVENLABS_AGENT_ID
  ELEVENLABS_AGENT_PHONE_NUMBER_ID
  ELEVENLABS_TEST_CUSTOMER_NUMBER
  LIVEKIT_URL
  LIVEKIT_API_KEY
  LIVEKIT_API_SECRET
  PIPECAT_AGENT_URL
  PIPECAT_AUTH_TOKEN
  CUSTOM_WEBRTC_WSS_URL
  CUSTOM_AGENT_RUNNER_URL
  HUGGINGFACE_TOKEN
  BOT_TO_BOT_CALLER_MODEL
  BOT_TO_BOT_JUDGE_MODEL
  BOT_TO_BOT_TTS_ENABLED
  BOT_TO_BOT_MAX_TURNS
  BOT_TO_BOT_TASK_DEADLINE_SECONDS
  BOT_TO_BOT_MAX_CONCURRENT_RUNS
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
  "GOOGLE_CLOUD_PROJECT=$PROJECT_ID"
  "GCP_REGION=$REGION"
  "CLOUD_TASKS_LOCATION=$REGION"
  "CLOUD_TASKS_QUEUE=$CLOUD_TASKS_QUEUE"
  "GCS_BUCKET=$GCS_BUCKET"
  "ELEVENLABS_COST_MODE=${ELEVENLABS_COST_MODE:-recording_replay}"
  "LIGHTCURVE_SYNTHETIC_CALLER_PROVIDER=${LIGHTCURVE_SYNTHETIC_CALLER_PROVIDER:-cheap_tts}"
  "BOT_TO_BOT_CALLER_MODEL=${BOT_TO_BOT_CALLER_MODEL:-gemini-1.5-flash}"
  "BOT_TO_BOT_JUDGE_MODEL=${BOT_TO_BOT_JUDGE_MODEL:-gemini-1.5-flash}"
  "BOT_TO_BOT_TTS_ENABLED=${BOT_TO_BOT_TTS_ENABLED:-0}"
  "BOT_TO_BOT_MAX_TURNS=${BOT_TO_BOT_MAX_TURNS:-4}"
  "BOT_TO_BOT_TASK_DEADLINE_SECONDS=${BOT_TO_BOT_TASK_DEADLINE_SECONDS:-900}"
  "BOT_TO_BOT_MAX_CONCURRENT_RUNS=${BOT_TO_BOT_MAX_CONCURRENT_RUNS:-50}"
  "VAPI_CALLER_MODEL_PROVIDER=${VAPI_CALLER_MODEL_PROVIDER:-openai}"
  "VAPI_CALLER_MODEL=${VAPI_CALLER_MODEL:-gpt-4o-mini}"
)

if [[ -n "${MOS_SERVICE_URL:-}" ]]; then
  env_vars+=("MOS_SERVICE_URL=$MOS_SERVICE_URL")
fi

env_arg="$(join_by_comma "${env_vars[@]}")"

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

echo "Updating Cloud Tasks queue concurrency"
if gcloud tasks queues describe "$CLOUD_TASKS_QUEUE" --project "$PROJECT_ID" --location "$REGION" >/dev/null 2>&1; then
  gcloud tasks queues update "$CLOUD_TASKS_QUEUE" \
    --project "$PROJECT_ID" \
    --location "$REGION" \
    --max-concurrent-dispatches "${BOT_TO_BOT_MAX_CONCURRENT_RUNS:-50}" \
    --quiet
else
  echo "Cloud Tasks queue $CLOUD_TASKS_QUEUE was not found; skipping concurrency update."
fi

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
