import { describe, expect, it } from "vitest";
import { joinNarration } from "./join-narration.js";

describe("joinNarration", () => {
  it("inserts a scene mark before each scene's narration", () => {
    const ssml = joinNarration({
      scenes: [{ narration: "First." }, { narration: "Second." }],
    });
    expect(ssml).toBe('<speak><mark name="scene_0"/>First. <mark name="scene_1"/>Second.</speak>');
  });

  it("escapes ampersands and angle brackets", () => {
    const ssml = joinNarration({ scenes: [{ narration: "A < B & C > D" }] });
    expect(ssml).toContain("A &lt; B &amp; C &gt; D");
  });
});
