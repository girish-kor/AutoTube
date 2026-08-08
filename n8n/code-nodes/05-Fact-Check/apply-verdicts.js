// Applies Gemini's per-claim verdicts deterministically (docs/AI_PIPELINE.md
// §4): REMOVED claims are deleted, REWRITTEN claims are string-replaced. A
// scene emptied by removals is dropped and its time redistributed to the
// previous scene so no scene is ever left as dead air.
function applyVerdicts(scriptJson, verdicts) {
  const scenes = (scriptJson.scenes || []).map((scene, sceneIndex) => {
    let narration = scene.narration || "";
    verdicts
      .filter((v) => v.scene_index === sceneIndex || v.scene_index === undefined)
      .forEach((v) => {
        if (!narration.includes(v.claim)) return;
        if (v.status === "REMOVED") {
          narration = narration.replace(v.claim, "").trim();
        } else if (v.status === "REWRITTEN" && v.rewritten_claim) {
          narration = narration.replace(v.claim, v.rewritten_claim);
        }
      });
    narration = narration.replace(/\s{2,}/g, " ").trim();
    return { ...scene, narration };
  });

  const kept = [];
  for (const scene of scenes) {
    if (!scene.narration) {
      if (kept.length > 0) {
        kept[kept.length - 1].duration_estimate_sec =
          (kept[kept.length - 1].duration_estimate_sec || 0) + (scene.duration_estimate_sec || 0);
      }
      continue;
    }
    kept.push(scene);
  }

  return { ...scriptJson, scenes: kept };
}

module.exports = { applyVerdicts };
