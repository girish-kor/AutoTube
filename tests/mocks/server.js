// Local stub server for n8n workflow integration tests (docs/TESTING.md §5).
// Point n8n HTTP Request nodes at this server (via a test-profile base URL
// override) instead of live Gemini/YouTube/Pollinations endpoints so
// workflow sub-chain tests are free, fast, and not dependent on live quota.
// Returns canned, schema-valid responses for exactly the calls each
// workflow makes (docs/N8N_NODES.md).
import { pathToFileURL } from "node:url";
import express from "express";

const app = express();
app.use(express.json({ limit: "10mb" }));

// --- Gemini (generativelanguage.googleapis.com) ---------------------------
app.post("/v1beta/models/:model\\:generateContent", (req, res) => {
  const prompt = req.body?.contents?.[0]?.parts?.[0]?.text || "";
  let payload;

  if (prompt.includes("scoring candidate YouTube video topics")) {
    payload = { scored: [{ topic_id: "fixture-topic-1", llm_score: 88.5, rejected: false }] };
  } else if (prompt.includes("Compile factual notes")) {
    payload = {
      facts: Array.from({ length: 8 }, (_, i) => ({
        claim: `Fixture fact ${i + 1}.`,
        source_url: `https://en.wikipedia.org/wiki/Fixture_${i + 1}`,
      })),
    };
  } else if (prompt.includes("Write a spoken-word YouTube script")) {
    payload = {
      scenes: Array.from({ length: 8 }, (_, i) => ({
        narration: "Fixture narration sentence. ".repeat(20),
        visual_prompt: `Fixture visual prompt for scene ${i}`,
        duration_estimate_sec: 60,
      })),
    };
  } else if (prompt.includes("decide:\n- VERIFIED")) {
    payload = { verdicts: [{ claim: "Fixture narration sentence.", status: "VERIFIED", source_url: "https://en.wikipedia.org/wiki/Fixture_1" }] };
  } else if (prompt.includes("thumbnail concept")) {
    payload = { art_prompt: "a bold fixture illustration", overlay_text: "Fixture Fact" };
  } else if (prompt.includes("Generate SEO metadata")) {
    payload = {
      title: "Fixture Title",
      description: "Fixture description.",
      tags: ["fixture", "test"],
      category_id: "27",
      chapters: [{ time: "00:00", label: "Intro" }],
    };
  } else if (prompt.includes("short-form YouTube Shorts")) {
    payload = { title: "Fixture Short", description: "Fixture short description.", tags: ["fixture"] };
  } else if (prompt.includes("propose adjusted weights")) {
    payload = {
      topic_scoring_weights: { recency: 0.2, trend_strength: 0.25, evergreen_potential: 0.2, competition_gap: 0.2, niche_fit: 0.15 },
      seo_prompt_examples: ["Fixture Title Example"],
    };
  } else {
    payload = {};
  }

  res.json({ candidates: [{ content: { parts: [{ text: JSON.stringify(payload) }] } }] });
});

// --- YouTube Data API v3 ---------------------------------------------------
app.get("/youtube/v3/videos", (req, res) => {
  res.json({
    items: Array.from({ length: 5 }, (_, i) => ({
      id: `fixture-yt-${i}`,
      snippet: { title: `Fixture Trending Video ${i}` },
      statistics: { viewCount: String(100000 - i * 1000) },
    })),
  });
});
app.get("/youtube/v3/search", (req, res) => {
  res.json({ items: [{ snippet: { title: "Fixture Competitor Title", description: "Fixture description" } }] });
});
app.post("/upload/youtube/v3/videos", (req, res) => res.json({ id: "fixture-video-id" }));
app.post("/upload/youtube/v3/thumbnails/set", (req, res) => res.json({}));
app.post("/upload/youtube/v3/captions", (req, res) => res.json({ id: "fixture-caption-id" }));

app.get("/v2/reports", (req, res) => {
  res.json({
    rows: [["fixture-video-id", 100, 500, 300, 10, 2, 1]],
    columnHeaders: [
      { name: "video" }, { name: "views" }, { name: "estimatedMinutesWatched" },
      { name: "averageViewDuration" }, { name: "likes" }, { name: "comments" }, { name: "subscribersGained" },
    ],
  });
});

// --- Google Trends RSS -------------------------------------------------------
app.get("/trending/rss", (req, res) => {
  res.type("application/rss+xml").send(
    "<rss><channel><item><title>Fixture Trend</title></item></channel></rss>"
  );
});

// --- Wikipedia ---------------------------------------------------------------
app.get("/w/api.php", (req, res) => {
  res.json({ query: { search: [{ title: "Fixture Page" }] } });
});
app.get("/api/rest_v1/page/summary/:title", (req, res) => {
  res.json({ title: req.params.title, extract: "Fixture summary text.", content_urls: { desktop: { page: "https://en.wikipedia.org/wiki/Fixture" } } });
});

// --- DuckDuckGo HTML -----------------------------------------------------------
app.get("/html/", (req, res) => {
  res.type("html").send('<div class="result__snippet">Fixture DuckDuckGo snippet</div>');
});

// --- Pollinations.ai -----------------------------------------------------------
const TINY_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64"
);
app.get("/prompt/:prompt", (req, res) => {
  res.type("image/png").send(TINY_PNG);
});

// --- AudD.io -------------------------------------------------------------------
app.post("/", (req, res) => {
  res.json({ status: "success", result: null });
});

// --- Meta Graph API --------------------------------------------------------------
app.post("/v19.0/:userId/media", (req, res) => res.json({ id: "fixture-creation-id" }));
app.post("/v19.0/:userId/media_publish", (req, res) => res.json({ id: "fixture-ig-post-id" }));

// --- TikTok Content Posting API ---------------------------------------------------
app.post("/v2/post/publish/video/init/", (req, res) => {
  res.json({ data: { publish_id: "fixture-publish-id", upload_url: "http://localhost:PORT/tiktok-upload" } });
});
app.put("/tiktok-upload", (req, res) => res.json({}));

// --- Telegram Bot API --------------------------------------------------------------
app.post(/\/bot.*\/sendMessage/, (req, res) => res.json({ ok: true, result: { message_id: 1 } }));

// Only binds a port when run directly (`node mocks/server.js`) — importing
// this module (e.g. from a test that wants its own ephemeral port) never
// has the side effect of starting a listener.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = process.env.MOCK_SERVER_PORT || 4000;
  app.listen(port, () => console.log(`mock external-API server listening on :${port}`));
}

export default app;
