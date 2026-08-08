"""`/caption` endpoint logic (docs/N8N_NODES.md workflow 09) — faster-whisper
transcription, SRT formatting, coverage validation, and caption burn-in."""

import re
import uuid
from pathlib import Path

from faster_whisper import WhisperModel

from . import ffmpeg_utils
from .storage import atomic_move, captions_srt_path, render_final_path, tmp_dir

SRT_BLOCK_RE = re.compile(
    r"(\d+)\s*\n(\d{2}):(\d{2}):(\d{2}),(\d{3}) --> "
    r"(\d{2}):(\d{2}):(\d{2}),(\d{3})\s*\n(.*?)(?=\n\n|\Z)",
    re.S,
)


def format_timestamp(seconds: float) -> str:
    ms_total = max(0, int(round(seconds * 1000)))
    h, ms_total = divmod(ms_total, 3600000)
    m, ms_total = divmod(ms_total, 60000)
    s, ms = divmod(ms_total, 1000)
    return f"{h:02d}:{m:02d}:{s:02d},{ms:03d}"


def format_srt(segments: list[dict]) -> str:
    """segments: [{start, end, text}]. Produces standard numbered SRT blocks."""
    blocks = []
    for i, seg in enumerate(segments, start=1):
        blocks.append(
            f"{i}\n{format_timestamp(seg['start'])} --> {format_timestamp(seg['end'])}\n"
            f"{seg['text'].strip()}\n"
        )
    return "\n".join(blocks)


def coverage_ratio(segments: list[dict], render_duration: float) -> float:
    """Ratio of transcribed coverage to render duration; the caller enforces
    the ≥0.98 gate from docs/CONTENT_PIPELINE.md §3 ("within 2% of render
    duration")."""
    if not segments or render_duration <= 0:
        return 0.0
    last_end = max(seg["end"] for seg in segments)
    return last_end / render_duration


def _parse_ts(h, m, s, ms) -> float:
    return int(h) * 3600 + int(m) * 60 + int(s) + int(ms) / 1000


def parse_srt(srt_text: str) -> list[dict]:
    entries = []
    for match in SRT_BLOCK_RE.finditer(srt_text.strip() + "\n\n"):
        _, h1, m1, s1, ms1, h2, m2, s2, ms2, text = match.groups()
        entries.append({
            "start": _parse_ts(h1, m1, s1, ms1),
            "end": _parse_ts(h2, m2, s2, ms2),
            "text": text.strip(),
        })
    return entries


def offset_srt(srt_text: str, start_ts: float, end_ts: float) -> str:
    """Re-time captions for a Shorts clip window: keep only entries
    overlapping [start_ts, end_ts], shift by -start_ts (docs/CONTENT_PIPELINE.md
    §6 — Shorts get "re-timed captions")."""
    entries = parse_srt(srt_text)
    clipped = [
        {
            "start": max(0.0, e["start"] - start_ts),
            "end": max(0.0, e["end"] - start_ts),
            "text": e["text"],
        }
        for e in entries
        if e["end"] > start_ts and e["start"] < end_ts
    ]
    return format_srt(clipped)


def transcribe(render_path: str, model_size: str) -> list[dict]:
    model = WhisperModel(model_size, device="cpu", compute_type="int8")
    raw_segments, _info = model.transcribe(render_path)
    return [{"start": s.start, "end": s.end, "text": s.text} for s in raw_segments]


def caption(channel_id: str, video_id: str, render_path: str, model_size: str) -> dict:
    render_duration = ffmpeg_utils.probe_duration(render_path)
    segments = transcribe(render_path, model_size)

    ratio = coverage_ratio(segments, render_duration)
    if not (0.98 <= ratio <= 1.02):
        raise ValueError(f"caption coverage ratio {ratio:.4f} outside 2% tolerance")

    srt_text = format_srt(segments)
    srt_final = captions_srt_path(channel_id, video_id)
    work_dir = tmp_dir(f"caption-{video_id}-{uuid.uuid4().hex}")
    work_dir.mkdir(parents=True, exist_ok=True)
    try:
        srt_tmp = work_dir / "captions.srt"
        srt_tmp.write_text(srt_text, encoding="utf-8")
        atomic_move(srt_tmp, srt_final)

        # Burn via a working-directory-relative filename, not an absolute
        # path embedded in the filter string — ffmpeg's `subtitles` filter
        # option-value escaping for colons (e.g. a Windows drive letter) is
        # notoriously fragile; a bare relative name sidesteps it entirely.
        burn_srt = work_dir / "burn.srt"
        burn_srt.write_text(srt_text, encoding="utf-8")

        burned_tmp = work_dir / "burned.mp4"
        cmd = [
            "ffmpeg", "-y", "-i", str(Path(render_path).resolve()),
            "-vf", f"subtitles={burn_srt.name}",
            "-c:a", "copy", str(burned_tmp),
        ]
        ffmpeg_utils.run_command(cmd, cwd=work_dir)

        final_render = render_final_path(channel_id, video_id)
        atomic_move(burned_tmp, final_render)
        return {"srt_path": str(srt_final), "captioned_render_path": str(final_render)}
    finally:
        ffmpeg_utils.cleanup_dir(work_dir)
