# DATABASE — PostgreSQL Schema

Single Postgres 16 instance, database `autotube` (separate from n8n's own internal `n8n` database in the same container — see `DEPLOYMENT.md`). All timestamps `timestamptz`, all IDs `uuid` default `gen_random_uuid()` (requires `pgcrypto` extension).

## 0. Extensions & Enums

```sql
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TYPE video_stage AS ENUM (
  'TOPIC_SELECTED','RESEARCHED','SCRIPTED','FACT_CHECKED','VOICED',
  'VISUALS_GENERATED','RENDERED','CAPTIONED','THUMBNAIL_READY','SEO_READY',
  'COMPLIANCE_PASSED','PUBLISHED','SHORTS_EXTRACTED','SHORTS_PUBLISHED',
  'CROSSPOSTED','ANALYTICS_TRACKED','FAILED'
);

CREATE TYPE topic_status AS ENUM ('PENDING','SELECTED','REJECTED');
CREATE TYPE crosspost_platform AS ENUM ('INSTAGRAM','TIKTOK');
CREATE TYPE crosspost_status AS ENUM ('PENDING','POSTED','FAILED');
CREATE TYPE fact_check_status AS ENUM ('VERIFIED','REMOVED','REWRITTEN');
```

## 1. `channels`

```sql
CREATE TABLE channels (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  niche TEXT NOT NULL,
  youtube_channel_id TEXT NOT NULL UNIQUE,
  oauth_credential_name TEXT NOT NULL,        -- n8n credential name, see CONFIG.md
  active BOOLEAN NOT NULL DEFAULT true,
  daily_long_form_quota INT NOT NULL DEFAULT 1,
  daily_shorts_quota INT NOT NULL DEFAULT 3,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

## 2. `topics`

```sql
CREATE TABLE topics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_id UUID NOT NULL REFERENCES channels(id),
  title TEXT NOT NULL,
  source TEXT NOT NULL,                        -- 'youtube_trending' | 'google_trends'
  trend_score NUMERIC(5,2) NOT NULL,
  llm_score NUMERIC(5,2),                       -- filled at selection time
  status topic_status NOT NULL DEFAULT 'PENDING',
  discovered_date DATE NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (channel_id, discovered_date, source, title)
);
CREATE INDEX idx_topics_pending ON topics (channel_id, discovered_date) WHERE status = 'PENDING';
```

## 3. `videos`

```sql
CREATE TABLE videos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_id UUID NOT NULL REFERENCES channels(id),
  topic_id UUID NOT NULL REFERENCES topics(id),
  stage video_stage NOT NULL DEFAULT 'TOPIC_SELECTED',
  research_json JSONB,
  script_json JSONB,
  script_hash TEXT,                             -- sha256 of script_json, used for fact-check idempotency
  audio_path TEXT,
  render_path TEXT,
  captions_path TEXT,
  thumbnail_path TEXT,
  title TEXT,
  description TEXT,
  tags TEXT[],
  category_id TEXT,
  youtube_video_id TEXT UNIQUE,
  is_synthetic_media BOOLEAN NOT NULL DEFAULT true,   -- drives YouTube "altered content" disclosure flag
  retry_count INT NOT NULL DEFAULT 0,
  error_message TEXT,
  published_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_videos_stage ON videos (stage, updated_at);
CREATE INDEX idx_videos_channel ON videos (channel_id, created_at DESC);

CREATE OR REPLACE FUNCTION set_updated_at() RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER trg_videos_updated_at BEFORE UPDATE ON videos
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
```

## 4. `assets`

```sql
CREATE TABLE assets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  video_id UUID NOT NULL REFERENCES videos(id),
  type TEXT NOT NULL,                           -- 'image' | 'audio' | 'thumbnail'
  scene_index INT,
  prompt TEXT,
  file_path TEXT NOT NULL,
  source_tool TEXT NOT NULL,                    -- 'pollinations' | 'edge-tts' | 'ffmpeg' | 'pillow'
  license TEXT NOT NULL DEFAULT 'generated-original',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (video_id, type, scene_index)
);
```

## 5. `shorts`

```sql
CREATE TABLE shorts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_video_id UUID NOT NULL REFERENCES videos(id),
  clip_index INT NOT NULL,
  start_ts NUMERIC(8,2) NOT NULL,
  end_ts NUMERIC(8,2) NOT NULL,
  score NUMERIC(5,2) NOT NULL,                  -- heuristic highlight score
  render_path TEXT,
  title TEXT,
  description TEXT,
  tags TEXT[],
  youtube_video_id TEXT UNIQUE,
  stage video_stage NOT NULL DEFAULT 'SHORTS_EXTRACTED',
  published_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (parent_video_id, clip_index)
);
```

## 6. `crossposts`

```sql
CREATE TABLE crossposts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  short_id UUID NOT NULL REFERENCES shorts(id),
  platform crosspost_platform NOT NULL,
  external_post_id TEXT,
  status crosspost_status NOT NULL DEFAULT 'PENDING',
  error_message TEXT,
  posted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (short_id, platform)
);
```

## 7. `fact_checks`

```sql
CREATE TABLE fact_checks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  video_id UUID NOT NULL REFERENCES videos(id),
  claim TEXT NOT NULL,
  scene_index INT,
  verification_status fact_check_status NOT NULL,
  source_url TEXT,
  rewritten_claim TEXT,
  checked_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_fact_checks_video ON fact_checks (video_id);
