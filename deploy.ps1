<#
.SYNOPSIS
    Ship this working tree to activities.ynafs.com and restart the server.

.DESCRIPTION
    One command, start to finish:

      1. sanity-checks the local tree (refuses to ship something missing the
         entry point)
      2. tars it up, minus the things that must not travel - .env, .git,
         node_modules, and the runtime state directories
      3. uploads over SSH with a key, so nothing prompts for a password
      4. on the server: backs up the live tree, unpacks the new one *beside* it,
         and only swaps them once the new one looks complete
      5. restarts via ~/bin/edu-run.sh and verifies /api/health and
         /api/pipeline/health before declaring success

    Runtime state - page cache, answer keys, submitted results - lives in
    ~/var/pipeline-* on the server, outside the deployed tree, so a deploy
    cannot destroy it. If any of it is still sitting inside the app directory,
    the remote step carries it across the swap rather than losing it.

    Nothing is written to the server's ~/config/edu.env. The environment is
    server-side state and deliberately not part of a code deploy; edit it by
    hand when a variable needs to change.

.EXAMPLE
    .\deploy.ps1
    Deploy and restart.

.EXAMPLE
    .\deploy.ps1 -DryRun
    Build the archive and list what would ship. Touches nothing remote.
#>

[CmdletBinding()]
param(
    [string] $ServerHost  = '65.109.31.94',
    [string] $User        = 'ynafs-activities',
    [string] $AppPath     = '/home/ynafs-activities/htdocs/activities.ynafs.com',
    [string] $KeyPath     = "$env:USERPROFILE\.ssh\ynafs-activities-deploy",
    [string] $SiteUrl     = 'https://activities.ynafs.com',
    [int]    $KeepBackups = 5,
    # The site sits behind Cloudflare, which caches assets for four hours. Set
    # both of these (as parameters or as CF_ZONE_ID / CF_API_TOKEN in the
    # environment) and the deploy purges the edge; leave them empty and it tells
    # you to purge by hand instead.
    [string] $CloudflareZoneId = $env:CF_ZONE_ID,
    [string] $CloudflareToken  = $env:CF_API_TOKEN,
    [switch] $DryRun
)

$ErrorActionPreference = 'Stop'

# Paths that must never end up in the archive. The first group is local noise,
# the second is server state that happens to have a slot in the tree.
$Excludes = @(
    '.env'
    '.git'
    'node_modules'
    '.vscode'
    'deploy.ps1'
    'playground-1.mongodb.js'
    'Thumbs.db'
    '.DS_Store'
    'data/assignments'
    'data/output'
    'data/cache'
)

# Files whose absence means the tree is not shippable - a truncated copy, or the
# wrong directory. Checked before anything remote happens.
$MustExist = @(
    'server/server.mjs'
    'server/render-page.mjs'
    'package.json'
    'index.html'
    'config.js'
)

function Write-Step { param([string] $Text) Write-Host "`n==> $Text" -ForegroundColor Cyan }
function Write-Ok   { param([string] $Text) Write-Host "    $Text" -ForegroundColor Green }
function Write-Warn { param([string] $Text) Write-Host "    $Text" -ForegroundColor Yellow }

function Assert-ExitCode {
    param([string] $What)
    if ($LASTEXITCODE -ne 0) { throw "$What failed (exit $LASTEXITCODE)" }
}

$Root = $PSScriptRoot
if (-not $Root) { $Root = (Get-Location).Path }
$Target  = "$User@$ServerHost"
$SshArgs = @('-i', $KeyPath, '-o', 'IdentitiesOnly=yes', '-o', 'StrictHostKeyChecking=accept-new', '-o', 'ConnectTimeout=20')

Write-Host 'Edu-Template-Generator deploy' -ForegroundColor White
Write-Host "  from  $Root"
Write-Host "  to    ${Target}:$AppPath"

# ---------------------------------------------------------------- preflight --
Write-Step 'Checking the local tree'

