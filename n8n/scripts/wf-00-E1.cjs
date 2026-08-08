const {
  scheduleTrigger, postgres, code, switchNode, splitInBatches, merge, noOp,
  telegram, executeWorkflow, ifNode, buildWorkflow, write,
} = require("./gen-workflows.cjs");

// --- 00-Master-Orchestrator ----------------------------------------------
// Two independent dispatch branches per cycle (docs/WORKFLOW.md "Master
// Orchestrator Logic"):
//   (a) channel-level: call 02-Topic-Selection for every active channel —
//       safe every cycle because 02's own guard clause no-ops when a video
//       is already in flight or no pending topics exist.
//   (b) video-level: fetch videos due for their next stage, switch on
//       `stage`, and Execute Workflow the matching stage workflow (03-16).
// N8N_NODES.md describes this as "16 outputs (one per successor workflow)";
// 02 through 16 is 15 explicit stage/channel branches, so the 16th output
// here is the unmatched-stage fallback (NoOp) — stages with no successor
// workflow (FAILED, terminal states already excluded by the query) land there.
{
  const cron = scheduleTrigger("Cron", { minutesInterval: 15 });

  const fetchChannels = postgres("Fetch Active Channels", {
    query: "SELECT * FROM channels WHERE active = true",
  });
  const loopChannels = splitInBatches("Loop Channels (Topic Selection)", 1);
  const execTopicSelection = executeWorkflow("Execute: Topic-Selection", "02-Topic-Selection", true);

  const fetchDueVideos = postgres("Fetch Due Videos", {
    query:
      "SELECT * FROM videos WHERE stage NOT IN ('PUBLISHED','SHORTS_PUBLISHED','CROSSPOSTED','FAILED') " +
      "AND retry_count < $1 ORDER BY updated_at ASC LIMIT $2",
    params: "[Number($env.MAX_RETRIES || 5), Number($env.MAX_CONCURRENT_VIDEOS || 3)]",
    notes: "MAX_RETRIES/MAX_CONCURRENT_VIDEOS env fallback per docs/CONFIG.md §3 precedence rule 3.",
  });
  const splitBatch = splitInBatches("Split Batch", "={{Number($env.MAX_CONCURRENT_VIDEOS || 3)}}");

  const stageWorkflows = [
    ["TOPIC_SELECTED", "03-Research"],
    ["RESEARCHED", "04-Script-Writer"],
    ["SCRIPTED", "05-Fact-Check"],
    ["FACT_CHECKED", "06-Voice-Synthesis"],
    ["VOICED", "07-Visual-Generation"],
    ["VISUALS_GENERATED", "08-Render"],
    ["RENDERED", "09-Captioning"],
    ["CAPTIONED", "10-Thumbnail"],
    ["THUMBNAIL_READY", "11-SEO-Metadata"],
    ["SEO_READY", "12-Compliance-Gate"],
    ["COMPLIANCE_PASSED", "13-Publish-LongForm"],
    ["PUBLISHED", "14-Shorts-Extraction"],
    ["SHORTS_EXTRACTED", "15-Shorts-Publish"],
    ["SHORTS_PUBLISHED", "16-Crosspost"],
  ];

  const routeByStage = switchNode(
    "Route by Stage",
    [
      ...stageWorkflows.map(([stage]) => ({
        conditions: {
          combinator: "and",
          conditions: [
            { leftValue: "={{$json.stage}}", rightValue: stage, operator: { type: "string", operation: "equals" } },
          ],
        },
      })),
      { conditions: { combinator: "and", conditions: [] } }, // fallback / unmatched stage
    ],
    "16 outputs: 14 explicit stage routes + fallback = matches N8N_NODES.md's stated count " +
      "when paired with the separate channel-level Topic-Selection branch above."
  );

  const execNodes = stageWorkflows.map(([stage, wf]) =>
    executeWorkflow(`Execute: ${wf}`, wf, true)
  );
  const fallbackNoOp = noOp("Unmatched Stage (No Successor)");

  const logResult = noOp("Log Result");

  const nodes = [
    cron, fetchChannels, loopChannels, execTopicSelection,
    fetchDueVideos, splitBatch, routeByStage, ...execNodes, fallbackNoOp, logResult,
  ];

  const edges = [
    ["Cron", "Fetch Active Channels"],
    ["Fetch Active Channels", "Loop Channels (Topic Selection)"],
    ["Loop Channels (Topic Selection)", "Execute: Topic-Selection"],
    ["Execute: Topic-Selection", "Loop Channels (Topic Selection)"],

    ["Cron", "Fetch Due Videos"],
    ["Fetch Due Videos", "Split Batch"],
    ["Split Batch", "Route by Stage"],
    ...stageWorkflows.map(([, wf], i) => ["Route by Stage", `Execute: ${wf}`, i, 0]),
    ["Route by Stage", "Unmatched Stage (No Successor)", stageWorkflows.length, 0],
    ...execNodes.map((n) => [n.name, "Split Batch"]), // SplitInBatches loop-back for next item
    ...execNodes.map((n) => [n.name, "Log Result"]),
    ["Unmatched Stage (No Successor)", "Split Batch"],
  ];

  write(buildWorkflow({ name: "00-Master-Orchestrator", nodes, edges }));
}

