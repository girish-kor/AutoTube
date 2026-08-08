const {
  readCodeFile, CRED, geminiRequest, pgLoadGuard,
  executeWorkflowTrigger, postgres, httpRequest, code, ifNode,
  splitInBatches, noOp, telegram, buildWorkflow, write,
} = require("./gen-workflows.cjs");

function mediaWorkerRequest(name, endpoint, jsonBody, notes) {
  return httpRequest(name, {
    method: "POST",
    url: `=\{\{$env.MEDIA_WORKER_BASE_URL\}\}${endpoint}`,
    jsonBody,
    notes: notes || "docs/N8N_NODES.md preamble: Response Format=JSON, Timeout=300000ms, Retry 3x/5000ms (media jobs are slow).",
  });
}

function stageGuard(stage) {
  return ifNode(`Guard: Stage = ${stage}?`, {
    combinator: "and",
    conditions: [{ leftValue: "={{$json.stage}}", rightValue: stage, operator: { type: "string", operation: "equals" } }],
  });
}

// --- 06-Voice-Synthesis -----------------------------------------------------
{
  const trigger = executeWorkflowTrigger("Trigger", ["video_id"]);
  const loadVideo = pgLoadGuard("Video", "FACT_CHECKED");
  const guardIf = stageGuard("FACT_CHECKED");
  const exitNoOp = noOp("Exit: Wrong Stage");

  const joinNarration = code(
    "Join Narration",
    readCodeFile("06-Voice-Synthesis/join-narration.js") +
      "\n\nreturn [{ json: { ...$json, ssml: joinNarration($json.script_json) } }];"
  );

  const ttsCall = mediaWorkerRequest("TTS Call", "/tts", {
    video_id: "={{$json.video_id}}",
    channel_id: "={{$json.channel_id}}",
    ssml: "={{$json.ssml}}",
    voice: "={{$json.tts_voice || $env.TTS_DEFAULT_VOICE}}",
  });

  const validateDuration = ifNode("Validate Duration", {
    combinator: "and",
    conditions: [
      { leftValue: "={{$json.duration_sec}}", rightValue: 480, operator: { type: "number", operation: "gte" } },
      { leftValue: "={{$json.duration_sec}}", rightValue: 900, operator: { type: "number", operation: "lte" } },
    ],
  });

  const persist = postgres("Persist", {
    query:
      "UPDATE videos SET audio_path = $1, stage = 'VOICED', " +
      "script_json = jsonb_set(script_json, '{scenes}', $2::jsonb) WHERE id = $3",
    params:
      "[$json.audio_path, JSON.stringify($json.script_json.scenes.map((s, i) => " +
      "({ ...s, start_ts: ($json.scene_timestamps.find(t => t.scene_index === i) || {}).start_ts }))), $json.video_id]",
  });

  const nodes = [trigger, loadVideo, guardIf, exitNoOp, joinNarration, ttsCall, validateDuration, persist];
  const edges = [
    ["Trigger", "Load Video"],
    ["Load Video", "Guard: Stage = FACT_CHECKED?"],
    ["Guard: Stage = FACT_CHECKED?", "Join Narration", 0, 0],
    ["Guard: Stage = FACT_CHECKED?", "Exit: Wrong Stage", 1, 0],
    ["Join Narration", "TTS Call"],
    ["TTS Call", "Validate Duration"],
    ["Validate Duration", "Persist", 0, 0],
  ];
  write(buildWorkflow({ name: "06-Voice-Synthesis", nodes, edges }));
}

