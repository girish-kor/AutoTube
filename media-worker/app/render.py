"""`/render` endpoint logic (docs/N8N_NODES.md workflows 08, 14). Two manifest
shapes share the endpoint: long-form Ken-Burns assembly (`images` present) and
Shorts re-crop/re-time (`source` present) — see docs/ARCHITECTURE.md data flow
steps 8 and 14."""

import hashlib
import uuid
from pathlib import Path

from . import ffmpeg_utils
from .caption import offset_srt
from .storage import atomic_move, render_v1_path, short_render_path, tmp_dir


def build_longform_command(manifest: dict, output_path: Path) -> list[str]:
    """Pure command construction (no subprocess execution) so N-image/duration
    manifests are unit-testable per docs/TESTING.md §2."""
    images = manifest["images"]
    if not images:
        raise ValueError("manifest.images must be non-empty")
    audio_path = manifest["audio_path"]
    width, height = manifest.get("resolution", "1920x1080").split("x")

    cmd = ["ffmpeg", "-y"]
    filter_parts = []
    for i, img in enumerate(images):
        duration = img["end_ts"] - img["start_ts"]
        if duration <= 0:
            raise ValueError(f"image {i} has non-positive duration")
        cmd += ["-loop", "1", "-t", f"{duration:.3f}", "-i", img["path"]]
        zoom_expr = "min(zoom+0.0015,1.2)"
        filter_parts.append(
            f"[{i}:v]scale={width}:{height},zoompan=z='{zoom_expr}':"
            f"d={max(1, int(duration * 25))}:s={width}x{height}:fps=25[v{i}]"
        )
    concat_inputs = "".join(f"[v{i}]" for i in range(len(images)))
    filter_parts.append(f"{concat_inputs}concat=n={len(images)}:v=1:a=0[vout]")

    cmd += ["-i", audio_path]
    cmd += ["-filter_complex", ";".join(filter_parts)]
    cmd += ["-map", "[vout]", "-map", f"{len(images)}:a"]
    cmd += ["-c:v", "libx264", "-c:a", "aac", "-shortest", str(output_path)]
    return cmd


def build_clip_command(source: str, start_ts: float, end_ts: float, aspect: str | None,
                        subtitles_filename: str | None, output_path: Path) -> list[str]:
    """`subtitles_filename` is a bare filename (no directory component),
    resolved relative to the process cwd at execution time — see `render()`,
    which runs this command with `cwd=work_dir`. A relative name sidesteps
    the `subtitles` filter's fragile colon-escaping for absolute paths
    (e.g. a Windows drive letter)."""
    if end_ts <= start_ts:
        raise ValueError("end_ts must be greater than start_ts")
    cmd = ["ffmpeg", "-y", "-ss", f"{start_ts:.3f}", "-to", f"{end_ts:.3f}", "-i", source]

    vf_parts = []
    if aspect == "9:16":
        vf_parts.append("crop=ih*9/16:ih,scale=1080:1920")
    if subtitles_filename is not None:
        vf_parts.append(f"subtitles={subtitles_filename}")
    if vf_parts:
        cmd += ["-vf", ",".join(vf_parts)]

    cmd += ["-c:v", "libx264", "-c:a", "aac", str(output_path)]
    return cmd


def duration_within_tolerance(rendered: float, reference: float, tolerance: float = 0.05) -> bool:
    """Render validation gate (docs/CONTENT_PIPELINE.md §3): rendered duration
    must be within ±5% of the reference (audio) duration."""
    if reference <= 0:
        return False
    return abs(rendered - reference) / reference <= tolerance


def checksum_file(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def render(manifest: dict) -> dict:
    channel_id = manifest["channel_id"]
    video_id = manifest["video_id"]
    work_dir = tmp_dir(f"render-{video_id}-{uuid.uuid4().hex}")
    work_dir.mkdir(parents=True, exist_ok=True)
    tmp_output = work_dir / "output.mp4"

    try:
        if manifest.get("images"):
            cmd = build_longform_command(manifest, tmp_output)
            final_path = render_v1_path(channel_id, video_id)
        else:
            subtitles_filename = None
            if manifest.get("burn_captions") and manifest.get("captions_path"):
                srt_text = Path(manifest["captions_path"]).read_text(encoding="utf-8")
                clipped = offset_srt(srt_text, manifest["start_ts"], manifest["end_ts"])
                (work_dir / "clip.srt").write_text(clipped, encoding="utf-8")
                subtitles_filename = "clip.srt"

            cmd = build_clip_command(
                manifest["source"], manifest["start_ts"], manifest["end_ts"],
                manifest.get("aspect"), subtitles_filename, tmp_output,
            )
            clip_index = manifest.get("clip_index", 0)
            final_path = short_render_path(channel_id, video_id, clip_index)

        ffmpeg_utils.run_command(cmd, cwd=work_dir)
        duration = ffmpeg_utils.probe_duration(tmp_output)
        checksum = checksum_file(tmp_output)
        atomic_move(tmp_output, final_path)
        return {"render_path": str(final_path), "checksum": checksum, "duration_sec": duration}
    finally:
        ffmpeg_utils.cleanup_dir(work_dir)
