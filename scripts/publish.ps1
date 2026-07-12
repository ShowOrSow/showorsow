<#
.SYNOPSIS
  Publish the ShowOrSow monorepo to github.com/ShowOrSow/showorsow.

.DESCRIPTION
  The local workspace carries private planning material (plan/, .claude/,
  docs/) on its own git history. This script syncs ONLY the project folders
  into a clone of the public repo and pushes a commit, keeping the two
  histories fully separate.

.PARAMETER Message
  Commit message for the publish commit.

.EXAMPLE
  pwsh scripts/publish.ps1 -Message "indexer: fix poll fallback interface ids"
#>
param(
  [Parameter(Mandatory = $true)][string]$Message
)

$ErrorActionPreference = 'Stop'
$repoUrl = 'https://github.com/ShowOrSow/showorsow.git'
$src = Split-Path -Parent $PSScriptRoot   # repo root (scripts/..)
$work = Join-Path $env:TEMP 'showorsow-publish'

if (-not (Test-Path (Join-Path $work '.git'))) {
  git clone $repoUrl $work
  if ($LASTEXITCODE -ne 0) { throw "clone failed" }
} else {
  git -C $work pull --ff-only
  if ($LASTEXITCODE -ne 0) { throw "pull failed" }
}

$folders = @('daml', 'daml-test', 'daml-demo', 'backend', 'indexer', 'web', 'scripts')
foreach ($f in $folders) {
  # /MIR mirrors (incl. deletions); exclude build junk and secrets.
  robocopy (Join-Path $src $f) (Join-Path $work $f) /MIR /NFL /NDL /NJH /NJS `
    /XD node_modules .next dist .daml /XF .env | Out-Null
  if ($LASTEXITCODE -ge 8) { throw "robocopy failed for $f (code $LASTEXITCODE)" }
}
foreach ($f in @('README.md', 'LICENSE', '.gitignore', '.env.example')) {
  Copy-Item (Join-Path $src $f) (Join-Path $work $f) -Force
}

git -C $work add -A
git -C $work diff --cached --quiet
if ($LASTEXITCODE -eq 0) {
  Write-Host 'Nothing to publish - public repo already up to date.'
  exit 0
}
git -C $work commit -m $Message
if ($LASTEXITCODE -ne 0) { throw "commit failed" }
git -C $work push
if ($LASTEXITCODE -ne 0) { throw "push failed" }
Write-Host "Published to $repoUrl"
