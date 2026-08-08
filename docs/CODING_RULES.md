# CODING_RULES

## 1. n8n Workflow JSON

- One workflow per stage (`WORKFLOW.md`), named exactly `NN-Name` matching the inventory table — no ad-hoc workflow names.
- Every workflow's first non-trigger node is a `Postgres` "load + guard" node (`WORKFLOW.md` §"Sub-Workflow Contract") — no exceptions, even for trivially simple stages, so the idempotency contract (`ERROR_HANDLING.md` §2) holds uniformly.
- Node names are descriptive verb-phrases matching the tables in `N8N_NODES.md` exactly (e.g., "Generate Script (Gemini)", not "HTTP Request1") — workflow JSON is version-controlled and diffed in PRs; unclear node names make review impossible.
- No credentials, API keys, or literal secrets in node parameters — always reference a named n8n credential (`SECURITY.md` §1).
- No hard-coded `video_id`/`channel_id` test values left in a node's default parameters before committing — use `{{$json.video_id}}` expressions only.
- Every external HTTP call sets an explicit timeout and retry policy (`N8N_NODES.md` preamble) — never rely on n8n's default.
- SQL in `Postgres` nodes is always parameterized (`$1`, `$2`, ... placeholders via n8n's query parameters field) — string-concatenated SQL is a hard reject in review (`SECURITY.md` §4).
- Complex branching logic (>2 conditions) uses a `Switch` node, not nested `If` nodes — keeps the visual graph readable and matches the stage-dispatch pattern in `00-Master-Orchestrator`.

## 2. `Code` Nodes (n8n's embedded JS)

- Any `Code` node logic longer than ~15 lines is extracted to a plain `.js` file under `n8n/code-nodes/<workflow>/<node-name>.js`, unit-tested independently (`TESTING.md` §3), and the `Code` node body is a thin wrapper that imports/inlines it at workflow-export time — keeps workflow JSON reviewable and logic testable outside n8n's runtime.
- `Code` nodes never call external network APIs directly (that's what `HTTP Request` nodes are for) — they only transform/validate data already fetched.
- `Code` nodes must not throw raw strings — throw `Error(message)` with a message specific enough to be useful in `pipeline_errors.error_message` without needing to open n8n's execution log.

## 3. SQL / Database

- No ORM — all queries are hand-written, parameterized SQL in `Postgres` nodes (`ARCHITECTURE.md`, `DATABASE.md`) or in `db/migrations/*.sql` files, since the query surface is small and stable enough that an ORM adds indirection without benefit.
- Every table has an explicit primary key (`uuid`), explicit `NOT NULL` on required columns, and a foreign key constraint wherever a relationship exists (`DATABASE.md`) — no implicit/unenforced relationships.
- Migrations are forward-only, numbered, never edited after being applied to any environment (including local dev) — a mistake is fixed with a new migration, never by rewriting history.
- Every `stage`-advancing update statement sets `updated_at` implicitly via the `trg_videos_updated_at` trigger (`DATABASE.md` §3) — never set `updated_at` manually in application-level SQL, avoiding drift between trigger and manual logic.

## 4. `media-worker` (Python)

- FastAPI + type-annotated Pydantic request/response models for every endpoint (`/tts`, `/image`, `/render`, `/caption`, `/thumbnail`, `/clip`, `/compliance-scan`) — the schema is the contract n8n's `HTTP Request` nodes rely on; changing a response shape without updating both the Pydantic model and `N8N_NODES.md` is a review blocker.
- Every endpoint writes output files to a temp path first, then atomically `os.rename`s to the final `MEDIA_ROOT` path on success (`ERROR_HANDLING.md` §4) — no endpoint ever leaves a partially-written file at a path that Postgres might reference.
- No endpoint logs request/response bodies containing file *contents* (binary/base64) — only paths, durations, and status, keeping logs small and secret-free (`SECURITY.md` §1).
- External calls from `media-worker` (Pollinations.ai, edge-tts, AudD) go through a single small `clients/` module per provider, not scattered inline `requests.get` calls — centralizes retry/timeout/error-shape handling per provider and makes swapping a provider (`TECH_STACK.md` fallback tools) a one-file change.
- Formatting/linting: `ruff` (free, fast) enforced in CI (`TESTING.md` §8); no unformatted code merges.
- No global mutable state between requests — FastAPI endpoints are stateless functions; anything that looks like it needs shared state (e.g., quota counters) belongs in Postgres (`api_usage` table), not in-process memory, since the worker may restart or scale to multiple instances (`SCALING.md` §4).

## 5. Naming Conventions

- Postgres: `snake_case` tables/columns, plural table names (`videos`, `shorts`, `assets`), singular FK columns (`channel_id`, `video_id`).
- Env vars: `SCREAMING_SNAKE_CASE`, always documented in `CONFIG.md` the same day they're introduced — an env var used in code but missing from `CONFIG.md` is a review blocker.
- n8n credentials: `kebab-case`, prefixed by provider (`youtube-oauth-<channel>`, `gemini-api`) as listed in `CONFIG.md` §2.
- File paths under `MEDIA_ROOT`: exactly the structure in `STORAGE.md` §2 — no ad-hoc subdirectories introduced without updating that doc.

## 6. Cross-Document Consistency Rule

Any change that adds/renames/removes a Postgres column, env var, n8n credential, workflow, or media-worker endpoint **must** update the corresponding doc(s) in the same PR: `DATABASE.md` (schema), `CONFIG.md` (env/credentials), `WORKFLOW.md`/`N8N_NODES.md` (workflows), or this file's §4 contract note (endpoints). A PR that changes code without the matching doc update is incomplete — the docs are the spec, not after-the-fact description.

## 7. Commit / PR Discipline

- One logical change per commit (a new workflow, a new endpoint, a schema migration) — not mixed unrelated changes.
- PR description states which doc(s) were updated alongside the code change (§6).
- No direct pushes to `main` — even for a single-operator project, PRs give the async diff-review point where `SECURITY.md` §4's "no literal secrets" and "no string-concatenated SQL" rules get caught before merge.
