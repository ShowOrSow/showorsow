#requires -Version 5.1
<#
.SYNOPSIS
  Fetch/build the six CIP-56 token-standard interface DARs that ShowOrSow's Daml
  packages data-depend on, into daml/lib/ (and, if present, daml-test/lib/).

.DESCRIPTION
  The six packages live in the Splice monorepo under `token-standard/`:
    splice-api-token-metadata-v1
    splice-api-token-holding-v1
    splice-api-token-transfer-instruction-v1
    splice-api-token-allocation-v1
    splice-api-token-allocation-request-v1
    splice-api-token-allocation-instruction-v1

  SOURCE OF TRUTH (verified live): https://github.com/hyperledger-labs/splice
  (docs also link to the mirror github.com/canton-network/splice). Each package is a
  self-contained Daml project (its own daml.yaml) under token-standard/<pkg>/.

  There is NO official public "download the .dar" endpoint for these interface
  packages — they are distributed as source and built with the Daml SDK / dpm, OR
  they ship inside a Splice release bundle. This script therefore supports two modes:

    MODE B ("extract") — RECOMMENDED / most reliable: if you already have a Splice
      release / LocalNet bundle that contains the prebuilt DARs, point -BundleDir at it
      and this script copies the six DARs out by filename match — no build, no dpm needed.
      This avoids the offline-unverifiable assumption that each token-standard package
      builds standalone with `dpm build` under sibling relative data-dependency paths
      (the splice repo's own daml.yaml files may reference DARs produced by its build
      system, in which case per-directory `dpm build` fails).

    MODE A (default flag, "build"): clone the splice repo at a pinned ref and build each
      package's DAR with `dpm build`, then copy the resulting DAR into daml/lib/.
      Requires `dpm` (Daml SDK 3.4.11) and `git` on PATH. If `dpm build` fails, retry with
      -Mode extract against a prebuilt bundle (see the hint emitted on failure).

  The DAR filenames produced by dpm are `<name>-<version>.dar` (e.g.
  splice-api-token-allocation-v1-1.0.0.dar). This script normalizes each copied file
  to the versionless name referenced in daml/daml.yaml
  (e.g. splice-api-token-allocation-v1.dar). If you prefer to keep the versioned
  filenames, update the data-dependencies in daml/daml.yaml and daml-test/daml.yaml
  to match and pass -KeepVersionedNames.

.PARAMETER Mode
  "build" (default) or "extract".

.PARAMETER Ref
  Git ref (branch/tag/commit) of hyperledger-labs/splice to pin. Default "main".
  PIN THIS to a real tag before a demo — `main` moves. DevNet package versions must
  match what is deployed (plan/02-architecture.md §2 notes DevNet resets ~quarterly).

.PARAMETER BundleDir
  (extract mode) Directory tree to search for prebuilt token-standard DARs.

.PARAMETER KeepVersionedNames
  Copy DARs under their dpm-produced `<name>-<version>.dar` names instead of the
  versionless names. If set you MUST edit the daml.yaml data-dependencies to match.

.EXAMPLE
  pwsh scripts/fetch-dars.ps1                     # build mode, main
  pwsh scripts/fetch-dars.ps1 -Ref v0.4.9         # build a pinned tag
  pwsh scripts/fetch-dars.ps1 -Mode extract -BundleDir C:\splice-localnet
