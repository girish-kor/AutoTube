// Builds the SSML the media-worker `/tts` endpoint expects: one
// <mark name="scene_N"/> boundary per scene (docs/N8N_NODES.md workflow 06;
// media-worker/app/tts.py's split_ssml_scenes parses this exact convention).
function escapeSsmlText(text) {
  return String(text || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function joinNarration(scriptJson) {
  const scenes = (scriptJson && scriptJson.scenes) || [];
  const body = scenes
    .map((scene, index) => `<mark name="scene_${index}"/>${escapeSsmlText(scene.narration)}`)
    .join(" ");
  return `<speak>${body}</speak>`;
}

module.exports = { escapeSsmlText, joinNarration };
