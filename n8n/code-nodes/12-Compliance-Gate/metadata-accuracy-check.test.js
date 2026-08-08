import { describe, expect, it } from "vitest";
import { checkMetadataAccuracy } from "./metadata-accuracy-check.js";

describe("checkMetadataAccuracy", () => {
  it("passes when title/description overlap the script content", () => {
    const scriptJson = { scenes: [{ narration: "Robots are transforming modern factories quickly." }] };
    const result = checkMetadataAccuracy("Robots Transforming Factories", "About robots and factories", scriptJson);
    expect(result.passed).toBe(true);
  });

  it("fails on a clickbait mismatch with no keyword overlap", () => {
    const scriptJson = { scenes: [{ narration: "A calm documentary about garden vegetables." }] };
    const result = checkMetadataAccuracy("Shocking Alien Invasion Secret", "You wont believe this", scriptJson);
    expect(result.passed).toBe(false);
  });
});
