# TECH_STACK — Ranked #1 Free Tool Per Stage

Ranking criteria, in order: (1) truly ₹0 at target volume (`SCALING.md` §1), (2) output quality, (3) reliability/API stability, (4) no unavoidable manual step beyond one-time OAuth. Runner-ups listed for fallback wiring (`AI_PIPELINE.md`, `ERROR_HANDLING.md`).

## 1. Niche / Trend Research

| Rank | Tool | Cost | Notes |
|---|---|---|---|
| **#1** | **YouTube Data API v3** — `videos.list(chart=mostPopular)`, `search.list` | Free, 10,000 units/day | Official, per-region/category trending; direct signal of what YouTube is already promoting |
| #1 (paired) | **Google Trends RSS** (`trends.google.com/trends/trendingsearches/daily/rss`) | Free, no key | No auth, cross-checks YouTube signal against broader web search interest |
| Runner-up | pytrends (unofficial Trends scraping lib) | Free | Less stable (breaks on Google layout changes); used only if RSS feed is insufficient for a niche |

## 2. Topic Selection

| Rank | Tool | Cost | Notes |
|---|---|---|---|
| **#1** | **Gemini 2.0 Flash** (Google AI Studio API, free tier) | Free (rate-limited, see `AI_PIPELINE.md`) | Scores/ranks candidate topics against niche fit, novelty, and estimated search demand in one structured-JSON call |
| Fallback | Ollama + Llama 3.1 8B (self-hosted) | Free (compute only) | Used when Gemini free-tier daily quota is exhausted; lower quality but zero external dependency |

## 3. Research

| Rank | Tool | Cost | Notes |
|---|---|---|---|
| **#1** | **Wikipedia REST API** (`/api/rest_v1/page/summary`, `/w/api.php`) | Free, no key, no rate limit for reasonable use | Structured, citable, low hallucination risk as a grounding source |
| #1 (paired) | **DuckDuckGo HTML endpoint** (`html.duckduckgo.com/html`) | Free, no key | Supplementary search for facts Wikipedia doesn't cover; ToS-safe (no JS rendering, low volume) |
| Runner-up | Google Custom Search JSON API | Free tier: 100 queries/day | Reserved as overflow only — quota too small to be primary |

## 4. Script

| Rank | Tool | Cost | Notes |
|---|---|---|---|
| **#1** | **Gemini 2.0 Flash** | Free tier | Long context window fits full research + prior script context; strong structured-output (scene JSON) support |

## 5. Fact-Checking

| Rank | Tool | Cost | Notes |
|---|---|---|---|
| **#1** | **Gemini 2.0 Flash, second isolated pass** cross-referencing `research_json` (Wikipedia/DuckDuckGo sourced) | Free tier | No paid fact-check API exists for free; grounding the check in the same sourced research (not open-web recall) minimizes hallucinated verification |
| Rule layer | Deterministic claim-removal rule: any claim the model cannot map to a `research_json` source is cut, never guessed | Free | See `AI_PIPELINE.md` §4 |

## 6. Voice (TTS)

| Rank | Tool | Cost | Notes |
|---|---|---|---|
| **#1** | **edge-tts** (open-source client for Microsoft Edge's neural "Read Aloud" voices) | Free, no key | Best free TTS quality available (neural, multi-accent, SSML rate/pitch control); self-hosted inside `media-worker` |
| Fallback | Coqui TTS (self-hosted, OSS) | Free (compute only) | Used if edge-tts endpoint is unreachable/blocked; fully offline |

## 7. Visuals (b-roll / scene images)

| Rank | Tool | Cost | Notes |
|---|---|---|---|
| **#1** | **Pollinations.ai** image API (`image.pollinations.ai/prompt/{prompt}`) | Free, no key | Stable-Diffusion-class output, zero setup, no GPU needed on host |
| Fallback | Self-hosted ComfyUI + SDXL (if host has GPU) | Free (compute only) | Used for scale/rate-limit avoidance once volume grows (`SCALING.md`) |

## 8. Editing / Rendering

| Rank | Tool | Cost | Notes |
|---|---|---|---|
| **#1** | **FFmpeg** (self-hosted, inside `media-worker`) | Free, OSS | The only tool capable of scripted, unattended, frame-accurate assembly (Ken Burns pans on stills, audio muxing, caption burn-in, aspect-ratio reflow for Shorts) |

## 9. Captions

| Rank | Tool | Cost | Notes |
|---|---|---|---|
| **#1** | **faster-whisper** (CTranslate2 reimplementation of OpenAI Whisper, self-hosted) | Free, OSS | Best free open ASR accuracy/speed tradeoff on CPU; runs inside `media-worker` |

