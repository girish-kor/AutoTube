# ARCHITECTURE

## 1. Component Overview

```
                                   ┌─────────────────────────────────────────────┐
                                   │                n8n (orchestrator)             │
                                   │  18 workflows, cron + webhook + sub-workflow  │
                                   │  chaining, credential store, error workflow   │
                                   └───────────────┬───────────────┬──────────────┘
                                                    │               │
                          HTTP (internal, no auth outside Docker network)
                                                    │               │
                    ┌───────────────────────────────▼──┐      ┌────▼─────────────────┐
                    │        media-worker (FastAPI)      │      │      PostgreSQL        │
                    │  /tts /image /render /caption      │◄────►│  pipeline state, all   │
                    │  /thumbnail /clip /compliance-scan │      │  tables in DATABASE.md │
                    └───────────────┬─────────────────────┘      └────────────────────────┘
                                    │
                          reads/writes MEDIA_ROOT (bind-mounted volume)
                                    │
                    ┌───────────────▼─────────────────────┐
                    │   Local filesystem (STORAGE.md)       │
                    │   /data/autotube/{channel}/{video_id}/│
                    └───────────────────────────────────────┘

External free APIs (all called from n8n HTTP Request nodes, credentials from n8n vault):
  YouTube Data API v3 · YouTube Analytics API · Google Trends RSS · Wikipedia REST API
  DuckDuckGo HTML · Gemini API (AI Studio, free tier) · Pollinations.ai · edge-tts (via worker)
  AudD.io (free tier) · Meta Graph API · TikTok Content Posting API · Telegram Bot API
```

## 2. Why n8n + a Media Worker (not n8n alone)

n8n's native nodes cover HTTP/API orchestration, control flow, scheduling, and credential management well, but have no native FFmpeg/Whisper/Pillow/edge-tts execution. Two options were considered:

1. **n8n `Execute Command` node calling CLI tools directly on the n8n host.** Rejected as primary: couples heavy CPU/GPU work to the orchestrator process, harder to scale/restart independently, harder to unit test.
2. **Dedicated stateless HTTP microservice (`media-worker`) that n8n calls, chosen.** Keeps n8n purely as an orchestrator issuing HTTP calls and reading return JSON (file paths, durations, scores). The worker is independently testable (`TESTING.md`), independently scalable (`SCALING.md`), and swappable per stage without touching workflow logic.

n8n's `Execute Command` node is still used for the very few local operations that don't warrant an HTTP round-trip (e.g., moving/renaming files) — see `N8N_NODES.md`.

## 3. Data Flow (single long-form video)

1. **Trend & Topic Discovery** (n8n, cron) → writes rows to `topics` (Postgres).
2. **Topic Selection** (n8n + Gemini) → scores `topics`, marks one `SELECTED`, creates `videos` row at stage `TOPIC_SELECTED`.
3. **Research** (n8n → Wikipedia/DuckDuckGo → Gemini) → writes structured research JSON to `videos.research_json`, stage → `RESEARCHED`.
4. **Script** (n8n → Gemini) → writes `videos.script_json` (scene-broken script), stage → `SCRIPTED`.
5. **Fact-Check** (n8n → Gemini + Wikipedia cross-ref) → writes `fact_checks` rows, rewrites/removes failed claims in `script_json`, stage → `FACT_CHECKED`.
6. **Voice** (n8n → media-worker `/tts`) → writes audio file to `MEDIA_ROOT`, path in `videos.audio_path`, stage → `VOICED`.
7. **Visuals** (n8n → media-worker `/image` per scene, Pollinations.ai) → writes image files, rows in `assets`, stage → `VISUALS_GENERATED`.
8. **Render** (n8n → media-worker `/render`, FFmpeg) → writes `videos.render_path`, stage → `RENDERED`.
9. **Captions** (n8n → media-worker `/caption`, faster-whisper) → writes SRT + burns captions into a second render pass, stage → `CAPTIONED`.
10. **Thumbnail** (n8n → media-worker `/thumbnail`, Pollinations.ai + Pillow) → writes `videos.thumbnail_path`, stage → `THUMBNAIL_READY`.
11. **SEO** (n8n → Gemini + YouTube `search.list`) → writes `videos.title/description/tags`, stage → `SEO_READY`.
12. **Compliance Gate** (n8n → media-worker `/compliance-scan` + rules) → writes `compliance_checks` rows; pass → `COMPLIANCE_PASSED`, fail → `FAILED` + alert.
13. **Publish** (n8n → YouTube `videos.insert`/`thumbnails.set`/`captions.insert`) → writes `videos.youtube_video_id`, stage → `PUBLISHED`.
14. **Shorts Extraction** (n8n → media-worker `/clip`) → writes `shorts` rows, stage → `SHORTS_EXTRACTED`.
15. **Shorts Publish** (n8n → YouTube `videos.insert` ×N) → stage → `SHORTS_PUBLISHED`.
16. **Cross-post** (n8n → Meta Graph API / TikTok API) → writes `crossposts` rows, stage → `CROSSPOSTED`.
17. **Analytics** (n8n, daily cron) → writes `analytics_daily` rows for all published videos, stage → `ANALYTICS_TRACKED`.
18. **Optimization** (n8n, weekly cron) → reads `analytics_daily`, updates topic-scoring weights and SEO prompt templates stored in `config` table.

Each stage is a **separate n8n workflow** invoked by the Master Orchestrator via "Execute Sub-workflow", gated on the `videos.stage` column so any stage can be re-run safely (idempotency contract in `CONTENT_PIPELINE.md` / `ERROR_HANDLING.md`).

## 4. Deployment Topology

Single Docker Compose stack (`DEPLOYMENT.md`) on one always-on host:

- `n8n` container (orchestrator + scheduler + credential vault)
- `media-worker` container (FastAPI + ffmpeg + faster-whisper + edge-tts + Pillow, CPU-only by default)
- `postgres` container (shared by n8n's own internal DB and AutoTube's pipeline schema, logically separated by database name — see `DATABASE.md`)
- Bind-mounted volume for `MEDIA_ROOT`

No external paid infrastructure. Horizontal scaling path (multi-channel, multi-worker) is in `SCALING.md`.

## 5. Control Flow Pattern

- **State machine, not blind linear chaining:** every workflow starts by reading the `videos` row for its target `video_id`, checks `stage` is exactly the expected predecessor, and no-ops (logs + exits) if not — this is what makes retries and duplicate cron fires safe.
- **Master Orchestrator** (`00-Master-Orchestrator`) runs every 15 minutes, queries Postgres for videos in each stage, and fires the corresponding sub-workflow for up to `MAX_CONCURRENT_VIDEOS` rows at a time (concurrency cap, see `SCALING.md`).
- **Error Trigger workflow** is attached globally in n8n settings; any uncaught node failure in any workflow routes there, which logs to `pipeline_errors`, increments `videos.retry_count`, and either re-queues (if `retry_count < MAX_RETRIES`) or marks `FAILED` + sends a Telegram alert.

## 6. Security Boundary

- `media-worker` is reachable only on the internal Docker network (no published port) — n8n is the only caller.
- All external credentials (YouTube OAuth, Gemini key, Meta/TikTok tokens, Telegram token) live in n8n's encrypted credential store, referenced by name in workflows, never inlined.
- Full detail in `SECURITY.md`.
