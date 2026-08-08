// Assembles the media-worker `/render` manifest (docs/N8N_NODES.md workflow
// 08) from the fact-checked script's per-scene start_ts (set in
// 06-Voice-Synthesis) joined against the generated image assets.
function buildRenderManifest(channelId, videoId, audioPath, scenes, assets, resolution) {
  const assetByScene = new Map(
    assets.filter((a) => a.type === "image").map((a) => [a.scene_index, a])
  );

  const images = scenes.map((scene, index) => {
    const asset = assetByScene.get(index);
    if (!asset) throw new Error(`missing image asset for scene_index ${index}`);
    const nextScene = scenes[index + 1];
    return {
      path: asset.file_path,
      start_ts: scene.start_ts,
      end_ts: nextScene ? nextScene.start_ts : scene.start_ts + (scene.duration_estimate_sec || 0),
    };
  });

  return {
    channel_id: channelId,
    video_id: videoId,
    audio_path: audioPath,
    images,
    resolution: resolution || "1920x1080",
  };
}

module.exports = { buildRenderManifest };
