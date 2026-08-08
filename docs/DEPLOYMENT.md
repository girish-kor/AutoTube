# DEPLOYMENT

## 1. Zero-Cost Hosting Options

| Option | Spec | Cost | Notes |
|---|---|---|---|
| **Recommended: Oracle Cloud "Always Free" ARM VM** | 4 OCPU Ampere A1, 24GB RAM, 200GB block storage | $0 forever (not a trial) | Sufficient for n8n + Postgres + media-worker (Whisper/FFmpeg are the heaviest CPU consumers; 4 ARM cores handle `MAX_CONCURRENT_VIDEOS=3` comfortably) |
| Operator's own always-on PC | Any modern CPU, Docker Desktop | $0 (uses existing hardware/electricity) | Requires the machine to stay on 24/7 for cron schedules to fire; use Windows Task Scheduler-based wake or simply leave it running |
| Other free-tier VMs (e.g., Google Cloud free tier e2-micro) | Lower spec | $0 | Viable at reduced `MAX_CONCURRENT_VIDEOS=1`; faster-whisper `WHISPER_MODEL_SIZE=base` to reduce CPU load |

This doc assumes a single Docker host reachable via SSH, with Docker + Docker Compose installed.

## 2. Docker Compose Stack

```yaml
# docker-compose.yml
version: "3.9"

services:
  postgres:
    image: postgres:16-alpine
    restart: unless-stopped
    environment:
      POSTGRES_USER: ${POSTGRES_USER}
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
      POSTGRES_MULTIPLE_DATABASES: n8n,autotube   # init script creates both DBs
    volumes:
      - postgres_data:/var/lib/postgresql/data
      - ./db/init:/docker-entrypoint-initdb.d
    expose:
      - "5432"

  migrate:
    build: ./db
    depends_on:
      - postgres
    environment:
      POSTGRES_HOST: postgres
      POSTGRES_DB: ${POSTGRES_DB_AUTOTUBE}
      POSTGRES_USER: ${POSTGRES_USER}
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
    command: ["./run-migrations.sh"]
    restart: "no"

  media-worker:
    build: ./media-worker
    restart: unless-stopped
    environment:
      MEDIA_ROOT: /data/autotube
      WHISPER_MODEL_SIZE: ${WHISPER_MODEL_SIZE}
      TTS_DEFAULT_VOICE: ${TTS_DEFAULT_VOICE}
    volumes:
      - media_data:/data/autotube
    expose:
      - "8000"

  n8n:
    image: n8nio/n8n:latest
    restart: unless-stopped
    depends_on:
      - postgres
      - migrate
      - media-worker
    environment:
      DB_TYPE: postgresdb
      DB_POSTGRESDB_HOST: postgres
      DB_POSTGRESDB_DATABASE: ${POSTGRES_DB_N8N}
      DB_POSTGRESDB_USER: ${POSTGRES_USER}
      DB_POSTGRESDB_PASSWORD: ${POSTGRES_PASSWORD}
      N8N_ENCRYPTION_KEY: ${N8N_ENCRYPTION_KEY}
      N8N_BASIC_AUTH_ACTIVE: "true"
      N8N_BASIC_AUTH_USER: ${N8N_BASIC_AUTH_USER}
      N8N_BASIC_AUTH_PASSWORD: ${N8N_BASIC_AUTH_PASSWORD}
      N8N_HOST: ${N8N_HOST}
      N8N_PORT: "5678"
      N8N_PROTOCOL: ${N8N_PROTOCOL}
      WEBHOOK_URL: ${WEBHOOK_URL}
      GENERIC_TIMEZONE: ${GENERIC_TIMEZONE}
      EXECUTIONS_DATA_PRUNE: "true"
      EXECUTIONS_DATA_MAX_AGE: "336"
    volumes:
      - n8n_data:/home/node/.n8n
      - media_data:/data/autotube        # shared mount, same paths as media-worker
    expose:
      - "5678"

  caddy:
    image: caddy:2-alpine
    restart: unless-stopped
    depends_on:
      - n8n
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile
      - caddy_data:/data
    environment:
      DOMAIN: ${N8N_HOST}

volumes:
  postgres_data:
  n8n_data:
  media_data:
  caddy_data:
```

`Caddyfile` (automatic free Let's Encrypt TLS, required since OAuth redirect URIs must be HTTPS):
```
{$DOMAIN} {
    reverse_proxy n8n:5678
}
```

Note: `postgres`, `media-worker`, `n8n` deliberately use `expose:` (internal Docker network only), not `ports:` — only `caddy` publishes 80/443 (`SECURITY.md` §3).

## 3. `media-worker` Image

`media-worker/Dockerfile` — Python 3.12-slim base + `ffmpeg` (apt), `faster-whisper`, `edge-tts`, `Pillow`, `auto-editor`, `fastapi`, `uvicorn` (all free/OSS pip packages, no license cost). Endpoints match `N8N_NODES.md` calls: `/tts`, `/image`, `/render`, `/caption`, `/thumbnail`, `/clip`, `/compliance-scan`.

## 4. First-Run Bootstrap (one-time, manual)

1. `cp .env.example .env`, fill in all values (`CONFIG.md`).
2. `docker compose up -d postgres` → wait healthy → `docker compose up migrate` (applies `DATABASE.md` DDL) → `docker compose up -d` (rest of stack).
3. Confirm `https://<domain>` reaches n8n's setup screen (Caddy auto-provisions TLS on first request — requires the domain's DNS A record already pointed at the host).
4. Complete n8n's first-owner-account setup.
5. In Google Cloud Console: create OAuth client, enable YouTube Data v3 + Analytics APIs (`YOUTUBE_API.md` §1).
6. In n8n UI: create all 7 credentials listed in `CONFIG.md` §2, authorizing each OAuth flow interactively (this is the one class of unavoidable manual action, done once per channel/integration — `README.md`).
7. Seed `channels` table with the initial channel row (`DATABASE.md` §1) via a one-off SQL insert or a small n8n "setup" workflow.
8. Seed `config` table defaults (`db/migrations/0001_seed_config.sql`, applied automatically by step 2's migration).
9. Import all workflow JSON files from `n8n/workflows/*.json` via n8n UI ("Import from File") or `n8n import:workflow` CLI, then **activate** each (toggling a workflow active registers its Cron/Execute-Workflow-Trigger).
10. Set n8n's global Error Workflow (Settings → Workflows → "Error Workflow") to `E1-Error-Handler`.
11. Trigger a manual test run of `01-Trend-Discovery` from the n8n UI to confirm the full chain fires correctly end-to-end (cross-check against `TESTING.md` §9 manual QA checklist).

## 5. Updates / Redeploy

`git pull` → `docker compose build media-worker` (only rebuilds if `media-worker/` changed) → `docker compose up -d` (recreates changed containers only, Postgres/n8n data volumes persist). Workflow JSON changes are re-imported via n8n UI/CLI; n8n itself does not require a rebuild for workflow-only changes.

## 6. Rollback

Docker volumes (`postgres_data`, `n8n_data`, `media_data`) persist across `docker compose down`/`up` — a bad deploy is rolled back via `git checkout <previous-tag>` + `docker compose up -d --build`, with no data loss since state lives in the named volumes, not in the containers themselves.
