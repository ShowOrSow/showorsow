# deploy/

VPS deployment assets for ShowOrSow. Full runbook: **[plan/13-deployment.md](../plan/13-deployment.md)** (kept private) — this folder is what runs on the box.

| File | Role |
|---|---|
| `Caddyfile` | TLS reverse proxy → Go backend (`:8080`). Edit the domain. |
| `showorsow-backend.service` | systemd unit — the Go backend binary. |
| `showorsow-indexer.service` | systemd unit — the Node indexer (`dist/main.js`). |
| `deploy.sh` | Pull public repo → build backend + indexer → migrate Neon → restart. Idempotent. |

## TL;DR

```bash
# one-time: create the showorsow user, install Go/Node+pnpm/Caddy, copy the
# units to /etc/systemd/system, put a filled .env at /opt/showorsow/.env
cp ../.env.production.example /opt/showorsow/.env   # then edit real values
sudo systemctl daemon-reload && sudo systemctl enable showorsow-backend showorsow-indexer

# every deploy
sudo -u showorsow /opt/showorsow/repo/deploy/deploy.sh
```

The web front end deploys separately on **Vercel** (Root Directory `web`, env `API_ORIGIN=https://api.<domain>`); the browser calls same-origin `/api/*` which Vercel rewrites to this VPS, so the session cookie and CORS just work.
