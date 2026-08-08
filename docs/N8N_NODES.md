# N8N_NODES — Node-by-Node Specification

Conventions: every workflow starts with the node type shown in "Trigger", ends with a `Postgres` node updating `videos.stage`. `HTTP Request` nodes to `media-worker` always set `Response Format = JSON`, `Timeout = 300000ms` (media jobs are slow), `Retry On Fail = true, 3 attempts, 5000ms wait` (n8n node-level retry, distinct from stage-level retry in `ERROR_HANDLING.md`). All Postgres nodes use the `postgres-autotube` credential and parameterized queries (never string-concatenated SQL).

## 00-Master-Orchestrator

| Node | Type | Config | I/O |
|---|---|---|---|
| Cron | `Schedule Trigger` | Every 15 min | → |
| Fetch Due Videos | `Postgres` (Execute Query) | `SELECT * FROM videos WHERE stage NOT IN ('PUBLISHED_TERMINAL_SET') AND retry_count < :maxRetries ORDER BY updated_at LIMIT :maxConcurrent` | rows[] |
| Split Batch | `SplitInBatches` | batchSize = `MAX_CONCURRENT_VIDEOS` | item |
| Route by Stage | `Switch` | rules on `{{$json.stage}}` → 16 outputs (one per successor workflow) | item |
| Execute: Topic-Selection ... Crosspost | `Execute Workflow` (×16, one per branch) | `waitForSubWorkflow = true`, passes `{video_id}` | result |
| Log Result | `NoOp` | records to execution log (n8n built-in) | — |

Also triggers `01-Trend-Discovery` (channel-level, no `video_id`) and `17-Analytics-Collector`/`18-Optimization-Loop` on their own independent Cron triggers (not dispatched by Master — see `WORKFLOW.md`).

## 01-Trend-Discovery

| Node | Type | Config | I/O |
|---|---|---|---|
| Cron | `Schedule Trigger` | Daily 00:30 UTC | → |
| Get Active Channels | `Postgres` | `SELECT * FROM channels WHERE active = true` | channels[] |
| Loop Channels | `SplitInBatches` | size 1 | channel |
| YouTube Trending | `HTTP Request` | GET `youtube.googleapis.com/youtube/v3/videos?chart=mostPopular&regionCode={{niche.region}}&videoCategoryId={{niche.category}}&part=snippet,statistics&maxResults=25`, cred `youtube-oauth-<channel>` | videos[] |
| Google Trends RSS | `HTTP Request` | GET `trends.google.com/trending/rss?geo={{region}}` | items[] |
| Merge Sources | `Merge` | combine mode | list |
| Dedupe & Normalize | `Code` (JS) | strip HTML, normalize title casing, compute `trend_score` from view velocity / rank | topics[] |
| Upsert Topics | `Postgres` | `INSERT INTO topics (...) VALUES (...) ON CONFLICT (channel_id, discovered_date, source, title) DO NOTHING` | — |
| Log Quota | `Postgres` | upsert `api_usage` for `youtube_data_v3` (+1 unit per list call) | — |

## 02-Topic-Selection

| Node | Type | Config | I/O |
|---|---|---|---|
| Trigger | `Execute Workflow Trigger` | input `{channel_id}` | → |
| Guard: video-in-flight? | `Postgres` + `If` | `SELECT count(*) FROM videos WHERE channel_id=:cid AND stage NOT IN ('PUBLISHED','SHORTS_PUBLISHED','CROSSPOSTED','FAILED')`; if ≥ `daily_long_form_quota`, exit | bool |
| Fetch Pending Topics | `Postgres` | `SELECT * FROM topics WHERE channel_id=:cid AND status='PENDING' AND discovered_date=CURRENT_DATE` | topics[] |
| Load Scoring Weights | `Postgres` | `SELECT value FROM config WHERE key='topic_scoring_weights'` | weights |
| Score Topics (Gemini) | `HTTP Request` | POST Gemini `generateContent`, prompt template `AI_PIPELINE.md` §1, `responseSchema` enforced JSON | scored[] |
| Pick Top | `Code` (JS) | sort by `llm_score`, take index 0 | topic |
| Mark Selected | `Postgres` | `UPDATE topics SET status='SELECTED', llm_score=:s WHERE id=:id`; `UPDATE topics SET status='REJECTED' WHERE id IN (...) AND id != :id` | — |
| Create Video Row | `Postgres` | `INSERT INTO videos (channel_id, topic_id, stage) VALUES (:cid, :tid, 'TOPIC_SELECTED') RETURNING id` | video_id |