// --- E1-Error-Handler ------------------------------------------------------
{
  // No Schedule/Execute-Workflow trigger: this is set as n8n's *global*
  // Error Workflow (Settings -> Workflows -> Error Workflow), so its entry
  // point is n8n's built-in Error Trigger node type.
  const trigger = { parameters: {}, id: require("crypto").randomUUID(), name: "Trigger", type: "n8n-nodes-base.errorTrigger", typeVersion: 1, position: [260, 260] };

  const logError = postgres("Log Error", {
    query:
      "INSERT INTO pipeline_errors (video_id, workflow_name, stage, error_message, stack) " +
      "VALUES ($1, $2, $3, $4, $5)",
    params:
      "[$json.execution.customData?.video_id ?? null, $json.workflow.name, " +
      "$json.execution.customData?.stage ?? null, $json.execution.error.message, $json.execution.error.stack]",
  });

  const incrementRetry = postgres("Increment Retry", {
    query:
      "UPDATE videos SET retry_count = retry_count + 1, error_message = $1 WHERE id = $2 RETURNING retry_count",
    params: "[$json.execution.error.message, $json.execution.customData?.video_id ?? null]",
  });

  const decide = ifNode("Decide", {
    combinator: "and",
    conditions: [
      {
        leftValue: "={{$json.retry_count}}",
        rightValue: "={{Number($env.MAX_RETRIES || 5)}}",
        operator: { type: "number", operation: "lt" },
      },
    ],
  });

  const requeue = noOp(
    "Requeue",
    "No-op: video stays at its last successful stage; Master Orchestrator retries it next 15-min cycle."
  );

  const markFailed = postgres("Mark Failed", {
    query: "UPDATE videos SET stage = 'FAILED' WHERE id = $1",
    params: "[$json.execution.customData?.video_id ?? null]",
  });

  const alert = telegram(
    "Send Alert",
    "=AutoTube pipeline failure\nvideo_id: {{$json.execution.customData?.video_id}}\n" +
      "workflow: {{$json.workflow.name}}\nstage: {{$json.execution.customData?.stage}}\n" +
      "error: {{$json.execution.error.message}}\ntime: {{$now}}"
  );

  const nodes = [trigger, logError, incrementRetry, decide, requeue, markFailed, alert];
  const edges = [
    ["Trigger", "Log Error"],
    ["Log Error", "Increment Retry"],
    ["Increment Retry", "Decide"],
    ["Decide", "Requeue", 0, 0],
    ["Decide", "Mark Failed", 1, 0],
    ["Mark Failed", "Send Alert"],
  ];

  write(buildWorkflow({ name: "E1-Error-Handler", nodes, edges }));
}
