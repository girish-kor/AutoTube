import { describe, expect, it } from "vitest";
import { checkRestrictedTopic } from "./restricted-topic-check.js";

describe("checkRestrictedTopic", () => {
  it("fails when a denylist term appears in the script", () => {
    const scriptJson = { scenes: [{ narration: "This explains how to build a firearm at home." }] };
    const result = checkRestrictedTopic("Safe title", "Safe description", scriptJson, ["firearm"]);
    expect(result.passed).toBe(false);
    expect(result.details).toContain("firearm");
  });

  it("passes when nothing matches the denylist", () => {
    const scriptJson = { scenes: [{ narration: "A friendly documentary about clouds." }] };
    const result = checkRestrictedTopic("Clouds 101", "Learn about clouds", scriptJson, ["firearm", "hate"]);
    expect(result.passed).toBe(true);
  });
});
