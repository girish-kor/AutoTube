# AI_PIPELINE — LLM Prompts, Schemas & Fallback Logic

All LLM calls use **Gemini 2.0 Flash** via Google AI Studio REST API (`generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent`), credential `gemini-api`, with `generationConfig.responseMimeType = "application/json"` and `responseSchema` set to the JSON Schema shown per call — this forces structured output and removes prompt-side parsing fragility.

## 0. Client-Side Throttling & Fallback

- **Rate limit:** free tier ≈ 15 requests/min, 1500 requests/day (subject to change — `GEMINI_RPM_LIMIT`/`GEMINI_RPD_LIMIT` in `config` table, checked against `api_usage` before every call).
- **Pre-flight check:** every Gemini-calling node first reads `api_usage` for `gemini`/today; if `units_used >= unit_limit`, the node routes to the **Ollama fallback** branch (`OLLAMA_BASE_URL`, model `llama3.1:8b`, same prompt, no `responseSchema` enforcement — output is parsed with a defensive JSON-extract `Code` node and re-validated against the same schema; on parse failure the stage fails cleanly and retries next cycle rather than persisting malformed data).
- **429 handling:** n8n HTTP node retry (3 attempts, exponential backoff 5s/15s/45s) before falling back to Ollama.
- **Never** silently truncate/guess on schema validation failure — the stage fails and retries (`ERROR_HANDLING.md`), preserving data integrity over throughput.

## 1. Topic Scoring (used in `02-Topic-Selection`)

**Input:** `topics[]` (title, source, trend_score), `channel.niche`, `config.topic_scoring_weights` (JSON: `{recency, trend_strength, evergreen_potential, competition_gap, niche_fit}` weights summing to 1.0).

**Prompt:**
```
You are scoring candidate YouTube video topics for the niche "{{niche}}".
For each topic, score 0-100 on: recency, trend_strength, evergreen_potential,
competition_gap (opportunity where saturation is low), niche_fit.
Combine using these weights: {{weights_json}}.
Reject (score 0) any topic that is: sexual, violent, hateful, medical/legal/financial
advice framed as fact, about a real private individual, or clearly designed to
mislead (title promises content the topic can't deliver).
Return strict JSON only.

Topics:
{{topics_json}}
```

**Response schema:**
```json
{
  "type": "object",
  "properties": {
    "scored": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "topic_id": {"type": "string"},
          "llm_score": {"type": "number"},
          "rejected": {"type": "boolean"},
          "reason": {"type": "string"}
        },
        "required": ["topic_id", "llm_score", "rejected"]
      }
    }
  },
  "required": ["scored"]
}
```

## 2. Research Compilation (used in `03-Research`)

**Input:** raw Wikipedia summaries + DuckDuckGo snippets, each tagged with source URL.

**Prompt:**
```
Compile factual notes for a video about "{{topic_title}}" using ONLY the source
material below. Do not add facts not present in the sources. For each fact,
copy the exact source_url it came from. Produce at least 8 distinct facts if
the sources support it; if they don't, return fewer — never invent facts to
reach a count. Flag any source material that is opinion, not fact.

Sources:
{{sources_json}}
```

**Response schema:**
```json
{
  "type": "object",
  "properties": {
    "facts": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "claim": {"type": "string"},
          "source_url": {"type": "string"}
        },
        "required": ["claim", "source_url"]
      }
    }
  },
  "required": ["facts"]
}
```

## 3. Script Generation (used in `04-Script-Writer`)

**Input:** `research_json.facts[]`, `topic_title`, target duration (8–15 min), channel tone (from `channels` config, default "clear, engaging, neutral").

**Prompt:**
```
Write a spoken-word YouTube script on "{{topic_title}}", 1200-2200 words,
8-15 minutes narrated. Base every factual claim strictly on the provided
research facts — do not introduce unsourced claims. Break the script into
8-20 scenes. For each scene provide: narration text (natural spoken sentences,
no stage directions), a visual_prompt (a text-to-image prompt describing what
should be shown on screen, safe-for-work, no real people's likeness, no
copyrighted characters/logos/brands), and duration_estimate_sec.
Open with a hook in the first scene. End with a summary, not a sales pitch.

Research facts:
{{facts_json}}
```

**Response schema:**
```json
{
  "type": "object",
  "properties": {
    "scenes": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "narration": {"type": "string"},
          "visual_prompt": {"type": "string"},
          "duration_estimate_sec": {"type": "number"}
        },
        "required": ["narration", "visual_prompt", "duration_estimate_sec"]
      }
    }
  },
  "required": ["scenes"]
}
```

## 4. Fact-Check Verification (used in `05-Fact-Check`)

**Input:** extracted `claims[]` from the script, `research_json.facts[]`.

