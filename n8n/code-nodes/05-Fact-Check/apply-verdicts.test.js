import { describe, expect, it } from "vitest";
import { applyVerdicts } from "./apply-verdicts.js";

describe("applyVerdicts", () => {
  it("deletes REMOVED claims and rewrites REWRITTEN claims", () => {
    const scriptJson = {
      scenes: [
        { narration: "True fact. False fact. Overstated fact.", duration_estimate_sec: 30 },
      ],
    };
    const verdicts = [
      { claim: "False fact.", status: "REMOVED", scene_index: 0 },
      { claim: "Overstated fact.", status: "REWRITTEN", rewritten_claim: "Accurate fact.", scene_index: 0 },
    ];
    const result = applyVerdicts(scriptJson, verdicts);
    expect(result.scenes[0].narration).toBe("True fact. Accurate fact.");
  });

  it("drops a scene emptied by removals and redistributes its duration", () => {
    const scriptJson = {
      scenes: [
        { narration: "Keep this.", duration_estimate_sec: 20 },
        { narration: "Only bad claim.", duration_estimate_sec: 10 },
      ],
    };
    const verdicts = [{ claim: "Only bad claim.", status: "REMOVED", scene_index: 1 }];
    const result = applyVerdicts(scriptJson, verdicts);
    expect(result.scenes).toHaveLength(1);
    expect(result.scenes[0].duration_estimate_sec).toBe(30);
  });
});
