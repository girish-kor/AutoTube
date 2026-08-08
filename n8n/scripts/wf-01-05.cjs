const {
  readCodeFile, CRED, geminiRequest, pgLoadGuard,
  scheduleTrigger, executeWorkflowTrigger, postgres, httpRequest, code, ifNode,
  splitInBatches, merge, noOp, htmlExtract, buildWorkflow, write,
} = require("./gen-workflows.cjs");

// --- 01-Trend-Discovery ---------------------------------------------------
{
  const cron = scheduleTrigger("Cron", { cron: "30 0 * * *", timezone: "UTC" });
  const getChannels = postgres("Get Active Channels", { query: "SELECT * FROM channels WHERE active = true" });
  const loopChannels = splitInBatches("Loop Channels", 1);

  const ytTrending = httpRequest("YouTube Trending", {
    url: "=https://youtube.googleapis.com/youtube/v3/videos?chart=mostPopular&regionCode={{$json.region}}&videoCategoryId={{$json.category}}&part=snippet,statistics&maxResults=25",
    credentials: CRED.youtube("CHANNEL"),
    notes: "Credential is per-channel (youtube-oauth-<channel>); deployment maps the active credential per loop iteration (docs/CONFIG.md §2).",
  });
  const trendsRss = httpRequest("Google Trends RSS", {
    url: "=https://trends.google.com/trending/rss?geo={{$json.region}}",
  });
  const mergeSources = merge("Merge Sources");

  const dedupeCode = code(
    "Dedupe & Normalize",
    readCodeFile("01-Trend-Discovery/dedupe-and-normalize.js") +
      "\n\nreturn dedupeAndNormalize($json.channel_id, new Date().toISOString().slice(0,10), $json.youtube_items, $json.trends_items).map(row => ({ json: row }));"
  );

  const upsertTopics = postgres("Upsert Topics", {
    query:
      "INSERT INTO topics (channel_id, title, source, trend_score, discovered_date) " +
      "VALUES ($1, $2, $3, $4, $5) ON CONFLICT (channel_id, discovered_date, source, title) DO NOTHING",
    params: "[$json.channel_id, $json.title, $json.source, $json.trend_score, $json.discovered_date]",
  });

  const logQuota = postgres("Log Quota", {
    query:
      "INSERT INTO api_usage (api_name, usage_date, units_used, unit_limit) VALUES ('youtube_data_v3', CURRENT_DATE, 1, 10000) " +
      "ON CONFLICT (api_name, usage_date) DO UPDATE SET units_used = api_usage.units_used + 1",
  });

  const nodes = [cron, getChannels, loopChannels, ytTrending, trendsRss, mergeSources, dedupeCode, upsertTopics, logQuota];
  const edges = [
    ["Cron", "Get Active Channels"],
    ["Get Active Channels", "Loop Channels"],
    ["Loop Channels", "YouTube Trending"],
    ["Loop Channels", "Google Trends RSS"],
    ["YouTube Trending", "Merge Sources", 0, 0],
    ["Google Trends RSS", "Merge Sources", 0, 1],
    ["Merge Sources", "Dedupe & Normalize"],
    ["Dedupe & Normalize", "Upsert Topics"],
    ["Upsert Topics", "Log Quota"],
    ["Log Quota", "Loop Channels"],
  ];
  write(buildWorkflow({ name: "01-Trend-Discovery", nodes, edges }));
}