```

## 8. `compliance_checks`

```sql
CREATE TABLE compliance_checks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  video_id UUID NOT NULL REFERENCES videos(id),
  check_type TEXT NOT NULL,                     -- 'asset_provenance' | 'audio_fingerprint' | 'restricted_topic' | 'metadata_accuracy'
  passed BOOLEAN NOT NULL,
  details TEXT,
  checked_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_compliance_video ON compliance_checks (video_id);
```

## 9. `pipeline_errors`

```sql
CREATE TABLE pipeline_errors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  video_id UUID REFERENCES videos(id),
  workflow_name TEXT NOT NULL,
  stage video_stage,
  error_message TEXT NOT NULL,
  stack TEXT,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved BOOLEAN NOT NULL DEFAULT false
);
CREATE INDEX idx_errors_unresolved ON pipeline_errors (occurred_at) WHERE resolved = false;
```

## 10. `api_usage`

```sql
CREATE TABLE api_usage (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  api_name TEXT NOT NULL,                       -- 'youtube_data_v3' | 'youtube_analytics' | 'gemini' | 'pollinations' | 'audd'
  usage_date DATE NOT NULL,
  units_used INT NOT NULL DEFAULT 0,
  unit_limit INT NOT NULL,
  UNIQUE (api_name, usage_date)
);
```
Incremented via `INSERT ... ON CONFLICT (api_name, usage_date) DO UPDATE SET units_used = api_usage.units_used + EXCLUDED.units_used` after every external call (Postgres node in each workflow, see `N8N_NODES.md`). Read before every quota-costly call to pre-flight-check against `unit_limit` (`YOUTUBE_API.md` §3).

## 11. `analytics_daily`

```sql
CREATE TABLE analytics_daily (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  video_id UUID NOT NULL,                       -- references videos.id OR shorts.id (see is_short)
  is_short BOOLEAN NOT NULL DEFAULT false,
  metric_date DATE NOT NULL,
  views INT NOT NULL DEFAULT 0,
  watch_time_minutes NUMERIC(10,2) NOT NULL DEFAULT 0,
  avg_view_duration_seconds NUMERIC(8,2),
  likes INT NOT NULL DEFAULT 0,
  comments INT NOT NULL DEFAULT 0,
  ctr NUMERIC(5,4),
  subscribers_gained INT NOT NULL DEFAULT 0,
  source TEXT NOT NULL DEFAULT 'youtube_analytics_api',
  UNIQUE (video_id, is_short, metric_date)
);
```
Upserted daily by `17-Analytics-Collector` (`ON CONFLICT (video_id, is_short, metric_date) DO UPDATE`) so late-finalizing YouTube data overwrites earlier estimates.

## 12. `config`

```sql
CREATE TABLE config (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```
Holds mutable, non-secret runtime tuning read by workflows at execution time: `topic_scoring_weights`, `seo_prompt_examples`, `max_concurrent_videos`, `shorts_per_video`. Written by `18-Optimization-Loop`. Seed values loaded via migration `0001_seed_config.sql`.

## Migrations

Plain numbered SQL files under `db/migrations/NNNN_description.sql`, applied at container start by a one-shot `migrate` init container running `psql -f` in order, tracked in a standard `schema_migrations(version TEXT PRIMARY KEY, applied_at TIMESTAMPTZ)` table. No ORM — all workflow SQL is hand-written parameterized queries in n8n Postgres nodes (`CODING_RULES.md` §3).

## Retention

`pipeline_errors` older than 90 days and resolved: purged monthly by a lightweight cron SQL job (`DELETE FROM pipeline_errors WHERE resolved AND occurred_at < now() - interval '90 days'`). All other tables are retained indefinitely — the entire dataset comfortably fits Postgres's free self-hosted footprint at the volumes in `SCALING.md`.
