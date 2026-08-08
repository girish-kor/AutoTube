# Contributing to AutoTube

Thanks for your interest — this is currently a single-operator personal project (see `docs/PRD.md` for scope), but issues and PRs are welcome.

## Before you start

- Skim `docs/ARCHITECTURE.md` for how the pieces fit together (n8n orchestrator, `media-worker`, Postgres, Caddy).
- Read `docs/CODING_RULES.md` — conventions enforced in review (no secrets in logs, parameterized SQL, etc.).
- Check `docs/TESTING.md` for how to run the test suites.

## Reporting bugs

Open a GitHub issue using the Bug Report template. Include steps to reproduce, expected vs. actual behavior, and relevant logs — redact any tokens, keys, or credentials before pasting.

## Proposing features

Open an issue using the Feature Request template first for anything non-trivial, so the change can be discussed against the pipeline design in `docs/PRD.md` before you put work into it.

## Making changes

1. Fork the repo and create a branch off `main`.
2. Match existing code style (`ruff` for `media-worker` Python; the project's lint config for n8n Code nodes).
3. Add or update tests — `media-worker` uses `pytest`, `n8n/` custom nodes use `vitest`.
4. Run the full local test suite (`docs/TESTING.md`) before opening a PR.
5. Open a PR against `main` describing what changed and why.

## Security issues

Do not open a public issue for a security vulnerability — see `docs/SECURITY.md` for how to report one privately.

## Code of Conduct

This project follows the [Code of Conduct](./CODE_OF_CONDUCT.md).
