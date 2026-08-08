# TASKS — Implementation Build Order

Ordered so each phase is independently testable before the next depends on it. References the doc that fully specifies each task.

## Phase 0 — Accounts & One-Time Approvals (do first; longest lead time)

- [ ] T0.1 Create Google Cloud project, enable YouTube Data API v3 + YouTube Analytics API (`YOUTUBE_API.md` §1)
- [ ] T0.2 Create OAuth 2.0 Client ID, configure consent screen (Testing mode) (`YOUTUBE_API.md` §1)
- [ ] T0.3 Create Google AI Studio account, generate `GEMINI_API_KEY` (`CONFIG.md`)
- [ ] T0.4 Register free AudD.io account, generate `AUDD_API_KEY` (`TECH_STACK.md` §12)
- [ ] T0.5 Create Telegram bot via BotFather, get `TELEGRAM_BOT_TOKEN` + chat ID (`CONFIG.md`)
- [ ] T0.6 (If cross-posting in scope) Submit Meta Developer App for Instagram Content Publishing review (`README.md`) — start early, review can take days
- [ ] T0.7 (If cross-posting in scope) Submit TikTok Developer App for Content Posting API approval (`README.md`) — start early
- [ ] T0.8 Provision Oracle Cloud "Always Free" ARM VM (or designate operator PC), install Docker + Docker Compose (`DEPLOYMENT.md` §1)
- [ ] T0.9 Point a domain/subdomain's DNS A record at the host (required for Caddy's automatic TLS + OAuth HTTPS redirect)

## Phase 1 — Infrastructure Skeleton

- [x] T1.1 Write `docker-compose.yml`, `Caddyfile`, `.env.example` (`DEPLOYMENT.md` §2)
- [x] T1.2 Write Postgres init script creating both `n8n` and `autotube` databases (`DEPLOYMENT.md` §2)
- [x] T1.3 Write full DDL migration `0001_init_schema.sql` covering all tables/enums/triggers (`DATABASE.md`)
- [x] T1.4 Write `0001_seed_config.sql` seeding `config` defaults (scoring weights, batch sizes) (`DATABASE.md` §12)
- [ ] T1.5 Stand up stack (`postgres`, `migrate`, `n8n`, `caddy`); confirm n8n reachable over HTTPS (`DEPLOYMENT.md` §4 steps 1–4)
- [ ] T1.6 Complete n8n owner setup, create all 7 credentials (`DEPLOYMENT.md` §4 step 6, `CONFIG.md` §2)
- [ ] T1.7 Seed initial `channels` row (`DEPLOYMENT.md` §4 step 7)

## Phase 2 — Media Worker

- [x] T2.1 Scaffold FastAPI app + Dockerfile with ffmpeg/faster-whisper/edge-tts/Pillow/auto-editor deps (`DEPLOYMENT.md` §3, `TECH_STACK.md`)
- [x] T2.2 Implement `/tts` endpoint (edge-tts wrapper, SSML scene timing) (`N8N_NODES.md` workflow 06, `CODING_RULES.md` §4)
- [x] T2.3 Implement `/image` endpoint (Pollinations.ai client) (`N8N_NODES.md` workflow 07)
- [x] T2.4 Implement `/render` endpoint (FFmpeg manifest → Ken-Burns render + mux) (`N8N_NODES.md` workflows 08, 14)
- [x] T2.5 Implement `/caption` endpoint (faster-whisper transcription + SRT + burn-in) (`N8N_NODES.md` workflow 09)
- [x] T2.6 Implement `/thumbnail` endpoint (Pollinations.ai + Pillow composite) (`N8N_NODES.md` workflow 10)
- [x] T2.7 Implement `/clip` endpoint (auto-editor + heuristic scorer) (`N8N_NODES.md` workflow 14, `AI_PIPELINE.md` §7)
- [x] T2.8 Implement `/compliance-scan` endpoint (AudD client + provenance check) (`N8N_NODES.md` workflow 12)
- [x] T2.9 Unit tests for all 7 endpoints' internal logic (`TESTING.md` §2)
- [x] T2.10 Integration tests against a mocked-external test profile (`TESTING.md` §4)
- [ ] T2.11 Add `media-worker` service to Compose stack, confirm reachable internally from n8n (`DEPLOYMENT.md` §2)

## Phase 3 — Core Content Pipeline Workflows (build + test in stage order; each depends on the previous producing valid fixture data)

