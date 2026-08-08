-- 0002_seed_denylist.sql
-- Populates config.restricted_topic_denylist (docs/MONETIZATION.md §3),
-- consumed by 12-Compliance-Gate's "Check: Restricted Topic" node and
-- (defense in depth) 02-Topic-Selection's Gemini rejection pass.
-- Editable without redeploying workflows — tune this list directly via SQL
-- as YouTube's advertiser-friendly guidelines evolve.

INSERT INTO config (key, value) VALUES
  ('restricted_topic_denylist', '[
     "graphic violence", "self-harm", "suicide method", "dangerous challenge",
     "how to make a bomb", "how to make explosives",
     "hate speech", "racial slur", "ethnic cleansing", "genocide denial",
     "nudity", "explicit sexual content", "pornographic",
     "firearm assembly instructions", "gun modification instructions",
     "drug synthesis instructions", "meth recipe", "how to manufacture drugs",
     "guaranteed cure", "guaranteed investment return", "guaranteed profit",
     "definitive medical diagnosis", "legal advice for your specific case",
     "election fraud claim", "voting machines were hacked", "the election was stolen"
   ]'::jsonb)
ON CONFLICT (key) DO NOTHING;