**Prompt:**
```
For each claim below, decide:
- VERIFIED: claim is directly supported by one of the research facts.
- REWRITTEN: claim is close to a research fact but overstates/misstates it —
  provide a corrected rewritten_claim that stays supported by the facts.
- REMOVED: claim has no support in the research facts at all.
Default to REMOVED when uncertain. Never mark VERIFIED without citing the
exact source_url that supports it.

Claims:
{{claims_json}}

Research facts:
{{facts_json}}
```

**Response schema:**
```json
{
  "type": "object",
  "properties": {
    "verdicts": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "claim": {"type": "string"},
          "status": {"type": "string", "enum": ["VERIFIED", "REWRITTEN", "REMOVED"]},
          "source_url": {"type": "string"},
          "rewritten_claim": {"type": "string"}
        },
        "required": ["claim", "status"]
      }
    }
  },
  "required": ["verdicts"]
}
```

Applied deterministically (`Code` node, not LLM): `REMOVED` claims are deleted from the scene's narration sentence-by-sentence; `REWRITTEN` claims are string-replaced. If a scene's narration becomes empty after removals, the scene's `duration_estimate_sec` is redistributed to neighboring scenes and the empty scene is dropped — never left as dead air.

## 5. Thumbnail Prompt Generation (used in `10-Thumbnail`)

**Prompt:**
```
Generate a YouTube thumbnail concept for a video titled about "{{topic_title}}".
Return an art_prompt for an AI image generator (bold, high-contrast, single
clear focal subject, no text baked into the image, no real people's likeness,
no logos/brands) and a short overlay_text (max 5 words, punchy, not clickbait-
misleading relative to the actual script content below).

Script summary:
{{script_summary}}
```

**Response schema:** `{"art_prompt": string, "overlay_text": string}`.

## 6. SEO Metadata Generation (used in `11-SEO-Metadata`)

See full strategy in `SEO.md`. Schema:
```json
{
  "type": "object",
  "properties": {
    "title": {"type": "string"},
    "description": {"type": "string"},
    "tags": {"type": "array", "items": {"type": "string"}},
    "category_id": {"type": "string"},
    "chapters": {
      "type": "array",
      "items": {"type": "object", "properties": {"time": {"type": "string"}, "label": {"type": "string"}}}
    }
  },
  "required": ["title", "description", "tags", "category_id", "chapters"]
}
```
Prompt includes `config.seo_prompt_examples` (few-shot examples of past high-CTR titles, maintained by the optimization loop) and the top-10 competitor titles from `search.list`, instructed explicitly: *"Title must accurately represent the script content — do not promise anything the video doesn't deliver."*

## 7. Shorts Highlight Scoring (used in `14-Shorts-Extraction`, runs inside `media-worker`, not Gemini)

Deterministic heuristic (no LLM call — keeps this stage free of API quota/latency):
```
score(window) = w1*keyword_density(window, script_keywords)
              + w2*caption_word_rate(window)          # faster speech = more energetic
              + w3*scene_boundary_alignment(window)    # prefer cuts on scene edges
              + w4*hook_proximity(window)              # bonus if window is near script's opening hook
              - w5*silence_ratio(window)                # penalize dead air (auto-editor output)
```
Weights `w1..w5` stored in `config.shorts_scoring_weights`, tunable by `18-Optimization-Loop` using `analytics_daily` retention data for past Shorts (higher `avg_view_duration_seconds` / clip length → weight reinforcement). Windows are 20–59s, non-overlapping, ranked, top `SHORTS_PER_VIDEO` selected.

## 8. Optimization Loop (used in `18-Optimization-Loop`)

**Input:** 7+ day aggregates from `analytics_daily` grouped by `topics.source`, `videos.category_id`, publish hour, and title-pattern clusters.

**Prompt:**
```
Given these aggregate performance stats per topic-source/category/publish-hour
bucket, and the current scoring weights, propose adjusted weights that shift
future selection toward higher-performing buckets. Keep all weights positive
and summing to 1.0. Bound any single weight change to ±0.1 per run to avoid
overreacting to noise. Also propose up to 3 new few-shot title examples drawn
from this period's top-CTR videos for future SEO generation.

Current weights: {{weights_json}}
Aggregate stats: {{agg_json}}
```

**Response schema:**
```json
{
  "type": "object",
  "properties": {
    "topic_scoring_weights": {"type": "object"},
    "seo_prompt_examples": {"type": "array", "items": {"type": "string"}}
  },
  "required": ["topic_scoring_weights", "seo_prompt_examples"]
}
```
Bound-checked in a `Code` node before persisting (reject if any weight outside [0,1] or sum deviates from 1.0 by more than 0.01).
