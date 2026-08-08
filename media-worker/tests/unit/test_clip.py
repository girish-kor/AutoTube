from app import clip
from app.caption import format_srt

FIXTURE_SCRIPT = {
    "scenes": [
        {"narration": "This is the amazing hook about robots.", "visual_prompt": "x",
         "duration_estimate_sec": 9, "start_ts": 0.0},
        {"narration": "Robots are transforming factories everywhere today.", "visual_prompt": "x",
         "duration_estimate_sec": 30, "start_ts": 9.0},
        {"narration": "Some quiet unrelated filler content here now.", "visual_prompt": "x",
         "duration_estimate_sec": 30, "start_ts": 39.0},
    ]
}


def test_keyword_density_scores_higher_for_relevant_window():
    keywords = ["robots", "factories"]
    good = [{"start": 0, "end": 5, "text": "robots robots factories transforming"}]
    bad = [{"start": 0, "end": 5, "text": "the quick brown fox jumps"}]
    assert clip.keyword_density(good, keywords) > clip.keyword_density(bad, keywords)


def test_silence_ratio_penalizes_dead_air_window():
    dense = [{"start": 0.0, "end": 20.0, "text": "talking the whole time here"}]
    sparse = [{"start": 0.0, "end": 2.0, "text": "short"}]
    assert clip.silence_ratio(sparse, 0.0, 20.0) > clip.silence_ratio(dense, 0.0, 20.0)


def test_rank_candidates_prefers_hook_and_keyword_dense_window_over_dead_air():
    entries = [
        {"start": 0.0, "end": 9.0, "text": "This is the amazing hook about robots and factories"},
        {"start": 9.0, "end": 39.0,
         "text": "Robots robots factories factories transforming everywhere constantly"},
        {"start": 90.0, "end": 92.0, "text": "quiet"},
    ]
    srt = format_srt(entries)
    ranked = clip.rank_candidates(srt, FIXTURE_SCRIPT, top_n=2)
    assert len(ranked) >= 1
    best = ranked[0]
    assert best["start_ts"] < 60.0


def test_candidate_windows_are_non_overlapping_and_bounded():
    windows = clip.candidate_windows(150.0)
    for start, end in windows:
        assert clip.MIN_WINDOW_SEC <= (end - start) <= clip.MAX_WINDOW_SEC
    for (_s1, e1), (s2, _e2) in zip(windows, windows[1:], strict=False):
        assert e1 == s2
