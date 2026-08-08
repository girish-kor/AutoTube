import { describe, expect, it } from "vitest";
import { tagsCharCount, validateSeoLimits } from "./validate-limits.js";

describe("tagsCharCount", () => {
  it("sums tag lengths plus separating commas", () => {
    expect(tagsCharCount(["ab", "cde"])).toBe("ab,cde".length);
  });
});

describe("validateSeoLimits", () => {
  it("passes within all limits", () => {
    const result = validateSeoLimits({ title: "A good title", description: "desc", tags: ["a", "b"] });
    expect(result.ok).toBe(true);
  });

  it("fails when title exceeds 100 chars", () => {
    const result = validateSeoLimits({ title: "x".repeat(101), description: "d", tags: [] });
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes("title"))).toBe(true);
  });

  it("fails when tags exceed 500 chars total", () => {
    const tags = Array.from({ length: 60 }, (_, i) => `tag-${i}-padding`);
    const result = validateSeoLimits({ title: "t", description: "d", tags });
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes("tags"))).toBe(true);
  });
});
