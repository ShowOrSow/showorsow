#!/usr/bin/env bash
# ShowOrSow — one-shot provisioning after the Canton sandbox starts.
# Wired as ExecStartPost of showorsow-sandbox.service. Idempotent: waits until
# the participant actually accepts writes, uploads both DARs, ensures the
# appOperator party exists, and records its full id to APPFILE for the backend
# .env. Always exits 0 so a transient hiccup never marks the service failed.
#
# NB: /v2/version answers a good ~30s BEFORE the participant can ingest packages
# or allocate parties, so readiness is gated on a real DAR upload returning 200,
# and every write is retried.
set -u

API=http://127.0.0.1:6864
DARS=/opt/showorsow/dars
APPFILE=/opt/showorsow/canton-data/appoperator.party

upload_dar() { # $1=path -> echoes HTTP code
  curl -sS -o /dev/null -w "%{http_code}" -X POST "$API/v2/packages" \
    --data-binary "@$1" -H "Content-Type: application/octet-stream" 2>/dev/null
}
get_appop() { curl -sf "$API/v2/parties" 2>/dev/null | grep -o '"appOperator::[0-9a-f]*"' | head -1 | tr -d '"'; }

echo "[init] waiting for the participant to accept writes..."
ready=0
for i in $(seq 1 60); do
  if curl -sf -o /dev/null "$API/v2/version" 2>/dev/null; then
    if [ "$(upload_dar "$DARS/showorsow-0.1.0.dar")" = "200" ]; then
      echo "[init] participant ready (~$((i*3))s); showorsow DAR uploaded"; ready=1; break
    fi
  fi
  sleep 3
done
[ "$ready" = 1 ] || { echo "[init] participant not ready in time; will retry next boot"; exit 0; }

# Upload every DAR in the dir (idempotent): the app + demo token AND the Splice
# token-standard libs, whose package NAMES the backend/indexer interface filters
# resolve (#splice-api-token-*-v1). Without the standalone libs those queries
# 404 with PACKAGE_NAMES_NOT_FOUND even though the ids are bundled elsewhere.
for f in "$DARS"/*.dar; do
  [ "$f" = "$DARS/showorsow-0.1.0.dar" ] && continue   # already uploaded in the gate
  echo "[init] upload $(basename "$f") -> HTTP $(upload_dar "$f")"
done

party=$(get_appop)
if [ -z "$party" ]; then
  for i in $(seq 1 12); do
    curl -sf -X POST "$API/v2/parties" -H "Content-Type: application/json" \
      -d '{"partyIdHint":"appOperator"}' >/dev/null 2>&1
    party=$(get_appop); [ -n "$party" ] && break; sleep 2
  done
  echo "[init] allocated appOperator=$party"
else
  echo "[init] appOperator already present=$party"
fi
[ -n "$party" ] && printf '%s' "$party" > "$APPFILE"
echo "[init] done (party=$party)"
exit 0