// --- 07-Visual-Generation ----------------------------------------------------
{
  const trigger = executeWorkflowTrigger("Trigger", ["video_id"]);
  const loadVideo = pgLoadGuard("Video", "VOICED");
  const guardIf = stageGuard("VOICED");
  const exitNoOp = noOp("Exit: Wrong Stage");

  const loopScenes = splitInBatches("Loop Scenes", "={{Number($env.VISUAL_BATCH_SIZE || 3)}}");

  const skipIfExists = postgres("Skip If Exists", {
    query: "SELECT count(*) AS existing FROM assets WHERE video_id = $1 AND type = 'image' AND scene_index = $2",
    params: "[$json.video_id, $json.scene_index]",
  });
  const skipIf = ifNode("Skip If Exists?", {
    combinator: "and",
    conditions: [{ leftValue: "={{$json.existing}}", rightValue: 0, operator: { type: "number", operation: "equals" } }],
  });

  const generateImage = mediaWorkerRequest("Generate Image", "/image", {
    channel_id: "={{$json.channel_id}}",
    video_id: "={{$json.video_id}}",
    scene_index: "={{$json.scene_index}}",
    prompt: "={{$json.visual_prompt}}",
    width: 1920,
    height: 1080,
    seed: "={{$json.scene_index}}",
  });

  const recordAsset = postgres("Record Asset", {
    query:
      "INSERT INTO assets (video_id, type, scene_index, prompt, file_path, source_tool) " +
      "VALUES ($1, 'image', $2, $3, $4, 'pollinations')",
    params: "[$json.video_id, $json.scene_index, $json.visual_prompt, $json.file_path]",
  });

  const allScenesDone = postgres("Count Image Assets", {
    query: "SELECT count(*) AS asset_count FROM assets WHERE video_id = $1 AND type = 'image'",
    params: "[$json.video_id]",
  });
  const allScenesDoneIf = ifNode("All Scenes Done?", {
    combinator: "and",
    conditions: [
      { leftValue: "={{$json.asset_count}}", rightValue: "={{$json.scenes.length}}", operator: { type: "number", operation: "gte" } },
    ],
  });

  const persist = postgres("Persist", {
    query: "UPDATE videos SET stage = 'VISUALS_GENERATED' WHERE id = $1",
    params: "[$json.video_id]",
  });

  const nodes = [
    trigger, loadVideo, guardIf, exitNoOp, loopScenes, skipIfExists, skipIf,
    generateImage, recordAsset, allScenesDone, allScenesDoneIf, persist,
  ];
  const edges = [
    ["Trigger", "Load Video"],
    ["Load Video", "Guard: Stage = VOICED?"],
    ["Guard: Stage = VOICED?", "Loop Scenes", 0, 0],
    ["Guard: Stage = VOICED?", "Exit: Wrong Stage", 1, 0],
    ["Loop Scenes", "Skip If Exists"],
    ["Skip If Exists", "Skip If Exists?"],
    ["Skip If Exists?", "Generate Image", 0, 0],
    ["Skip If Exists?", "Loop Scenes", 1, 0],
    ["Generate Image", "Record Asset"],
    ["Record Asset", "Loop Scenes"],
    ["Loop Scenes", "Count Image Assets"],
    ["Count Image Assets", "All Scenes Done?"],
    ["All Scenes Done?", "Persist", 0, 0],
  ];
  write(buildWorkflow({ name: "07-Visual-Generation", nodes, edges }));
}

// --- 08-Render ----------------------------------------------------------------
{
  const trigger = executeWorkflowTrigger("Trigger", ["video_id"]);
  const loadVideo = pgLoadGuard("Video and Assets", "VISUALS_GENERATED");
  const guardIf = stageGuard("VISUALS_GENERATED");
  const exitNoOp = noOp("Exit: Wrong Stage");

  const fetchAssets = postgres("Fetch Assets", {
    query: "SELECT * FROM assets WHERE video_id = $1 AND type = 'image' ORDER BY scene_index",
    params: "[$json.video_id]",
  });

  const buildManifest = code(
    "Build Render Manifest",
    readCodeFile("08-Render/build-render-manifest.js") +
      "\n\nconst video = $('Load Video and Assets').first().json;\n" +
      "const assets = $input.all().map(i => i.json);\n" +
      "return [{ json: buildRenderManifest(video.channel_id, video.video_id, video.audio_path, " +
      "video.script_json.scenes, assets, '1920x1080') }];"
  );

  const renderCall = mediaWorkerRequest("Render Call", "/render", "={{$json}}");

  const validate = ifNode("Validate", {
    combinator: "and",
    conditions: [
      {
        leftValue: "={{Math.abs($json.duration_sec - $('Load Video and Assets').first().json.audio_duration_sec) / $('Load Video and Assets').first().json.audio_duration_sec}}",
        rightValue: 0.05,
        operator: { type: "number", operation: "lte" },
      },
    ],
    notes: "Render duration within +/-5% of audio duration (docs/CONTENT_PIPELINE.md §3).",
  });

  const persist = postgres("Persist", {
    query: "UPDATE videos SET render_path = $1, stage = 'RENDERED' WHERE id = $2",
    params: "[$json.render_path, $json.video_id]",
  });

  const nodes = [trigger, loadVideo, guardIf, exitNoOp, fetchAssets, buildManifest, renderCall, validate, persist];
  const edges = [
    ["Trigger", "Load Video and Assets"],
    ["Load Video and Assets", "Guard: Stage = VISUALS_GENERATED?"],
    ["Guard: Stage = VISUALS_GENERATED?", "Fetch Assets", 0, 0],
    ["Guard: Stage = VISUALS_GENERATED?", "Exit: Wrong Stage", 1, 0],
    ["Fetch Assets", "Build Render Manifest"],
    ["Build Render Manifest", "Render Call"],
    ["Render Call", "Validate"],
    ["Validate", "Persist", 0, 0],
  ];
  write(buildWorkflow({ name: "08-Render", nodes, edges }));
}

