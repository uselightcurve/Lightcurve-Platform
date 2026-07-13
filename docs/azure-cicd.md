# Azure CI/CD

Production deploys from GitHub Actions through `.github/workflows/deploy-azure.yml`.

On every push to `main`, the workflow:

1. Logs in to Azure using GitHub OIDC.
2. Builds the Next.js web image in Azure Container Registry.
3. Tags the image with the commit SHA and `latest`.
4. Updates the Azure Container App named `web`.

The old Google Cloud Run workflow is manual-only now, so pushes to `main` no longer deploy to Google Cloud.

## One-time Azure setup

Run this from a local PowerShell session where `az login` is already authenticated:

```powershell
.\scripts\setup-azure-github-oidc.ps1
```

The script creates or reuses an Azure app registration named `lightcurve-github-actions`, adds a GitHub OIDC credential for:

```text
repo:uselightcurve/Lightcurve-Platform:ref:refs/heads/main
```

It assigns the deploy identity `Contributor` only on:

- the Azure Container Registry
- the `web` Azure Container App

It does not grant Contributor over the whole production resource group.

## GitHub settings

Add these repository secrets from the script output:

- `AZURE_CLIENT_ID`
- `AZURE_TENANT_ID`
- `AZURE_SUBSCRIPTION_ID`

Add this as either a repository variable or secret:

- `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`

The workflow defaults already match current production:

- `AZURE_RESOURCE_GROUP=lightcurve-production`
- `AZURE_ACR_NAME=lightcurveprod0472`
- `AZURE_CONTAINER_APP_NAME=web`
- `NEXT_PUBLIC_APP_URL=https://app.uselightcurve.com`

Only change those if production resource names change.
