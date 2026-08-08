# CONFIG — Environment Variables & Credentials

## 1. Environment Variables (`.env`, loaded by Docker Compose)

### n8n core
| Variable | Default | Description |
|---|---|---|
| `N8N_ENCRYPTION_KEY` | *(generate, 32+ random chars)* | Encrypts n8n's credential store at rest. Never rotate without re-encrypting existing credentials. |
| `N8N_BASIC_AUTH_ACTIVE` | `true` | Protects n8n editor UI. |
| `N8N_BASIC_AUTH_USER` | *(set)* | n8n UI login. |
| `N8N_BASIC_AUTH_PASSWORD` | *(set)* | n8n UI login. |
| `N8N_HOST` | `0.0.0.0` | Bind address inside container. |
| `N8N_PORT` | `5678` | n8n UI/webhook port. |
| `N8N_PROTOCOL` | `http` (or `https` behind reverse proxy) | |
| `WEBHOOK_URL` | `https://<host>/` | Public URL for OAuth redirect callbacks. |
| `GENERIC_TIMEZONE` | `Asia/Kolkata` | Cron schedule timezone. |
| `EXECUTIONS_DATA_PRUNE` | `true` | Auto-prune old execution logs to bound disk use. |
| `EXECUTIONS_DATA_MAX_AGE` | `336` (hours = 14 days) | Execution log retention. |

### Postgres
| Variable | Default | Description |
|---|---|---|
| `POSTGRES_HOST` | `postgres` | Docker service name. |
| `POSTGRES_PORT` | `5432` | |
| `POSTGRES_DB_N8N` | `n8n` | n8n's own internal DB. |
| `POSTGRES_DB_AUTOTUBE` | `autotube` | Pipeline schema DB (`DATABASE.md`). |
| `POSTGRES_USER` | `autotube` | |
| `POSTGRES_PASSWORD` | *(set)* | |

### Media worker
| Variable | Default | Description |
|---|---|---|
| `MEDIA_WORKER_BASE_URL` | `http://media-worker:8000` | Internal Docker network URL, called from n8n HTTP Request nodes. |
| `MEDIA_ROOT` | `/data/autotube` | Bind-mounted storage root (`STORAGE.md`). |
| `WHISPER_MODEL_SIZE` | `small` | faster-whisper model; `base`/`small` balance CPU cost vs. accuracy. |
| `TTS_DEFAULT_VOICE` | `en-US-AndrewNeural` | edge-tts voice ID; per-channel override in `channels` table if needed. |

### LLM
| Variable | Default | Description |
|---|---|---|
| `GEMINI_API_KEY` | *(set, from Google AI Studio)* | Free-tier key. |
| `GEMINI_MODEL` | `gemini-2.0-flash` | |
| `GEMINI_RPM_LIMIT` | `15` | Client-side throttle matching free-tier cap (`AI_PIPELINE.md`). |
| `OLLAMA_BASE_URL` | `http://ollama:11434` | Fallback local LLM, only if self-hosted fallback container is enabled. |

### YouTube (per channel; stored as n8n OAuth2 credential, not raw env vars — listed here for reference)
| Variable | Description |
|---|---|
| `YOUTUBE_CLIENT_ID` | Google Cloud OAuth client ID (used once to create the n8n credential). |
| `YOUTUBE_CLIENT_SECRET` | Google Cloud OAuth client secret. |
| Scopes | `youtube.upload`, `youtube.readonly`, `youtube.force-ssl`, `yt-analytics.readonly` — see `YOUTUBE_API.md` §1. |

### Cross-posting
| Variable | Description |
|---|---|
| `META_APP_ID` / `META_APP_SECRET` | Meta Developer App (Instagram Content Publishing). |
| `META_ACCESS_TOKEN` | Long-lived Page/IG Business token, refreshed by `16-Crosspost` before expiry (`SECURITY.md`). |
| `META_IG_USER_ID` | Instagram Business Account ID. |
| `TIKTOK_CLIENT_KEY` / `TIKTOK_CLIENT_SECRET` | TikTok Developer App. |
| `TIKTOK_ACCESS_TOKEN` / `TIKTOK_REFRESH_TOKEN` | OAuth tokens for Content Posting API. |

### Compliance / alerting
| Variable | Description |
|---|---|
| `AUDD_API_KEY` | Free-tier key (300 req/month), used by `12-Compliance-Gate`. |
| `TELEGRAM_BOT_TOKEN` | Alert channel bot. |
| `TELEGRAM_CHAT_ID` | Operator's chat/channel ID for alerts. |

### Runtime tuning (also mirrored into Postgres `config` table for dynamic updates — env vars are the bootstrap default only)
| Variable | Default | Description |
|---|---|---|
| `MAX_CONCURRENT_VIDEOS` | `3` | Master Orchestrator fan-out cap. |
| `VISUAL_BATCH_SIZE` | `3` | Parallel Pollinations.ai calls per video. |
| `MAX_RETRIES` | `5` | Per-stage retry ceiling before `FAILED`. |
| `SHORTS_PER_VIDEO` | `3` | Default Shorts extracted per long-form video. |

## 2. n8n Credentials (created via n8n UI/API, referenced by name in workflows)

| Credential name | Type | Used by workflows |
|---|---|---|
| `youtube-oauth-<channel>` | Google OAuth2 (YouTube scopes) | 13, 14, 15, 17 |
| `gemini-api` | HTTP Header Auth (`x-goog-api-key`) | 02, 03, 04, 05, 11, 18 |
| `postgres-autotube` | Postgres | all |
| `meta-graph-api` | HTTP Header Auth (Bearer) | 16 |
| `tiktok-content-api` | OAuth2 | 16 |
| `telegram-bot` | Telegram API | E1, all alerting nodes |
| `audd-api` | HTTP Query Auth | 12 |

All credentials are encrypted at rest by `N8N_ENCRYPTION_KEY`; none are ever placed directly in workflow JSON (`SECURITY.md` §1).

## 3. Config Precedence

1. Postgres `config` table (dynamic, mutated by `18-Optimization-Loop`) — read at the start of each relevant workflow execution.
2. `.env` / Docker Compose environment — bootstrap defaults and anything not meant to change at runtime (credentials, ports, hosts).
3. Hard-coded fallback in workflow node (only for `MAX_RETRIES`-style constants where a missing config row must not halt the pipeline).