## 03-Research

| Node | Type | Config | I/O |
|---|---|---|---|
| Trigger | `Execute Workflow Trigger` | `{video_id}` | → |
| Load Video | `Postgres` | fetch row, `If stage != 'TOPIC_SELECTED'` → `NoOp` exit | video |
| Wikipedia Search | `HTTP Request` | GET `en.wikipedia.org/w/api.php?action=query&list=search&srsearch={{topic.title}}&format=json` | pages[] |
| Wikipedia Summaries | `HTTP Request` (loop, `SplitInBatches`) | GET `en.wikipedia.org/api/rest_v1/page/summary/{{title}}` per top-5 page | summaries[] |
| DuckDuckGo Search | `HTTP Request` | GET `html.duckduckgo.com/html/?q={{topic.title}}`, parse via `HTML Extract` node | snippets[] |
| Compile Research (Gemini) | `HTTP Request` | POST Gemini, prompt `AI_PIPELINE.md` §2, structures into `research_json` (facts[] with `claim`, `source_url`) | research_json |
| Validate Non-Empty | `If` | `research_json.facts.length >= 8` else route to Error (insufficient sourcing) | — |
| Persist | `Postgres` | `UPDATE videos SET research_json=:r, stage='RESEARCHED' WHERE id=:id` | — |

## 04-Script-Writer

| Node | Type | Config | I/O |
|---|---|---|---|
| Trigger | `Execute Workflow Trigger` | `{video_id}` | → |
| Load Video | `Postgres` | guard `stage='RESEARCHED'` | video |
| Generate Script (Gemini) | `HTTP Request` | POST Gemini, prompt `AI_PIPELINE.md` §3, output = scene-broken JSON (`scenes[]`: `narration`, `visual_prompt`, `duration_estimate_sec`) | script_json |
| Validate Structure | `Code` (JS) | assert word count 1200–2200, every scene has non-empty `narration` + `visual_prompt` | ok/err |
| Hash Script | `Code` (JS) | `sha256(JSON.stringify(script_json))` | hash |
| Persist | `Postgres` | `UPDATE videos SET script_json=:s, script_hash=:h, stage='SCRIPTED'` | — |

## 05-Fact-Check

| Node | Type | Config | I/O |
|---|---|---|---|
| Trigger | `Execute Workflow Trigger` | `{video_id}` | → |
| Load Video | `Postgres` | guard `stage='SCRIPTED'`; skip if a `fact_checks` row already exists for this `script_hash` (idempotent re-run) | video |
| Extract Claims | `Code` (JS) | split `script_json.scenes[].narration` into discrete factual claims (sentence-level heuristic + Gemini claim-extraction call) | claims[] |
| Verify Claims (Gemini) | `HTTP Request` | POST Gemini, prompt `AI_PIPELINE.md` §4, given `claims[]` + `research_json.facts[]`, returns per-claim `VERIFIED | REWRITTEN | REMOVED` + `rewritten_claim?` | verdicts[] |
| Apply Verdicts | `Code` (JS) | patch `script_json.scenes[].narration`: replace REWRITTEN text, delete REMOVED sentences | script_json' |
| Log Fact Checks | `Postgres` | bulk insert into `fact_checks` | — |
| Persist | `Postgres` | `UPDATE videos SET script_json=:s2, stage='FACT_CHECKED'` | — |

## 06-Voice-Synthesis

| Node | Type | Config | I/O |
|---|---|---|---|
| Trigger | `Execute Workflow Trigger` | `{video_id}` | → |
| Load Video | `Postgres` | guard `stage='FACT_CHECKED'` | video |
| Join Narration | `Code` (JS) | concat all `scenes[].narration` with SSML break markers per scene boundary | ssml |
| TTS Call | `HTTP Request` | POST `{{MEDIA_WORKER_BASE_URL}}/tts` body `{video_id, ssml, voice}` | `{audio_path, duration_sec, scene_timestamps[]}` |
| Validate Duration | `If` | `duration_sec` within 480–900s (8–15 min) else Error | — |
| Persist | `Postgres` | `UPDATE videos SET audio_path=:p, stage='VOICED'`; store `scene_timestamps` into `script_json.scenes[].start_ts` | — |

## 07-Visual-Generation

