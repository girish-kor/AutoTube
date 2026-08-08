const {
  readCodeFile, CRED, geminiRequest, pgLoadGuard,
  executeWorkflowTrigger, scheduleTrigger, postgres, httpRequest, code, ifNode,
  splitInBatches, noOp, buildWorkflow, write,
} = require("./gen-workflows.cjs");

function mediaWorkerRequest(name, endpoint, jsonBody, notes) {
  return httpRequest(name, {
    method: "POST",
    url: `=\{\{$env.MEDIA_WORKER_BASE_URL\}\}${endpoint}`,
    jsonBody,
    notes: notes || "docs/N8N_NODES.md preamble: Response Format=JSON, Timeout=300000ms, Retry 3x/5000ms.",
  });
}

function stageGuard(stage) {
  return ifNode(`Guard: Stage = ${stage}?`, {
    combinator: "and",
    conditions: [{ leftValue: "={{$json.stage}}", rightValue: stage, operator: { type: "string", operation: "equals" } }],
  });
}

// --- 14-Shorts-Extraction ------------------------------------------------------
{
  const trigger = executeWorkflowTrigger("Trigger", ["video_id"]);
  const loadVideo = pgLoadGuard("Video", "PUBLISHED");
  const guardIf = stageGuard("PUBLISHED");
  const exitNoOp = noOp("Exit: Wrong Stage");

  const scoreHighlights = mediaWorkerRequest("Score Highlights", "/clip", {
    video_id: "={{$json.video_id}}",
    captions_path: "={{$json.captions_path}}",
    script_json: "={{$json.script_json}}",
    top_n: "={{Number($env.SHORTS_PER_VIDEO || 3)}}",
  });

  const loopCandidates = splitInBatches("Loop Candidates", 1);

  const renderShort = mediaWorkerRequest("Render Short", "/render", {
    channel_id: "={{$('Load Video').first().json.channel_id}}",
    video_id: "={{$('Load Video').first().json.video_id}}",
    source: "={{$('Load Video').first().json.render_path}}",
    start_ts: "={{$json.start_ts}}",
    end_ts: "={{$json.end_ts}}",
    aspect: "9:16",
    burn_captions: true,
    captions_path: "={{$('Load Video').first().json.captions_path}}",
    clip_index: "={{$runIndex}}",
  });

  const recordShort = postgres("Record Short", {
    query:
      "INSERT INTO shorts (parent_video_id, clip_index, start_ts, end_ts, score, render_path) " +
      "VALUES ($1, $2, $3, $4, $5, $6)",
    params:
      "[$('Load Video').first().json.video_id, $runIndex, $('Loop Candidates').item.json.start_ts, " +
      "$('Loop Candidates').item.json.end_ts, $('Loop Candidates').item.json.score, $json.render_path]",
  });

  const persistParent = postgres("Persist Parent", {
    query: "UPDATE videos SET stage = 'SHORTS_EXTRACTED' WHERE id = $1",
    params: "[$('Load Video').first().json.video_id]",
  });

  const nodes = [trigger, loadVideo, guardIf, exitNoOp, scoreHighlights, loopCandidates, renderShort, recordShort, persistParent];
  const edges = [
    ["Trigger", "Load Video"],
    ["Load Video", "Guard: Stage = PUBLISHED?"],
    ["Guard: Stage = PUBLISHED?", "Score Highlights", 0, 0],
    ["Guard: Stage = PUBLISHED?", "Exit: Wrong Stage", 1, 0],
    ["Score Highlights", "Loop Candidates"],
    ["Loop Candidates", "Render Short"],
    ["Render Short", "Record Short"],
    ["Record Short", "Loop Candidates"],
    ["Loop Candidates", "Persist Parent"],
  ];
  write(buildWorkflow({ name: "14-Shorts-Extraction", nodes, edges }));
}