// --- 09-Captioning --------------------------------------------------------------
{
  const trigger = executeWorkflowTrigger("Trigger", ["video_id"]);
  const loadVideo = pgLoadGuard("Video", "RENDERED");
  const guardIf = stageGuard("RENDERED");
  const exitNoOp = noOp("Exit: Wrong Stage");

  const transcribe = mediaWorkerRequest("Transcribe", "/caption", {
    channel_id: "={{$json.channel_id}}",
    video_id: "={{$json.video_id}}",
    render_path: "={{$json.render_path}}",
    model_size: "={{$env.WHISPER_MODEL_SIZE}}",
  });

  const validateCoverage = code(
    "Validate Coverage",
    "// SRT total duration within 2% of render duration (docs/CONTENT_PIPELINE.md §3).\n" +
      "if ($json.coverage_ratio < 0.98 || $json.coverage_ratio > 1.02) {\n" +
      "  throw new Error(`caption coverage ratio ${$json.coverage_ratio} outside 2% tolerance`);\n" +
      "}\nreturn [{ json: $json }];"
  );

  const persist = postgres("Persist", {
    query: "UPDATE videos SET captions_path = $1, render_path = $2, stage = 'CAPTIONED' WHERE id = $3",
    params: "[$json.srt_path, $json.captioned_render_path, $json.video_id]",
  });

  const nodes = [trigger, loadVideo, guardIf, exitNoOp, transcribe, validateCoverage, persist];
  const edges = [
    ["Trigger", "Load Video"],
    ["Load Video", "Guard: Stage = RENDERED?"],
    ["Guard: Stage = RENDERED?", "Transcribe", 0, 0],
    ["Guard: Stage = RENDERED?", "Exit: Wrong Stage", 1, 0],
    ["Transcribe", "Validate Coverage"],
    ["Validate Coverage", "Persist"],
  ];
  write(buildWorkflow({ name: "09-Captioning", nodes, edges }));
}

// --- 10-Thumbnail -----------------------------------------------------------------
{
  const trigger = executeWorkflowTrigger("Trigger", ["video_id"]);
  const loadVideo = pgLoadGuard("Video", "CAPTIONED");
  const guardIf = stageGuard("CAPTIONED");
  const exitNoOp = noOp("Exit: Wrong Stage");

  const thumbPrompt = geminiRequest("Thumbnail Prompt (Gemini)", {
    promptExpr:
      "=Generate a YouTube thumbnail concept for a video titled about \"{{$json.topic_title}}\".\\n" +
      "Return an art_prompt for an AI image generator (bold, high-contrast, single\\n" +
      "clear focal subject, no text baked into the image, no real people's likeness,\\n" +
      "no logos/brands) and a short overlay_text (max 5 words, punchy, not clickbait-\\n" +
      "misleading relative to the actual script content below).\\n\\n" +
      "Script summary:\\n{{$json.script_json.scenes.map(s => s.narration).join(' ').slice(0, 1000)}}",
    schema: {
      type: "object",
      properties: { art_prompt: { type: "string" }, overlay_text: { type: "string" } },
      required: ["art_prompt", "overlay_text"],
    },
  });

  const generateThumbnail = mediaWorkerRequest("Generate Thumbnail", "/thumbnail", {
    channel_id: "={{$('Load Video').first().json.channel_id}}",
    video_id: "={{$('Load Video').first().json.video_id}}",
    art_prompt: "={{$json.art_prompt}}",
    overlay_text: "={{$json.overlay_text}}",
  });

  const persist = postgres("Persist", {
    query: "UPDATE videos SET thumbnail_path = $1, stage = 'THUMBNAIL_READY' WHERE id = $2",
    params: "[$json.file_path, $('Load Video').first().json.video_id]",
  });

  const nodes = [trigger, loadVideo, guardIf, exitNoOp, thumbPrompt, generateThumbnail, persist];
  const edges = [
    ["Trigger", "Load Video"],
    ["Load Video", "Guard: Stage = CAPTIONED?"],
    ["Guard: Stage = CAPTIONED?", "Thumbnail Prompt (Gemini)", 0, 0],
    ["Guard: Stage = CAPTIONED?", "Exit: Wrong Stage", 1, 0],
    ["Thumbnail Prompt (Gemini)", "Generate Thumbnail"],
    ["Generate Thumbnail", "Persist"],
  ];
  write(buildWorkflow({ name: "10-Thumbnail", nodes, edges }));
}

