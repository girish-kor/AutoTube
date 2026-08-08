// Compliance/policy regression fixture set (docs/TESTING.md §7): known-bad
// topics/scripts run through the deterministic parts of 05-Fact-Check and
// 12-Compliance-Gate, asserting each is correctly blocked. Prevents a
// silent regression in the denylist or claim-removal logic from ever
// reaching production undetected. The three named fixtures from
// TESTING.md §7 are: a violence keyword, medical-advice phrasing, and a
// script with an artificially inserted unsourced claim.
import { describe, expect, it } from "vitest";
import { checkRestrictedTopic } from "../12-Compliance-Gate/restricted-topic-check.js";
import { checkMetadataAccuracy } from "../12-Compliance-Gate/metadata-accuracy-check.js";
import { extractClaims } from "../05-Fact-Check/extract-claims.js";
import { applyVerdicts } from "../05-Fact-Check/apply-verdicts.js";

// Mirrors db/migrations/0002_seed_denylist.sql.
const DENYLIST = [
  "graphic violence", "self-harm", "suicide method", "dangerous challenge",
  "how to make a bomb", "how to make explosives",
  "hate speech", "racial slur", "ethnic cleansing", "genocide denial",
  "nudity", "explicit sexual content", "pornographic",
  "firearm assembly instructions", "gun modification instructions",
  "drug synthesis instructions", "meth recipe", "how to manufacture drugs",
  "guaranteed cure", "guaranteed investment return", "guaranteed profit",
  "definitive medical diagnosis", "legal advice for your specific case",
  "election fraud claim", "voting machines were hacked", "the election was stolen",
];

describe("compliance regression fixture: violence keyword", () => {
  it("blocks a script containing an explicit dangerous-act instruction", () => {
    const scriptJson = {
      scenes: [{ narration: "This tutorial explains how to make a bomb using household items." }],
    };
    const result = checkRestrictedTopic("Household Chemistry", "A fun science video", scriptJson, DENYLIST);
    expect(result.passed).toBe(false);
    expect(result.details).toContain("how to make a bomb");
  });
});

describe("compliance regression fixture: medical-advice phrasing", () => {
  it("blocks a script framing a diagnosis as definitive fact", () => {
    const scriptJson = {
      scenes: [{ narration: "Based on these symptoms, this is a definitive medical diagnosis of the condition." }],
    };
    const result = checkRestrictedTopic("Health Symptoms Explained", "General info", scriptJson, DENYLIST);
    expect(result.passed).toBe(false);
    expect(result.details).toContain("definitive medical diagnosis");
  });
});

describe("compliance regression fixture: artificially inserted unsourced claim", () => {
  it("extracts the unsourced claim as a discrete claim, then the fact-check " +
    "REMOVED verdict strips it from the final script", () => {
    const scriptJson = {
      scenes: [
        {
          narration: "The Eiffel Tower was completed in 1889. It is secretly 47cm taller every leap year.",
          duration_estimate_sec: 30,
        },
      ],
    };

    const claims = extractClaims(scriptJson);
    expect(claims.map((c) => c.claim)).toContain(
      "It is secretly 47cm taller every leap year."
    );

    // Simulates Gemini's verdict (docs/AI_PIPELINE.md §4): the fabricated
    // claim has no supporting research fact, so it defaults to REMOVED.
    const verdicts = [
      { claim: "It is secretly 47cm taller every leap year.", status: "REMOVED", scene_index: 0 },
    ];
    const patched = applyVerdicts(scriptJson, verdicts);

    expect(patched.scenes[0].narration).toBe("The Eiffel Tower was completed in 1889.");
    expect(patched.scenes[0].narration).not.toContain("47cm taller");
  });
});

describe("compliance regression fixture: clickbait metadata mismatch", () => {
  it("blocks a title/description with no keyword overlap to the actual script", () => {
    const scriptJson = { scenes: [{ narration: "A calm walkthrough of common kitchen herbs and spices." }] };
    const result = checkMetadataAccuracy(
      "You Won't Believe This Shocking Government Secret",
      "The truth they don't want you to know",
      scriptJson
    );
    expect(result.passed).toBe(false);
  });
});

describe("compliance regression fixture: clean content passes both gates", () => {
  it("does not block ordinary, well-sourced, accurately-titled content", () => {
    const scriptJson = {
      scenes: [{ narration: "This video explains how photosynthesis converts sunlight into chemical energy." }],
    };
    const title = "How Photosynthesis Converts Sunlight Into Energy";
    const description = "Learn how photosynthesis converts sunlight into chemical energy in plants.";
    const restricted = checkRestrictedTopic(title, description, scriptJson, DENYLIST);
    const accurate = checkMetadataAccuracy(title, description, scriptJson);
    expect(restricted.passed).toBe(true);
    expect(accurate.passed).toBe(true);
  });
});
