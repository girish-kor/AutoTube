# CONTENT_PIPELINE — Lifecycle & Stage-Gate Contract

## 1. Stage State Machine

```
TOPIC_SELECTED → RESEARCHED → SCRIPTED → FACT_CHECKED → VOICED → VISUALS_GENERATED
  → RENDERED → CAPTIONED → THUMBNAIL_READY → SEO_READY → COMPLIANCE_PASSED
  → PUBLISHED → SHORTS_EXTRACTED → SHORTS_PUBLISHED → CROSSPOSTED → ANALYTICS_TRACKED

Any stage → FAILED (terminal, on compliance failure or retry exhaustion)
```

`videos.stage` moves strictly forward, one step at a time, only after the current stage's validation gate passes (`WORKFLOW.md` §"Sub-Workflow Contract"). No stage is ever skipped and no stage writes fields belonging to a later stage.

## 2. Stage Ownership of Fields

| Stage transition | Fields written | Owning workflow |
|---|---|---|
| → `RESEARCHED` | `research_json` | 03 |
| → `SCRIPTED` | `script_json`, `script_hash` | 04 |
| → `FACT_CHECKED` | `script_json` (patched), `fact_checks` rows | 05 |
| → `VOICED` | `audio_path`, `script_json.scenes[].start_ts` | 06 |
| → `VISUALS_GENERATED` | `assets` rows (type=image) | 07 |
| → `RENDERED` | `render_path` | 08 |
| → `CAPTIONED` | `captions_path`, `render_path` (captioned) | 09 |
| → `THUMBNAIL_READY` | `thumbnail_path` | 10 |
| → `SEO_READY` | `title`, `description`, `tags`, `category_id` | 11 |
| → `COMPLIANCE_PASSED` / `FAILED` | `compliance_checks` rows | 12 |
| → `PUBLISHED` | `youtube_video_id`, `published_at` | 13 |
| → `SHORTS_EXTRACTED` | `shorts` rows | 14 |
| → `SHORTS_PUBLISHED` | `shorts.youtube_video_id` | 15 |
| → `CROSSPOSTED` | `crossposts` rows | 16 |
| → `ANALYTICS_TRACKED` | `analytics_daily` rows (non-terminal, re-entered daily) | 17 |

Only the owning workflow ever writes its fields — this makes the guard clause (`WORKFLOW.md` step 2) a sufficient concurrency control without needing row-level locking beyond Postgres's default read-committed isolation, since two workflows never write the same column.

## 3. Validation Gates (per stage, enforced before persisting — detailed node config in `N8N_NODES.md`)

| Stage | Gate |
|---|---|
| Research | ≥ 8 sourced facts, each with a `source_url` |
| Script | 1200–2200 words, 8–20 scenes, every scene has non-empty `narration` + `visual_prompt` |
| Fact-check | Every claim in final script maps to a `VERIFIED` or `REWRITTEN` verdict; no `REMOVED` text remains |
| Voice | Audio duration 480–900s |
| Visuals | One image asset per scene, no gaps |
| Render | Rendered duration within ±5% of audio duration |
| Captions | SRT total duration within 2% of render duration |
| SEO | Title ≤100 chars, description ≤5000 chars, tags ≤500 chars total |
| Compliance | All 4 checks (`asset_provenance`, `audio_fingerprint`, `restricted_topic`, `metadata_accuracy`) pass |
| Publish | YouTube API returns 200 with a `video.id` |

Failure at any gate does **not** advance `stage`; it raises (caught by `E1-Error-Handler`), which either requeues for retry at the same stage or terminates to `FAILED` after `MAX_RETRIES` (`ERROR_HANDLING.md`).

## 4. Compliance Gate Detail (Stage 12 — the copyright/policy checkpoint)

Structural prevention is the primary control (not detection after the fact):

1. **Asset provenance rule:** every row in `assets` for a video must have `source_tool` in the allowed set (`pollinations`, `edge-tts`, `ffmpeg`, `pillow`). The render pipeline (`08-Render`) physically cannot include a file that doesn't have a corresponding `assets` row from an allowed tool — there is no code path in `N8N_NODES.md` that ingests external stock/copyrighted media at all.
2. **Audio fingerprint safety net:** the final render's audio track is scanned via AudD.io (free tier) to catch any accidental leakage (e.g., a TTS engine's background music bed) — this is a backstop, not the primary control.
3. **Restricted-topic denylist:** title/description/script scanned against a maintained keyword/category denylist (violence-glorification, hate, dangerous acts, medical/legal/financial advice framed as fact, real-private-individual content) — see `MONETIZATION.md` §3 for the full list and rationale.
4. **Metadata-accuracy check:** title/description must have sufficient keyword overlap with actual script content — structurally prevents clickbait/misleading-metadata policy violations.

A `FAILED` compliance result never publishes; the video is retained (not deleted) with `error_message` populated for operator review via Telegram alert, but no further automated retry is attempted for that specific video (a compliance failure indicates a content problem, not a transient error — re-running the same script would fail identically). The topic is implicitly available for re-selection on a future run if still trending.

## 5. Originality Guarantee

Every long-form video's script, narration audio, and every visual frame are generated fresh per video (no asset reuse across videos, no template video with swapped text) — `assets` rows are always `UNIQUE (video_id, type, scene_index)`, scoped to one video only. This satisfies YouTube's "reused content" policy (spam, deceptive practices, and repetitive content are policy violations; templated/duplicated content across a channel's uploads risks demonetization or removal) since each video's underlying research facts, script wording, and generated imagery differ by topic even when structural pipeline steps are identical.

## 6. Shorts Derivation Contract

Shorts are **extracted from**, not independently generated from, the published long-form video — same audio/visual assets, re-cropped to 9:16 with re-timed captions. This keeps Shorts compliant as "repurposed original content" (permitted) rather than separately AI-generated content that could drift from the long-form's fact-checked narration.

## 7. Retention of Rejected/Failed Content

`FAILED` videos and `REJECTED` topics are never deleted — retained for operator inspection and for `18-Optimization-Loop` to learn from which topic patterns fail scoring or compliance repeatedly (feeds back into `config.topic_scoring_weights` denylist tuning).
