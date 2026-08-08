# SCALING

## 1. Baseline Volume (validated ₹0 target, referenced throughout)

1 channel, 1 long-form video/day, 3 Shorts/day, 2 cross-post platforms — this is the volume every quota/cost calculation in `YOUTUBE_API.md`, `STORAGE.md`, `AI_PIPELINE.md` is proven against.

## 2. Scaling Dimension 1: More Videos on One Channel

| Constraint | Limit at baseline | Headroom |
|---|---|---|
| YouTube Data API quota | 6,951/10,000 units/day (`YOUTUBE_API.md` §3) | Room for ~1 more long-form video/day before quota-constrained |
| Gemini free-tier RPD | ~7 calls/video (topic score, research, script, fact-check, thumbnail prompt, SEO, +1 buffer) × videos/day | ~1500 RPD ceiling supports ~200 videos/day worth of Gemini calls alone — YouTube quota is the binding constraint, not Gemini |
| Disk | ~200MB/video steady-state (`STORAGE.md` §5) | Trivial at any realistic single-channel volume |
| CPU (FFmpeg render + Whisper transcribe) | ~10–20 min combined per video on 4 ARM cores | `MAX_CONCURRENT_VIDEOS=3` keeps a full day's queue clear well within 24h even at 2–3 long-form videos/day |

**Conclusion:** a single channel can scale to ~2 long-form + up to 6 Shorts/day before YouTube's Data API daily quota becomes the binding constraint — beyond that, either request a quota increase (Google grants these for legitimate use free of charge, still ₹0) or move to multi-channel/multi-project (§3).

## 3. Scaling Dimension 2: Multiple Channels

Each additional channel needs its own `channels` row, its own `youtube-oauth-<channel>` credential, and its own YouTube Data API quota allocation. Since the 10,000-unit/day quota is **per Google Cloud project**, not per channel:

- **Up to ~3–4 channels per Google Cloud project** before quota gets tight (6,951 units × N channels must stay under 10,000, i.e., realistically N=1 comfortably, N=2 tight — so in practice **one Cloud project per channel** is the safe default, since Google Cloud projects are free and unlimited in number).
- Each channel operates its own independent pipeline instance logically (same `n8n`/`media-worker`/Postgres deployment, just more rows and more credentials) — no infrastructure duplication needed, only credential + quota partitioning.
- Gemini free-tier quota (per API key) similarly scales by using one `GEMINI_API_KEY` per 2–3 channels if RPD becomes constraining (unlikely before YouTube quota does, per §2).

`Master Orchestrator`'s `MAX_CONCURRENT_VIDEOS` cap is **global**, not per-channel — with multiple channels, either raise the cap (bounded by host CPU) or accept slightly staggered dispatch across channels within each 15-min cycle (acceptable; no video needs sub-15-minute latency).

## 4. Scaling Dimension 3: Host Resources

| Resource | Bottleneck stage | Mitigation |
|---|---|---|
| CPU | FFmpeg render, faster-whisper transcription | Reduce `WHISPER_MODEL_SIZE` to `base`/`tiny`; lower `MAX_CONCURRENT_VIDEOS`; or move `media-worker` to a second free-tier VM and point `MEDIA_WORKER_BASE_URL` at it (still $0, Oracle allows multiple free ARM VMs per account within the "Always Free" aggregate limit) |
| RAM | Whisper model loading, concurrent FFmpeg jobs | 24GB (Oracle free tier) comfortably fits `small` Whisper model + 3 concurrent FFmpeg processes; monitor via `docker stats`, downgrade model size if constrained |
| Disk | Long-term storage growth | Retention/purge policy (`STORAGE.md` §4) bounds steady-state growth to a few GB/month per channel regardless of scale |
| Network egress | Image/render downloads from Pollinations.ai, YouTube uploads | Both well within any free-tier VM's egress allowance at this volume (video files are the largest transfer, ~150MB × videos/day) |

## 5. Scaling Dimension 4: Rate-Limited Free APIs

| API | Soft limit | Mitigation at scale |
|---|---|---|
| Pollinations.ai | No hard published cap, informal throttle recommended | `VISUAL_BATCH_SIZE` caps concurrent requests; add jitter/delay between calls if 429s appear; fallback to self-hosted ComfyUI+SDXL (`TECH_STACK.md` §7) once volume justifies the GPU setup cost (still $0 if using existing hardware) |
| edge-tts | Unofficial, no published quota, but shared MS infrastructure | Fallback to self-hosted Coqui TTS (`TECH_STACK.md` §6) if reliability degrades under higher volume |
| AudD.io | 300 requests/month free tier | At >300 videos/month, becomes the binding compliance-scan constraint — mitigate by scanning only long-form final renders (not every Short, since Shorts are re-crops of already-scanned long-form audio, no new audio introduced) |
| DuckDuckGo HTML | Informal, scrape-friendly but not officially rate-documented | Throttled to 1 request per research call; Wikipedia (no limit) is the primary source, DuckDuckGo supplementary only |

## 6. What Does NOT Scale for Free (explicit boundary)

Beyond roughly **5 channels or ~10 long-form videos/day aggregate**, at least one of YouTube Data API quota (even split across projects, Google may flag excessive project-per-channel patterns as quota-farming) or AudD's 300/month compliance-scan tier will bind. At that point the honest options are: (a) apply for a Google Cloud quota increase (still free, but requires justification and review), (b) drop the AudD safety-net scan and rely solely on the structural zero-external-asset rule (still policy-compliant, marginally less defense-in-depth), or (c) accept a paid tier — which is out of scope for this system's ₹0 mandate. This system is explicitly designed and validated for the baseline (§1) through the multi-channel range in §3, not unbounded scale.

## 7. Concurrency Safety at Scale

`MAX_CONCURRENT_VIDEOS` and per-workflow `SplitInBatches` sizes are the only concurrency controls needed — because every stage is idempotent and guarded (`ERROR_HANDLING.md` §2), adding more channels/videos never risks data corruption, only queuing delay, which degrades gracefully (videos simply take longer to reach `PUBLISHED`, never fail due to contention).
