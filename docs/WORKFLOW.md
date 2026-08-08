# WORKFLOW — n8n Workflow Inventory

18 workflows. Naming convention: `NN-Name` where `NN` is execution order (informational; actual dispatch is stage-driven, see §19). Each workflow is imported/exported as its own JSON file under `n8n/workflows/`.

## Stage → Workflow Map

| # | Workflow | Trigger | Reads stage | Writes stage | Idempotency key |
|---|---|---|---|---|---|
| 00 | `00-Master-Orchestrator` | Cron, every 15 min | any | dispatches only | n/a (dispatcher) |
| 01 | `01-Trend-Discovery` | Cron, daily 00:30 UTC per channel | n/a | inserts `topics` | `(channel_id, date, source)` unique |
| 02 | `02-Topic-Selection` | Called by Master when `topics` has unscored rows for a channel with no video in flight | n/a | `videos` @ `TOPIC_SELECTED` | one `SELECTED` topic per `(channel_id, date)` |
| 03 | `03-Research` | Master, stage=`TOPIC_SELECTED` | `TOPIC_SELECTED` | `RESEARCHED` | `video_id` (skip if `research_json` already set) |
| 04 | `04-Script-Writer` | Master, stage=`RESEARCHED` | `RESEARCHED` | `SCRIPTED` | `video_id` (skip if `script_json` already set) |
| 05 | `05-Fact-Check` | Master, stage=`SCRIPTED` | `SCRIPTED` | `FACT_CHECKED` | `video_id` + `script_json` hash |
| 06 | `06-Voice-Synthesis` | Master, stage=`FACT_CHECKED` | `FACT_CHECKED` | `VOICED` | `video_id` (skip if `audio_path` exists on disk) |
| 07 | `07-Visual-Generation` | Master, stage=`VOICED` | `VOICED` | `VISUALS_GENERATED` | `(video_id, scene_index)` per asset |
| 08 | `08-Render` | Master, stage=`VISUALS_GENERATED` | `VISUALS_GENERATED` | `RENDERED` | `video_id` (skip if `render_path` exists + checksum matches manifest) |
| 09 | `09-Captioning` | Master, stage=`RENDERED` | `RENDERED` | `CAPTIONED` | `video_id` (skip if `captions_path` exists) |
| 10 | `10-Thumbnail` | Master, stage=`CAPTIONED` | `CAPTIONED` | `THUMBNAIL_READY` | `video_id` |
| 11 | `11-SEO-Metadata` | Master, stage=`THUMBNAIL_READY` | `THUMBNAIL_READY` | `SEO_READY` | `video_id` |
| 12 | `12-Compliance-Gate` | Master, stage=`SEO_READY` | `SEO_READY` | `COMPLIANCE_PASSED` or `FAILED` | `video_id` |
| 13 | `13-Publish-LongForm` | Master, stage=`COMPLIANCE_PASSED` | `COMPLIANCE_PASSED` | `PUBLISHED` | `video_id` (skip if `youtube_video_id` already set) |
| 14 | `14-Shorts-Extraction` | Master, stage=`PUBLISHED` | `PUBLISHED` | `SHORTS_EXTRACTED` | `(video_id, clip_index)` |
| 15 | `15-Shorts-Publish` | Master, stage=`SHORTS_EXTRACTED` | `SHORTS_EXTRACTED` | `SHORTS_PUBLISHED` | `shorts.id` (skip if `youtube_video_id` set) |
| 16 | `16-Crosspost` | Master, stage=`SHORTS_PUBLISHED` | `SHORTS_PUBLISHED` | `CROSSPOSTED` | `(shorts.id, platform)` unique in `crossposts` |
| 17 | `17-Analytics-Collector` | Cron, daily 03:00 UTC | any `PUBLISHED`+ video younger than 90 days | `ANALYTICS_TRACKED` (non-terminal, re-runs daily) | `(video_id, date)` unique in `analytics_daily` |
| 18 | `18-Optimization-Loop` | Cron, weekly Mon 04:00 UTC | reads `analytics_daily` | updates `config` weights | n/a (aggregate, not per-video) |
| E1 | `E1-Error-Handler` | n8n global Error Trigger | any | `pipeline_errors`, retry or `FAILED` | `(video_id, stage, occurred_at)` |

## Scheduling Rationale

- **Trend Discovery at 00:30 UTC**: after most regions' prior-day trending data has stabilized.
- **Master Orchestrator every 15 min**: fast enough that a video reaches PUBLISHED same-day; coarse enough to stay well inside every API's rate limit (worst case ~96 dispatch cycles/day).
- **Analytics Collector daily 03:00 UTC**: after YouTube's own analytics data finalizes for the prior day (YouTube backfills same-day data as estimates for ~48h; we store per-date snapshots and let later runs overwrite via upsert, see `DATABASE.md`).
- **Optimization Loop weekly**: needs ≥7 days of `analytics_daily` per video to avoid overfitting to first-24h noise.

## Master Orchestrator Logic (`00-Master-Orchestrator`)

1. Postgres query: `SELECT * FROM videos WHERE stage NOT IN ('PUBLISHED','SHORTS_PUBLISHED','CROSSPOSTED','FAILED') AND retry_count < 5 ORDER BY updated_at ASC LIMIT :max_concurrent`.
2. For each row, `Switch` node routes to the sub-workflow matching `stage`'s successor (table above) via `Execute Workflow` node, passing `video_id`.
3. `max_concurrent` = `MAX_CONCURRENT_VIDEOS` env var (default 3) — caps simultaneous FFmpeg/Whisper jobs on the media-worker (`SCALING.md`).
4. Each `Execute Workflow` call runs in **fire-and-continue** mode (n8n "Execute Workflow" with `waitForSubWorkflow=false` is NOT used for stages that must complete before the next dispatch reads fresh state — instead each stage sub-workflow is awaited synchronously per video, but different videos are processed in parallel across Master's loop iterations via n8n's `SplitInBatches` node with batch size = `max_concurrent`).
5. On sub-workflow exception, n8n's global Error Trigger fires `E1-Error-Handler` automatically — Master does not need its own try/catch.

## Per-Video Linear Chain vs. Fan-Out

Within one video, stages 02→16 are strictly sequential (each depends on the previous stage's output). Across videos/channels, the Master Orchestrator fans out up to `MAX_CONCURRENT_VIDEOS` in parallel. Workflow 07 (Visual Generation) internally fans out per-scene image generation (n8n `SplitInBatches`, batch size = `VISUAL_BATCH_SIZE`, default 3) to respect Pollinations.ai's informal rate limit (`AI_PIPELINE.md`).

## Sub-Workflow Contract

Every stage workflow (01–18) follows the same shape, detailed per-node in `N8N_NODES.md`:

1. **Input**: `{ video_id }` (or `{ channel_id }` for 01/02, none for 17/18).
2. **Guard**: read row, verify current `stage` matches expected predecessor; if not, `NoOp` + log, exit success (safe re-dispatch).
3. **Work**: stage-specific nodes (API calls, media-worker calls, LLM calls).
4. **Validate**: schema/content validation of stage output (`CONTENT_PIPELINE.md` §4) before persisting.
5. **Persist**: update `videos`/`shorts`/`assets` row, advance `stage`, `updated_at = now()`.
6. **Output**: `{ video_id, stage, ok: true }` for Master's log.

Any thrown error inside steps 2–5 propagates to n8n's Error Trigger (E1), never silently swallowed.