| Node | Type | Config | I/O |
|---|---|---|---|
| Trigger | `Execute Workflow Trigger` | `{video_id}` | → |
| Load Video | `Postgres` | guard `stage='VOICED'` | video |
| Loop Scenes | `SplitInBatches` | batchSize = `VISUAL_BATCH_SIZE` | scene |
| Skip If Exists | `Postgres` + `If` | check `assets` for `(video_id, 'image', scene_index)`; skip generation if present | — |
| Generate Image | `HTTP Request` | POST `{{MEDIA_WORKER_BASE_URL}}/image` body `{prompt: scene.visual_prompt, width:1920, height:1080, seed}` (worker calls Pollinations.ai, retries alt seed on failure) | `{file_path}` |
| Record Asset | `Postgres` | `INSERT INTO assets (video_id, type, scene_index, prompt, file_path, source_tool) VALUES (..., 'image', ..., 'pollinations')` | — |
| All Scenes Done? | `If` (after loop) | count `assets` rows == `scenes.length` | — |
| Persist | `Postgres` | `UPDATE videos SET stage='VISUALS_GENERATED'` | — |

## 08-Render

| Node | Type | Config | I/O |
|---|---|---|---|
| Trigger | `Execute Workflow Trigger` | `{video_id}` | → |
| Load Video + Assets | `Postgres` | guard `stage='VISUALS_GENERATED'`; fetch `assets` ordered by `scene_index` | manifest |
| Build Render Manifest | `Code` (JS) | assemble `{audio_path, images:[{path, start_ts, end_ts}], resolution:'1920x1080'}` | manifest |
| Render Call | `HTTP Request` | POST `{{MEDIA_WORKER_BASE_URL}}/render` body manifest (worker runs FFmpeg: Ken-Burns pan/zoom per image timed to `scene_timestamps`, mux audio) | `{render_path, checksum, duration_sec}` |
| Validate | `If` | `duration_sec` within ±5% of `audio_path` duration | — |
| Persist | `Postgres` | `UPDATE videos SET render_path=:p, stage='RENDERED'` | — |

## 09-Captioning

| Node | Type | Config | I/O |
|---|---|---|---|
| Trigger | `Execute Workflow Trigger` | `{video_id}` | → |
| Load Video | `Postgres` | guard `stage='RENDERED'` | video |
| Transcribe | `HTTP Request` | POST `{{MEDIA_WORKER_BASE_URL}}/caption` body `{video_id, render_path, model_size: WHISPER_MODEL_SIZE}` (faster-whisper) | `{srt_path, captioned_render_path}` |
| Validate Coverage | `Code` (JS) | SRT total duration within 2% of render duration | ok/err |
| Persist | `Postgres` | `UPDATE videos SET captions_path=:srt, render_path=:captioned, stage='CAPTIONED'` | — |

## 10-Thumbnail

| Node | Type | Config | I/O |
|---|---|---|---|
| Trigger | `Execute Workflow Trigger` | `{video_id}` | → |
| Load Video | `Postgres` | guard `stage='CAPTIONED'` | video |
| Thumbnail Prompt (Gemini) | `HTTP Request` | POST Gemini, prompt `AI_PIPELINE.md` §5 → `{art_prompt, overlay_text}` | prompt |
| Generate Thumbnail | `HTTP Request` | POST `{{MEDIA_WORKER_BASE_URL}}/thumbnail` body `{art_prompt, overlay_text}` (worker: Pollinations.ai art + Pillow text composite, 1280×720, contrast-safe) | `{file_path}` |
| Persist | `Postgres` | `UPDATE videos SET thumbnail_path=:p, stage='THUMBNAIL_READY'` | — |

## 11-SEO-Metadata

| Node | Type | Config | I/O |
|---|---|---|---|
| Trigger | `Execute Workflow Trigger` | `{video_id}` | → |
| Load Video | `Postgres` | guard `stage='THUMBNAIL_READY'` | video |
| Keyword Research | `HTTP Request` | GET YouTube `search.list?q={{topic.title}}&part=snippet&maxResults=10` (competitor titles/tags signal) | results[] |
| Generate Metadata (Gemini) | `HTTP Request` | POST Gemini, prompt `AI_PIPELINE.md` §6 using `script_json` + keyword results → `{title, description, tags[], category_id, chapters[]}` | metadata |
| Validate Limits | `Code` (JS) | title ≤100 chars, description ≤5000 chars, tags total ≤500 chars | ok/err |
| Persist | `Postgres` | `UPDATE videos SET title=:t, description=:d, tags=:tg, category_id=:c, stage='SEO_READY'` | — |
| Log Quota | `Postgres` | upsert `api_usage` `youtube_data_v3` +100 (search.list cost) | — |