// --- 15-Shorts-Publish --------------------------------------------------------
{
  const trigger = executeWorkflowTrigger("Trigger", ["video_id"]);
  const loadShorts = postgres("Load Shorts", {
    query: "SELECT * FROM shorts WHERE parent_video_id = $1 AND youtube_video_id IS NULL",
    params: "[$json.video_id]",
  });

  const generateShortSeo = geminiRequest("Generate Short SEO (Gemini)", {
    promptExpr:
      "=Write a short-form YouTube Shorts title/description/tags for this clip, derived\\n" +
      "from the parent video's metadata and this clip's own content. Title must include\\n" +
      "#Shorts. Keep description to 1-2 sentences plus 3-5 tags inherited from the\\n" +
      "parent's tag set, plus 1-2 trending hashtags.\\n\\n" +
      "Parent title: {{$json.parent_title}}\\nParent tags: {{JSON.stringify($json.parent_tags)}}\\n" +
      "Clip window: {{$json.start_ts}}-{{$json.end_ts}}s",
    schema: {
      type: "object",
      properties: {
        title: { type: "string" },
        description: { type: "string" },
        tags: { type: "array", items: { type: "string" } },
      },
      required: ["title", "description", "tags"],
    },
  });

  const loopUpload = splitInBatches("Loop & Upload", 1);
  const uploadShort = httpRequest("Upload Short", {
    method: "POST",
    url: "=https://youtube.googleapis.com/upload/youtube/v3/videos?part=snippet,status&uploadType=resumable",
    jsonBody: {
      snippet: { title: "={{$json.title}} #Shorts", description: "={{$json.description}}", tags: "={{$json.tags}}" },
      status: { privacyStatus: "={{$env.TEST_MODE === 'true' ? 'private' : 'public'}}", selfDeclaredMadeForKids: false, containsSyntheticMedia: true },
    },
    credentials: CRED.youtube("CHANNEL"),
  });

  const persistEach = postgres("Persist Each", {
    query: "UPDATE shorts SET youtube_video_id = $1, stage = 'SHORTS_PUBLISHED', published_at = now() WHERE id = $2",
    params: "[$json.id, $('Loop & Upload').item.json.id]",
  });

  const checkAllPublished = postgres("Check All Shorts Published", {
    query: "SELECT count(*) AS remaining FROM shorts WHERE parent_video_id = $1 AND youtube_video_id IS NULL",
    params: "[$('Load Shorts').first().json.parent_video_id]",
  });
  const allPublishedIf = ifNode("All Shorts Published?", {
    combinator: "and",
    conditions: [{ leftValue: "={{$json.remaining}}", rightValue: 0, operator: { type: "number", operation: "equals" } }],
  });
  const persistParent = postgres("Persist Parent", {
    query: "UPDATE videos SET stage = 'SHORTS_PUBLISHED' WHERE id = $1",
    params: "[$('Trigger').first().json.video_id]",
  });

  const nodes = [
    trigger, loadShorts, generateShortSeo, loopUpload, uploadShort, persistEach,
    checkAllPublished, allPublishedIf, persistParent,
  ];
  const edges = [
    ["Trigger", "Load Shorts"],
    ["Load Shorts", "Generate Short SEO (Gemini)"],
    ["Generate Short SEO (Gemini)", "Loop & Upload"],
    ["Loop & Upload", "Upload Short"],
    ["Upload Short", "Persist Each"],
    ["Persist Each", "Loop & Upload"],
    ["Loop & Upload", "Check All Shorts Published"],
    ["Check All Shorts Published", "All Shorts Published?"],
    ["All Shorts Published?", "Persist Parent", 0, 0],
  ];
  write(buildWorkflow({ name: "15-Shorts-Publish", nodes, edges }));
}