// --- 11-SEO-Metadata --------------------------------------------------------------
{
  const trigger = executeWorkflowTrigger("Trigger", ["video_id"]);
  const loadVideo = pgLoadGuard("Video", "THUMBNAIL_READY");
  const guardIf = stageGuard("THUMBNAIL_READY");
  const exitNoOp = noOp("Exit: Wrong Stage");

  const keywordResearch = httpRequest("Keyword Research", {
    url: "=https://youtube.googleapis.com/youtube/v3/search?q={{encodeURIComponent($json.topic_title)}}&part=snippet&maxResults=10",
    credentials: CRED.youtube("CHANNEL"),
  });

  const generateMetadata = geminiRequest("Generate Metadata (Gemini)", {
    promptExpr:
      "=Generate SEO metadata for this YouTube video. Title must accurately represent\\n" +
      "the script content — do not promise anything the video doesn't deliver.\\n" +
      "Front-load the primary keyword within the first 60 characters, avoid ALL-CAPS\\n" +
      "spam, avoid misleading bracketed tags, keep title <=100 chars, description\\n" +
      "<=5000 chars, tags total <=500 chars. Do not copy competitor titles verbatim —\\n" +
      "use them only as keyword signal.\\n\\n" +
      "Past high-CTR examples: {{JSON.stringify($json.seo_prompt_examples)}}\\n" +
      "Competitor titles: {{JSON.stringify($json.competitor_titles)}}\\n" +
      "Script: {{JSON.stringify($json.script_json)}}",
    schema: {
      type: "object",
      properties: {
        title: { type: "string" },
        description: { type: "string" },
        tags: { type: "array", items: { type: "string" } },
        category_id: { type: "string" },
        chapters: {
          type: "array",
          items: { type: "object", properties: { time: { type: "string" }, label: { type: "string" } } },
        },
      },
      required: ["title", "description", "tags", "category_id", "chapters"],
    },
  });

  const validateLimits = code(
    "Validate Limits",
    readCodeFile("11-SEO-Metadata/validate-limits.js") +
      "\n\nconst result = validateSeoLimits($json);\n" +
      "if (!result.ok) throw new Error('SEO metadata validation failed: ' + result.errors.join('; '));\n" +
      "return [{ json: $json }];"
  );

  const persist = postgres("Persist", {
    query: "UPDATE videos SET title = $1, description = $2, tags = $3, category_id = $4, stage = 'SEO_READY' WHERE id = $5",
    params: "[$json.title, $json.description, $json.tags, $json.category_id, $json.video_id]",
  });

  const logQuota = postgres("Log Quota", {
    query:
      "INSERT INTO api_usage (api_name, usage_date, units_used, unit_limit) VALUES ('youtube_data_v3', CURRENT_DATE, 100, 10000) " +
      "ON CONFLICT (api_name, usage_date) DO UPDATE SET units_used = api_usage.units_used + 100",
  });

  const nodes = [trigger, loadVideo, guardIf, exitNoOp, keywordResearch, generateMetadata, validateLimits, persist, logQuota];
  const edges = [
    ["Trigger", "Load Video"],
    ["Load Video", "Guard: Stage = THUMBNAIL_READY?"],
    ["Guard: Stage = THUMBNAIL_READY?", "Keyword Research", 0, 0],
    ["Guard: Stage = THUMBNAIL_READY?", "Exit: Wrong Stage", 1, 0],
    ["Keyword Research", "Generate Metadata (Gemini)"],
    ["Generate Metadata (Gemini)", "Validate Limits"],
    ["Validate Limits", "Persist"],
    ["Persist", "Log Quota"],
  ];
  write(buildWorkflow({ name: "11-SEO-Metadata", nodes, edges }));
}

