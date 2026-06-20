param(
  [Parameter(Mandatory = $true)]
  [string]$ProjectId,

  [string]$Region = "us-central1",
  [string]$ServiceName = "lightcurve",
  [string]$Repository = "lightcurve",
  [string]$ImageName = "lightcurve-web",
  [string]$BucketName = "",
  [string]$CloudSqlInstance = "",
  [string]$EnvFile = ".env"
)

$ErrorActionPreference = "Stop"

function Assert-Command($Name) {
  if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
    throw "$Name is not installed or not available on PATH."
  }
}

function Read-EnvFile($Path) {
  $values = @{}
  if (-not (Test-Path -LiteralPath $Path)) {
    return $values
  }

  foreach ($line in Get-Content -LiteralPath $Path) {
    $trimmed = $line.Trim()
    if (-not $trimmed -or $trimmed.StartsWith("#") -or -not $trimmed.Contains("=")) {
      continue
    }

    $key, $value = $trimmed.Split("=", 2)
    $values[$key] = $value.Trim().Trim('"').Trim("'")
  }

  return $values
}

function Ensure-Secret($Name, $Value) {
  if ([string]::IsNullOrWhiteSpace($Value)) {
    return $false
  }

  $exists = & gcloud.cmd secrets list --project $ProjectId --filter="name:$Name" --format="value(name)"
  if (-not $exists) {
    & gcloud.cmd secrets create $Name --project $ProjectId --replication-policy="automatic" | Out-Host
  }

  $tempFile = New-TemporaryFile
  try {
    Set-Content -LiteralPath $tempFile -Value $Value -NoNewline
    & gcloud.cmd secrets versions add $Name --project $ProjectId --data-file=$tempFile | Out-Host
  }
  finally {
    Remove-Item -LiteralPath $tempFile -Force -ErrorAction SilentlyContinue
  }

  return $true
}

function Get-CloudSqlSocketUrl($DatabaseUrl, $ConnectionName) {
  if ([string]::IsNullOrWhiteSpace($DatabaseUrl) -or [string]::IsNullOrWhiteSpace($ConnectionName)) {
    return $DatabaseUrl
  }

  $uri = [Uri]$DatabaseUrl
  $user = [Uri]::EscapeDataString($uri.UserInfo.Split(":", 2)[0])
  $password = ""
  if ($uri.UserInfo.Contains(":")) {
    $password = [Uri]::EscapeDataString([Uri]::UnescapeDataString($uri.UserInfo.Split(":", 2)[1]))
  }
  $database = $uri.AbsolutePath.TrimStart("/")
  $socketHost = [Uri]::EscapeDataString("/cloudsql/$ConnectionName")

  if ($password) {
    return "postgresql://$user`:$password@/$database`?host=$socketHost"
  }

  return "postgresql://$user@/$database`?host=$socketHost"
}

Assert-Command "gcloud.cmd"
Assert-Command "docker"

$envValues = Read-EnvFile $EnvFile
if (-not $BucketName) {
  $BucketName = $envValues["GCS_BUCKET"]
}
if (-not $BucketName) {
  $BucketName = "$ProjectId-lightcurve-artifacts"
}

$imageTag = if ($env:GITHUB_SHA) { $env:GITHUB_SHA } else { "local-$(Get-Date -Format yyyyMMddHHmmss)" }
$imageUri = "$Region-docker.pkg.dev/$ProjectId/$Repository/$ImageName`:$imageTag"

Write-Host "Configuring Google Cloud project $ProjectId"
& gcloud.cmd config set project $ProjectId | Out-Host

Write-Host "Enabling required Google Cloud services"
& gcloud.cmd services enable `
  run.googleapis.com `
  artifactregistry.googleapis.com `
  secretmanager.googleapis.com `
  cloudbuild.googleapis.com `
  sqladmin.googleapis.com `
  iamcredentials.googleapis.com `
  sts.googleapis.com `
  storage.googleapis.com `
  --project $ProjectId | Out-Host

$projectNumber = & gcloud.cmd projects describe $ProjectId --format="value(projectNumber)"
$runtimeServiceAccount = "$projectNumber-compute@developer.gserviceaccount.com"

Write-Host "Ensuring Artifact Registry repository $Repository"
$repoExists = & gcloud.cmd artifacts repositories list --location=$Region --project $ProjectId --filter="name:$Repository" --format="value(name)"
if (-not $repoExists) {
  & gcloud.cmd artifacts repositories create $Repository `
    --repository-format=docker `
    --location=$Region `
    --description="Lightcurve production images" `
    --project $ProjectId | Out-Host
}

Write-Host "Ensuring Cloud Storage bucket gs://$BucketName"
$bucketExists = & gcloud.cmd storage buckets list --project $ProjectId --filter="name:$BucketName" --format="value(name)"
if (-not $bucketExists) {
  & gcloud.cmd storage buckets create "gs://$BucketName" --location=$Region --project $ProjectId | Out-Host
}

Write-Host "Granting runtime service account minimum app permissions"
& gcloud.cmd projects add-iam-policy-binding $ProjectId `
  --member="serviceAccount:$runtimeServiceAccount" `
  --role="roles/secretmanager.secretAccessor" `
  --condition=None | Out-Host
