# AutoTube — ₹0-Cost, 100% Automated YouTube Long-Form + Shorts System (2026)

AutoTube is a production-grade, fully automated content pipeline that discovers trending topics, researches and scripts videos, generates voice/visuals, renders and capions long-form videos, extracts Shorts, publishes to YouTube (and optionally cross-posts to Instagram Reels / TikTok), and closes the loop with analytics-driven optimization — end to end, with **zero recurring monetary cost** and **no manual work beyond unavoidable one-time OAuth/app-review approvals**.

## Core Design

- **Orchestrator:** [n8n](https://n8n.io) — self-hosted (Docker, fair-code license, free for internal use), runs every workflow, schedule, retry, and state transition.
- **Media Worker:** a self-hosted Python FastAPI microservice (`media-worker`) that n8n calls over HTTP for tasks n8n's native nodes can't do efficiently: TTS, image generation orchestration, FFmpeg rendering, Whisper captioning, thumbnail compositing, Shorts clipping.
- **State store:** PostgreSQL (self-hosted Docker container) — the single source of truth for pipeline state (see `DATABASE.md`).
- **File store:** local filesystem on the host, structured under `MEDIA_ROOT` (see `STORAGE.md`).
- **Host:** any always-on machine running Docker — recommended Oracle Cloud "Always Free" ARM VM (4 OCPU / 24 GB RAM, $0 forever) or the operator's own always-on PC (see `DEPLOYMENT.md`).

## Why This Architecture

Every paid SaaS step (stock footage APIs, paid TTS, paid LLM tiers, clipping-AI SaaS, scheduling SaaS) is replaced by a free/open-source or generous-free-tier equivalent, ranked #1-for-cost-and-quality per pipeline stage. Full ranking and rationale: `TECH_STACK.md`.

## Document Index

| Doc | Purpose |
|---|---|
| `PRD.md` | Product requirements, goals, non-goals, success metrics |
| `ARCHITECTURE.md` | System architecture, components, data flow |
| `TECH_STACK.md` | Ranked #1 free tool per stage + alternatives considered |
| `WORKFLOW.md` | The 18 n8n workflows: triggers, schedules, sequencing |
| `N8N_NODES.md` | Exact node-by-node spec (type, config, I/O) per workflow |
| `AI_PIPELINE.md` | LLM prompts, chains, and validation for topic/script/fact-check/SEO |
| `YOUTUBE_API.md` | YouTube Data/Analytics API usage, scopes, quota math |
| `CONTENT_PIPELINE.md` | End-to-end content lifecycle & stage-gate contract |
| `DATABASE.md` | Postgres schema, migrations, indices |
| `STORAGE.md` | Filesystem layout, retention, backup |
| `CONFIG.md` | All environment variables and credentials |
| `SECURITY.md` | Secrets handling, OAuth scopes, threat model |
| `MONETIZATION.md` | YPP eligibility path, monetization constraints, compliance |
| `SEO.md` | Title/description/tag/thumbnail SEO strategy |
| `ANALYTICS.md` | Metrics collected, dashboards, feedback loop |
| `ERROR_HANDLING.md` | Retry policy, idempotency, dead-letter handling |
| `TESTING.md` | Unit/integration/e2e test plan for workflows & worker |
| `DEPLOYMENT.md` | Docker Compose stack, host setup, zero-cost hosting |
| `SCALING.md` | Multi-channel scaling, quota partitioning, concurrency |
| `TASKS.md` | Implementation task breakdown (build order) |
| `CODING_RULES.md` | Conventions for n8n workflows, worker code, SQL |

## Unavoidable Manual Steps (one-time only)

1. Google Cloud OAuth consent screen verification + YouTube Data/Analytics API OAuth grant.
2. Meta Developer App review for Instagram Content Publishing API (cross-posting only).
3. TikTok Developer App approval for Content Posting API (cross-posting only).
4. YouTube Partner Program (YPP) application (monetization only — channel must hit 500 subs / 3M public Shorts views in 90 days, or 1,000 subs / 4,000 watch hours in 12 months).

Everything else — discovery, research, scripting, fact-checking, voice, visuals, editing, captions, thumbnails, SEO, compliance checks, publishing, Shorts extraction, cross-posting, analytics, optimization — runs unattended.

## Quick Start

See `DEPLOYMENT.md` for the full Docker Compose stack and first-run OAuth bootstrap. See `TASKS.md` for build order.
