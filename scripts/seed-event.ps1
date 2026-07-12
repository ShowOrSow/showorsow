<#
.SYNOPSIS
  Seed the ShowOrSow demo event + invites via the Go backend REST API.

.DESCRIPTION
  Reproduces the demo's take-1 beat (10-demo-script.md): create "Canton Meetup"
  with a 0.01 cBTC stake, then invite attendee1..3. All calls go through the
  backend (05-backend.md §2) — the browser/ledger are never touched directly.
  Idempotent-ish: re-running creates a NEW event (backend mints a fresh
  eventId), so run after a fumbled take for a clean slate (10 §pre-flight).

.PARAMETER ApiUrl
  Backend base URL. Defaults to $env:NEXT_PUBLIC_API_URL or http://localhost:8080.

.PARAMETER TokenLabel
  Configured token label to stake in (must exist in the backend's TOKENS). Default cBTC.

.PARAMETER StakeAmount
  Stake per RSVP as a decimal string. Default 0.01.

.EXAMPLE
  pwsh ./scripts/seed-event.ps1
  pwsh ./scripts/seed-event.ps1 -ApiUrl http://localhost:8080 -TokenLabel cETH -StakeAmount 0.5
#>
[CmdletBinding()]
param(
  [string]$ApiUrl = $(if ($env:NEXT_PUBLIC_API_URL) { $env:NEXT_PUBLIC_API_URL } else { "http://localhost:8080" }),
  [string]$TokenLabel = "cBTC",
  [string]$StakeAmount = "0.01",
  [string]$OrganizerEmail = "organizer@showorsow.dev",
  [string[]]$Attendees = @("alice@showorsow.dev", "bob@showorsow.dev", "charlie@showorsow.dev"),
  [int]$RsvpDeadlineHours = 24,
  [int]$EventEndHours = 48
)

$ErrorActionPreference = "Stop"
$ApiUrl = $ApiUrl.TrimEnd("/")

# Shared web session so the signed session cookie carries across calls.
$session = New-Object Microsoft.PowerShell.Commands.WebRequestSession

function Invoke-Api {
  param(
    [Parameter(Mandatory)] [string]$Method,
    [Parameter(Mandatory)] [string]$Path,
    [object]$Body
  )
  $uri = "$ApiUrl$Path"
  $params = @{
    Method      = $Method
    Uri         = $uri
    WebSession  = $session
    ContentType = "application/json"
  }
  if ($null -ne $Body) {
    $params.Body = ($Body | ConvertTo-Json -Depth 10 -Compress)
  }
  try {
    return Invoke-RestMethod @params
  }
  catch {
    $resp = $_.Exception.Response
    $detail = ""
    if ($resp) {
      try {
        $reader = New-Object System.IO.StreamReader($resp.GetResponseStream())
        $detail = $reader.ReadToEnd()
      } catch {}
    }
    throw "API $Method $Path failed: $($_.Exception.Message) $detail"
  }
}

Write-Host "==> ShowOrSow seed against $ApiUrl" -ForegroundColor Cyan

# 1) Log in as the seeded organizer via dev quick-login (real-accounts auth,
#    pivot Jul 11 — replaces the old persona session). Requires DEV_QUICK_LOGIN=true
#    and SEED_DEMO_USERS having seeded organizer@showorsow.dev. Sets the signed
#    session cookie on $session.
Write-Host "  - POST /api/auth/dev-login ($OrganizerEmail)"
$sess = Invoke-Api -Method POST -Path "/api/auth/dev-login" -Body @{ email = $OrganizerEmail }
Write-Host "    organizer party: $($sess.user.partyId)"

# 2) Create the event. Backend mints eventId and derives settleBefore.
$now = [DateTimeOffset]::UtcNow
$rsvpDeadline = $now.AddHours($RsvpDeadlineHours).ToString("yyyy-MM-ddTHH:mm:ssZ")
$eventEnd     = $now.AddHours($EventEndHours).ToString("yyyy-MM-ddTHH:mm:ssZ")

$eventBody = @{
  title        = "Canton Meetup"
  description  = "Stake to RSVP, show up to get it back — ghosts pay the room. Privacy-preserving escrow on Canton."
  venue        = "DA HQ, San Francisco"
  imageUrl     = ""
  stakeAmount  = $StakeAmount
  tokenLabel   = $TokenLabel
  rsvpDeadline = $rsvpDeadline
  eventEnd     = $eventEnd
}
Write-Host "  - POST /api/events ('Canton Meetup', $StakeAmount $TokenLabel)"
$created = Invoke-Api -Method POST -Path "/api/events" -Body $eventBody
$eventId = $created.eventId
Write-Host "    eventId: $eventId" -ForegroundColor Green

# 3) Invite each attendee by email (organizer session). The invitee must already
#    have an account — seeded demo accounts satisfy this (SEED_DEMO_USERS).
foreach ($a in $Attendees) {
  Write-Host "  - POST /api/events/$eventId/invites ($a)"
  $inv = Invoke-Api -Method POST -Path "/api/events/$eventId/invites" -Body @{ email = $a }
  Write-Host "    invited $a -> status=$($inv.status) inviteCid=$($inv.inviteCid)"
}

Write-Host ""
Write-Host "==> Seed complete." -ForegroundColor Cyan
Write-Host "    Event detail: $ApiUrl/api/events/$eventId"
Write-Host "    Web UI:       $($env:NEXT_PUBLIC_API_URL) /events/$eventId"
Write-Host "    eventId=$eventId"

# Emit the eventId as the last line for scripting/capture.
$eventId