- [x] T3.1 `01-Trend-Discovery` (`N8N_NODES.md`)
- [x] T3.2 `02-Topic-Selection` incl. Gemini scoring prompt (`AI_PIPELINE.md` §1)
- [x] T3.3 `03-Research` incl. Wikipedia/DuckDuckGo calls + Gemini compilation (`AI_PIPELINE.md` §2)
- [x] T3.4 `04-Script-Writer` incl. Gemini script prompt (`AI_PIPELINE.md` §3)
- [x] T3.5 `05-Fact-Check` incl. Gemini verification + claim-patching logic (`AI_PIPELINE.md` §4)
- [x] T3.6 `06-Voice-Synthesis`
- [x] T3.7 `07-Visual-Generation`
- [x] T3.8 `08-Render`
- [x] T3.9 `09-Captioning`
- [x] T3.10 `10-Thumbnail` incl. Gemini thumbnail-prompt generation (`AI_PIPELINE.md` §5)
- [x] T3.11 `11-SEO-Metadata` incl. Gemini SEO prompt + `search.list` (`AI_PIPELINE.md` §6, `SEO.md`)
- [x] T3.12 `12-Compliance-Gate` incl. all 4 checks (`CONTENT_PIPELINE.md` §4)
- [x] T3.13 `13-Publish-LongForm` incl. resumable upload + synthetic-media flag (`YOUTUBE_API.md` §5)
- [ ] For each: workflow-level integration test with mocked externals before moving to the next (`TESTING.md` §5) — mock server (`tests/mocks/server.js`) built and verified standalone; running these workflows themselves requires a live n8n instance (Docker unavailable here)

## Phase 4 — Shorts, Cross-Post, Analytics, Optimization

- [x] T4.1 `14-Shorts-Extraction`
- [x] T4.2 `15-Shorts-Publish`
- [x] T4.3 `16-Crosspost` (Instagram + TikTok) — workflow built; going live still gates on Phase 0 T0.6/T0.7 approval landing
- [x] T4.4 `17-Analytics-Collector`
- [x] T4.5 `18-Optimization-Loop` incl. Gemini weight-adjustment prompt (`AI_PIPELINE.md` §8)

## Phase 5 — Orchestration & Resilience

- [x] T5.1 `00-Master-Orchestrator` (dispatch logic, `WORKFLOW.md` §"Master Orchestrator Logic")
- [ ] T5.2 `E1-Error-Handler`, set as n8n global Error Workflow (`DEPLOYMENT.md` §4 step 10) — workflow built; setting it as the instance's global Error Workflow is an n8n UI action against a live instance (Settings → Workflows → Error Workflow, `DEPLOYMENT.md` §4 step 10)
- [ ] T5.3 Verify idempotency: manually re-trigger a stage mid-pipeline, confirm no duplicate rows/publishes (`ERROR_HANDLING.md` §2) — requires a running pipeline against live Postgres/n8n
- [ ] T5.4 Verify quota pre-flight checks correctly defer (not fail) when `api_usage` near ceiling (`YOUTUBE_API.md` §3) — requires a running pipeline against live Postgres/n8n
- [ ] T5.5 Force a failure, confirm Telegram alert fires with correct context (`TESTING.md` §9) — requires a live n8n instance + real Telegram bot credential

## Phase 6 — Compliance & Policy Hardening

- [x] T6.1 Populate `config.restricted_topic_denylist` (`MONETIZATION.md` §3)
- [x] T6.2 Run compliance/policy regression fixture set (`TESTING.md` §7)
- [ ] T6.3 Confirm `containsSyntheticMedia`/`selfDeclaredMadeForKids` flags set correctly on a real test upload (`YOUTUBE_API.md` §5, `MONETIZATION.md` §2) — flags are wired into `13-Publish-LongForm`'s request body; confirming against a real upload requires a live YouTube OAuth credential

## Phase 7 — End-to-End Validation

- [ ] T7.1 Stand up test YouTube channel, run full pipeline with `TEST_MODE=true` (private uploads) (`TESTING.md` §6)
- [ ] T7.2 Manual QA checklist: audio/caption sync, thumbnail legibility, imagery quality (`TESTING.md` §9)
- [ ] T7.3 Confirm wall-clock topic→publish under 2 hours (`PRD.md` §7)
- [ ] T7.4 Confirm zero `pipeline_errors` on a clean full run

## Phase 8 — Go Live

- [ ] T8.1 Switch `TEST_MODE=false`, point at production channel credential
- [ ] T8.2 Activate all 19 workflows in n8n
- [ ] T8.3 Monitor first week closely via Telegram alerts + weekly digest (`ANALYTICS.md` §3)
- [ ] T8.4 After 7+ days of `analytics_daily` data, confirm `18-Optimization-Loop` runs cleanly and produces bounded weight adjustments (`AI_PIPELINE.md` §8)

## Phase 9 — Scale-Out (optional, only once baseline is stable)

- [ ] T9.1 Add second channel: new Cloud project, new OAuth credential, new `channels` row (`SCALING.md` §3)
- [ ] T9.2 Re-validate quota headroom under multi-channel load (`SCALING.md` §2–3)
- [ ] T9.3 Set up storage/CI backup automation if not already done (`STORAGE.md` §6)

## CI/Repo Setup (parallel track, any time after Phase 1)

- [x] TC.1 GitHub Actions: lint + unit tests on every PR (`TESTING.md` §8)
- [x] TC.2 GitHub Actions: weekly manual-dispatch e2e test job (`TESTING.md` §6, §8) — job defined; needs repo secrets (test-channel OAuth, Gemini key, etc.) added by the operator to actually run
- [x] TC.3 `.gitignore` excludes `.env`; commit `.env.example` only (`SECURITY.md` §1)
- [x] TC.4 Dependabot/Renovate enabled on `media-worker` dependencies (`SECURITY.md` §6) — extended to n8n/ and tests/ npm deps and GitHub Actions too
