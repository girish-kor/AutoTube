# SECURITY

## 0. Reporting a Vulnerability

Please **do not** open a public GitHub issue for a security vulnerability. Instead, use GitHub's private vulnerability reporting: go to the [Security tab](https://github.com/girish-kor/AutoTube/security/advisories/new) and click "Report a vulnerability". This opens a private advisory visible only to the maintainer until a fix is ready.

Include what you'd include in a bug report: affected component, reproduction steps, and impact. Expect an initial response within a few days — this is a single-operator project (see `docs/PRD.md`), not a funded security team, so response times are best-effort.

## 1. Secrets Handling

- All credentials (YouTube OAuth2, Gemini API key, Meta/TikTok tokens, Telegram bot token, AudD key, Postgres password) live **only** in n8n's built-in encrypted credential store or the Docker Compose `.env` file (`CONFIG.md`).
- `.env` is never committed to version control — repo ships `.env.example` with variable names and no values; `.gitignore` excludes `.env`.
- `N8N_ENCRYPTION_KEY` is generated once at first deploy (`openssl rand -base64 32`) and backed up out-of-band (password manager) — losing it makes all stored n8n credentials unrecoverable, forcing re-auth of every OAuth integration.
- Workflow JSON exports (`n8n/workflows/*.json`, version-controlled) reference credentials **by name only** (n8n's standard export behavior) — never contain tokens/secrets in plaintext.
- No secret is ever logged: `Code` nodes and error-handling paths log `error.message` and structured context but explicitly exclude credential/header values (`CODING_RULES.md` §4 enforces this in code review).

## 2. OAuth Scope Discipline (least privilege)

Per `YOUTUBE_API.md` §1, only 4 scopes are granted — no `youtube.readonly`-superset admin scopes, no `youtubepartner` scope (not needed; monetization status is read via the standard Analytics scope, no CMS-level access requested). Meta and TikTok tokens are scoped to Content Publishing only, not full Page/Business management, at app-review time (`README.md`).

## 3. Network Boundary

- `media-worker` has **no published port** on the Docker host — reachable only via the internal Compose network, callable only by `n8n`. It has no public attack surface.
- `postgres` likewise has no published port; only `n8n` and `media-worker` reach it over the internal network.
- Only `n8n`'s UI/webhook port (5678, or 443 behind a reverse proxy) is exposed externally, protected by `N8N_BASIC_AUTH_*` (`CONFIG.md`) at minimum; production deployment (`DEPLOYMENT.md`) fronts it with a free TLS reverse proxy (Caddy or Nginx + Let's Encrypt, both free) — required because OAuth redirect URIs must be HTTPS.
- Outbound calls from `media-worker` are limited to the specific hosts it needs (Pollinations.ai for image gen inside the container's business logic) — it does not proxy arbitrary user-supplied URLs, closing off SSRF via that service.

## 4. Threat Model

| Threat | Mitigation |
|---|---|
| Leaked YouTube OAuth refresh token | Scoped to upload/analytics only (no account-takeover-level scope); revocable instantly from Google Account security settings; stored encrypted, never logged |
| Compromised n8n UI (weak basic-auth password) | Enforce a strong `N8N_BASIC_AUTH_PASSWORD`; recommend n8n's own user-management (email+password per operator) over shared basic auth once multi-operator; restrict UI to VPN/allowlisted IP via reverse-proxy rule where feasible |
| Prompt injection via scraped web content (DuckDuckGo/Wikipedia snippets feeding Gemini) | Research-compilation prompt (`AI_PIPELINE.md` §2) explicitly instructs the model to treat source text as data, not instructions, and structured `responseSchema` output constrains what the model can return (it cannot cause arbitrary tool calls — Gemini calls in this pipeline never have function-calling/tool-use enabled, only plain generation) |
| SSRF via generated `visual_prompt` reaching Pollinations.ai | Prompts are text-only inputs to an image-generation API, not URLs the worker fetches on the caller's behalf; worker validates prompt length/charset before forwarding |
| Malicious/oversized file from Pollinations.ai response | `media-worker` validates content-type and enforces a max download size before writing to disk |
| Postgres SQL injection | All queries are parameterized in n8n Postgres nodes (`CODING_RULES.md` §3) — no string concatenation of user/LLM-derived text into SQL, ever |
| Compromised Meta/TikTok long-lived token | Tokens stored encrypted in n8n vault; `16-Crosspost` refreshes Meta's long-lived token proactively before the ~60-day expiry (scheduled sub-check in workflow 16's guard step) to avoid needing to re-paste tokens manually, and scope is publish-only |
| Disk exhaustion (DoS via storage growth) | Retention/purge policy (`STORAGE.md` §4) bounds steady-state growth; `MAX_CONCURRENT_VIDEOS` bounds in-flight temp usage |
| Runaway API cost if a free tier's terms change | All external calls are pre-flight quota-checked against `api_usage` (`DATABASE.md` §10) — a stage **defers** rather than calling an API past its configured free-tier ceiling, so a silent pricing change cannot silently rack up cost since nothing beyond the configured `unit_limit` is ever called |

## 5. Data Privacy

- No PII is collected or processed — the pipeline never ingests viewer data beyond aggregate YouTube Analytics (views/watch-time/likes at the video level, not per-viewer).
- Generated content explicitly avoids real private individuals (`AI_PIPELINE.md` §1, §3 prompts instruct against likeness/real-person depiction; `CONTENT_PIPELINE.md` §4 restricted-topic denylist reinforces this at the compliance gate).

## 6. Hardening Checklist (pre-production)

- [ ] `.env` populated, not committed; `.env.example` committed instead.
- [ ] `N8N_ENCRYPTION_KEY` generated and backed up out-of-band.
- [ ] n8n reverse-proxied behind HTTPS (Caddy/Let's Encrypt, free).
- [ ] `N8N_BASIC_AUTH_*` set to non-default strong credentials.
- [ ] Postgres and media-worker ports confirmed **not** published in `docker-compose.yml` (`ports:` omitted, only `expose:` for internal use).
- [ ] All 7 credentials in `CONFIG.md` §2 created via n8n UI, verified referenced by name (not literal) in every workflow JSON that uses them.
- [ ] Docker host firewall allows only 22 (SSH, key-auth only, password auth disabled) and 443 inbound.
- [ ] Automated dependency updates for the `media-worker` base image (Dependabot or Renovate, free on GitHub) to pick up security patches for FFmpeg/Whisper/Pillow dependencies.