## 12-Compliance-Gate

| Node | Type | Config | I/O |
|---|---|---|---|
| Trigger | `Execute Workflow Trigger` | `{video_id}` | → |
| Load Video | `Postgres` | guard `stage='SEO_READY'` | video |
| Check: Asset Provenance | `Postgres` + `Code` | every `assets` row for this `video_id` has `source_tool IN ('pollinations','edge-tts','ffmpeg','pillow')` | pass/fail |
| Check: Audio Fingerprint | `HTTP Request` | POST `api.audd.io/` with render's audio track (safety net against accidental music leakage) | pass/fail |
| Check: Restricted Topic | `Code` (JS) | keyword/category denylist scan on `title`+`description`+`script_json` (see `MONETIZATION.md` §3) | pass/fail |
| Check: Metadata Accuracy | `Code` (JS) | title/description keyword overlap with actual script content ≥ threshold (no clickbait mismatch) | pass/fail |
| Log All Checks | `Postgres` | insert 4 rows into `compliance_checks` | — |
| Gate | `If` | all four passed | — |
| Persist Pass | `Postgres` | `UPDATE videos SET stage='COMPLIANCE_PASSED'` | — |
| Persist Fail + Alert | `Postgres` + `Telegram` | `UPDATE videos SET stage='FAILED', error_message=:reason`; send alert | — |

## 13-Publish-LongForm

| Node | Type | Config | I/O |
|---|---|---|---|
| Trigger | `Execute Workflow Trigger` | `{video_id}` | → |
| Load Video | `Postgres` | guard `stage='COMPLIANCE_PASSED'`; skip if `youtube_video_id` already set | video |
| Upload Video | `HTTP Request` (resumable upload, multipart) | POST `youtube/v3/videos?part=snippet,status,contentDetails`, body includes `snippet{title,description,tags,categoryId}`, `status{privacyStatus:'public', selfDeclaredMadeForKids:false, containsSyntheticMedia:true}`, media = `render_path` | `{id}` |
| Set Thumbnail | `HTTP Request` | POST `youtube/v3/thumbnails/set?videoId={{id}}`, media = `thumbnail_path` | — |
| Upload Captions | `HTTP Request` | POST `youtube/v3/captions?part=snippet`, media = `captions_path` | — |
| Persist | `Postgres` | `UPDATE videos SET youtube_video_id=:id, stage='PUBLISHED', published_at=now()` | — |
| Log Quota | `Postgres` | upsert `api_usage` `youtube_data_v3` +1600 (insert) +50 (thumbnails.set) +400 (captions.insert) | — |

## 14-Shorts-Extraction

| Node | Type | Config | I/O |
|---|---|---|---|
| Trigger | `Execute Workflow Trigger` | `{video_id}` | → |
| Load Video | `Postgres` | guard `stage='PUBLISHED'` | video |
| Score Highlights | `HTTP Request` | POST `{{MEDIA_WORKER_BASE_URL}}/clip` body `{video_id, captions_path, script_json}` — worker runs `auto-editor` dead-air trim + heuristic scorer (`AI_PIPELINE.md` §7), returns top-N candidate windows | candidates[] |
| Loop Candidates | `SplitInBatches` | size 1, N = `SHORTS_PER_VIDEO` | candidate |
| Render Short | `HTTP Request` | POST `{{MEDIA_WORKER_BASE_URL}}/render` body `{source: render_path, start_ts, end_ts, aspect:'9:16', burn_captions:true}` | `{render_path}` |
| Record Short | `Postgres` | `INSERT INTO shorts (parent_video_id, clip_index, start_ts, end_ts, score, render_path)` | — |
| Persist Parent | `Postgres` | `UPDATE videos SET stage='SHORTS_EXTRACTED'` (after loop completes) | — |

## 15-Shorts-Publish

| Node | Type | Config | I/O |
|---|---|---|---|
| Trigger | `Execute Workflow Trigger` | `{video_id}` | → |
| Load Shorts | `Postgres` | `SELECT * FROM shorts WHERE parent_video_id=:vid AND youtube_video_id IS NULL` | shorts[] |
| Generate Short SEO (Gemini) | `HTTP Request` | POST Gemini per short, short-form title/description/tags derived from parent metadata + clip content | metadata |
| Loop & Upload | `SplitInBatches` → `HTTP Request` | POST `youtube/v3/videos?part=snippet,status`, `snippet.title` includes `#Shorts`, media = short `render_path` | `{id}` |
| Persist Each | `Postgres` | `UPDATE shorts SET youtube_video_id=:id, stage='SHORTS_PUBLISHED', published_at=now()` | — |
| Persist Parent | `Postgres` | `UPDATE videos SET stage='SHORTS_PUBLISHED'` when all shorts published | — |