// --- 16-Crosspost -----------------------------------------------------------------
{
  const trigger = executeWorkflowTrigger("Trigger", ["video_id"]);
  const loadShorts = postgres("Load Shorts", {
    query: "SELECT * FROM shorts WHERE parent_video_id = $1 AND stage = 'SHORTS_PUBLISHED'",
    params: "[$json.video_id]",
  });

  const loopPlatforms = code(
    "Expand Shorts x Platforms",
    "const shorts = $input.all().map(i => i.json);\n" +
      "const platforms = ['INSTAGRAM', 'TIKTOK'];\n" +
      "return shorts.flatMap(s => platforms.map(p => ({ json: { ...s, platform: p } })));"
  );
  const loopBatch = splitInBatches("Loop Platforms", 1);

  const skipIfPosted = postgres("Skip If Posted", {
    query: "SELECT count(*) AS already_posted FROM crossposts WHERE short_id = $1 AND platform = $2",
    params: "[$json.id, $json.platform]",
  });
  const skipIf = ifNode("Not Yet Posted?", {
    combinator: "and",
    conditions: [{ leftValue: "={{$json.already_posted}}", rightValue: 0, operator: { type: "number", operation: "equals" } }],
  });

  const platformRoute = ifNode("Platform = Instagram?", {
    combinator: "and",
    conditions: [{ leftValue: "={{$('Loop Platforms').item.json.platform}}", rightValue: "INSTAGRAM", operator: { type: "string", operation: "equals" } }],
  });

  const igCreate = httpRequest("Instagram: Create Container", {
    method: "POST",
    url: "=https://graph.facebook.com/v19.0/{{$env.META_IG_USER_ID}}/media",
    jsonBody: {
      media_type: "REELS",
      video_url: "={{$('Loop Platforms').item.json.render_path}}",
      caption: "={{$('Loop Platforms').item.json.title}}",
    },
    credentials: CRED.meta(),
  });
  const igPublish = httpRequest("Instagram: Publish", {
    method: "POST",
    url: "=https://graph.facebook.com/v19.0/{{$env.META_IG_USER_ID}}/media_publish",
    jsonBody: { creation_id: "={{$json.creation_id}}" },
    credentials: CRED.meta(),
  });

  const ttInit = httpRequest("TikTok: Init Upload", {
    method: "POST",
    url: "=https://open.tiktokapis.com/v2/post/publish/video/init/",
    jsonBody: { post_info: { title: "={{$('Loop Platforms').item.json.title}}" } },
    credentials: CRED.tiktok(),
  });
  const ttUpload = httpRequest("TikTok: Upload Bytes", {
    method: "PUT",
    url: "={{$json.upload_url}}",
    notes: "Binary render file PUT to the upload_url returned by Init Upload.",
  });

  const recordCrosspost = postgres("Record Crosspost", {
    query:
      "INSERT INTO crossposts (short_id, platform, external_post_id, status, posted_at) " +
      "VALUES ($1, $2, $3, 'POSTED', now())",
    params:
      "[$('Loop Platforms').item.json.id, $('Loop Platforms').item.json.platform, " +
      "$json.id || $json.publish_id]",
  });

  const checkAllRecorded = postgres("Check All Crossposts Recorded", {
    query:
      "SELECT count(*) AS remaining FROM shorts s WHERE s.parent_video_id = $1 AND s.stage = 'SHORTS_PUBLISHED' " +
      "AND (SELECT count(*) FROM crossposts c WHERE c.short_id = s.id) < 2",
    params: "[$('Trigger').first().json.video_id]",
  });
  const allRecordedIf = ifNode("All Combinations Recorded?", {
    combinator: "and",
    conditions: [{ leftValue: "={{$json.remaining}}", rightValue: 0, operator: { type: "number", operation: "equals" } }],
  });
  const persistParent = postgres("Persist Parent", {
    query: "UPDATE videos SET stage = 'CROSSPOSTED' WHERE id = $1",
    params: "[$('Trigger').first().json.video_id]",
  });

  const nodes = [
    trigger, loadShorts, loopPlatforms, loopBatch, skipIfPosted, skipIf, platformRoute,
    igCreate, igPublish, ttInit, ttUpload, recordCrosspost, checkAllRecorded, allRecordedIf, persistParent,
  ];
  const edges = [
    ["Trigger", "Load Shorts"],
    ["Load Shorts", "Expand Shorts x Platforms"],
    ["Expand Shorts x Platforms", "Loop Platforms"],
    ["Loop Platforms", "Skip If Posted"],
    ["Skip If Posted", "Not Yet Posted?"],
    ["Not Yet Posted?", "Platform = Instagram?", 0, 0],
    ["Not Yet Posted?", "Loop Platforms", 1, 0],
    ["Platform = Instagram?", "Instagram: Create Container", 0, 0],
    ["Instagram: Create Container", "Instagram: Publish"],
    ["Instagram: Publish", "Record Crosspost"],
    ["Platform = Instagram?", "TikTok: Init Upload", 1, 0],
    ["TikTok: Init Upload", "TikTok: Upload Bytes"],
    ["TikTok: Upload Bytes", "Record Crosspost"],
    ["Record Crosspost", "Loop Platforms"],
    ["Loop Platforms", "Check All Crossposts Recorded"],
    ["Check All Crossposts Recorded", "All Combinations Recorded?"],
    ["All Combinations Recorded?", "Persist Parent", 0, 0],
  ];
  write(buildWorkflow({ name: "16-Crosspost", nodes, edges }));
}

