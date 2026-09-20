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
. (Join-Path $PSScriptRoot 'cloud-release-http.ps1')
function Read-CloudJson([string[]]$CloudArgs) {
  if($CloudArgs[0] -ne 'run' -or $CloudArgs[2] -ne 'describe'){throw 'Unsupported read.'}
  return Invoke-CloudReleaseRequest -Url "https://$region-run.googleapis.com/apis/serving.knative.dev/v1/namespaces/$project/$($CloudArgs[1])/$($CloudArgs[3])"
}
$current=Read-CloudJson @('run','services','describe',$Service)
$live=@($current.status.traffic | Where-Object { $_.percent -gt 0 })
if($live.Count -ne 1 -or $live[0].revisionName -ne $ExpectedServingRevision -or $live[0].percent -ne 100){throw 'Serving traffic changed or is split. Review the new state before release.'}
$newRevision="$Service-$Suffix"
if($Promote){
  $proofPath=Join-Path $PSScriptRoot "../staff-chat-verification/$newRevision.smoke.json"
  if(-not (Test-Path -LiteralPath $proofPath)){throw 'Synthetic verification receipt is required before promotion.'}
  $proof=Get-Content -LiteralPath $proofPath -Raw | ConvertFrom-Json
  if($proof.revision -ne $newRevision -or -not $proof.completedAt -or $proof.syntheticOnly -ne $true){throw 'Verification receipt is incomplete or belongs to a different revision.'}
  $candidate=Read-CloudJson @('run','revisions','describe',$newRevision)
  if(-not ($candidate.status.conditions | Where-Object { $_.type -eq 'Ready' -and $_.status -eq 'True' })){throw 'Candidate is not ready.'}
  if($candidate.spec.containers[0].image -ne $Image){throw 'Candidate image changed; verify the exact image before promotion.'}
  $current.spec.traffic=@($current.status.traffic | ForEach-Object {
    $target=@{revisionName=$_.revisionName;percent=0}
    if($_.tag){$target.tag=$_.tag}
    if($_.revisionName -eq $newRevision){$target.percent=100}
    $target
  })
  if(-not ($current.spec.traffic | Where-Object {$_.percent -eq 100})){throw 'Verified revision has no staged traffic target.'}
  $promotePath=Join-Path ([IO.Path]::GetTempPath()) ('bhw-chat-promote-'+[guid]::NewGuid().ToString('N')+'.json')
  try {
    @{apiVersion=$current.apiVersion;kind=$current.kind;metadata=@{name=$Service;namespace=$current.metadata.namespace;resourceVersion=$current.metadata.resourceVersion;annotations=$current.metadata.annotations;labels=$current.metadata.labels};spec=$current.spec} | ConvertTo-Json -Depth 100 | Set-Content -LiteralPath $promotePath -Encoding utf8
    $null=Invoke-CloudReleaseRequest -Url "https://$region-run.googleapis.com/apis/serving.knative.dev/v1/namespaces/$project/services/$Service" -Method PUT -BodyPath $promotePath
    Write-Output "Promotion requested for verified revision $newRevision. Confirm serving traffic before claiming live."
  } finally {if(Test-Path -LiteralPath $promotePath){Remove-Item -LiteralPath $promotePath}}
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
  if($property.Name -notmatch '^run.googleapis.com/(operation-id|client-name|client-version|build.*|source-location)$' -and $property.Name -notmatch '^serving.knative.dev/(creator|lastModifier)$'){$templateAnnotations[$property.Name]=$property.Value}
}
$serviceAnnotations=@{}
foreach($property in $current.metadata.annotations.psobject.Properties){
  if($property.Name -notmatch '^run.googleapis.com/(operation-id|urls|build.*|source-location)$' -and $property.Name -notmatch '^serving.knative.dev/(creator|lastModifier)$'){$serviceAnnotations[$property.Name]=$property.Value}
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
  $null=Invoke-CloudReleaseRequest -Url "https://$region-run.googleapis.com/apis/serving.knative.dev/v1/namespaces/$project/services/$Service" -Method PUT -BodyPath $privatePath
  $stateDirectory=Join-Path $PSScriptRoot '../staff-chat-verification'
  $null=New-Item -ItemType Directory -Path $stateDirectory -Force
  $secretBinding=($oldEnv | Where-Object {$_.name -eq 'CREWOS_OPERATIONS_TOKEN_SECRET'}).valueFrom.secretKeyRef
  @{service=$Service;previous=$ExpectedServingRevision;revision=$newRevision;image=$Image;project=$project;region=$region;database=($oldEnv | Where-Object {$_.name -eq 'FIRESTORE_DATABASE'}).value;secretName=$secretBinding.name;secretVersion=$secretBinding.key;candidateUrl=($current.status.url -replace '^https://',"https://staff-chat-$Suffix---")} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $stateDirectory "$newRevision.json") -Encoding utf8
  Write-Output "Staged $newRevision with zero production traffic. Existing $ExpectedServingRevision remains at 100 percent."
} finally {
  if(Test-Path -LiteralPath $privatePath){Remove-Item -LiteralPath $privatePath}
  if(Test-Path -LiteralPath $privateDirectory){Remove-Item -LiteralPath $privateDirectory}
}
