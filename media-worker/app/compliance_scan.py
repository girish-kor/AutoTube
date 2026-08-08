"""`/compliance-scan` endpoint logic (docs/N8N_NODES.md workflow 12,
docs/CONTENT_PIPELINE.md §4.1) — the zero-external-asset rules engine
(docs/TECH_STACK.md §12 #1). Structural prevention: every asset backing a
video must come from an allowed generation tool, or the video fails the
compliance gate before publish."""

from .config import ALLOWED_ASSET_SOURCE_TOOLS


def check_asset_provenance(assets: list[dict]) -> tuple[bool, str]:
    if not assets:
        return False, "no assets recorded for this video"

    disallowed = [
        a for a in assets if a.get("source_tool") not in ALLOWED_ASSET_SOURCE_TOOLS
    ]
    if disallowed:
        bad_tools = sorted({a.get("source_tool") for a in disallowed})
        return False, f"disallowed source_tool(s) present: {', '.join(bad_tools)}"

    return True, f"all {len(assets)} asset(s) sourced from allowed tools"


def scan(video_id: str, assets: list[dict]) -> dict:
    passed, details = check_asset_provenance(assets)
    return {"passed": passed, "details": details}
