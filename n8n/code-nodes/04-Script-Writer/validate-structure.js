function countWords(text) {
  return String(text || "").trim().split(/\s+/).filter(Boolean).length;
}

function validateScript(scriptJson) {
  const scenes = (scriptJson && scriptJson.scenes) || [];
  const errors = [];

  if (scenes.length < 8 || scenes.length > 20) {
    errors.push(`scene count ${scenes.length} outside 8-20 range`);
  }

  scenes.forEach((scene, index) => {
    if (!scene.narration || !scene.narration.trim()) {
      errors.push(`scene ${index} has empty narration`);
    }
    if (!scene.visual_prompt || !scene.visual_prompt.trim()) {
      errors.push(`scene ${index} has empty visual_prompt`);
    }
  });

  const totalWords = scenes.reduce((sum, scene) => sum + countWords(scene.narration), 0);
  if (totalWords < 1200 || totalWords > 2200) {
    errors.push(`word count ${totalWords} outside 1200-2200 range`);
  }

  return { ok: errors.length === 0, errors, totalWords };
}

module.exports = { countWords, validateScript };
