param(
  [Parameter(Mandatory = $true)]
  [string] $GoogleSheetId,

  [string] $ProjectId = "itera-tools",
  [string] $Region = "us-central1",
  [string] $ServiceName = "itera-claim-reconciliation-api",
  [string] $ServiceAccount = "itera-backend-svc@itera-tools.iam.gserviceaccount.com",
  [string] $AllowedOrigin = "https://itera-br.vercel.app",
  [string] $SupportingDocumentsFolderId = $env:SUPPORTING_DOCUMENTS_FOLDER_ID
)

$ErrorActionPreference = "Stop"

$tag = (Get-Date -Format "yyyyMMddHHmmss")
$image = "gcr.io/$ProjectId/$ServiceName`:$tag"

Write-Host "Building image: $image"
gcloud builds submit --project $ProjectId --tag $image .

$envVars = @(
  "NODE_ENV=production",
  "REQUIRE_AUTH=true",
  "IDENTITY_PLATFORM_PROJECT_ID=$ProjectId",
  "FIREBASE_PROJECT_ID=$ProjectId",
  "GOOGLE_CLOUD_PROJECT=$ProjectId",
  "GOOGLE_USE_ADC=true",
  "GOOGLE_SHEET_ID=$GoogleSheetId",
  "ALLOWED_ORIGIN=$AllowedOrigin"
)

if ($SupportingDocumentsFolderId) {
  $envVars += "SUPPORTING_DOCUMENTS_FOLDER_ID=$SupportingDocumentsFolderId"
}

$envVars = $envVars -join ","

Write-Host "Deploying Cloud Run service: $ServiceName"
gcloud run deploy $ServiceName `
  --project $ProjectId `
  --region $Region `
  --platform managed `
  --image $image `
  --service-account $ServiceAccount `
  --allow-unauthenticated `
  --port 8080 `
  --memory 1Gi `
  --cpu 1 `
  --min-instances 0 `
  --max-instances 5 `
  --timeout 300 `
  --set-env-vars $envVars

$url = gcloud run services describe $ServiceName --project $ProjectId --region $Region --format "value(status.url)"
Write-Host "Cloud Run URL: $url"
Write-Host "Status endpoint: $url/api/status"
