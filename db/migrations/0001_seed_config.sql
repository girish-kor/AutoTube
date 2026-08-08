-- 0001_seed_config.sql
-- Seeds mutable runtime-tuning defaults into the `config` table (docs/DATABASE.md §12).
-- Values here are bootstrap defaults only; docs/CONFIG.md §3 config precedence
-- has this table as the highest-precedence source, overwritten in place by
-- 18-Optimization-Loop as analytics accumulate.

INSERT INTO config (key, value) VALUES
  ('topic_scoring_weights', '{
     "recency": 0.20,
     "trend_strength": 0.25,
     "evergreen_potential": 0.20,
     "competition_gap": 0.20,
     "niche_fit": 0.15
   }'::jsonb),
  ('seo_prompt_examples', '[]'::jsonb),
  ('max_concurrent_videos', '3'::jsonb),
  ('shorts_per_video', '3'::jsonb),
  ('shorts_scoring_weights', '{
     "w1_keyword_density": 0.30,
     "w2_caption_word_rate": 0.20,
     "w3_scene_boundary_alignment": 0.20,
     "w4_hook_proximity": 0.15,
     "w5_silence_ratio_penalty": 0.25
   }'::jsonb)
ON CONFLICT (key) DO NOTHING;
