"""Thin subprocess wrappers around ffmpeg/ffprobe. Kept separate from the
per-endpoint modules so command-construction logic (tested without actually
invoking a subprocess) stays distinct from execution."""

import shutil
import subprocess
from pathlib import Path


class FFmpegError(RuntimeError):
    pass


def run_command(cmd: list[str], cwd: Path | None = None) -> None:
    result = subprocess.run(cmd, capture_output=True, text=True, cwd=cwd)
    if result.returncode != 0:
        raise FFmpegError(f"command failed ({cmd[0]}): {result.stderr[-2000:]}")


def probe_duration(path: Path) -> float:
    cmd = [
        "ffprobe", "-v", "error", "-show_entries", "format=duration",
        "-of", "default=noprint_wrappers=1:nokey=1", str(path),
    ]
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        raise FFmpegError(f"ffprobe failed: {result.stderr[-2000:]}")
    return float(result.stdout.strip())


def concat_audio(segment_paths: list[Path], output_path: Path) -> None:
    list_file = output_path.parent / f"{output_path.stem}_concat_list.txt"
    with open(list_file, "w", encoding="utf-8") as f:
        for p in segment_paths:
            f.write(f"file '{p.as_posix()}'\n")
    cmd = [
        "ffmpeg", "-y", "-f", "concat", "-safe", "0", "-i", str(list_file),
        "-c:a", "pcm_s16le", str(output_path),
    ]
    run_command(cmd)
    list_file.unlink(missing_ok=True)


def cleanup_dir(path: Path) -> None:
    shutil.rmtree(path, ignore_errors=True)