// --- 17-Analytics-Collector --------------------------------------------------------
{
  const cron = scheduleTrigger("Cron", { cron: "0 3 * * *", timezone: "UTC" });

  const fetchTrackable = postgres("Fetch Trackable Videos", {
    query:
      "SELECT * FROM videos WHERE stage IN ('PUBLISHED','SHORTS_PUBLISHED','CROSSPOSTED') " +
      "AND published_at > now() - interval '90 days'",
  });
  const loop = splitInBatches("Loop", 10);
  const queryAnalytics = httpRequest("Query Analytics", {
    url:
      "=https://youtubeanalytics.googleapis.com/v2/reports?ids=channel==MINE&startDate={{$today.minus({days:1}).toFormat('yyyy-MM-dd')}}" +
      "&endDate={{$today.minus({days:1}).toFormat('yyyy-MM-dd')}}&metrics=views,estimatedMinutesWatched,averageViewDuration,likes,comments,subscribersGained" +
      "&dimensions=video&filters=video=={{$json.ids.join(',')}}",
    credentials: CRED.youtube("CHANNEL"),
  });
  const upsert = postgres("Upsert", {
    query:
      "INSERT INTO analytics_daily (video_id, is_short, metric_date, views, watch_time_minutes, " +
      "avg_view_duration_seconds, likes, comments, subscribers_gained) VALUES ($1, false, $2, $3, $4, $5, $6, $7, $8) " +
      "ON CONFLICT (video_id, is_short, metric_date) DO UPDATE SET views = EXCLUDED.views, " +
      "watch_time_minutes = EXCLUDED.watch_time_minutes, avg_view_duration_seconds = EXCLUDED.avg_view_duration_seconds, " +
      "likes = EXCLUDED.likes, comments = EXCLUDED.comments, subscribers_gained = EXCLUDED.subscribers_gained",
    params:
      "[$json.video_id, $json.date, $json.views, $json.estimatedMinutesWatched, $json.averageViewDuration, " +
      "$json.likes, $json.comments, $json.subscribersGained]",
  });

  const fetchTrackableShorts = postgres("Fetch Trackable Shorts", {
    query:
      "SELECT * FROM shorts WHERE stage IN ('SHORTS_PUBLISHED') AND published_at > now() - interval '90 days'",
  });
  const loopShorts = splitInBatches("Loop Shorts", 10);
  const queryAnalyticsShorts = httpRequest("Query Analytics (Shorts)", {
    url:
      "=https://youtubeanalytics.googleapis.com/v2/reports?ids=channel==MINE&startDate={{$today.minus({days:1}).toFormat('yyyy-MM-dd')}}" +
      "&endDate={{$today.minus({days:1}).toFormat('yyyy-MM-dd')}}&metrics=views,estimatedMinutesWatched,averageViewDuration,likes,comments,subscribersGained" +
      "&dimensions=video&filters=video=={{$json.ids.join(',')}}",
    credentials: CRED.youtube("CHANNEL"),
  });
  const upsertShorts = postgres("Upsert Shorts", {
    query:
      "INSERT INTO analytics_daily (video_id, is_short, metric_date, views, watch_time_minutes, " +
      "avg_view_duration_seconds, likes, comments, subscribers_gained) VALUES ($1, true, $2, $3, $4, $5, $6, $7, $8) " +
      "ON CONFLICT (video_id, is_short, metric_date) DO UPDATE SET views = EXCLUDED.views, " +
      "watch_time_minutes = EXCLUDED.watch_time_minutes, avg_view_duration_seconds = EXCLUDED.avg_view_duration_seconds, " +
      "likes = EXCLUDED.likes, comments = EXCLUDED.comments, subscribers_gained = EXCLUDED.subscribers_gained",
    params:
      "[$json.video_id, $json.date, $json.views, $json.estimatedMinutesWatched, $json.averageViewDuration, " +
      "$json.likes, $json.comments, $json.subscribersGained]",
  });

  const nodes = [
    cron, fetchTrackable, loop, queryAnalytics, upsert,
    fetchTrackableShorts, loopShorts, queryAnalyticsShorts, upsertShorts,
  ];
  const edges = [
    ["Cron", "Fetch Trackable Videos"],
    ["Fetch Trackable Videos", "Loop"],
    ["Loop", "Query Analytics"],
    ["Query Analytics", "Upsert"],
    ["Upsert", "Loop"],
    ["Cron", "Fetch Trackable Shorts"],
    ["Fetch Trackable Shorts", "Loop Shorts"],
    ["Loop Shorts", "Query Analytics (Shorts)"],
    ["Query Analytics (Shorts)", "Upsert Shorts"],
    ["Upsert Shorts", "Loop Shorts"],
  ];
  write(buildWorkflow({ name: "17-Analytics-Collector", nodes, edges }));
}

