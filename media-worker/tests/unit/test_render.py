import subprocess
from pathlib import Path

import pytest

from app import render


def test_build_longform_command_for_n_images():
    manifest = {
        "audio_path": "/data/audio.wav",
        "resolution": "1920x1080",
        "images": [
            {"path": "/data/scene_00.png", "start_ts": 0.0, "end_ts": 5.0},
            {"path": "/data/scene_01.png", "start_ts": 5.0, "end_ts": 12.0},
        ],
    }
    output_path = Path("/tmp/out.mp4")
    cmd = render.build_longform_command(manifest, output_path)
    assert cmd.count("-loop") == 2
    assert "/data/scene_00.png" in cmd
    assert "/data/scene_01.png" in cmd
    assert "/data/audio.wav" in cmd
    assert cmd[-1] == str(output_path)


def test_build_longform_command_rejects_empty_images():
    with pytest.raises(ValueError):
        render.build_longform_command({"audio_path": "a.wav", "images": []}, Path("/tmp/out.mp4"))


def test_build_longform_command_rejects_non_positive_duration():
    manifest = {
        "audio_path": "a.wav",
        "images": [{"path": "s.png", "start_ts": 5.0, "end_ts": 5.0}],
    }
    with pytest.raises(ValueError):
        render.build_longform_command(manifest, Path("/tmp/out.mp4"))


def test_build_clip_command_applies_aspect_crop():
    cmd = render.build_clip_command("src.mp4", 10.0, 40.0, "9:16", None, Path("/tmp/short.mp4"))
    assert "-vf" in cmd
    idx = cmd.index("-vf")
    assert "crop=" in cmd[idx + 1]


def test_build_clip_command_rejects_bad_range():
    with pytest.raises(ValueError):
        render.build_clip_command("src.mp4", 40.0, 10.0, None, None, Path("/tmp/short.mp4"))


def test_duration_within_tolerance():
    assert render.duration_within_tolerance(100.0, 98.0) is True
    assert render.duration_within_tolerance(100.0, 90.0) is False
    assert render.duration_within_tolerance(100.0, 0.0) is False


def test_checksum_file_is_deterministic(tmp_path):
    p = tmp_path / "f.bin"
    p.write_bytes(b"hello world")
    assert render.checksum_file(p) == render.checksum_file(p)


def test_render_writes_via_atomic_temp_then_rename(tmp_path, monkeypatch):
    from app import storage

    monkeypatch.setattr(storage, "MEDIA_ROOT", tmp_path)

    src = tmp_path / "src.mp4"
    subprocess.run(
        ["ffmpeg", "-y", "-f", "lavfi", "-i", "color=c=blue:s=320x240:d=2",
         "-f", "lavfi", "-i", "anullsrc=r=44100:cl=stereo",
         "-shortest", str(src)],
        capture_output=True, check=True,
    )

    manifest = {
        "channel_id": "chan1", "video_id": "vid1",
        "source": str(src), "start_ts": 0.0, "end_ts": 1.0, "clip_index": 0,
    }
    result = render.render(manifest)
    out_path = Path(result["render_path"])
    assert out_path.exists()
    assert result["duration_sec"] > 0
    # no leftover temp/work dir
    assert not (tmp_path / "tmp").exists() or not any((tmp_path / "tmp").iterdir())
