# SEO — Discovery Optimization Strategy

## 1. Scope

Covers long-form and Shorts: title, description, tags, category, chapters, and thumbnail text — generated in `11-SEO-Metadata` (long-form) and `15-Shorts-Publish` (Shorts), using Gemini 2.0 Flash + YouTube Data API `search.list` (`AI_PIPELINE.md` §6, `YOUTUBE_API.md` §2).

## 2. Title

- Generated from the fact-checked `script_json`, not the raw topic string — guarantees the title reflects what the video actually says (compliance-gate metadata-accuracy check, `CONTENT_PIPELINE.md` §4.4, would otherwise reject a mismatched title).
- Prompt instructs: front-load the primary keyword within the first 60 characters (mobile truncation point), avoid ALL-CAPS spam, avoid bracketed clickbait tags not reflective of content, keep ≤100 chars (`YOUTUBE_API.md` limit).
- Seeded with `config.seo_prompt_examples` — up to 3 few-shot examples of the channel's own past high-CTR titles, refreshed weekly by `18-Optimization-Loop` — so title style converges toward what has actually worked for this specific channel/niche rather than generic advice.
- Competitor titles from `search.list` (top 10 results for the topic) are supplied as *keyword signal*, not copied — prompt explicitly forbids reproducing a competitor title verbatim.

## 3. Description

- First 150 characters (visible above the fold) restate the title's promise concretely — no generic "In this video..." filler.
- Body includes: a short synthesis of the script's key points (aids both viewer decision and YouTube's semantic indexing), the chapter list (see §5), and a standard channel boilerplate footer (added by a `Code` node, not the LLM, for consistency): synthetic-media disclosure line, upload schedule, niche description.
- ≤5000 characters (YouTube limit, validated in `N8N_NODES.md` workflow 11).

## 4. Tags

- Generated as a ranked list: 3–5 broad niche tags, 5–10 topic-specific tags, 2–3 long-tail question-style tags (matching how people phrase YouTube searches, e.g., "how does X work" style) — informed by `search.list` result titles/descriptions for term-frequency signal.
- Total character budget ≤500 (YouTube limit) enforced in validation gate.

## 5. Chapters

- Derived directly from `script_json.scenes[].start_ts` (populated during `06-Voice-Synthesis`) grouped into 4–8 logical chapters by the SEO generation prompt, formatted as `MM:SS Label` lines appended to the description — YouTube auto-detects and renders these as timestamp chapters with no extra API call needed.

## 6. Category

- `category_id` selected by the same Gemini call from YouTube's fixed category taxonomy (Education, Science & Technology, Entertainment, etc.), matched to actual script content — correct categorization affects both discovery (related-video surfacing) and advertiser-friendliness classification (`MONETIZATION.md` §2).

## 7. Thumbnail Text

- Generated jointly with the art prompt (`AI_PIPELINE.md` §5): overlay text ≤5 words, high-contrast placement (Pillow compositing enforces safe-margin/contrast-box rules in `media-worker`, not left to the LLM), and explicitly checked against script content to prevent thumbnail/content mismatch — the same discipline as title accuracy.

## 8. Shorts SEO

- Title auto-appends `#Shorts` (YouTube's own discovery signal for the Shorts shelf).
- Description is short (1–2 sentences) plus 3–5 tags inherited from the parent long-form video's tag set (topical consistency) plus 1–2 Shorts-specific trending hashtags pulled from the same `topics` discovery data (`01-Trend-Discovery`) so Shorts ride current trend momentum independent of the parent video's original publish date.

## 9. Feedback Loop

`18-Optimization-Loop` (weekly) reads `analytics_daily` CTR and average-view-duration per video, clusters by title pattern (question-style vs. statement vs. number-led, etc.) and publish hour, and:
1. Updates `config.seo_prompt_examples` with the period's top-CTR titles (bounded to 3, replacing the oldest).
2. Adjusts `config.topic_scoring_weights.competition_gap` if a title pattern consistently underperforms regardless of topic — signals the *format*, not just topic selection, needs to shift, which is reflected back into the SEO prompt's guidance text (stored as part of `seo_prompt_examples` context) rather than requiring a workflow redeploy.

No paid keyword-research tool (e.g., TubeBuddy, VidIQ paid tiers) is used — `search.list` against live YouTube results is the sole and sufficient free keyword signal at this volume.