## 10. Thumbnails

| Rank | Tool | Cost | Notes |
|---|---|---|---|
| **#1** | **Pollinations.ai** (background art) + **Pillow** (Python, text/contrast compositing) | Free, OSS | Fully scriptable pipeline: generate base image → composite title text, safe-margins, contrast box |

## 11. SEO

| Rank | Tool | Cost | Notes |
|---|---|---|---|
| **#1** | **Gemini 2.0 Flash** (title/description/tag generation) + **YouTube Data API `search.list`** (competitive keyword/tag discovery) | Free tier | Generation + real search-result grounding in one pipeline; see `SEO.md` |

## 12. Copyright / Policy Validation

| Rank | Tool | Cost | Notes |
|---|---|---|---|
| **#1** | **Zero-external-asset rules engine** (internal): every audio/visual asset must originate from `assets.source_tool ∈ {edge-tts, pollinations, ffmpeg-generated}` — no downloaded stock/copyrighted media is ever permitted into the render pipeline | Free | Structural prevention beats detection; see `CONTENT_PIPELINE.md` §5 |
| Safety net | **AudD.io** free tier (300 requests/month) audio-fingerprint scan on final render's audio track | Free tier | Catches accidental TTS-voice/music leakage before publish; see `MONETIZATION.md` |

## 13. Publishing

| Rank | Tool | Cost | Notes |
|---|---|---|---|
| **#1** | **YouTube Data API v3** (`videos.insert`, `thumbnails.set`, `captions.insert`) | Free, 10,000 units/day | Only official publish path; OAuth2 one-time grant (`YOUTUBE_API.md`) |

## 14. Shorts Extraction

| Rank | Tool | Cost | Notes |
|---|---|---|---|
| **#1** | **FFmpeg** (crop/reflow to 9:16, cut) + **auto-editor** (OSS, silence/dead-air trimming) + internal heuristic scorer (caption keyword density, TTS emphasis markers, scene-boundary alignment) | Free, OSS | No paid "AI clipping" SaaS used; scoring logic in `AI_PIPELINE.md` §6 |

## 15. Cross-Posting

| Rank | Tool | Cost | Notes |
|---|---|---|---|
| **#1** | **Meta Graph API** (Instagram Content Publishing) | Free | Requires one-time Meta App Review (unavoidable, `README.md`) |
| **#1** | **TikTok Content Posting API** | Free | Requires one-time TikTok Developer App approval (unavoidable) |

## 16. Analytics

| Rank | Tool | Cost | Notes |
|---|---|---|---|
| **#1** | **YouTube Analytics API** + **YouTube Reporting API** | Free, OAuth | Official first-party metrics: views, watch time, CTR, retention, traffic source |

## 17. Optimization

| Rank | Tool | Cost | Notes |
|---|---|---|---|
| **#1** | **Gemini 2.0 Flash** feedback loop reading `analytics_daily` aggregates, adjusting topic-scoring weights and SEO prompt few-shot examples stored in `config` table | Free tier | Closes the loop without any paid experimentation/BI platform |

## 18. Orchestration & Infra (cross-cutting)

| Component | Tool | Cost |
|---|---|---|
| Orchestrator | n8n (self-hosted, Docker) | Free (fair-code, self-hosted internal use) |
| State DB | PostgreSQL 16 (self-hosted Docker) | Free |
| Media worker runtime | Python 3.12 + FastAPI (self-hosted Docker) | Free |
| File storage | Local filesystem / Docker bind volume | Free |
| Alerts | Telegram Bot API | Free, unlimited |
| Host | Oracle Cloud "Always Free" ARM VM (4 OCPU/24GB) or operator's always-on PC | Free forever |

## Tools Explicitly Rejected (and why)

| Tool | Reason rejected |
|---|---|
| ElevenLabs / paid TTS | Recurring cost beyond free tier at target volume |
| Runway/Pika/paid video-AI | Paid, no free tier at usable resolution/length |
| OpusClip / paid clipping AI | Paid SaaS; replaced by FFmpeg + heuristic scorer |
| Stock footage APIs (Pexels/Storyblocks etc.) | Licensing ambiguity for AI-repurposed commercial channels; replaced by 100% generated visuals to keep the compliance gate structurally simple |
| OpenAI GPT API | No perpetual free tier; Gemini's free tier is the only frontier-quality LLM with a durable $0 tier at time of writing |
| Zapier/Make | Paid beyond trivial volume; n8n self-hosted is free and more capable for this workload |