$missing = @()
foreach ($f in $MustExist) {
    if (-not (Test-Path (Join-Path $Root $f))) { $missing += $f }
}
if ($missing.Count -gt 0) {
    throw "Not shipping: missing $($missing -join ', '). Is $Root the project root?"
}
Write-Ok "$($MustExist.Count) key files present"

if (-not (Test-Path $KeyPath)) {
    throw "No deploy key at $KeyPath. Create one with ssh-keygen -t ed25519 -f '$KeyPath' -N '' and append the .pub line to ~/.ssh/authorized_keys on the server."
}

# ------------------------------------------------------------------ package --
Write-Step 'Packing the tree'

$stamp   = Get-Date -Format 'yyyyMMdd-HHmmss'
$payload = Join-Path $env:TEMP "edu-app-$stamp.tar.gz"
$remoteS = Join-Path $env:TEMP "edu-deploy-$stamp.sh"

# tar matches --exclude against the stored path, which is ./-prefixed, so each
# name is offered in every shape it can appear in.
$tarArgs = @('-czf', $payload)
foreach ($e in $Excludes) {
    $tarArgs += "--exclude=./$e"
    $tarArgs += "--exclude=./$e/*"
    $tarArgs += "--exclude=*/$e"
    $tarArgs += "--exclude=*/$e/*"
}
$tarArgs += @('-C', $Root, '.')

& tar.exe @tarArgs
Assert-ExitCode 'tar'

$entries = & tar.exe -tzf $payload
Assert-ExitCode 'tar --list'
$files  = @($entries | Where-Object { $_ -notmatch '/$' })
$sizeMb = [math]::Round((Get-Item $payload).Length / 1MB, 2)
Write-Ok "$($files.Count) files, $sizeMb MB"

# A leaked .env or a stray assignments directory is worth failing over rather
# than warning about - either one would overwrite live server state.
$leaks = @($entries | Where-Object {
    $_ -match '(^|/)\.env$' -or $_ -match 'data/(assignments|output|cache)(/|$)'
})
if ($leaks.Count -gt 0) {
    Remove-Item $payload -Force
    throw "Archive contains files that must not ship:`n  $($leaks -join "`n  ")"
}
Write-Ok 'no .env or runtime state in the archive'

if ($DryRun) {
    Write-Step 'Dry run - nothing was uploaded'
    $files | Sort-Object
    Write-Host "`nArchive left at $payload" -ForegroundColor Yellow
    return
}

# ------------------------------------------------------- remote deploy step --
# Written to a file and executed there, rather than passed as an inline ssh
# command, so PowerShell's native-argument quoting never gets a say in it.
$remoteScript = @'
#!/usr/bin/env bash
set -euo pipefail

H="$HOME"
APP="__APP__"
KEEP=__KEEP__
PAY="$H/tmp/edu-app.tar.gz"
TS=$(date +%Y%m%d-%H%M%S)

[ -f "$PAY" ] || { echo "payload $PAY is missing"; exit 1; }

echo "--- backing up the live tree"
mkdir -p "$H/backups"
tar -czf "$H/backups/edu-app-$TS.tar.gz" -C "$(dirname "$APP")" "$(basename "$APP")"
if [ -f "$H/config/edu.env" ]; then cp -a "$H/config/edu.env" "$H/backups/edu.env-$TS"; fi
echo "    $H/backups/edu-app-$TS.tar.gz"

echo "--- unpacking beside the live tree"
rm -rf "$APP.new"
mkdir -p "$APP.new"
tar -xzf "$PAY" -C "$APP.new"

# The swap is the only destructive moment, so everything that could make the new
# tree unusable is checked before it, not after.
for f in server/server.mjs server/render-page.mjs package.json index.html config.js; do
  [ -f "$APP.new/$f" ] || { echo "staged tree has no $f - not swapping"; rm -rf "$APP.new"; exit 1; }
