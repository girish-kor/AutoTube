// Deterministic sentence-level claim extraction. Code nodes never call
// external network APIs directly (docs/CODING_RULES.md §2) — the actual
// Gemini verification call is the next node, "Verify Claims (Gemini)".
function splitSentences(text) {
  return String(text || "")
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function extractClaims(scriptJson) {
  const scenes = (scriptJson && scriptJson.scenes) || [];
  const claims = [];
  scenes.forEach((scene, sceneIndex) => {
    splitSentences(scene.narration).forEach((sentence) => {
      claims.push({ claim: sentence, scene_index: sceneIndex });
    });
  });
  return claims;
}

module.exports = { splitSentences, extractClaims };
