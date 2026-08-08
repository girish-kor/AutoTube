// Mirrors media-worker/app/compliance_scan.py's rule (docs/CONTENT_PIPELINE.md
// §4.1) — kept as a Postgres-fed Code node here because the asset list lives
// in Postgres, not something media-worker can query itself.
const ALLOWED_SOURCE_TOOLS = ["pollinations", "edge-tts", "ffmpeg", "pillow"];

function checkAssetProvenance(assets) {
  if (!assets || assets.length === 0) {
    return { passed: false, details: "no assets recorded for this video" };
  }
  const disallowed = assets.filter((a) => !ALLOWED_SOURCE_TOOLS.includes(a.source_tool));
  if (disallowed.length > 0) {
    const tools = [...new Set(disallowed.map((a) => a.source_tool))];
    return { passed: false, details: `disallowed source_tool(s) present: ${tools.join(", ")}` };
  }
  return { passed: true, details: `all ${assets.length} asset(s) sourced from allowed tools` };
}

module.exports = { ALLOWED_SOURCE_TOOLS, checkAssetProvenance };
