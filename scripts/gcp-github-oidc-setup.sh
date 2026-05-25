#!/usr/bin/env bash
set -Eeuo pipefail

PROJECT_ID="${PROJECT_ID:-lightcurve-platform}"
GITHUB_REPOSITORY="${GITHUB_REPOSITORY:-}"
POOL_ID="${POOL_ID:-github-actions}"
PROVIDER_ID="${PROVIDER_ID:-github}"
SERVICE_ACCOUNT_ID="${SERVICE_ACCOUNT_ID:-github-deployer}"

if [[ -z "$GITHUB_REPOSITORY" ]]; then
  echo "Set GITHUB_REPOSITORY to owner/repo before running this script." >&2
  exit 1
fi

project_number="$(gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)')"
service_account_email="$SERVICE_ACCOUNT_ID@$PROJECT_ID.iam.gserviceaccount.com"

echo "Ensuring service account $service_account_email"
if ! gcloud iam service-accounts describe "$service_account_email" --project "$PROJECT_ID" >/dev/null 2>&1; then
  gcloud iam service-accounts create "$SERVICE_ACCOUNT_ID" \
    --project "$PROJECT_ID" \
    --display-name "GitHub deployer for Lightcurve"
fi

roles=(
  roles/run.admin
  roles/artifactregistry.writer
  roles/iam.serviceAccountUser
  roles/secretmanager.viewer
  roles/secretmanager.secretAccessor
  roles/cloudsql.viewer
)

for role in "${roles[@]}"; do
  gcloud projects add-iam-policy-binding "$PROJECT_ID" \
    --member "serviceAccount:$service_account_email" \
    --role "$role" \
    --condition=None \
    --quiet
done

echo "Ensuring Workload Identity pool $POOL_ID"
if ! gcloud iam workload-identity-pools describe "$POOL_ID" --project "$PROJECT_ID" --location global >/dev/null 2>&1; then
  gcloud iam workload-identity-pools create "$POOL_ID" \
    --project "$PROJECT_ID" \
    --location global \
    --display-name "GitHub Actions"
fi

echo "Ensuring Workload Identity provider $PROVIDER_ID"
if ! gcloud iam workload-identity-pools providers describe "$PROVIDER_ID" --project "$PROJECT_ID" --location global --workload-identity-pool "$POOL_ID" >/dev/null 2>&1; then
  gcloud iam workload-identity-pools providers create-oidc "$PROVIDER_ID" \
    --project "$PROJECT_ID" \
    --location global \
    --workload-identity-pool "$POOL_ID" \
    --display-name "GitHub Actions" \
    --issuer-uri "https://token.actions.githubusercontent.com" \
    --attribute-mapping "google.subject=assertion.sub,attribute.actor=assertion.actor,attribute.repository=assertion.repository,attribute.repository_owner=assertion.repository_owner,attribute.ref=assertion.ref" \
    --attribute-condition "assertion.repository=='$GITHUB_REPOSITORY'"
fi

principal="principalSet://iam.googleapis.com/projects/$project_number/locations/global/workloadIdentityPools/$POOL_ID/attribute.repository/$GITHUB_REPOSITORY"
gcloud iam service-accounts add-iam-policy-binding "$service_account_email" \
  --project "$PROJECT_ID" \
  --role roles/iam.workloadIdentityUser \
  --member "$principal" \
  --quiet

provider_name="projects/$project_number/locations/global/workloadIdentityPools/$POOL_ID/providers/$PROVIDER_ID"

cat <<EOF

GitHub Actions auth is ready.

Add these GitHub repository secrets:
GCP_WORKLOAD_IDENTITY_PROVIDER=$provider_name
GCP_DEPLOYER_SERVICE_ACCOUNT=$service_account_email

EOF
