# Read/write only the existing Cloud Run resources. IPv4 avoids broken local IPv6
# handshakes; this does not alter the machine's network or cloud IAM settings.
function Invoke-CloudReleaseRequest {
  param([string]$Url, [ValidateSet('GET','PUT')][string]$Method='GET', [string]$BodyPath='')
  if($Url -notmatch '^https://us-east4-run\.googleapis\.com/apis/serving\.knative\.dev/v1/namespaces/constant-land-504517-i9/(services|revisions)/bhw-(operations-api|health-core-ehr)[a-z0-9-]*$'){throw 'Unexpected release resource.'}
  $releaseToken=(& gcloud auth print-access-token 2>$null).Trim()
  if($LASTEXITCODE -ne 0 -or -not $releaseToken){throw 'Google Cloud sign-in is required.'}
  $settings="url = `"$Url`"`nrequest = `"$Method`"`nheader = `"Authorization: Bearer $releaseToken`"`nsilent`nshow-error`nfail`nmax-time = 60"
  if($BodyPath){$settings += "`nheader = `"Content-Type: application/json`"`ndata-binary = `"@$($BodyPath.Replace('\','/'))`""}
  try {
    $raw=$settings | & curl.exe -4 --config -
    if($LASTEXITCODE -ne 0){throw 'Cloud request failed. Inspect current state before retrying a write.'}
    return ($raw | ConvertFrom-Json -Depth 100)
  } finally {$releaseToken=$null; $settings=$null; $raw=$null}
}
