# STORAGE — Filesystem Layout

## 1. Root

`MEDIA_ROOT` (default `/data/autotube`) is a Docker bind-mounted volume shared between the `n8n` and `media-worker` containers (both mount the same host path so file paths stored in Postgres are valid from either container). Backed by the host's local disk — no paid object storage required.

## 2. Directory Structure

```
/data/autotube/
├── {channel_id}/
│   ├── videos/
│   │   └── {video_id}/
│   │       ├── audio/
│   │       │   └── narration.wav
│   │       ├── images/
│   │       │   ├── scene_00.png
│   │       │   ├── scene_01.png
│   │       │   └── ...
│   │       ├── render/
│   │       │   ├── longform_v1.mp4          # pre-caption render (08-Render)
│   │       │   └── longform_final.mp4       # captioned render (09-Captioning)
│   │       ├── captions/
│   │       │   └── captions.srt
│   │       ├── thumbnail/
│   │       │   └── thumbnail.jpg
│   │       └── manifest.json                 # full render manifest, for reproducibility/debug
│   └── shorts/
│       └── {video_id}/
│           └── {clip_index}/
│               └── short.mp4
└── tmp/
    └── {execution_id}/                        # scratch space, purged after each media-worker job
```

All paths stored in Postgres (`videos.audio_path`, `videos.render_path`, etc.) are **absolute container paths** (`/data/autotube/...`), identical from both containers since they share the mount.

## 3. Naming Rules

- `{channel_id}` and `{video_id}` are the Postgres UUIDs — globally unique, collision-proof, no naming coordination needed.
- Scene images zero-padded to 2 digits (`scene_00`..`scene_19`, supports up to 20 scenes per `CONTENT_PIPELINE.md` gate).
- `manifest.json` captures the exact FFmpeg render manifest used, enabling a byte-identical re-render if `08-Render` needs to be retried (idempotency — re-running the stage overwrites the same path rather than creating `longform_v1_2.mp4`).

## 4. Retention Policy

| Content | Retention | Rationale |
|---|---|---|
| `render/longform_final.mp4`, `shorts/**/short.mp4` | Indefinite while `videos.stage NOT IN ('FAILED')` | Source of truth backing the published YouTube video; needed for potential re-upload/repair |
| `render/longform_v1.mp4` (pre-caption) | 14 days after `CAPTIONED` reached, then purged | Intermediate artifact, superseded by final render |
| `images/scene_*.png` | 30 days after `PUBLISHED`, then purged | Kept briefly for debugging/re-render; not needed long-term since final render embeds them |
| `audio/narration.wav` | 30 days after `PUBLISHED`, then purged | Same rationale |
| `tmp/{execution_id}/` | Purged immediately after each `media-worker` job completes (success or failure) | Scratch only |
| Videos at `stage='FAILED'` | All artifacts retained indefinitely (small volume — failures are the minority path) | Operator review, optimization-loop learning |

Purge job: a daily cron workflow (`n8n Schedule Trigger` → `Postgres` query for eligible `video_id`s past retention age → `Execute Command` `rm` on qualifying paths → clear the now-stale path column to `NULL` only for the specific purged field, never touching `render_path`/`captions_path`/`thumbnail_path` unless the video itself is being fully removed).

## 5. Disk Sizing (validates ₹0 self-hosting is sufficient — see `SCALING.md` for full math)

Approximate per-video footprint at 1080p, ~10 min: narration ~10MB, 15 scene images ~15MB, pre-caption render ~150MB, final render ~150MB, 3 Shorts ~45MB, thumbnail <1MB ≈ **~370MB/video** before intermediate purge, **~200MB/video** steady-state after 30-day purge of intermediates. At 30 long-form videos/month steady state: **~6GB/month** growth — trivially within a 50GB+ free-tier VM disk (Oracle Free Tier includes 200GB block storage) for years of continuous operation.

## 6. Backup

Optional, still ₹0: a weekly `Execute Command` node runs `tar` + `rclone` to a free-tier remote (e.g., a free Cloudflare R2 bucket, 10GB free egress-free tier, or a second free-tier VM) for disaster recovery of the Postgres dump + `MEDIA_ROOT/**/render/*_final.mp4` (final renders only, not intermediates — keeps backup volume small). Not required for core operation; the pipeline has no hard dependency on backup existing.
