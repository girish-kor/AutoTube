import { describe, expect, it } from "vitest";
import { countWords, validateScript } from "./validate-structure.js";

function sceneWithWords(n, visualPrompt = "a scene") {
  return { narration: Array(n).fill("word").join(" "), visual_prompt: visualPrompt };
}

describe("countWords", () => {
  it("counts whitespace-separated tokens", () => {
    expect(countWords("one two  three")).toBe(3);
  });
  it("returns 0 for empty/undefined", () => {
    expect(countWords("")).toBe(0);
    expect(countWords(undefined)).toBe(0);
  });
});

describe("validateScript", () => {
  it("passes with 10 scenes totalling 1500 words", () => {
    const scenes = Array.from({ length: 10 }, () => sceneWithWords(150));
    const result = validateScript({ scenes });
    expect(result.ok).toBe(true);
    expect(result.totalWords).toBe(1500);
  });

  it("fails at 1199 words (boundary)", () => {
    const scenes = [sceneWithWords(1199)];
    // pad to 8 scenes to isolate the word-count boundary from scene-count failure
    for (let i = 1; i < 8; i++) scenes.push(sceneWithWords(0, "x"));
    scenes[0].narration = Array(1199).fill("w").join(" ");
    const result = validateScript({ scenes });
    const totalWords = scenes.reduce((s, sc) => s + countWords(sc.narration), 0);
    expect(totalWords).toBe(1199);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes("word count"))).toBe(true);
  });

  it("passes at exactly 1200 words with 8 scenes", () => {
    // first scene carries 1193 words; the remaining 7 scenes each contribute
    // exactly 1 word ("x") so the total lands on the 1200 boundary exactly.
    const scenes = [sceneWithWords(1193)];
    for (let i = 1; i < 8; i++) scenes.push({ narration: "x", visual_prompt: "x" });
    const result = validateScript({ scenes });
    expect(result.totalWords).toBe(1200);
    expect(result.errors.some((e) => e.includes("word count"))).toBe(false);
  });

  it("fails when a scene has empty narration", () => {
    const scenes = Array.from({ length: 8 }, () => sceneWithWords(150));
    scenes[3].narration = "";
    const result = validateScript({ scenes });
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes("scene 3"))).toBe(true);
  });

  it("fails with fewer than 8 scenes", () => {
    const scenes = Array.from({ length: 5 }, () => sceneWithWords(300));
    const result = validateScript({ scenes });
    expect(result.errors.some((e) => e.includes("scene count"))).toBe(true);
  });
});
