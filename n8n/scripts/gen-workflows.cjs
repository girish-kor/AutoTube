// Generator for n8n/workflows/*.json from the declarative node/edge lists in
// wf-*.js. Run via `node n8n/scripts/run-gen.js` to regenerate every
// workflow after editing a wf-*.js file or a code-nodes/**/*.js module —
// this is what CODING_RULES.md §2 means by a Code node body being "a thin
// wrapper that imports/inlines [the .js file] at workflow-export time".
// Keeps ~150+ hand-specified nodes across 19 workflows internally
// consistent (credential refs, HTTP timeout/retry, node naming) instead of
// hand-typing each workflow's JSON.
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const OUT_DIR = path.join(__dirname, "..", "workflows");
const CODE_NODES_DIR = path.join(__dirname, "..", "code-nodes");

function id() {
  return crypto.randomUUID();
}

function readCodeFile(relPath) {
  const full = path.join(CODE_NODES_DIR, relPath);
  const raw = fs.readFileSync(full, "utf-8");
  // Strip the trailing `module.exports = {...};` line(s) — n8n's Code node
  // sandbox has no `module` global, so the exported source is inlined
  // without it (docs/CODING_RULES.md §2: "thin wrapper that imports/inlines
  // it at workflow-export time").
  return raw.replace(/\n?module\.exports\s*=\s*\{[^}]*\};\s*$/m, "").trimEnd();
}

const CRED = {
  postgres: (name = "postgres-autotube") => ({ postgres: { name } }),
  gemini: (name = "gemini-api") => ({ httpHeaderAuth: { name } }),
  youtube: (chan) => ({ youTubeOAuth2Api: { name: `youtube-oauth-${chan}` } }),
  telegram: (name = "telegram-bot") => ({ telegramApi: { name } }),
  meta: (name = "meta-graph-api") => ({ httpHeaderAuth: { name } }),
  tiktok: (name = "tiktok-content-api") => ({ oAuth2Api: { name } }),
  audd: (name = "audd-api") => ({ httpQueryAuth: { name } }),
};

function baseNode({ name, type, typeVersion = 1, parameters = {}, credentials, notes, retry }) {
  const n = { parameters, id: id(), name, type, typeVersion, position: [0, 0] };
  if (credentials) n.credentials = credentials;
  if (notes) n.notes = notes;
  if (retry) {
    n.retryOnFail = true;
    n.maxTries = 3;
    n.waitBetweenTries = 5000;
  }
  return n;
}

function scheduleTrigger(name, { cron, minutesInterval, timezone }) {
  const interval = cron
    ? [{ field: "cronExpression", expression: cron }]
    : [{ field: "minutes", minutesInterval }];
  const parameters = { rule: { interval } };
  if (timezone) parameters.timezone = timezone;
  return baseNode({ name, type: "n8n-nodes-base.scheduleTrigger", typeVersion: 1.2, parameters });
}

function executeWorkflowTrigger(name, inputs) {
  return baseNode({
    name,
    type: "n8n-nodes-base.executeWorkflowTrigger",
    typeVersion: 1.1,
    parameters: { workflowInputs: { values: (inputs || []).map((i) => ({ name: i })) } },
  });
}

function postgres(name, { query, params, notes }) {
  const options = {};
  if (params) options.queryReplacement = `={{ ${params} }}`;
  return baseNode({
    name,
    type: "n8n-nodes-base.postgres",
    typeVersion: 2.5,
    parameters: { operation: "executeQuery", query, options },
    credentials: CRED.postgres(),
    notes,
  });
}

function httpRequest(name, { method = "GET", url, jsonBody, credentials, notes, timeout = 300000 }) {
  const parameters = { method, url, options: { timeout } };
  if (jsonBody !== undefined) {
    parameters.sendBody = true;
    parameters.specifyBody = "json";
    parameters.jsonBody = typeof jsonBody === "string" ? jsonBody : JSON.stringify(jsonBody);
  }
  return baseNode({
    name,
    type: "n8n-nodes-base.httpRequest",
    typeVersion: 4.2,
    parameters,
    credentials,
    notes,
    retry: true,
  });
}

function code(name, jsCode, notes) {
  return baseNode({
    name,
    type: "n8n-nodes-base.code",
    typeVersion: 2,
    parameters: { language: "javaScript", jsCode },
    notes,
  });
}

function ifNode(name, conditions, notes) {
  return baseNode({
    name,
    type: "n8n-nodes-base.if",
    typeVersion: 2.2,
    parameters: { conditions },
    notes,
  });
}

