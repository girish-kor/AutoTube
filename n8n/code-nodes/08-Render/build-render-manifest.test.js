import { describe, expect, it } from "vitest";
import { buildRenderManifest } from "./build-render-manifest.js";

describe("buildRenderManifest", () => {
  it("pairs each scene with its image asset and computes end_ts from the next scene", () => {
    const scenes = [
      { start_ts: 0, duration_estimate_sec: 5 },
      { start_ts: 5, duration_estimate_sec: 7 },
    ];
    const assets = [
      { type: "image", scene_index: 0, file_path: "/data/scene_00.png" },
      { type: "image", scene_index: 1, file_path: "/data/scene_01.png" },
    ];
    const manifest = buildRenderManifest("chan-1", "vid-1", "/data/narration.wav", scenes, assets);
    expect(manifest.images).toEqual([
      { path: "/data/scene_00.png", start_ts: 0, end_ts: 5 },
      { path: "/data/scene_01.png", start_ts: 5, end_ts: 12 },
    ]);
  });

  it("throws when an image asset is missing for a scene", () => {
    const scenes = [{ start_ts: 0, duration_estimate_sec: 5 }];
    expect(() => buildRenderManifest("c", "v", "a.wav", scenes, [])).toThrow(/scene_index 0/);
  });
});