done

# Runtime state normally lives in ~/var (see config/edu.env). If a previous
# configuration left any inside the app directory, carry it over: losing an
# issued answer key or a submitted result is not a recoverable mistake.
for d in data/assignments data/output data/cache; do
  if [ -d "$APP/$d" ] && [ -n "$(ls -A "$APP/$d" 2>/dev/null)" ]; then
    echo "--- carrying over $d (it holds state and sits inside the app directory)"
    mkdir -p "$APP.new/$(dirname "$d")"
    cp -a "$APP/$d" "$APP.new/$(dirname "$d")/"
  fi
done

echo "--- swapping"
rm -rf "$APP.old"
mv "$APP" "$APP.old"
mv "$APP.new" "$APP"
rm -rf "$APP.old"
rm -f "$PAY"

# Keep the archive shelf from growing without bound.
ls -1t "$H"/backups/edu-app-*.tar.gz 2>/dev/null | tail -n +$((KEEP + 1)) | xargs -r rm -f
ls -1t "$H"/backups/edu.env-* 2>/dev/null | tail -n +$((KEEP + 1)) | xargs -r rm -f

echo "--- restarting"
"$H/bin/edu-run.sh"

PORT=$(grep -E '^PORT=' "$H/config/edu.env" 2>/dev/null | head -1 | cut -d= -f2)
PORT=${PORT:-2026}
KEY=$(grep -E '^EDU_API_KEY=' "$H/config/edu.env" 2>/dev/null | head -1 | cut -d= -f2-)

echo "--- verifying"
ok=0
for i in 1 2 3 4 5 6 7 8 9 10; do
  if curl -fsS "http://127.0.0.1:$PORT/api/health" > "/tmp/edu-health.$$" 2>/dev/null; then ok=1; break; fi
  sleep 1
done
if [ "$ok" != 1 ]; then
  echo "the server did not answer /api/health - last log lines:"
  tail -30 "$H/logs/edu/app.log"
  exit 1
fi

echo "    /api/health:"
sed 's/^/      /' "/tmp/edu-health.$$"
echo
rm -f "/tmp/edu-health.$$"

# Two things have to be true, and they fail for different reasons: the lessons
# database must be readable (the generator's `ai`), and the results database
# must be writable (`activities`) - a user with `read` where `readWrite` was
# meant passes the first and fails the second.
if [ -n "$KEY" ]; then
  health=$(curl -fsS -H "X-Api-Key: $KEY" "http://127.0.0.1:$PORT/api/pipeline/health" 2>/dev/null | tr -d ' \n' || true)
  lessons=$(echo "$health" | grep -o '"lessons":{"ok":[a-z]*' | cut -d: -f3)
  write=$(echo "$health" | grep -o '"canWrite":[a-z]*' | cut -d: -f2)
  if [ "$lessons" = "true" ] && [ "$write" = "true" ]; then
    echo "    /api/pipeline/health: lessons readable, results database writable"
  else
    echo "    /api/pipeline/health: lessons=${lessons:-?} canWrite=${write:-?} - check EDU_PIPELINE_MONGO_URI in ~/config/edu.env"
  fi
fi

# A warning here means a directory the app writes to sits inside the served site
# root, where its files are fetchable as plain URLs.
if grep -qi 'site root' "$H/logs/edu/app.log" 2>/dev/null; then
  echo "    NOTE: the server logged a site-root warning - see ~/logs/edu/app.log"
fi

echo "DEPLOY_OK"
'@

$remoteScript = $remoteScript.Replace('__APP__', $AppPath).Replace('__KEEP__', $KeepBackups.ToString())
# LF only, no BOM: bash will not run a script with CRLF line endings.
[System.IO.File]::WriteAllText($remoteS, ($remoteScript -replace "`r`n", "`n"), (New-Object System.Text.UTF8Encoding $false))