function switchNode(name, rules, notes) {
  return baseNode({
    name,
    type: "n8n-nodes-base.switch",
    typeVersion: 3.2,
    parameters: { rules: { values: rules } },
    notes,
  });
}

function splitInBatches(name, batchSize, notes) {
  return baseNode({
    name,
    type: "n8n-nodes-base.splitInBatches",
    typeVersion: 3,
    parameters: { options: { batchSize } },
    notes,
  });
}

function merge(name, notes) {
  return baseNode({ name, type: "n8n-nodes-base.merge", typeVersion: 3, parameters: { mode: "combine" }, notes });
}

function noOp(name, notes) {
  return baseNode({ name, type: "n8n-nodes-base.noOp", typeVersion: 1, parameters: {}, notes });
}

function telegram(name, text) {
  return baseNode({
    name,
    type: "n8n-nodes-base.telegram",
    typeVersion: 1.2,
    parameters: { chatId: "={{$env.TELEGRAM_CHAT_ID}}", text, additionalFields: {} },
    credentials: CRED.telegram(),
  });
}

function executeWorkflow(name, workflowName, wait = true) {
  return baseNode({
    name,
    type: "n8n-nodes-base.executeWorkflow",
    typeVersion: 1.2,
    parameters: {
      source: "database",
      workflowId: { value: "", cachedResultName: workflowName },
      options: { waitForSubWorkflow: wait },
    },
  });
}

function htmlExtract(name, extractionValues) {
  return baseNode({
    name,
    type: "n8n-nodes-base.htmlExtract",
    typeVersion: 1.2,
    parameters: { extractionValues: { values: extractionValues } },
  });
}

// --- layout + assembly --------------------------------------------------

function layoutGrid(nodeNames, colWidth = 260, rowHeight = 180, perRow = 6) {
  const positions = {};
  nodeNames.forEach((n, i) => {
    const col = i % perRow;
    const row = Math.floor(i / perRow);
    positions[n] = [260 + col * colWidth, 260 + row * rowHeight];
  });
  return positions;
}

function buildWorkflow({ name, nodes, edges }) {
  const positions = layoutGrid(nodes.map((n) => n.name));
  nodes.forEach((n) => {
    n.position = positions[n.name];
  });

  const connections = {};
  edges.forEach(([from, to, fromOutput = 0, toInput = 0]) => {
    connections[from] = connections[from] || { main: [] };
    while (connections[from].main.length <= fromOutput) connections[from].main.push([]);
    connections[from].main[fromOutput].push({ node: to, type: "main", index: toInput });
  });

  return {
    name,
    nodes,
    connections,
    active: false,
    settings: { executionOrder: "v1" },
    pinData: {},
  };
}

function write(workflow) {
  const outPath = path.join(OUT_DIR, `${workflow.name}.json`);
  fs.writeFileSync(outPath, JSON.stringify(workflow, null, 2) + "\n", "utf-8");
  console.log("wrote", outPath, `(${workflow.nodes.length} nodes)`);
}

function geminiRequest(name, { promptExpr, schema, notes }) {
  const jsonBody = {
    contents: [{ parts: [{ text: promptExpr }] }],
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema: schema,
    },
  };
  return httpRequest(name, {
    method: "POST",
    url: "=https://generativelanguage.googleapis.com/v1beta/models/{{$env.GEMINI_MODEL || 'gemini-2.0-flash'}}:generateContent",
    jsonBody,
    credentials: CRED.gemini(),
    notes: notes || "docs/AI_PIPELINE.md prompt/schema. Pre-flight-checked against api_usage/gemini before call; falls back to Ollama on quota exhaustion per docs/AI_PIPELINE.md §0 (fallback branch omitted here for diagram clarity, implement per that section).",
  });
}

function pgLoadGuard(workflowLabel, expectedStage, extraSelect) {
  return postgres(`Load ${workflowLabel}`, {
    query: `SELECT ${extraSelect || "*"} FROM videos WHERE id = $1`,
    params: "[$json.video_id]",
    notes: `Guard: only proceeds if stage = '${expectedStage}' (checked in the following If node); otherwise NoOp exit (docs/WORKFLOW.md Sub-Workflow Contract step 2).`,
  });
}

module.exports = {
  readCodeFile,
  CRED,
  geminiRequest,
  pgLoadGuard,
  scheduleTrigger,
  executeWorkflowTrigger,
  postgres,
  httpRequest,
  code,
  ifNode,
  switchNode,
  splitInBatches,
  merge,
  noOp,
  telegram,
  executeWorkflow,
  htmlExtract,
  buildWorkflow,
  write,
};
