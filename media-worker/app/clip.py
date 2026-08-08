"""`/clip` endpoint logic (docs/N8N_NODES.md workflow 14, docs/AI_PIPELINE.md
§7) — deterministic heuristic Shorts highlight scorer. No LLM call: this
stage stays free of Gemini quota/latency."""

import json
import re
import subprocess
from collections import Counter

from .caption import parse_srt

MIN_WINDOW_SEC = 20.0
MAX_WINDOW_SEC = 59.0
WORD_RATE_REFERENCE = 3.5  # words/sec, normalizes caption_word_rate to [0,1]
BOUNDARY_TOLERANCE_SEC = 1.5

WORD_RE = re.compile(r"[a-z0-9']+")

DEFAULT_WEIGHTS = {
    "w1_keyword_density": 0.30,
    "w2_caption_word_rate": 0.20,
    "w3_scene_boundary_alignment": 0.20,
    "w4_hook_proximity": 0.15,
    "w5_silence_ratio_penalty": 0.25,
}


def tokenize(text: str) -> list[str]:
    return WORD_RE.findall(text.lower())


def extract_keywords(script_json: dict, top_n: int = 20) -> list[str]:
    words = []
    for scene in script_json.get("scenes", []):
        words.extend(tokenize(scene.get("narration", "")))
    counts = Counter(w for w in words if len(w) > 3)
    return [w for w, _ in counts.most_common(top_n)]


def window_captions(entries: list[dict], start_ts: float, end_ts: float) -> list[dict]:
    return [e for e in entries if e["end"] > start_ts and e["start"] < end_ts]


def keyword_density(window_entries: list[dict], keywords: list[str]) -> float:
    words = [w for e in window_entries for w in tokenize(e["text"])]
    if not words:
        return 0.0
    keyword_set = set(keywords)
    hits = sum(1 for w in words if w in keyword_set)
    return hits / len(words)


def caption_word_rate(window_entries: list[dict], duration: float) -> float:
    if duration <= 0:
        return 0.0
    word_count = sum(len(tokenize(e["text"])) for e in window_entries)
    return min(1.0, (word_count / duration) / WORD_RATE_REFERENCE)


def scene_boundary_alignment(
    start_ts: float, end_ts: float, scene_boundaries: list[float]
) -> float:
    if not scene_boundaries:
        return 0.0
    start_hit = any(abs(start_ts - b) <= BOUNDARY_TOLERANCE_SEC for b in scene_boundaries)
    end_hit = any(abs(end_ts - b) <= BOUNDARY_TOLERANCE_SEC for b in scene_boundaries)
    return (int(start_hit) + int(end_hit)) / 2


def hook_proximity(start_ts: float, hook_end_ts: float) -> float:
    if start_ts <= hook_end_ts:
        return 1.0
    distance = start_ts - hook_end_ts
    return max(0.0, 1.0 - distance / 120.0)


def silence_ratio(window_entries: list[dict], start_ts: float, end_ts: float) -> float:
    """Fraction of the window with no caption coverage — a proxy for dead
    air (docs/AI_PIPELINE.md §7 `w5*silence_ratio` penalty term)."""
    duration = end_ts - start_ts
    if duration <= 0:
        return 1.0
    covered = 0.0
    cursor = start_ts
    for e in sorted(window_entries, key=lambda x: x["start"]):
        seg_start = max(cursor, e["start"], start_ts)
        seg_end = min(e["end"], end_ts)
        if seg_end > seg_start:
            covered += seg_end - seg_start
            cursor = max(cursor, seg_end)
    return max(0.0, 1.0 - covered / duration)


def score_window(start_ts: float, end_ts: float, entries: list[dict], keywords: list[str],
                  scene_boundaries: list[float], hook_end_ts: float,
                  weights: dict = DEFAULT_WEIGHTS) -> float:
    window_entries = window_captions(entries, start_ts, end_ts)
    duration = end_ts - start_ts
    return (
        weights["w1_keyword_density"] * keyword_density(window_entries, keywords)
        + weights["w2_caption_word_rate"] * caption_word_rate(window_entries, duration)
        + weights["w3_scene_boundary_alignment"]
        * scene_boundary_alignment(start_ts, end_ts, scene_boundaries)
        + weights["w4_hook_proximity"] * hook_proximity(start_ts, hook_end_ts)
        - weights["w5_silence_ratio_penalty"] * silence_ratio(window_entries, start_ts, end_ts)
    )


def candidate_windows(
    total_duration: float, window_sec: float = MAX_WINDOW_SEC
) -> list[tuple[float, float]]:
    """Non-overlapping windows spanning the render, each MIN..MAX seconds."""
    windows = []
    cursor = 0.0
    while cursor < total_duration:
        end = min(cursor + window_sec, total_duration)
        if end - cursor >= MIN_WINDOW_SEC:
            windows.append((cursor, end))
        cursor = end
    return windows


def rank_candidates(srt_text: str, script_json: dict, top_n: int,
                     weights: dict = DEFAULT_WEIGHTS) -> list[dict]:
    entries = parse_srt(srt_text)
    if not entries:
        return []
    total_duration = max(e["end"] for e in entries)
    keywords = extract_keywords(script_json)
    scenes = script_json.get("scenes", [])
    scene_boundaries = [s["start_ts"] for s in scenes if s.get("start_ts") is not None]
    hook_end_ts = (
        scenes[0].get("start_ts", 0.0) + scenes[0].get("duration_estimate_sec", 0.0)
        if scenes else 0.0
    )

    scored = [
        {
            "start_ts": start_ts, "end_ts": end_ts,
            "score": score_window(start_ts, end_ts, entries, keywords, scene_boundaries,
                                   hook_end_ts, weights),
        }
        for start_ts, end_ts in candidate_windows(total_duration)
    ]
    scored.sort(key=lambda w: w["score"], reverse=True)
    return scored[:top_n]


def detect_silence_intervals(render_path: str) -> list[tuple[float, float]]:
    """Best-effort dead-air detection via auto-editor (docs/TECH_STACK.md
    §14). This is a supplementary signal, not a hard dependency — an
    unavailable/unparsable auto-editor output degrades to an empty list
    rather than failing the stage (docs/ERROR_HANDLING.md §4)."""
    try:
        result = subprocess.run(
            ["auto-editor", render_path, "--edit", "audio:threshold=4%",
             "--export", "json", "--no-open"],
            capture_output=True, text=True, timeout=300,
        )
        if result.returncode != 0:
            return []
        data = json.loads(result.stdout)
        return [(c["start"], c["end"]) for c in data.get("silent_chunks", [])]
    except Exception:
        return []


def extract(video_id: str, captions_path: str, script_json: dict, top_n: int) -> dict:
    from pathlib import Path

    srt_text = Path(captions_path).read_text(encoding="utf-8")
    candidates = rank_candidates(srt_text, script_json, top_n)
    return {"candidates": candidates}
