import { describe, expect, it } from "vitest";
import { checkAssetProvenance } from "./asset-provenance-check.js";

describe("checkAssetProvenance", () => {
  it("fails when a fixture assets list includes a disallowed source_tool", () => {
    const assets = [
      { source_tool: "pollinations" },
      { source_tool: "stock-footage-api" },
    ];
    const result = checkAssetProvenance(assets);
    expect(result.passed).toBe(false);
    expect(result.details).toContain("stock-footage-api");
  });

  it("passes when every asset is from an allowed tool", () => {
    const result = checkAssetProvenance([{ source_tool: "edge-tts" }, { source_tool: "ffmpeg" }]);
    expect(result.passed).toBe(true);
  });

  it("fails when there are no assets at all", () => {
    expect(checkAssetProvenance([]).passed).toBe(false);
  });
});
