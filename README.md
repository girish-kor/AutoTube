# ![Favicon](./assets/favicon.png)

> A fully automated, ₹0-recurring-cost pipeline that discovers topics, writes and fact-checks scripts, generates voice/visuals, renders video, and publishes long-form + Shorts to YouTube — unattended, on a schedule.

![status](https://img.shields.io/badge/status-in%20development-yellow) ![license](https://img.shields.io/badge/license-TBD-lightgrey) ![stack](https://img.shields.io/badge/stack-n8n%20%2B%20FastAPI%20%2B%20Postgres-blue)

## Why AutoTube?

Running a consistent YouTube channel end-to-end — research, scripting, voice, editing, thumbnails, SEO, publishing — is a full-time job, and the SaaS tools that automate each step charge recurring fees that don't scale to multiple channels on a hobbyist budget. AutoTube replaces every paid step (stock footage, paid TTS, paid LLM tiers, clipping AI, scheduling SaaS) with a free-tier or self-hosted OSS equivalent, orchestrated so the whole content lifecycle runs unattended after a one-time setup. See `docs/TECH_STACK.md` for the tool ranked #1 per stage and why.

## How it works

- **Orchestrator — [n8n](https://n8n.io):** self-hosted, runs every workflow, schedule, retry, and state transition (`docs/WORKFLOW.md`, `docs/N8N_NODES.md`).
- **Media worker (`media-worker/`):** a Python/FastAPI microservice n8n calls for TTS, image generation, FFmpeg rendering, Whisper captioning, thumbnail compositing, and Shorts clipping.
- **State store:** PostgreSQL — single source of truth for pipeline state (`docs/DATABASE.md`).
- **File store:** local filesystem under `MEDIA_ROOT` (`docs/STORAGE.md`).
- **Reverse proxy:** Caddy, for automatic HTTPS (required for OAuth redirect URIs).

The pipeline: trend discovery → topic selection → research → script → fact-check → voice → visuals → render → captions → thumbnail → SEO → compliance gate → publish → Shorts extraction/publish → cross-post → analytics → optimization. Full spec in `docs/PRD.md` and `docs/CONTENT_PIPELINE.md`.

## Quickstart

Requires Docker + Docker Compose and a host reachable via a domain (for HTTPS/OAuth).

```bash
git clone <this-repo-url>
cd AutoTube
cp .env.example .env      # fill in values — see docs/CONFIG.md

docker compose up -d postgres
docker compose up migrate                # applies DB schema (docs/DATABASE.md)
docker compose up -d                     # starts media-worker, n8n, caddy
```

Then, one-time only:

1. Visit `https://<your-domain>` and complete n8n's first-owner-account setup.
2. Create a Google Cloud OAuth client and enable the YouTube Data v3 + Analytics APIs.
3. In the n8n UI, create the credentials listed in `docs/CONFIG.md` §2 and authorize each OAuth flow.
4. Import the workflows from `n8n/workflows/*.json` and activate each one.
5. Trigger `01-Trend-Discovery` manually from the n8n UI to confirm the pipeline fires end-to-end.

Full walkthrough, including zero-cost hosting recommendations (Oracle Cloud "Always Free" ARM VM): `docs/DEPLOYMENT.md`.

## Repository layout

| Path                               | Purpose                                                                               |
| ---------------------------------- | ------------------------------------------------------------------------------------- |
| `n8n/`                             | Workflow JSON definitions and custom code nodes                                       |
| `media-worker/`                    | FastAPI service for TTS, rendering, captioning, thumbnails                            |
| `db/`                              | Postgres schema migrations and init scripts                                           |
| `docs/`                            | Full system documentation (architecture, API usage, security, etc. — see index below) |
| `tests/`                           | Cross-cutting integration test mocks/fixtures                                         |
| `docker-compose.yml` / `Caddyfile` | The entire self-hosted stack                                                          |

## Documentation

Everything beyond this quickstart lives in `docs/`:

| Doc                   | Purpose                                                             |
| --------------------- | ------------------------------------------------------------------- |
| `PRD.md`              | Product requirements, goals, non-goals, success metrics             |
| `ARCHITECTURE.md`     | System architecture, components, data flow                          |
| `TECH_STACK.md`       | Ranked #1 free tool per stage + alternatives considered             |
| `WORKFLOW.md`         | The n8n workflows: triggers, schedules, sequencing                  |
| `N8N_NODES.md`        | Node-by-node spec (type, config, I/O) per workflow                  |
| `AI_PIPELINE.md`      | LLM prompts, chains, and validation for topic/script/fact-check/SEO |
| `YOUTUBE_API.md`      | YouTube Data/Analytics API usage, scopes, quota math                |
| `CONTENT_PIPELINE.md` | End-to-end content lifecycle & stage-gate contract                  |
| `DATABASE.md`         | Postgres schema, migrations, indices                                |
| `STORAGE.md`          | Filesystem layout, retention, backup                                |
| `CONFIG.md`           | All environment variables and credentials                           |
| `SECURITY.md`         | Secrets handling, OAuth scopes, threat model                        |
| `MONETIZATION.md`     | YPP eligibility path, monetization constraints, compliance          |
| `SEO.md`              | Title/description/tag/thumbnail SEO strategy                        |
| `ANALYTICS.md`        | Metrics collected, dashboards, feedback loop                        |
| `ERROR_HANDLING.md`   | Retry policy, idempotency, dead-letter handling                     |
| `TESTING.md`          | Unit/integration/e2e test plan for workflows & worker               |
| `DEPLOYMENT.md`       | Docker Compose stack, host setup, zero-cost hosting                 |
| `SCALING.md`          | Multi-channel scaling, quota partitioning, concurrency              |
| `TASKS.md`            | Implementation task breakdown (build order)                         |
| `CODING_RULES.md`     | Conventions for n8n workflows, worker code, SQL                     |

## Unavoidable manual steps (one-time only)

Everything runs unattended after these:

1. Google Cloud OAuth consent screen verification + YouTube Data/Analytics API OAuth grant.
2. Meta Developer App review for Instagram Content Publishing API (cross-posting only).
3. TikTok Developer App approval for Content Posting API (cross-posting only).
4. YouTube Partner Program (YPP) application (monetization only).

## Testing

```bash
cd n8n && npm test          # vitest — n8n custom code nodes
cd media-worker && pytest   # media-worker unit/integration tests
```

See `docs/TESTING.md` for the full test plan.

## Contributing

This is a single-operator personal project; the pipeline design in `docs/PRD.md` and `docs/CODING_RULES.md` reflects that scope. Issues and PRs are welcome — please read `docs/ARCHITECTURE.md` and `docs/CODING_RULES.md` first so changes match the existing conventions.

## License

No license has been chosen yet — all rights reserved by default until one is added.