// --- 02-Topic-Selection ----------------------------------------------------
{
  const trigger = executeWorkflowTrigger("Trigger", ["channel_id"]);

  const guardQuery = postgres("Guard: video-in-flight?", {
    query:
      "SELECT (SELECT count(*) FROM videos WHERE channel_id = $1 AND stage NOT IN " +
      "('PUBLISHED','SHORTS_PUBLISHED','CROSSPOSTED','FAILED')) AS in_flight_count, " +
      "(SELECT daily_long_form_quota FROM channels WHERE id = $1) AS daily_quota",
    params: "[$json.channel_id]",
  });
  const guardIf = ifNode("Guard: Under Quota?", {
    combinator: "and",
    conditions: [
      { leftValue: "={{$json.in_flight_count}}", rightValue: "={{$json.daily_quota}}", operator: { type: "number", operation: "lt" } },
    ],
  });
  const exitNoOp = noOp("Exit: Quota Reached", "Safe re-dispatch — Master will retry next cycle once in-flight videos advance.");

  const fetchPending = postgres("Fetch Pending Topics", {
    query: "SELECT * FROM topics WHERE channel_id = $1 AND status = 'PENDING' AND discovered_date = CURRENT_DATE",
    params: "[$json.channel_id]",
  });
  const loadWeights = postgres("Load Scoring Weights", {
    query: "SELECT value FROM config WHERE key = 'topic_scoring_weights'",
  });

  const scoreTopics = geminiRequest("Score Topics (Gemini)", {
    promptExpr:
      "=You are scoring candidate YouTube video topics for the niche \"{{$json.niche}}\".\\n" +
      "For each topic, score 0-100 on: recency, trend_strength, evergreen_potential,\\n" +
      "competition_gap (opportunity where saturation is low), niche_fit.\\n" +
      "Combine using these weights: {{JSON.stringify($json.weights)}}.\\n" +
      "Reject (score 0) any topic that is: sexual, violent, hateful, medical/legal/financial\\n" +
      "advice framed as fact, about a real private individual, or clearly designed to\\n" +
      "mislead (title promises content the topic can't deliver).\\n" +
      "Return strict JSON only.\\n\\nTopics:\\n{{JSON.stringify($json.topics)}}",
    schema: {
      type: "object",
      properties: {
        scored: {
          type: "array",
          items: {
            type: "object",
            properties: {
              topic_id: { type: "string" },
              llm_score: { type: "number" },
              rejected: { type: "boolean" },
              reason: { type: "string" },
            },
            required: ["topic_id", "llm_score", "rejected"],
          },
        },
      },
      required: ["scored"],
    },
  });

  const pickTop = code(
    "Pick Top",
    "const scored = $input.first().json.scored.filter(s => !s.rejected);\n" +
      "if (!scored.length) throw new Error('no eligible topics after scoring/rejection');\n" +
      "scored.sort((a, b) => b.llm_score - a.llm_score);\n" +
      "return [{ json: scored[0] }];"
  );

  const markSelected = postgres("Mark Selected", {
    query: "UPDATE topics SET status = 'SELECTED', llm_score = $1 WHERE id = $2",
    params: "[$json.llm_score, $json.topic_id]",
  });
  const markRejected = postgres("Mark Rejected", {
    query:
      "UPDATE topics SET status = 'REJECTED' WHERE channel_id = $1 AND discovered_date = CURRENT_DATE AND id != $2",
    params: "[$json.channel_id, $json.topic_id]",
  });

  const createVideo = postgres("Create Video Row", {
    query: "INSERT INTO videos (channel_id, topic_id, stage) VALUES ($1, $2, 'TOPIC_SELECTED') RETURNING id",
    params: "[$json.channel_id, $json.topic_id]",
  });

  const nodes = [
    trigger, guardQuery, guardIf, exitNoOp, fetchPending, loadWeights,
    scoreTopics, pickTop, markSelected, markRejected, createVideo,
  ];
  const edges = [
    ["Trigger", "Guard: video-in-flight?"],
    ["Guard: video-in-flight?", "Guard: Under Quota?"],
    ["Guard: Under Quota?", "Fetch Pending Topics", 0, 0],
    ["Guard: Under Quota?", "Exit: Quota Reached", 1, 0],
    ["Fetch Pending Topics", "Load Scoring Weights"],
    ["Load Scoring Weights", "Score Topics (Gemini)"],
    ["Score Topics (Gemini)", "Pick Top"],
    ["Pick Top", "Mark Selected"],
    ["Mark Selected", "Mark Rejected"],
    ["Mark Rejected", "Create Video Row"],
  ];
  write(buildWorkflow({ name: "02-Topic-Selection", nodes, edges }));
}

