import { describe, expect, it } from "vitest";
import { boundCheckWeights } from "./bound-check-weights.js";

const CURRENT = {
  recency: 0.2,
  trend_strength: 0.25,
  evergreen_potential: 0.2,
  competition_gap: 0.2,
  niche_fit: 0.15,
};

describe("boundCheckWeights", () => {
  it("accepts a small in-bounds adjustment", () => {
    const proposed = { ...CURRENT, trend_strength: 0.3, niche_fit: 0.1 };
    const result = boundCheckWeights(CURRENT, proposed);
    expect(result.ok).toBe(true);
  });

  it("rejects a weight outside [0,1]", () => {
    const proposed = { ...CURRENT, recency: 1.2 };
    const result = boundCheckWeights(CURRENT, proposed);
    expect(result.ok).toBe(false);
  });

  it("rejects a single-run change larger than +/-0.1", () => {
    const proposed = { ...CURRENT, trend_strength: 0.5, niche_fit: -0.05 };
    const result = boundCheckWeights(CURRENT, proposed);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes("trend_strength"))).toBe(true);
  });

  it("rejects weights that do not sum to ~1.0", () => {
    const proposed = { ...CURRENT, recency: 0.05 };
    const result = boundCheckWeights(CURRENT, proposed);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes("sum"))).toBe(true);
  });
});
