param(
  [Parameter(Mandatory=$true)][ValidateSet('bhw-operations-api','bhw-health-core-ehr')][string]$Service,
  [Parameter(Mandatory=$true)][string]$ExpectedServingRevision,
  [Parameter(Mandatory=$true)][string]$Image,
  [Parameter(Mandatory=$true)][ValidatePattern('^[a-z0-9-]+$')][string]$Suffix,
  [switch]$Promote
)
$ErrorActionPreference='Stop'
$project='constant-land-504517-i9'
$region='us-east4'
function Read-CloudJson([string[]]$CloudArgs) {
  $raw = & gcloud @CloudArgs --project=$project --region=$region --format=json
  if($LASTEXITCODE -ne 0){ throw 'Google Cloud command failed; no traffic was changed by this script.' }
  return ($raw | ConvertFrom-Json -Depth 100)
}
$current=Read-CloudJson @('run','services','describe',$Service)
$live=@($current.status.traffic | Where-Object { $_.percent -gt 0 })
if($live.Count -ne 1 -or $live[0].revisionName -ne $ExpectedServingRevision -or $live[0].percent -ne 100){throw 'Serving traffic changed or is split. Review the new state before release.'}
$newRevision="$Service-$Suffix"
if($Promote){
  $candidate=Read-CloudJson @('run','revisions','describe',$newRevision)
  if(-not ($candidate.status.conditions | Where-Object { $_.type -eq 'Ready' -and $_.status -eq 'True' })){throw 'Candidate is not ready.'}
  & gcloud run services update-traffic $Service --to-revisions="$newRevision=100" --project=$project --region=$region --quiet
  if($LASTEXITCODE -ne 0){throw 'Traffic update failed; inspect current traffic before retrying.'}
  exit 0
}
if(-not $Image.StartsWith("us-east4-docker.pkg.dev/$project/cloud-run-source-deploy/$Service")){throw 'Unexpected image registry or service.'}
$production=Read-CloudJson @('run','revisions','describe',$ExpectedServingRevision)
$pod=$production.spec
if($pod.containers.Count -ne 1){throw 'Expected one application container; review configuration.'}
$pod.containers[0].image=$Image
$gate=if($Service -eq 'bhw-operations-api'){'STAFF_CHAT_ENABLED'}else{'EHR_STAFF_CHAT_ENABLED'}
$oldEnv=@($pod.containers[0].env | Where-Object { $_.name -ne $gate })
$pod.containers[0].env=@($oldEnv)+@([pscustomobject]@{name=$gate;value='true'})
# Clone the actual serving revision, not the latest preview. All other feature gates,
# secrets, service account, limits, volumes, probes and IAM boundary are preserved.
$templateAnnotations=@{}
foreach($property in $production.metadata.annotations.psobject.Properties){
  if($property.Name -notin @('run.googleapis.com/operation-id','run.googleapis.com/client-name','run.googleapis.com/client-version')){$templateAnnotations[$property.Name]=$property.Value}
}
$serviceAnnotations=@{}
foreach($property in $current.metadata.annotations.psobject.Properties){
  if($property.Name -notin @('run.googleapis.com/operation-id','run.googleapis.com/urls','serving.knative.dev/creator','serving.knative.dev/lastModifier')){$serviceAnnotations[$property.Name]=$property.Value}
}
$traffic=@($current.status.traffic | Where-Object { $_.tag -ne "staff-chat-$Suffix" } | ForEach-Object {
  $target=@{revisionName=$_.revisionName}
  if($_.percent){$target.percent=$_.percent}
  if($_.tag){$target.tag=$_.tag}
  $target
})+@(@{revisionName=$newRevision;tag="staff-chat-$Suffix";percent=0})
$release=@{
  apiVersion='serving.knative.dev/v1';kind='Service'
  metadata=@{name=$Service;namespace=$current.metadata.namespace;annotations=$serviceAnnotations;labels=$current.metadata.labels;resourceVersion=$current.metadata.resourceVersion}
  spec=@{template=@{metadata=@{name=$newRevision;annotations=$templateAnnotations};spec=$pod};traffic=$traffic}
}
# Configuration may contain sensitive legacy values: generated only in the user's
# temporary directory, never logged or added to a repository/deploy directory.
$privateDirectory=Join-Path ([IO.Path]::GetTempPath()) ('bhw-chat-release-'+[guid]::NewGuid().ToString('N'))
$null=New-Item -ItemType Directory -Path $privateDirectory
$privatePath=Join-Path $privateDirectory 'service.json'
try {
  $release | ConvertTo-Json -Depth 100 | Set-Content -LiteralPath $privatePath -Encoding utf8
  & gcloud run services replace $privatePath --project=$project --region=$region --async --quiet --format='value(status.latestCreatedRevisionName)'
  if($LASTEXITCODE -ne 0){throw 'Staging failed; do not promote.'}
  Write-Output "Staged $newRevision with zero production traffic. Existing $ExpectedServingRevision remains at 100 percent."
} finally {
  if(Test-Path -LiteralPath $privatePath){Remove-Item -LiteralPath $privatePath}
  if(Test-Path -LiteralPath $privateDirectory){Remove-Item -LiteralPath $privateDirectory}
}