// --- 03-Research ------------------------------------------------------------
{
  const trigger = executeWorkflowTrigger("Trigger", ["video_id"]);
  const loadVideo = pgLoadGuard("Video", "TOPIC_SELECTED");
  const guardIf = ifNode("Guard: Stage = TOPIC_SELECTED?", {
    combinator: "and",
    conditions: [{ leftValue: "={{$json.stage}}", rightValue: "TOPIC_SELECTED", operator: { type: "string", operation: "equals" } }],
  });
  const exitNoOp = noOp("Exit: Wrong Stage");

  const wikiSearch = httpRequest("Wikipedia Search", {
    url: "=https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch={{encodeURIComponent($json.topic_title)}}&format=json",
  });
  const loopTop5 = splitInBatches("Loop Top-5 Pages", 1);
  const wikiSummaries = httpRequest("Wikipedia Summaries", {
    url: "=https://en.wikipedia.org/api/rest_v1/page/summary/{{encodeURIComponent($json.title)}}",
  });
  const ddgSearch = httpRequest("DuckDuckGo Search", {
    url: "=https://html.duckduckgo.com/html/?q={{encodeURIComponent($json.topic_title)}}",
  });
  const ddgExtract = htmlExtract("DuckDuckGo Extract", [
    { key: "snippets", cssSelector: ".result__snippet", returnArray: true },
  ]);

  const compileResearch = geminiRequest("Compile Research (Gemini)", {
    promptExpr:
      "=Compile factual notes for a video about \"{{$json.topic_title}}\" using ONLY the source\\n" +
      "material below. Do not add facts not present in the sources. For each fact,\\n" +
      "copy the exact source_url it came from. Produce at least 8 distinct facts if\\n" +
      "the sources support it; if they don't, return fewer — never invent facts to\\n" +
      "reach a count. Flag any source material that is opinion, not fact.\\n\\n" +
      "Sources:\\n{{JSON.stringify($json.sources)}}",
    schema: {
      type: "object",
      properties: {
        facts: {
          type: "array",
          items: {
            type: "object",
            properties: { claim: { type: "string" }, source_url: { type: "string" } },
            required: ["claim", "source_url"],
          },
        },
      },
      required: ["facts"],
    },
  });

  const validateNonEmpty = ifNode("Validate Non-Empty", {
    combinator: "and",
    conditions: [
      { leftValue: "={{$json.facts.length}}", rightValue: 8, operator: { type: "number", operation: "gte" } },
    ],
  });

  const persist = postgres("Persist", {
    query: "UPDATE videos SET research_json = $1, stage = 'RESEARCHED' WHERE id = $2",
    params: "[JSON.stringify($json), $json.video_id]",
  });

  const nodes = [
    trigger, loadVideo, guardIf, exitNoOp, wikiSearch, loopTop5, wikiSummaries,
    ddgSearch, ddgExtract, compileResearch, validateNonEmpty, persist,
  ];
  const edges = [
    ["Trigger", "Load Video"],
    ["Load Video", "Guard: Stage = TOPIC_SELECTED?"],
    ["Guard: Stage = TOPIC_SELECTED?", "Wikipedia Search", 0, 0],
    ["Guard: Stage = TOPIC_SELECTED?", "Exit: Wrong Stage", 1, 0],
    ["Wikipedia Search", "Loop Top-5 Pages"],
    ["Loop Top-5 Pages", "Wikipedia Summaries"],
    ["Wikipedia Summaries", "Loop Top-5 Pages"],
    ["Loop Top-5 Pages", "DuckDuckGo Search"],
    ["DuckDuckGo Search", "DuckDuckGo Extract"],
    ["DuckDuckGo Extract", "Compile Research (Gemini)"],
    ["Compile Research (Gemini)", "Validate Non-Empty"],
    ["Validate Non-Empty", "Persist", 0, 0],
  ];
  write(buildWorkflow({ name: "03-Research", nodes, edges }));
}

