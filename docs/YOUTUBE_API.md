# YOUTUBE_API — Data/Analytics API Usage

## 1. OAuth2 Setup (one-time, unavoidable manual step)

1. Create a Google Cloud project → enable **YouTube Data API v3** and **YouTube Analytics API**.
2. Create an OAuth 2.0 Client ID (type: Web application), redirect URI = n8n's OAuth callback (`{{WEBHOOK_URL}}rest/oauth2-credential/callback`).
3. Configure the OAuth consent screen; while in "Testing" mode, add the channel's Google account as a test user (avoids Google's full app-verification review for personal/single-channel use — verification is only required to remove the 100-test-user cap and the "unverified app" warning; for a single self-owned channel, Testing mode is sufficient and free).
4. In n8n, create credential `youtube-oauth-<channel>` (type: Google OAuth2 API), paste Client ID/Secret, authorize with the channel's Google account. n8n stores and auto-refreshes the resulting refresh token.

**Scopes required:**
| Scope | Used for |
|---|---|
| `https://www.googleapis.com/auth/youtube.upload` | `videos.insert` |
| `https://www.googleapis.com/auth/youtube.force-ssl` | `thumbnails.set`, `captions.insert`, `videos.update` |
| `https://www.googleapis.com/auth/youtube.readonly` | `videos.list`, `search.list` |
| `https://www.googleapis.com/auth/yt-analytics.readonly` | YouTube Analytics API reports |

Multi-channel: repeat per channel, one credential each (`CONFIG.md` §2), one Google Cloud project can back multiple channel credentials.

## 2. Endpoints Used

| Endpoint | Method | Purpose | Workflow |
|---|---|---|---|
| `youtube/v3/videos?chart=mostPopular` | GET | Trending discovery | 01 |
| `youtube/v3/search` | GET | Competitor keyword/tag research | 11 |
| `youtube/v3/videos` (insert) | POST (resumable, multipart) | Publish long-form/Shorts | 13, 15 |
| `youtube/v3/thumbnails/set` | POST | Set custom thumbnail | 13 |
| `youtube/v3/captions` (insert) | POST | Upload SRT captions | 13 |
| `youtube/v3/videos` (update) | PUT | Post-publish metadata correction if needed | 18 (rare, manual-triggered only if a systemic title issue is detected — not part of default automated flow) |
| `youtubeanalytics/v2/reports` | GET | Views/watch-time/CTR/retention per video | 17 |

## 3. Quota Math

Daily cap: **10,000 units** (Data API v3, per Google Cloud project — shared across all channel credentials under that project; if scaling past ~5 channels, use one Cloud project per 3–4 channels, see `SCALING.md`).

| Operation | Cost (units) |
|---|---|
| `videos.list` | 1 |
| `search.list` | 100 |
| `videos.insert` | 1600 |
| `thumbnails.set` | 50 |
| `captions.insert` | 400 |
| `videos.update` | 50 |

**Per long-form video published (worst case, 1 video + 3 Shorts + 1 trending scan + 1 SEO search):**
```
trending scan (videos.list ×1)         =    1
SEO keyword search (search.list ×1)    =  100
long-form publish (insert+thumb+capt)  = 2050
3 Shorts (insert ×3, no thumb/capt)    = 4800
                                  Total = 6951 / 10,000 units/day
```
Comfortably within the daily 10,000-unit cap for 1 channel at 1 long-form + 3 Shorts/day, leaving ~3,000 units headroom for research and retries. `api_usage` table (`DATABASE.md` §10) tracks actual consumption; every quota-costly node pre-flight-checks remaining headroom and, if insufficient, the stage **defers** (exits without consuming, Master Orchestrator retries next cycle) rather than firing a call that would 403.

**YouTube Analytics API** has a separate, much higher quota (queries, not units, ~faír use); not a practical constraint at this volume.

## 4. Rate Limits & Retry

- Data API v3: no hard per-second cap documented beyond the daily unit budget, but bursty resumable-upload chunks are throttled client-side to avoid `403 userRateLimitExceeded`.
- On `403 quotaExceeded`: stage exits without advancing `stage`/incrementing `retry_count` (this is a scheduling problem, not a data problem) and is picked up automatically the next day once quota resets at midnight Pacific Time.
- On `5xx`/network errors: standard n8n HTTP node retry (3 attempts, exponential backoff), then falls through to `ERROR_HANDLING.md` stage-retry policy.
- Resumable upload (`videos.insert`) uses chunked upload with `Content-Range` per n8n's binary HTTP Request handling; on interrupted upload, the resumable session URI is **not** reused across retries (simplicity over partial-resume optimization at this volume) — the stage restarts the upload from scratch, which is safe because `youtube_video_id` is only persisted after a confirmed 200 response (idempotent: a partial failed upload never creates a duplicate video, since YouTube only returns an ID on success).

## 5. Synthetic Media Disclosure

Every upload sets `status.containsSyntheticMedia = true` (per `videos.is_synthetic_media` default `true` in `DATABASE.md`) — required for AI-generated voice/visuals under YouTube's altered-content policy (`MONETIZATION.md` §2). This is a first-class field in the `videos.insert` request body, not an afterthought.

## 6. YouTube Analytics API Report Query

```
GET /v2/reports
  ?ids=channel==MINE
  &startDate={{yesterday}}
  &endDate={{yesterday}}
  &metrics=views,estimatedMinutesWatched,averageViewDuration,likes,comments,subscribersGained
  &dimensions=video
  &filters=video=={{comma_separated_ids}}
```
Batched up to 200 video IDs per `filters` clause per YouTube Analytics API limits; `17-Analytics-Collector` chunks `SplitInBatches` accordingly if a channel exceeds 200 trackable videos.
