# TESTING

## 1. Test Pyramid

```
        e2e (few, slow)         — full pipeline against sandbox/test channel
      integration (moderate)    — media-worker endpoints, n8n workflow sub-chains
  unit (many, fast)              — media-worker Python functions, Code-node JS logic
```

## 2. Unit Tests — `media-worker` (pytest, free, self-hosted CI)

| Module | Test cases |
|---|---|
| `tts.py` | SSML scene-break parsing produces correct per-scene timestamps; voice ID validation; empty-narration rejection |
| `render.py` (FFmpeg wrapper) | Manifest→FFmpeg command construction is correct for N images/durations; duration-mismatch detection; atomic temp-file-then-rename on completion |
| `caption.py` (faster-whisper wrapper) | SRT formatting correctness; coverage-ratio validation against known fixture audio |
| `thumbnail.py` (Pillow) | Text overlay stays within safe margins at various overlay_text lengths; contrast-box applied when background is light |
| `clip.py` (Shorts scorer) | Heuristic scoring formula (`AI_PIPELINE.md` §7) produces expected ranking on a fixture transcript with known "obviously good" and "obviously bad" windows; silence-ratio penalty correctly down-ranks a dead-air window |
| `compliance_scan.py` | Asset-provenance check correctly fails when a fixture `assets` list includes a disallowed `source_tool` |

Target: ≥80% line coverage on `media-worker/`, run via `pytest --cov` in CI (GitHub Actions, free for public/private repos within free-tier minutes).

## 3. Unit Tests — n8n `Code` Node Logic

n8n `Code` nodes (script validation, claim extraction, verdict application, manifest building) are written as plain JS functions in separate `.js` files under `n8n/code-nodes/`, imported into the node body — this makes them independently unit-testable with `vitest`/`jest` outside n8n, and keeps workflow JSON diffs small (`CODING_RULES.md` §2). Test cases mirror the validation gates in `CONTENT_PIPELINE.md` §3 (e.g., script word-count boundary tests at 1199/1200/2200/2201 words).

## 4. Integration Tests — media-worker API

`tests/integration/` spins up the `media-worker` container (Docker Compose test profile) and issues real HTTP requests against `/tts`, `/image` (mocked Pollinations.ai response via a local stub server to avoid external network flakiness in CI), `/render`, `/caption`, `/thumbnail`, `/clip`, `/compliance-scan`, asserting on response schema and that output files are actually written to a test `MEDIA_ROOT`.

## 5. Integration Tests — n8n Workflow Sub-Chains

Using n8n's CLI (`n8n execute --id <workflow>`) against a test Postgres database (`autotube_test`, separate from `autotube`) seeded with fixture rows per stage precondition (e.g., a `videos` row at `stage='RESEARCHED'` to test `04-Script-Writer` in isolation). External API calls (Gemini, YouTube, Pollinations.ai) are intercepted via n8n's HTTP node pointed at a local mock server (`tests/mocks/`, a small Express app returning canned schema-valid responses) — keeps tests free, fast, and not dependent on live quota.

Each of the 19 workflows gets at minimum:
- One "happy path" test (valid input → expected stage advance + correct field writes).
- One "guard clause" test (input already past this stage → no-op, no duplicate work).
- One "validation gate failure" test (malformed/out-of-bounds output → stage does not advance, error logged).

## 6. End-to-End Test

A dedicated **test YouTube channel** (free, separate Google account) runs the full pipeline (`01` through `18`) against a fixed test topic weekly in CI, with `privacyStatus` forced to `private` (never public) via a `TEST_MODE` env flag read by `13-Publish-LongForm`/`15-Shorts-Publish` — validates the entire chain including real external APIs (within their free tiers) without touching the production channel or wasting production quota (`YOUTUBE_API.md` §3 headroom exists specifically to accommodate this weekly test run's quota cost). Asserts: video reaches `SHORTS_PUBLISHED`, all validation gates passed, no `pipeline_errors` rows created, total wall-clock under 2 hours (`PRD.md` §7 target).

## 7. Compliance/Policy Regression Tests

Fixture set of known-bad topics/scripts (violence keyword, medical-advice phrasing, a script with an artificially inserted unsourced claim) run through `05-Fact-Check` and `12-Compliance-Gate` in isolation, asserting the gate correctly blocks each — prevents silent regressions in the denylist or fact-check prompt from ever reaching production undetected.

## 8. CI Pipeline

GitHub Actions (free tier, sufficient minutes at this repo's size): on every PR — lint (`CODING_RULES.md`), unit tests, integration tests against mocked externals. On merge to `main` — additionally runs the weekly-scheduled e2e test on-demand (manual workflow_dispatch) rather than on every merge, to conserve free-tier Gemini/YouTube quota for the actual production pipeline.

## 9. Manual QA Checklist (pre-first-production-run only)

- [ ] OAuth flow completes end-to-end for a real test channel.
- [ ] A full pipeline run produces a video that, watched manually once, has audio/caption sync within human-perceptible tolerance and no obviously broken/garbled AI-generated imagery.
- [ ] Thumbnail renders legibly at YouTube's small (mobile feed) thumbnail size.
- [ ] Telegram alert fires correctly on a deliberately forced failure (e.g., temporarily invalid Gemini key).

This checklist is run once per environment stand-up, not per video — everything after it is covered by automated tests above.
