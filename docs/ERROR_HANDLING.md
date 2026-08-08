# ERROR_HANDLING — Retries, Idempotency, Failure Recovery

## 1. Two-Layer Retry Model

| Layer | Scope | Mechanism |
|---|---|---|
| **Node-level** | A single HTTP call (transient network blip, 5xx, 429) | n8n HTTP Request node built-in retry: 3 attempts, exponential backoff (5s/15s/45s), configured per node in `N8N_NODES.md` |
| **Stage-level** | An entire workflow execution failing after node-level retries are exhausted | `E1-Error-Handler` global Error Trigger increments `videos.retry_count`; Master Orchestrator naturally re-dispatches the same stage next 15-min cycle since `videos.stage` was never advanced |

`MAX_RETRIES` (default 5, `CONFIG.md`) bounds stage-level retries. On the 5th failure, `E1-Error-Handler` sets `stage='FAILED'` and sends a Telegram alert — no infinite retry loop, no silent stall.

## 2. Idempotency Contract

Every stage workflow is safe to re-run against the same `video_id` because:

1. **Guard clause** (`WORKFLOW.md` §"Sub-Workflow Contract" step 2): a stage only proceeds if `videos.stage` still equals its expected predecessor. A stage that already completed (stage already advanced past it) is a no-op on re-dispatch.
2. **Per-artifact existence checks**: stages that produce files/rows check for prior existence before regenerating (`N8N_NODES.md`): `07-Visual-Generation` skips scenes with an existing `assets` row; `06-Voice-Synthesis` and others check for an existing output path before re-calling the (costly) generation step.
3. **Unique constraints as a backstop**: `assets (video_id, type, scene_index)`, `shorts (parent_video_id, clip_index)`, `crossposts (short_id, platform)`, `analytics_daily (video_id, is_short, metric_date)`, `topics (channel_id, discovered_date, source, title)` — all have DB-level unique constraints (`DATABASE.md`), so even a race between two dispatches of the same stage (shouldn't happen given the guard clause, but defense in depth) cannot create duplicate rows; conflicting inserts use `ON CONFLICT DO NOTHING`/`DO UPDATE`.
4. **Publish idempotency**: `13-Publish-LongForm` and `15-Shorts-Publish` check `youtube_video_id IS NULL` before calling `videos.insert` — since YouTube only returns an ID on a confirmed successful upload, and that ID is persisted immediately after the 200 response in the same node chain, a retry after a crash **between** upload-success and DB-write is the one gap: mitigated by treating a `409`/duplicate-looking retry conservatively (see §5).

## 3. Dead-Letter Handling

There is no separate dead-letter queue system — `videos.stage = 'FAILED'` **is** the dead letter: the row and all its artifacts remain in Postgres/`MEDIA_ROOT` (`STORAGE.md` §4), excluded from Master Orchestrator dispatch (`WORKFLOW.md` §"Master Orchestrator Logic" query filters `stage NOT IN (...,'FAILED')`), and surfaced via the weekly `ANALYTICS.md` §3 digest and the immediate Telegram alert at time of failure. An operator can manually reset a `FAILED` row's `stage` back to its last-good predecessor (a documented, deliberate SQL `UPDATE`) to force a retry after fixing a root cause (e.g., an API key rotation) — this is the one form of manual intervention the system supports, and it's optional, not required for the pipeline to keep functioning for other videos.

## 4. Failure Classification & Response

| Failure type | Example | Response |
|---|---|---|
| Transient network/5xx | Gemini API momentary outage | Node-level retry; if exhausted, stage-level retry next cycle |
| Quota exhausted | YouTube Data API 403 `quotaExceeded` | Stage **defers** without incrementing `retry_count` (`YOUTUBE_API.md` §4) — resumes automatically at quota reset, not treated as an error |
| Validation gate failure | Script word count out of range | Stage-level retry (regenerates with same inputs — Gemini's non-determinism usually resolves it within `MAX_RETRIES`) |
| Compliance failure | Restricted-topic denylist hit | Terminal `FAILED`, no retry (content problem, not transient — `CONTENT_PIPELINE.md` §4) |
| Structural/config error | Missing credential, malformed env var | Node fails immediately, no useful retry; `E1-Error-Handler` alert message includes the raw error, surfacing the misconfiguration for manual fix |
| Media-worker crash mid-job | FFmpeg OOM on a large render | n8n HTTP node retry (worker restarts per Docker `restart: unless-stopped`); if a partial file was written, the worker always writes to a temp path and atomically renames on success, so a crash never leaves a corrupt file at the path Postgres would reference |

## 5. Duplicate-Publish Prevention (specific hardening)

Before calling `videos.insert`, `13-Publish-LongForm`/`15-Shorts-Publish` additionally query YouTube's own `search.list?forMine=true&q={{title}}` as a last-resort check if `retry_count > 0` on that specific video (i.e., this is a retry, not a first attempt) — if a video with a matching title already exists on the channel within the last hour, the workflow assumes the prior attempt actually succeeded (crash happened after upload, before DB write), captures that video's ID, persists it, and skips re-uploading. This trades a small amount of extra API quota (one `search.list` call, 100 units) only on retry paths for a hard guarantee against duplicate publishes.

## 6. Alerting

All `FAILED` transitions and any `E1-Error-Handler` invocation send a Telegram message (`telegram-bot` credential, `CONFIG.md`) containing: `video_id`, `channel`, `workflow_name`, `stage`, `error_message`, timestamp. This is the sole alert channel — free, immediate, no paid incident-management tool required.

## 7. Data Integrity Guarantees

- A stage never partially writes its owned fields (`CONTENT_PIPELINE.md` §2) — each stage's final `Postgres` update node is a single statement setting all of that stage's fields plus the new `stage` value atomically; if the workflow fails before reaching that node, no partial state is persisted.
- Cross-table writes within a stage (e.g., `07-Visual-Generation` writing multiple `assets` rows before the final `videos.stage` update) are safe under retry because of the per-artifact existence checks in §2.2 — a crash mid-loop simply resumes from the next missing scene on retry, never reprocessing completed scenes.
