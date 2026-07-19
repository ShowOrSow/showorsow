#!/usr/bin/env bash
# ShowOrSow VPS deploy: pull the public repo, build backend + indexer, run
# migrations, restart services. Idempotent — safe to re-run.
#
# One-time VPS setup (see deploy/README.md) installs Go, Node 22+pnpm, Caddy,
# a `showorsow` user, /opt/showorsow/.env, and the two systemd units.
#
#   sudo -u showorsow /opt/showorsow/deploy.sh
set -euo pipefail

APP=/opt/showorsow
REPO="$APP/repo"
REMOTE="https://github.com/ShowOrSow/showorsow.git"

# 1. sync code
if [ ! -d "$REPO/.git" ]; then
  git clone "$REMOTE" "$REPO"
else
  git -C "$REPO" fetch --quiet origin main
  git -C "$REPO" reset --hard --quiet origin/main
fi

# 2. backend → static binary
echo "building backend…"
( cd "$REPO/backend" && go build -o "$APP/bin/backend" ./cmd/server )

# 3. indexer → dist/
echo "building indexer…"
( cd "$REPO/indexer" && pnpm install --frozen-lockfile && pnpm build )

# 4. DB migrations (idempotent; needs NEON_DATABASE_URL in the env)
echo "running migrations…"
set -a; . "$APP/.env"; set +a
( cd "$REPO/indexer" && pnpm migrate )

# 5. restart
echo "restarting services…"
sudo systemctl restart showorsow-backend showorsow-indexer
sudo systemctl --no-pager status showorsow-backend showorsow-indexer | head -20

echo "done. backend :8080  indexer healthz :8091"