# ------------------------------------------------------------------- upload --
Write-Step "Uploading to $Target"

& scp.exe @SshArgs $payload "${Target}:/home/$User/tmp/edu-app.tar.gz"
Assert-ExitCode 'scp (payload)'
& scp.exe @SshArgs $remoteS "${Target}:/home/$User/tmp/edu-deploy.sh"
Assert-ExitCode 'scp (deploy script)'
Write-Ok "$sizeMb MB uploaded"

# ------------------------------------------------------------------- deploy --
Write-Step 'Deploying'

$remoteCmd = "bash /home/$User/tmp/edu-deploy.sh; rc=`$?; rm -f /home/$User/tmp/edu-deploy.sh; exit `$rc"
& ssh.exe @SshArgs $Target $remoteCmd
$deployCode = $LASTEXITCODE

Remove-Item $payload, $remoteS -Force -ErrorAction SilentlyContinue

if ($deployCode -ne 0) {
    $appParent = $AppPath.Substring(0, $AppPath.LastIndexOf('/'))
    Write-Host "`nDEPLOY FAILED (exit $deployCode)." -ForegroundColor Red
    Write-Host 'The live tree was backed up before the swap. To roll back:' -ForegroundColor Red
    Write-Host "  ssh -i `"$KeyPath`" $Target" -ForegroundColor Red
    Write-Host '  B=$(ls -1t ~/backups/edu-app-*.tar.gz | head -1)' -ForegroundColor Red
    Write-Host "  rm -rf $AppPath" -ForegroundColor Red
    Write-Host "  tar -xzf `$B -C $appParent" -ForegroundColor Red
    Write-Host '  ~/bin/edu-run.sh' -ForegroundColor Red
    exit 1
}

# ------------------------------------------------------------- edge purge ----
# Without this the server is updated but visitors keep getting the old CSS and
# JS from Cloudflare for up to max-age (four hours), which looks exactly like a
# failed deploy.
Write-Step 'Purging the Cloudflare cache'

if ($CloudflareZoneId -and $CloudflareToken) {
    try {
        $resp = Invoke-RestMethod -Method Post `
            -Uri "https://api.cloudflare.com/client/v4/zones/$CloudflareZoneId/purge_cache" `
            -Headers @{ Authorization = "Bearer $CloudflareToken" } `
            -ContentType 'application/json' `
            -Body '{"purge_everything":true}' `
            -TimeoutSec 30
        if ($resp.success) {
            Write-Ok 'edge cache purged'
        } else {
            Write-Warn "Cloudflare refused the purge: $($resp.errors | ConvertTo-Json -Compress)"
        }
    } catch {
        Write-Warn "Could not reach the Cloudflare API: $($_.Exception.Message)"
    }
} else {
    Write-Warn 'Not configured - the edge still holds the old files for up to 4 hours.'
    Write-Warn 'Purge at dash.cloudflare.com -> ynafs.com -> Caching -> Configuration -> Purge Everything,'
    Write-Warn 'or set CF_ZONE_ID and CF_API_TOKEN once and this script will do it for you.'
}

# ------------------------------------------------------------- public check --
Write-Step 'Checking the public site'

try {
    # Cache-busted, so a stale edge copy cannot make a bad deploy look good.
    $bust   = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
    $r      = Invoke-WebRequest -Uri "$SiteUrl/api/health?_=$bust" -UseBasicParsing -TimeoutSec 25
    $health = $r.Content | ConvertFrom-Json
    Write-Ok "$SiteUrl -> HTTP $($r.StatusCode), v$($health.version), $($health.templates.Count) templates"
    Write-Host "    templates: $($health.templates -join ', ')"
} catch {
    Write-Warn "$SiteUrl did not answer: $($_.Exception.Message)"
    Write-Warn 'The server is healthy on 127.0.0.1, so this points at nginx or DNS rather than the app.'
    exit 1
}

Write-Host "`nDone." -ForegroundColor Green