// --- 04-Script-Writer --------------------------------------------------------
{
  const trigger = executeWorkflowTrigger("Trigger", ["video_id"]);
  const loadVideo = pgLoadGuard("Video", "RESEARCHED");
  const guardIf = ifNode("Guard: Stage = RESEARCHED?", {
    combinator: "and",
    conditions: [{ leftValue: "={{$json.stage}}", rightValue: "RESEARCHED", operator: { type: "string", operation: "equals" } }],
  });
  const exitNoOp = noOp("Exit: Wrong Stage");

  const generateScript = geminiRequest("Generate Script (Gemini)", {
    promptExpr:
      "=Write a spoken-word YouTube script on \"{{$json.topic_title}}\", 1200-2200 words,\\n" +
      "8-15 minutes narrated. Base every factual claim strictly on the provided\\n" +
      "research facts — do not introduce unsourced claims. Break the script into\\n" +
      "8-20 scenes. For each scene provide: narration text (natural spoken sentences,\\n" +
      "no stage directions), a visual_prompt (a text-to-image prompt describing what\\n" +
      "should be shown on screen, safe-for-work, no real people's likeness, no\\n" +
      "copyrighted characters/logos/brands), and duration_estimate_sec.\\n" +
      "Open with a hook in the first scene. End with a summary, not a sales pitch.\\n\\n" +
      "Research facts:\\n{{JSON.stringify($json.research_json.facts)}}",
    schema: {
      type: "object",
      properties: {
        scenes: {
          type: "array",
          items: {
            type: "object",
            properties: {
              narration: { type: "string" },
              visual_prompt: { type: "string" },
              duration_estimate_sec: { type: "number" },
            },
            required: ["narration", "visual_prompt", "duration_estimate_sec"],
          },
        },
      },
      required: ["scenes"],
    },
  });

  const validateStructure = code(
    "Validate Structure",
    readCodeFile("04-Script-Writer/validate-structure.js") +
      "\n\nconst result = validateScript($json);\n" +
      "if (!result.ok) throw new Error('script validation failed: ' + result.errors.join('; '));\n" +
      "return [{ json: $json }];"
  );

  const hashScript = code(
    "Hash Script",
    "const crypto = require('crypto');\n" +
      "const hash = crypto.createHash('sha256').update(JSON.stringify($json)).digest('hex');\n" +
      "return [{ json: { ...$json, script_hash: hash } }];"
  );

  const persist = postgres("Persist", {
    query: "UPDATE videos SET script_json = $1, script_hash = $2, stage = 'SCRIPTED' WHERE id = $3",
    params: "[JSON.stringify($json), $json.script_hash, $json.video_id]",
  });

  const nodes = [trigger, loadVideo, guardIf, exitNoOp, generateScript, validateStructure, hashScript, persist];
  const edges = [
    ["Trigger", "Load Video"],
    ["Load Video", "Guard: Stage = RESEARCHED?"],
    ["Guard: Stage = RESEARCHED?", "Generate Script (Gemini)", 0, 0],
    ["Guard: Stage = RESEARCHED?", "Exit: Wrong Stage", 1, 0],
    ["Generate Script (Gemini)", "Validate Structure"],
    ["Validate Structure", "Hash Script"],
    ["Hash Script", "Persist"],
  ];
  write(buildWorkflow({ name: "04-Script-Writer", nodes, edges }));
}

