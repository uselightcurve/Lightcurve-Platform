param(
  [string]$GitHubRepository = "uselightcurve/Lightcurve-Platform",
  [string]$AppRegistrationName = "lightcurve-github-actions",
  [string]$ResourceGroup = "lightcurve-production",
  [string]$AcrName = "lightcurveprod0472",
  [string]$ContainerAppName = "web"
)

$ErrorActionPreference = "Stop"

function Ensure-RoleAssignment {
  param(
    [string]$AssigneeObjectId,
    [string]$Role,
    [string]$Scope
  )

  $existing = az role assignment list `
    --assignee-object-id $AssigneeObjectId `
    --role $Role `
    --scope $Scope `
    --query "[0].id" `
    --output tsv

  if (-not $existing) {
    az role assignment create `
      --assignee-object-id $AssigneeObjectId `
      --assignee-principal-type ServicePrincipal `
      --role $Role `
      --scope $Scope `
      --only-show-errors | Out-Null
  }
}

$subscriptionId = az account show --query id --output tsv
$tenantId = az account show --query tenantId --output tsv

$appId = az ad app list `
  --display-name $AppRegistrationName `
  --query "[0].appId" `
  --output tsv

if (-not $appId) {
  $appId = az ad app create `
    --display-name $AppRegistrationName `
    --query appId `
    --output tsv
}

$spObjectId = az ad sp list `
  --filter "appId eq '$appId'" `
  --query "[0].id" `
  --output tsv

if (-not $spObjectId) {
  az ad sp create --id $appId --only-show-errors | Out-Null
  Start-Sleep -Seconds 10
  $spObjectId = az ad sp list `
    --filter "appId eq '$appId'" `
    --query "[0].id" `
    --output tsv
}

$acrId = az acr show `
  --resource-group $ResourceGroup `
  --name $AcrName `
  --query id `
  --output tsv

$containerAppId = az containerapp show `
  --resource-group $ResourceGroup `
  --name $ContainerAppName `
  --query id `
  --output tsv

Ensure-RoleAssignment -AssigneeObjectId $spObjectId -Role "Contributor" -Scope $acrId
Ensure-RoleAssignment -AssigneeObjectId $spObjectId -Role "Contributor" -Scope $containerAppId

$credentialName = "github-main"
$existingCredential = az ad app federated-credential list `
  --id $appId `
  --query "[?name=='$credentialName'].name | [0]" `
  --output tsv

if (-not $existingCredential) {
  $subject = "repo:$GitHubRepository`:ref:refs/heads/main"
  $parametersPath = Join-Path $env:TEMP "lightcurve-github-oidc-$credentialName.json"
  @{
    name = $credentialName
    issuer = "https://token.actions.githubusercontent.com"
    subject = $subject
    description = "GitHub Actions deploys Lightcurve production from main"
    audiences = @("api://AzureADTokenExchange")
  } | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $parametersPath -Encoding utf8

  az ad app federated-credential create `
    --id $appId `
    --parameters "@$parametersPath" `
    --only-show-errors | Out-Null
}

Write-Host ""
Write-Host "Add these GitHub Actions secrets:"
Write-Host "AZURE_CLIENT_ID=$appId"
Write-Host "AZURE_TENANT_ID=$tenantId"
Write-Host "AZURE_SUBSCRIPTION_ID=$subscriptionId"
Write-Host ""
Write-Host "The workflow also expects NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY as a GitHub Actions variable or secret."
Write-Host "Current defaults already match production: resource group $ResourceGroup, ACR $AcrName, Container App $ContainerAppName."
