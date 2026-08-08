"""`/tts` endpoint logic (docs/N8N_NODES.md workflow 06). The incoming `ssml`
is the whole narration with `<mark name="scene_N"/>` boundary markers dropped
in by n8n's Join Narration code node between scenes. Each scene is
synthesized as its own edge-tts call so per-scene start/end timestamps are
exact (cumulative segment durations) rather than inferred from TTS engine
boundary events."""

import re
import uuid

from . import ffmpeg_utils
from .clients.edge_tts_client import is_valid_voice, synthesize_to_file
from .storage import atomic_move, audio_path, tmp_dir

SCENE_MARK_RE = re.compile(r'<mark\s+name="scene_(\d+)"\s*/>')
TAG_RE = re.compile(r"<[^>]+>")


def split_ssml_scenes(ssml: str) -> list[tuple[int, str]]:
    """Split ssml on scene marks into ordered (scene_index, narration_text)
    pairs. Raises ValueError if there are no marks or a scene is empty."""
    marks = list(SCENE_MARK_RE.finditer(ssml))
    if not marks:
        raise ValueError("ssml contains no <mark name=\"scene_N\"/> boundaries")

    scenes = []
    for i, m in enumerate(marks):
        start = m.end()
        end = marks[i + 1].start() if i + 1 < len(marks) else len(ssml)
        text = TAG_RE.sub("", ssml[start:end]).strip()
        if not text:
            raise ValueError(f"scene {m.group(1)} has empty narration")
        scenes.append((int(m.group(1)), text))
    return scenes


def validate_voice(voice: str) -> None:
    if not is_valid_voice(voice):
        raise ValueError(f"invalid voice id: {voice}")


async def synthesize(video_id: str, channel_id: str, ssml: str, voice: str) -> dict:
    validate_voice(voice)
    scenes = split_ssml_scenes(ssml)

    work_dir = tmp_dir(f"tts-{video_id}-{uuid.uuid4().hex}")
    work_dir.mkdir(parents=True, exist_ok=True)
    segment_paths = []
    scene_timestamps = []
    cursor = 0.0
    try:
        for scene_index, text in scenes:
            seg_path = work_dir / f"scene_{scene_index:02d}.mp3"
            await synthesize_to_file(text, voice, seg_path)
            duration = ffmpeg_utils.probe_duration(seg_path)
            scene_timestamps.append(
                {"scene_index": scene_index, "start_ts": cursor, "end_ts": cursor + duration}
            )
            cursor += duration
            segment_paths.append(seg_path)

        final_path = audio_path(channel_id, video_id)
        concat_tmp = work_dir / "narration.wav"
        ffmpeg_utils.concat_audio(segment_paths, concat_tmp)
        atomic_move(concat_tmp, final_path)
        return {
            "audio_path": str(final_path),
            "duration_sec": cursor,
            "scene_timestamps": scene_timestamps,
        }
    finally:
        ffmpeg_utils.cleanup_dir(work_dir)