& gcloud.cmd projects add-iam-policy-binding $ProjectId `
  --member="serviceAccount:$runtimeServiceAccount" `
  --role="roles/cloudsql.client" `
  --condition=None | Out-Host
& gcloud.cmd storage buckets add-iam-policy-binding "gs://$BucketName" `
  --member="serviceAccount:$runtimeServiceAccount" `
  --role="roles/storage.objectAdmin" | Out-Host

$cloudSqlConnectionName = ""
if ($CloudSqlInstance) {
  if ($CloudSqlInstance.Contains(":")) {
    $cloudSqlConnectionName = $CloudSqlInstance
  } else {
    $cloudSqlConnectionName = & gcloud.cmd sql instances describe $CloudSqlInstance --project $ProjectId --format="value(connectionName)"
  }
} else {
  $cloudSqlConnectionName = & gcloud.cmd sql instances list --project $ProjectId --filter="region:$Region" --limit=1 --format="value(connectionName)"
}

if ($cloudSqlConnectionName) {
  Write-Host "Using Cloud SQL connector instance $cloudSqlConnectionName"
  $envValues["DATABASE_URL"] = Get-CloudSqlSocketUrl $envValues["DATABASE_URL"] $cloudSqlConnectionName
}

$secretNames = @(
  "DATABASE_URL",
  "GEMINI_API_KEY",
  "KMS_KEY_NAME",
  "LIGHTCURVE_TURN_USERNAME",
  "LIGHTCURVE_TURN_CREDENTIAL"
)

$activeSecretNames = @()
foreach ($secretName in $secretNames) {
  if (Ensure-Secret $secretName $envValues[$secretName]) {
    $activeSecretNames += $secretName
  }
}

Write-Host "Building and pushing $imageUri"
& gcloud.cmd auth configure-docker "$Region-docker.pkg.dev" --quiet | Out-Host
& docker build -t $imageUri . | Out-Host
& docker push $imageUri | Out-Host

$appUrl = $envValues["NEXT_PUBLIC_APP_URL"]
if (-not $appUrl -or $appUrl -eq "http://localhost:3000") {
  $appUrl = ""
}

$envVars = @(
  "NODE_ENV=production",
  "GOOGLE_CLOUD_PROJECT=$ProjectId",
  "GCP_REGION=$Region",
  "VERTEX_AI_LOCATION=$Region",
  "GCS_BUCKET=$BucketName",
  "LIGHTCURVE_STUN_URL=stun:stun.uselightcurve.com:3478",
  "LIGHTCURVE_TURN_URL=turn:turn.uselightcurve.com:3478"
)

if ($appUrl) {
  $envVars += "NEXT_PUBLIC_APP_URL=$appUrl"
}
if ($envValues["MOS_SERVICE_URL"]) {
  $envVars += "MOS_SERVICE_URL=$($envValues["MOS_SERVICE_URL"])"
}

$deployArgs = @(
  "run", "deploy", $ServiceName,
  "--project", $ProjectId,
  "--region", $Region,
  "--image", $imageUri,
  "--allow-unauthenticated",
  "--port", "8080",
  "--cpu", "1",
  "--memory", "1Gi",
  "--min-instances", "0",
  "--max-instances", "10",
  "--timeout", "300",
  "--set-env-vars", ($envVars -join ",")
)

if ($cloudSqlConnectionName) {
  $deployArgs += "--add-cloudsql-instances"
  $deployArgs += $cloudSqlConnectionName
}

if ($activeSecretNames.Count -gt 0) {
  $secretMappings = $activeSecretNames | ForEach-Object { "$($_)=$($_):latest" }
  $deployArgs += "--set-secrets"
  $deployArgs += ($secretMappings -join ",")
}

Write-Host "Deploying Cloud Run service $ServiceName"
& gcloud.cmd @deployArgs | Out-Host

$serviceUrl = & gcloud.cmd run services describe $ServiceName --project $ProjectId --region $Region --format="value(status.url)"
Write-Host "Cloud Run URL: $serviceUrl"
Write-Host "Run smoke test with:"
Write-Host "`$env:SMOKE_BASE_URL='$serviceUrl'; npm.cmd run smoke:production"