// --- 12-Compliance-Gate -----------------------------------------------------------
{
  const trigger = executeWorkflowTrigger("Trigger", ["video_id"]);
  const loadVideo = pgLoadGuard("Video", "SEO_READY");
  const guardIf = stageGuard("SEO_READY");
  const exitNoOp = noOp("Exit: Wrong Stage");

  const fetchAssets = postgres("Fetch Assets For Provenance", {
    query: "SELECT * FROM assets WHERE video_id = $1",
    params: "[$json.video_id]",
  });
  const checkProvenance = code(
    "Check: Asset Provenance",
    readCodeFile("12-Compliance-Gate/asset-provenance-check.js") +
      "\n\nreturn [{ json: { check_type: 'asset_provenance', ...checkAssetProvenance($input.all().map(i => i.json)) } }];"
  );

  const checkFingerprint = httpRequest("Check: Audio Fingerprint", {
    method: "POST",
    url: "=https://api.audd.io/",
    jsonBody: { url: "={{$('Load Video').first().json.render_path}}" },
    credentials: CRED.audd(),
    notes: "Safety net against accidental TTS/music leakage (docs/CONTENT_PIPELINE.md §4.2).",
  });

  const loadDenylist = postgres("Load Denylist", {
    query: "SELECT value FROM config WHERE key = 'restricted_topic_denylist'",
  });
  const checkRestricted = code(
    "Check: Restricted Topic",
    readCodeFile("12-Compliance-Gate/restricted-topic-check.js") +
      "\n\nconst video = $('Load Video').first().json;\n" +
      "return [{ json: { check_type: 'restricted_topic', " +
      "...checkRestrictedTopic(video.title, video.description, video.script_json, $json.value) } }];"
  );

  const checkMetadata = code(
    "Check: Metadata Accuracy",
    readCodeFile("12-Compliance-Gate/metadata-accuracy-check.js") +
      "\n\nconst video = $('Load Video').first().json;\n" +
      "return [{ json: { check_type: 'metadata_accuracy', " +
      "...checkMetadataAccuracy(video.title, video.description, video.script_json) } }];"
  );

  const logAllChecks = postgres("Log All Checks", {
    query: "INSERT INTO compliance_checks (video_id, check_type, passed, details) VALUES ($1, $2, $3, $4)",
    params: "[$('Load Video').first().json.video_id, $json.check_type, $json.passed, $json.details]",
    notes: "Runs once per incoming check-result item (asset_provenance, audio_fingerprint, restricted_topic, metadata_accuracy).",
  });

  const gate = ifNode("Gate", {
    combinator: "and",
    conditions: [
      { leftValue: "={{$json.every_check_passed}}", rightValue: true, operator: { type: "boolean", operation: "equals" } },
    ],
    notes: "Aggregation of the 4 check results into every_check_passed happens in a preceding merge/aggregate step (n8n Aggregate node) not shown as a separate named node here for diagram brevity.",
  });

  const persistPass = postgres("Persist Pass", {
    query: "UPDATE videos SET stage = 'COMPLIANCE_PASSED' WHERE id = $1",
    params: "[$('Load Video').first().json.video_id]",
  });
  const persistFail = postgres("Persist Fail", {
    query: "UPDATE videos SET stage = 'FAILED', error_message = $1 WHERE id = $2",
    params: "[$json.failure_reason, $('Load Video').first().json.video_id]",
  });
  const alertFail = telegram(
    "Send Alert",
    "=Compliance gate FAILED\nvideo_id: {{$('Load Video').first().json.video_id}}\nreason: {{$json.failure_reason}}"
  );

  const nodes = [
    trigger, loadVideo, guardIf, exitNoOp, fetchAssets, checkProvenance, checkFingerprint,
    loadDenylist, checkRestricted, checkMetadata, logAllChecks, gate, persistPass, persistFail, alertFail,
  ];
  const edges = [
    ["Trigger", "Load Video"],
    ["Load Video", "Guard: Stage = SEO_READY?"],
    ["Guard: Stage = SEO_READY?", "Fetch Assets For Provenance", 0, 0],
    ["Guard: Stage = SEO_READY?", "Exit: Wrong Stage", 1, 0],
    ["Fetch Assets For Provenance", "Check: Asset Provenance"],
    ["Check: Asset Provenance", "Log All Checks"],
    ["Guard: Stage = SEO_READY?", "Check: Audio Fingerprint", 0, 0],
    ["Check: Audio Fingerprint", "Log All Checks"],
    ["Guard: Stage = SEO_READY?", "Load Denylist", 0, 0],
    ["Load Denylist", "Check: Restricted Topic"],
    ["Check: Restricted Topic", "Log All Checks"],
    ["Guard: Stage = SEO_READY?", "Check: Metadata Accuracy", 0, 0],
    ["Check: Metadata Accuracy", "Log All Checks"],
    ["Log All Checks", "Gate"],
    ["Gate", "Persist Pass", 0, 0],
    ["Gate", "Persist Fail", 1, 0],
    ["Persist Fail", "Send Alert"],
  ];
  write(buildWorkflow({ name: "12-Compliance-Gate", nodes, edges }));
}

