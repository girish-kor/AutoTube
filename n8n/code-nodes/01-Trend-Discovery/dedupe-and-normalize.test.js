import { describe, expect, it } from "vitest";
import { dedupeAndNormalize, normalizeTitle, stripHtml } from "./dedupe-and-normalize.js";

describe("stripHtml", () => {
  it("removes tags and trims", () => {
    expect(stripHtml("<b>Hello</b>  world ")).toBe("Hello  world");
  });
});

describe("normalizeTitle", () => {
  it("collapses whitespace after stripping tags", () => {
    expect(normalizeTitle("<i>Big   News</i>   Today")).toBe("Big News Today");
  });
});

describe("dedupeAndNormalize", () => {
  it("produces one row per unique title per source", () => {
    const youtube = [
      { title: "Robots Today", viewCount: 100000 },
      { title: "robots today", viewCount: 5 }, // duplicate, different case
    ];
    const trends = [{ title: "Robots Today" }]; // same title, different source -> kept

    const rows = dedupeAndNormalize("chan-1", "2026-08-08", youtube, trends);
    expect(rows).toHaveLength(2);
    expect(rows[0].source).toBe("youtube_trending");
    expect(rows[1].source).toBe("google_trends");
  });

  it("scores earlier-ranked, higher-view items higher", () => {
    const youtube = [
      { title: "Top Story", viewCount: 1000000 },
      { title: "Lower Story", viewCount: 10 },
    ];
    const rows = dedupeAndNormalize("chan-1", "2026-08-08", youtube, []);
    expect(rows[0].trend_score).toBeGreaterThan(rows[1].trend_score);
  });

  it("drops entries with empty titles", () => {
    const rows = dedupeAndNormalize("chan-1", "2026-08-08", [{ title: "   " }], []);
    expect(rows).toHaveLength(0);
  });
});
