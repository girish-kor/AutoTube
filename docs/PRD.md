# PRD — AutoTube

## 1. Problem

Running a consistent, policy-compliant YouTube long-form + Shorts channel requires daily research, writing, voice, editing, thumbnails, SEO, and publishing labor. Paid automation SaaS (video AI, clipping AI, scheduling tools) impose recurring cost incompatible with a ₹0 budget. Manual operation doesn't scale past one channel and breaks under operator downtime.

## 2. Goal

Fully automate the content lifecycle — trend discovery → topic selection → research → script → fact-check → voice → visuals → render → captions → thumbnail → SEO → compliance gate → publish → Shorts extraction → Shorts publish → cross-post → analytics → optimization — at **₹0 recurring cost**, running unattended on a schedule, for one or more channels.

## 3. Non-Goals

- Not a video editor UI — no human-in-the-loop editing.
- Not targeting paid stock footage, paid TTS, or paid LLM tiers — every stage must run on a free tier or self-hosted OSS.
- Not attempting copyrighted-material reuse (no re-uploads, no unlicensed music/clips) — all assets are either AI-generated or self-produced.
- Not building a custom video player or CMS — YouTube is the platform of record.
- Not guaranteeing monetization approval — YPP eligibility depends on YouTube's own review, outside this system's control.

## 4. Users

Single operator ("channel owner") who configures niches, approves nothing on a per-video basis (fully unattended), and only intervenes for the one-time OAuth/app-review steps listed in `README.md`.

## 5. Functional Requirements

| # | Requirement |
|---|---|
| FR1 | System discovers trending topics per configured niche daily, scores them, and selects one topic per channel per run without human input. |
| FR2 | System researches the selected topic from free, attributable sources and produces a fact-grounded outline. |
| FR3 | System writes a full long-form script (8–15 min spoken, ~1200–2200 words) with scene breakdown for visuals. |
| FR4 | System fact-checks every discrete claim in the script against research sources before proceeding; on failure, claim is rewritten or removed automatically. |
| FR5 | System synthesizes narration audio matching script timing. |
| FR6 | System generates one visual asset per scene, matched to script content. |
| FR7 | System renders a long-form video (audio + visuals + captions burned or as track) via FFmpeg. |
| FR8 | System generates accurate closed captions (SRT + burned-in) via ASR. |
| FR9 | System generates a thumbnail with text overlay optimized for CTR. |
| FR10 | System generates SEO-optimized title, description, tags, and chapters. |
| FR11 | System runs a compliance gate (originality, no copyrighted assets, no restricted content categories) before publish; on failure, video is not published and is flagged. |
| FR12 | System publishes the long-form video to YouTube via API with correct metadata, category, and thumbnail. |
| FR13 | System extracts 1–5 Shorts (≤60s, 9:16) from the long-form video using an automated highlight scorer. |
| FR14 | System publishes Shorts to YouTube. |
| FR15 | System cross-posts Shorts to Instagram Reels and TikTok where the one-time app approval has been granted. |
| FR16 | System pulls daily analytics (views, watch time, CTR, retention) per video. |
| FR17 | System uses analytics to adjust future topic-scoring weights and SEO templates (closed-loop optimization) without human input. |
| FR18 | All failures are retried per policy (`ERROR_HANDLING.md`) and, if unrecoverable, alert the operator via a free channel (Telegram) without blocking other videos in flight. |
| FR19 | Every pipeline stage is idempotent and resumable from stored state — a crash mid-pipeline does not duplicate publishes or corrupt state. |
| FR20 | System supports N channels/niches running independently on the same infrastructure (`SCALING.md`). |

## 6. Non-Functional Requirements

- **Cost:** ₹0 recurring infrastructure/API cost at the target volume defined in `SCALING.md` (1 channel, 1 long-form + up to 3 Shorts/day). Scaling beyond free-tier quotas must degrade gracefully (queue, not fail).
- **Compliance:** Every published asset must satisfy YouTube's reused-content, spam, and misleading-metadata policies (`CONTENT_PIPELINE.md`, `MONETIZATION.md`).
- **Reliability:** Pipeline stage failures must not corrupt shared state; each stage is retried with backoff and is safe to re-run.
- **Observability:** Every stage transition, API call, and failure is logged and queryable (`ANALYTICS.md`, `ERROR_HANDLING.md`).
- **Security:** All credentials stored as encrypted n8n credentials or `.env`, never in workflow JSON or logs (`SECURITY.md`).
- **Portability:** Entire stack runs from one `docker-compose.yml`, reproducible on any Docker host (`DEPLOYMENT.md`).

## 7. Success Metrics

| Metric | Target |
|---|---|
| End-to-end automation rate | ≥ 95% of runs reach PUBLISHED or SHORTS_PUBLISHED with zero manual steps |
| Recurring cost | ₹0/month at 1 channel / 30 long-form + 90 Shorts per month |
| Fact-check false-pass rate | < 5% of published claims flagged post-hoc as inaccurate |
| Pipeline failure recovery | 100% of failed runs resumable from last successful stage, no duplicate publishes |
| Time to publish (topic → live) | < 2 hours unattended wall-clock per long-form video |
| Policy compliance | 0 Community Guidelines strikes attributable to system-generated content |

## 8. Constraints

- All APIs/tools used must have a free tier sufficient for the target volume, or be fully self-hosted OSS (`TECH_STACK.md`).
- OAuth-gated platforms (YouTube, Meta, TikTok) require one-time manual app setup/review — everything after that is unattended.
- No content may be republished from copyrighted third-party sources; all video/audio assets are generated or self-produced.

## 9. Risks

| Risk | Mitigation |
|---|---|
| Free-tier API quota exhaustion | Quota tracking table (`api_usage`), pre-flight quota checks, graceful queuing (`SCALING.md`) |
| Free LLM/TTS/image provider changes terms or rate-limits | Fallback provider per stage defined in `TECH_STACK.md` and `AI_PIPELINE.md` |
| AI-generated content triggers YouTube's synthetic-media disclosure requirement | Automated "altered/synthetic content" flag set on every upload (`YOUTUBE_API.md`, `MONETIZATION.md`) |
| Fact-check gate produces false negatives | Conservative claim-removal default: unverifiable claims are cut, not guessed (`AI_PIPELINE.md`) |
| Cross-post APIs require app review that may be rejected | Cross-posting is optional/isolated; core YouTube pipeline functions independently (`WORKFLOW.md`) |