// --- 18-Optimization-Loop -----------------------------------------------------------
{
  const cron = scheduleTrigger("Cron", { cron: "0 4 * * 1", timezone: "UTC" });

  const aggregatePerformance = postgres("Aggregate Performance", {
    query:
      "SELECT t.source, v.category_id, extract(hour from v.published_at) AS publish_hour, " +
      "avg(a.views) AS avg_views, avg(a.ctr) AS avg_ctr, avg(a.watch_time_minutes) AS avg_watch_time " +
      "FROM analytics_daily a " +
      "JOIN videos v ON v.id = a.video_id AND a.is_short = false " +
      "JOIN topics t ON t.id = v.topic_id " +
      "WHERE a.metric_date >= now() - interval '7 days' " +
      "GROUP BY t.source, v.category_id, publish_hour",
  });

  const loadCurrentWeights = postgres("Load Current Weights", {
    query: "SELECT value FROM config WHERE key = 'topic_scoring_weights'",
  });

  const recomputeWeights = geminiRequest("Recompute Weights (Gemini)", {
    promptExpr:
      "=Given these aggregate performance stats per topic-source/category/publish-hour\\n" +
      "bucket, and the current scoring weights, propose adjusted weights that shift\\n" +
      "future selection toward higher-performing buckets. Keep all weights positive\\n" +
      "and summing to 1.0. Bound any single weight change to +/-0.1 per run to avoid\\n" +
      "overreacting to noise. Also propose up to 3 new few-shot title examples drawn\\n" +
      "from this period's top-CTR videos for future SEO generation.\\n\\n" +
      "Current weights: {{JSON.stringify($json.value)}}\\nAggregate stats: {{JSON.stringify($json.agg)}}",
    schema: {
      type: "object",
      properties: {
        topic_scoring_weights: { type: "object" },
        seo_prompt_examples: { type: "array", items: { type: "string" } },
      },
      required: ["topic_scoring_weights", "seo_prompt_examples"],
    },
  });

  const boundCheck = code(
    "Bound-Check Weights",
    readCodeFile("18-Optimization-Loop/bound-check-weights.js") +
      "\n\nconst current = $('Load Current Weights').first().json.value;\n" +
      "const result = boundCheckWeights(current, $json.topic_scoring_weights);\n" +
      "if (!result.ok) throw new Error('weight adjustment rejected: ' + result.errors.join('; '));\n" +
      "return [{ json: $json }];"
  );

  const persist = postgres("Persist", {
    query:
      "UPDATE config SET value = $1, updated_at = now() WHERE key = 'topic_scoring_weights'; " +
      "UPDATE config SET value = $2, updated_at = now() WHERE key = 'seo_prompt_examples'",
    params: "[JSON.stringify($json.topic_scoring_weights), JSON.stringify($json.seo_prompt_examples)]",
  });

  const nodes = [cron, aggregatePerformance, loadCurrentWeights, recomputeWeights, boundCheck, persist];
  const edges = [
    ["Cron", "Aggregate Performance"],
    ["Aggregate Performance", "Load Current Weights"],
    ["Load Current Weights", "Recompute Weights (Gemini)"],
    ["Recompute Weights (Gemini)", "Bound-Check Weights"],
    ["Bound-Check Weights", "Persist"],
  ];
  write(buildWorkflow({ name: "18-Optimization-Loop", nodes, edges }));
}