#>
[CmdletBinding()]
param(
  [ValidateSet("build", "extract")]
  [string]$Mode = "build",
  [string]$Ref = "main",
  [string]$BundleDir,
  [switch]$KeepVersionedNames
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

# Repo layout: this script lives in scripts/, so the repo root is one level up.
$RepoRoot = Split-Path -Parent $PSScriptRoot
$LibDir   = Join-Path $RepoRoot "daml\lib"
$TestLibDir = Join-Path $RepoRoot "daml-test\lib"

# The six packages, in dependency order (metadata has no deps; the rest layer on it).
$Packages = @(
  "splice-api-token-metadata-v1",
  "splice-api-token-holding-v1",
  "splice-api-token-transfer-instruction-v1",
  "splice-api-token-allocation-v1",
  "splice-api-token-allocation-request-v1",
  "splice-api-token-allocation-instruction-v1"
)

New-Item -ItemType Directory -Force -Path $LibDir | Out-Null

function Copy-Dar {
  param([string]$SrcDar, [string]$PkgName)
  $destName = if ($KeepVersionedNames) { Split-Path -Leaf $SrcDar } else { "$PkgName.dar" }
  $dest = Join-Path $LibDir $destName
  Copy-Item -Path $SrcDar -Destination $dest -Force
  Write-Host "  -> $dest"
  # Mirror into daml-test/lib if that directory is used by daml-test/daml.yaml.
  if (Test-Path $TestLibDir) {
    Copy-Item -Path $SrcDar -Destination (Join-Path $TestLibDir $destName) -Force
  }
}

if ($Mode -eq "extract") {
  if (-not $BundleDir -or -not (Test-Path $BundleDir)) {
    throw "extract mode requires -BundleDir pointing at a directory containing the prebuilt DARs."
  }
  Write-Host "Extract mode: searching $BundleDir for token-standard DARs..."
  foreach ($pkg in $Packages) {
    # Match `<pkg>-<version>.dar` (any version) or the exact versionless name.
    $candidate = Get-ChildItem -Path $BundleDir -Recurse -Filter "$pkg*.dar" -ErrorAction SilentlyContinue |
      Sort-Object Name | Select-Object -First 1
    if (-not $candidate) { throw "Could not find a DAR for '$pkg' under $BundleDir" }
    Write-Host "Found $pkg : $($candidate.FullName)"
    Copy-Dar -SrcDar $candidate.FullName -PkgName $pkg
  }
  Write-Host "Done (extract). DARs are in $LibDir"
  return
}

# ---- MODE A: build from source ----
foreach ($tool in @("git", "dpm")) {
  if (-not (Get-Command $tool -ErrorAction SilentlyContinue)) {
    throw "build mode needs '$tool' on PATH. Install it, or use -Mode extract with a prebuilt bundle."
  }
}

$WorkDir = Join-Path $env:TEMP "showorsow-splice-$([guid]::NewGuid().ToString('N').Substring(0,8))"
Write-Host "Cloning hyperledger-labs/splice@$Ref (shallow) into $WorkDir ..."
git clone --depth 1 --branch $Ref https://github.com/hyperledger-labs/splice.git $WorkDir
if ($LASTEXITCODE -ne 0) {
  # --branch fails for a bare commit sha; fall back to full clone + checkout.
  Write-Host "Shallow branch clone failed; doing full clone + checkout $Ref ..."
  Remove-Item -Recurse -Force $WorkDir -ErrorAction SilentlyContinue
  git clone https://github.com/hyperledger-labs/splice.git $WorkDir
  if ($LASTEXITCODE -ne 0) { throw "git clone failed" }
  Push-Location $WorkDir
  git checkout $Ref
  if ($LASTEXITCODE -ne 0) { Pop-Location; throw "git checkout $Ref failed" }
  Pop-Location
}

$TokenStd = Join-Path $WorkDir "token-standard"
if (-not (Test-Path $TokenStd)) { throw "token-standard/ not found in clone — repo layout changed?" }

foreach ($pkg in $Packages) {
  $pkgDir = Join-Path $TokenStd $pkg
  if (-not (Test-Path (Join-Path $pkgDir "daml.yaml"))) {
    throw "Package project not found: $pkgDir (expected a daml.yaml). Repo layout may have changed."
  }
  Write-Host "Building $pkg ..."
  Push-Location $pkgDir
  try {
    dpm build
    if ($LASTEXITCODE -ne 0) {
      Write-Host "HINT: per-directory 'dpm build' of the splice token-standard packages is"
      Write-Host "      not always self-contained. Retry with the reliable extract mode:"
      Write-Host "      pwsh scripts/fetch-dars.ps1 -Mode extract -BundleDir <splice-localnet-or-release-dir>"
      throw "dpm build failed for $pkg"
    }
    $dar = Get-ChildItem -Path (Join-Path $pkgDir ".daml\dist") -Filter "*.dar" |
      Sort-Object LastWriteTime -Descending | Select-Object -First 1
    if (-not $dar) { throw "No DAR produced for $pkg under .daml/dist" }
    Copy-Dar -SrcDar $dar.FullName -PkgName $pkg
  } finally {
    Pop-Location
  }
}

Write-Host ""
Write-Host "Done (build). Six DARs are in $LibDir"
Write-Host "Pinned ref: $Ref  (edit -Ref / pin a tag before a demo; DevNet package versions must match)."
Write-Host "Clone left at $WorkDir — delete it when finished: Remove-Item -Recurse -Force '$WorkDir'"
