"""Filesystem layout per docs/STORAGE.md §2. Every path under MEDIA_ROOT is
built here so the directory structure has exactly one source of truth."""

import os
import uuid
from pathlib import Path

from .config import MEDIA_ROOT


def video_dir(channel_id: str, video_id: str) -> Path:
    return MEDIA_ROOT / channel_id / "videos" / video_id


def audio_path(channel_id: str, video_id: str) -> Path:
    return video_dir(channel_id, video_id) / "audio" / "narration.wav"


def image_path(channel_id: str, video_id: str, scene_index: int) -> Path:
    return video_dir(channel_id, video_id) / "images" / f"scene_{scene_index:02d}.png"


def render_v1_path(channel_id: str, video_id: str) -> Path:
    return video_dir(channel_id, video_id) / "render" / "longform_v1.mp4"


def render_final_path(channel_id: str, video_id: str) -> Path:
    return video_dir(channel_id, video_id) / "render" / "longform_final.mp4"


def captions_srt_path(channel_id: str, video_id: str) -> Path:
    return video_dir(channel_id, video_id) / "captions" / "captions.srt"


def thumbnail_img_path(channel_id: str, video_id: str) -> Path:
    return video_dir(channel_id, video_id) / "thumbnail" / "thumbnail.jpg"


def manifest_json_path(channel_id: str, video_id: str) -> Path:
    return video_dir(channel_id, video_id) / "manifest.json"


def short_render_path(channel_id: str, video_id: str, clip_index: int) -> Path:
    return MEDIA_ROOT / channel_id / "shorts" / video_id / str(clip_index) / "short.mp4"


def tmp_dir(execution_id: str) -> Path:
    return MEDIA_ROOT / "tmp" / execution_id


def atomic_write_bytes(final_path: Path, data: bytes) -> None:
    final_path.parent.mkdir(parents=True, exist_ok=True)
    tmp_path = final_path.parent / f".{final_path.name}.{uuid.uuid4().hex}.tmp"
    tmp_path.write_bytes(data)
    os.replace(tmp_path, final_path)


def atomic_move(tmp_path: Path, final_path: Path) -> None:
    """Rename a completed temp file into place. Never leaves a partial file
    at `final_path` (docs/ERROR_HANDLING.md §4, docs/CODING_RULES.md §4)."""
    final_path.parent.mkdir(parents=True, exist_ok=True)
    os.replace(tmp_path, final_path)
