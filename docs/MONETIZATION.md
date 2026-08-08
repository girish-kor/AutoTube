# MONETIZATION — YPP Path & Policy Constraints

## 1. YouTube Partner Program (YPP) Eligibility (unavoidable manual step)

YPP acceptance is YouTube's own manual/automated review — outside this system's control. AutoTube's job is to make the channel **eligible and compliant**, not to bypass review. Eligibility paths as of 2026:

- **Standard path:** 1,000 subscribers + 4,000 valid public watch hours in the trailing 12 months, **or**
- **Shorts path:** 1,000 subscribers + 10,000,000 public Shorts views in the trailing 90 days (long-form watch-hours and Shorts-views paths were unified/expanded over 2024–2025; check current thresholds at application time — this doc states the mechanism, not a guaranteed fixed number).

AutoTube's dual long-form + Shorts output is deliberately structured to build toward **either** path simultaneously. Once thresholds are met, the operator submits the YPP application manually (one-time; YouTube does not expose this via API).

## 2. Content Policy Compliance Built Into the Pipeline

| YouTube policy area | How AutoTube complies |
|---|---|
| **Reused/repetitious content** | Every video's script, narration, and visuals are freshly generated per topic (`CONTENT_PIPELINE.md` §5) — no templated filler, no mass-produced near-duplicate videos |
| **Spam, deceptive practices & scams** | Metadata-accuracy compliance check (`CONTENT_PIPELINE.md` §4.4) enforces title/description match actual content; no engagement-bait instructions in any prompt |
| **Altered/synthetic content disclosure** | `containsSyntheticMedia: true` set on every upload (`YOUTUBE_API.md` §5) — required disclosure for AI-generated voice and visuals |
| **Advertiser-friendly content guidelines** | Restricted-topic denylist (below) scanned pre-publish; category selection (`category_id`) matched to actual content via SEO generation prompt |
| **Copyright** | Zero-external-asset structural rule + AudD fingerprint safety net (`CONTENT_PIPELINE.md` §4.1–4.2) — no third-party copyrighted audio/video ever enters the render pipeline |
| **Misinformation / medical-legal-financial claims** | Fact-check gate (`AI_PIPELINE.md` §4) removes unsourced claims by default; restricted-topic denylist blocks content framed as medical/legal/financial advice |
| **Made for Kids** | `selfDeclaredMadeForKids: false` set explicitly (`N8N_NODES.md`, workflow 13) — channel niches are general-audience topics, not child-directed content; if a channel is ever configured for kid-directed content this flag and the entire compliance gate must be revisited (out of scope for the default configuration) |

## 3. Restricted-Topic Denylist (Compliance Gate, `CONTENT_PIPELINE.md` §4.3)

Enforced as a keyword + category classifier check against `title` + `description` + `script_json` text:

- Graphic violence, self-harm, dangerous acts/challenges
- Hate speech, harassment targeting protected groups or private individuals
- Sexual content, nudity
- Firearms/weapons instructions, drug manufacturing
- Medical, legal, or financial claims presented as factual advice (vs. clearly-labeled general-information framing)
- Content about a named real private individual (public figures in a factual/biographical, non-defamatory context are permitted since research is Wikipedia-grounded and fact-checked)
- Election/civic-integrity misinformation patterns
- Any topic the `02-Topic-Selection` Gemini scoring pass already flagged `rejected: true` (defense in depth — same denylist logic applied at both topic-selection and pre-publish stages)

This list is maintained in `config.restricted_topic_denylist` (editable without redeploying workflows) and reviewed whenever YouTube updates its advertiser-friendly guidelines.

## 4. Ad Revenue Is Not a Pipeline Dependency

AutoTube's automation does not require monetization to function — publishing, Shorts extraction, cross-posting, and analytics all operate identically pre- and post-YPP acceptance. No paid AdSense/monetization API is called; ad revenue, once YPP is granted, flows through YouTube's standard AdSense payout independent of this system.

## 5. Cost Ceiling Under Monetization

Achieving monetization does not change the system's ₹0 cost structure — no paid tier is required at any point in this document. Optional post-monetization scaling (more channels, higher output) is governed by `SCALING.md`, which explicitly bounds growth to stay within free-tier ceilings or pauses output rather than incurring cost.
