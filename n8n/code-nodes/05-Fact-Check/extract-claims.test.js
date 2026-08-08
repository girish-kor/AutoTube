import { describe, expect, it } from "vitest";
import { extractClaims, splitSentences } from "./extract-claims.js";

describe("splitSentences", () => {
  it("splits on sentence-ending punctuation", () => {
    expect(splitSentences("First fact. Second fact! Third fact?")).toEqual([
      "First fact.",
      "Second fact!",
      "Third fact?",
    ]);
  });
});

describe("extractClaims", () => {
  it("tags each claim with its scene_index", () => {
    const scriptJson = {
      scenes: [
        { narration: "A is true. B is also true." },
        { narration: "C is true." },
      ],
    };
    const claims = extractClaims(scriptJson);
    expect(claims).toEqual([
      { claim: "A is true.", scene_index: 0 },
      { claim: "B is also true.", scene_index: 0 },
      { claim: "C is true.", scene_index: 1 },
    ]);
  });
});