// --- 13-Publish-LongForm -----------------------------------------------------------
{
  const trigger = executeWorkflowTrigger("Trigger", ["video_id"]);
  const loadVideo = pgLoadGuard("Video", "COMPLIANCE_PASSED");
  const guardIf = ifNode("Guard: Stage = COMPLIANCE_PASSED And Not Yet Published?", {
    combinator: "and",
    conditions: [
      { leftValue: "={{$json.stage}}", rightValue: "COMPLIANCE_PASSED", operator: { type: "string", operation: "equals" } },
      { leftValue: "={{$json.youtube_video_id}}", rightValue: "", operator: { type: "string", operation: "empty" } },
    ],
  });
  const exitNoOp = noOp("Exit: Wrong Stage Or Already Published");

  const uploadVideo = httpRequest("Upload Video", {
    method: "POST",
    url: "=https://youtube.googleapis.com/upload/youtube/v3/videos?part=snippet,status,contentDetails&uploadType=resumable",
    jsonBody: {
      snippet: {
        title: "={{$json.title}}",
        description: "={{$json.description}}",
        tags: "={{$json.tags}}",
        categoryId: "={{$json.category_id}}",
      },
      status: {
        privacyStatus: "={{$env.TEST_MODE === 'true' ? 'private' : 'public'}}",
        selfDeclaredMadeForKids: false,
        containsSyntheticMedia: true,
      },
    },
    credentials: CRED.youtube("CHANNEL"),
    notes: "Media body (render_path file) attached via n8n binary-data upload, resumable/chunked per docs/YOUTUBE_API.md §4. TEST_MODE forces private uploads (docs/TESTING.md §6).",
  });

  const setThumbnail = httpRequest("Set Thumbnail", {
    method: "POST",
    url: "=https://youtube.googleapis.com/upload/youtube/v3/thumbnails/set?videoId={{$json.id}}",
    credentials: CRED.youtube("CHANNEL"),
  });
  const uploadCaptions = httpRequest("Upload Captions", {
    method: "POST",
    url: "=https://youtube.googleapis.com/upload/youtube/v3/captions?part=snippet",
    jsonBody: { snippet: { videoId: "={{$('Upload Video').first().json.id}}", language: "en", name: "English" } },
    credentials: CRED.youtube("CHANNEL"),
  });

  const persist = postgres("Persist", {
    query: "UPDATE videos SET youtube_video_id = $1, stage = 'PUBLISHED', published_at = now() WHERE id = $2",
    params: "[$('Upload Video').first().json.id, $('Load Video').first().json.video_id]",
  });

  const logQuota = postgres("Log Quota", {
    query:
      "INSERT INTO api_usage (api_name, usage_date, units_used, unit_limit) VALUES ('youtube_data_v3', CURRENT_DATE, 2050, 10000) " +
      "ON CONFLICT (api_name, usage_date) DO UPDATE SET units_used = api_usage.units_used + 2050",
    notes: "1600 (insert) + 50 (thumbnails.set) + 400 (captions.insert) = 2050 units (docs/YOUTUBE_API.md §3).",
  });

  const nodes = [trigger, loadVideo, guardIf, exitNoOp, uploadVideo, setThumbnail, uploadCaptions, persist, logQuota];
  const edges = [
    ["Trigger", "Load Video"],
    ["Load Video", "Guard: Stage = COMPLIANCE_PASSED And Not Yet Published?"],
    ["Guard: Stage = COMPLIANCE_PASSED And Not Yet Published?", "Upload Video", 0, 0],
    ["Guard: Stage = COMPLIANCE_PASSED And Not Yet Published?", "Exit: Wrong Stage Or Already Published", 1, 0],
    ["Upload Video", "Set Thumbnail"],
    ["Set Thumbnail", "Upload Captions"],
    ["Upload Captions", "Persist"],
    ["Persist", "Log Quota"],
  ];
  write(buildWorkflow({ name: "13-Publish-LongForm", nodes, edges }));
}