## 16-Crosspost

| Node | Type | Config | I/O |
|---|---|---|---|
| Trigger | `Execute Workflow Trigger` | `{video_id}` | → |
| Load Shorts | `Postgres` | `SELECT * FROM shorts WHERE parent_video_id=:vid AND stage='SHORTS_PUBLISHED'` | shorts[] |
| Loop Platforms | `SplitInBatches` | per short × `[INSTAGRAM, TIKTOK]` | item |
| Skip If Posted | `Postgres` + `If` | check `crossposts` unique constraint | — |
| Instagram: Create Container | `HTTP Request` | POST `graph.facebook.com/v19.0/{{IG_USER_ID}}/media` `{media_type:'REELS', video_url, caption}` | `{creation_id}` |
| Instagram: Publish | `HTTP Request` | POST `.../media_publish` `{creation_id}` | `{id}` |
| TikTok: Init Upload | `HTTP Request` | POST `open.tiktokapis.com/v2/post/publish/video/init/` | `{publish_id, upload_url}` |
| TikTok: Upload Bytes | `HTTP Request` | PUT to `upload_url`, binary render file | — |
| Record Crosspost | `Postgres` | `INSERT INTO crossposts (short_id, platform, external_post_id, status='POSTED', posted_at=now())` | — |
| Persist Parent | `Postgres` | `UPDATE videos SET stage='CROSSPOSTED'` when all combinations recorded | — |

## 17-Analytics-Collector

| Node | Type | Config | I/O |
|---|---|---|---|
| Cron | `Schedule Trigger` | Daily 03:00 UTC | → |
| Fetch Trackable Videos | `Postgres` | `SELECT * FROM videos WHERE stage IN ('PUBLISHED','SHORTS_PUBLISHED','CROSSPOSTED') AND published_at > now() - interval '90 days'` | videos[] |
| Loop | `SplitInBatches` | size 10 | video |
| Query Analytics | `HTTP Request` | GET `youtubeanalytics.googleapis.com/v2/reports?ids=channel==MINE&startDate=...&endDate=...&metrics=views,estimatedMinutesWatched,averageViewDuration,likes,comments,subscribersGained&filters=video=={{id}}` | metrics |
| Upsert | `Postgres` | `INSERT INTO analytics_daily (...) ON CONFLICT (video_id,is_short,metric_date) DO UPDATE SET ...` | — |
| Same for Shorts | (parallel branch) | identical pattern against `shorts` table | — |

## 18-Optimization-Loop

| Node | Type | Config | I/O |
|---|---|---|---|
| Cron | `Schedule Trigger` | Weekly Mon 04:00 UTC | → |
| Aggregate Performance | `Postgres` | join `videos`/`shorts` + `analytics_daily` (≥7 days data), group by topic source/category/publish-hour | agg |
| Recompute Weights (Gemini) | `HTTP Request` | POST Gemini, prompt `AI_PIPELINE.md` §8, input = agg stats + current weights → new `topic_scoring_weights`, `seo_prompt_examples` | new_config |
| Persist | `Postgres` | `UPDATE config SET value=:v, updated_at=now() WHERE key IN (...)` | — |

## E1-Error-Handler (Global Error Workflow)

| Node | Type | Config | I/O |
|---|---|---|---|
| Trigger | `Error Trigger` | set as n8n instance-level Error Workflow (Settings → Workflows) | `{workflow, execution, node, error}` |
| Log Error | `Postgres` | `INSERT INTO pipeline_errors (video_id, workflow_name, stage, error_message, stack)` (`video_id` parsed from failed execution's input data if present) | — |
| Increment Retry | `Postgres` | `UPDATE videos SET retry_count = retry_count + 1, error_message=:msg WHERE id=:vid` | — |
| Decide | `If` | `retry_count < MAX_RETRIES` | — |
| Requeue | `NoOp` | no-op: video stays at its last successful `stage`, Master Orchestrator naturally retries it next 15-min cycle | — |
| Mark Failed + Alert | `Postgres` + `Telegram` | `UPDATE videos SET stage='FAILED'`; send message with `video_id`, `workflow_name`, `error_message` | — |