// --- 05-Fact-Check ------------------------------------------------------------
{
  const trigger = executeWorkflowTrigger("Trigger", ["video_id"]);
  const loadVideo = pgLoadGuard("Video", "SCRIPTED");
  const guardIf = ifNode("Guard: Stage = SCRIPTED?", {
    combinator: "and",
    conditions: [{ leftValue: "={{$json.stage}}", rightValue: "SCRIPTED", operator: { type: "string", operation: "equals" } }],
  });
  const skipIfChecked = postgres("Skip If Already Checked", {
    query: "SELECT count(*) AS already_checked FROM fact_checks fc JOIN videos v ON v.id = fc.video_id " +
      "WHERE v.id = $1 AND v.script_hash = $2",
    params: "[$json.video_id, $json.script_hash]",
  });
  const exitNoOp = noOp("Exit: Wrong Stage Or Already Checked");

  const extractClaims = code(
    "Extract Claims",
    readCodeFile("05-Fact-Check/extract-claims.js") +
      "\n\nreturn [{ json: { ...$json, claims: extractClaims($json.script_json) } }];"
  );

  const verifyClaims = geminiRequest("Verify Claims (Gemini)", {
    promptExpr:
      "=For each claim below, decide:\\n" +
      "- VERIFIED: claim is directly supported by one of the research facts.\\n" +
      "- REWRITTEN: claim is close to a research fact but overstates/misstates it —\\n" +
      "  provide a corrected rewritten_claim that stays supported by the facts.\\n" +
      "- REMOVED: claim has no support in the research facts at all.\\n" +
      "Default to REMOVED when uncertain. Never mark VERIFIED without citing the\\n" +
      "exact source_url that supports it.\\n\\nClaims:\\n{{JSON.stringify($json.claims)}}\\n\\n" +
      "Research facts:\\n{{JSON.stringify($json.research_json.facts)}}",
    schema: {
      type: "object",
      properties: {
        verdicts: {
          type: "array",
          items: {
            type: "object",
            properties: {
              claim: { type: "string" },
              status: { type: "string", enum: ["VERIFIED", "REWRITTEN", "REMOVED"] },
              source_url: { type: "string" },
              rewritten_claim: { type: "string" },
            },
            required: ["claim", "status"],
          },
        },
      },
      required: ["verdicts"],
    },
  });

  const applyVerdicts = code(
    "Apply Verdicts",
    readCodeFile("05-Fact-Check/apply-verdicts.js") +
      "\n\nconst patched = applyVerdicts($json.script_json, $json.verdicts);\n" +
      "return [{ json: { ...$json, script_json: patched } }];"
  );

  const logFactChecks = postgres("Log Fact Checks", {
    query:
      "INSERT INTO fact_checks (video_id, claim, scene_index, verification_status, source_url, rewritten_claim) " +
      "VALUES ($1, $2, $3, $4, $5, $6)",
    params: "[$json.video_id, $json.claim, $json.scene_index, $json.status, $json.source_url, $json.rewritten_claim]",
    notes: "Bulk-inserted once per verdict item (n8n auto-iterates Postgres nodes over incoming items).",
  });

  const persist = postgres("Persist", {
    query: "UPDATE videos SET script_json = $1, stage = 'FACT_CHECKED' WHERE id = $2",
    params: "[JSON.stringify($json.script_json), $json.video_id]",
  });

  const nodes = [
    trigger, loadVideo, guardIf, skipIfChecked, exitNoOp,
    extractClaims, verifyClaims, applyVerdicts, logFactChecks, persist,
  ];
  const edges = [
    ["Trigger", "Load Video"],
    ["Load Video", "Guard: Stage = SCRIPTED?"],
    ["Guard: Stage = SCRIPTED?", "Skip If Already Checked", 0, 0],
    ["Guard: Stage = SCRIPTED?", "Exit: Wrong Stage Or Already Checked", 1, 0],
    ["Skip If Already Checked", "Extract Claims"],
    ["Extract Claims", "Verify Claims (Gemini)"],
    ["Verify Claims (Gemini)", "Apply Verdicts"],
    ["Apply Verdicts", "Log Fact Checks"],
    ["Log Fact Checks", "Persist"],
  ];
  write(buildWorkflow({ name: "05-Fact-Check", nodes, edges }));
}
