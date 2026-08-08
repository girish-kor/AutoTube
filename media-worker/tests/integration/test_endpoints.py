"""Integration tests (docs/TESTING.md §4) — real HTTP requests against the
FastAPI app via TestClient, with external providers (Pollinations.ai,
edge-tts, faster-whisper's model download) stubbed so runs are deterministic
and offline, same rationale docs/TESTING.md gives for stubbing Pollinations.
FFmpeg itself runs for real (available in the media-worker image and in CI)."""

import subprocess
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app import caption as caption_module
from app import image as image_module
from app import thumbnail as thumbnail_module
from app import tts as tts_module
from app.config import MEDIA_ROOT
from app.main import app

client = TestClient(app)

TINY_PNG = (
    b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01\x08\x02\x00\x00\x00"
    b"\x90wS\xde\x00\x00\x00\x0cIDATx\x9cc\xf8\xcf\xc0\x00\x00\x03\x01\x01\x00\x18\xdd\x8d\xb0"
    b"\x00\x00\x00\x00IEND\xaeB`\x82"
)


def _make_video(path: Path, duration: float = 2.0) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    subprocess.run(
        ["ffmpeg", "-y", "-f", "lavfi", "-i", f"color=c=red:s=320x240:d={duration}",
         "-f", "lavfi", "-i", "anullsrc=r=44100:cl=stereo",
         "-shortest", str(path)],
        capture_output=True, check=True,
    )


def test_healthz():
    resp = client.get("/healthz")
    assert resp.status_code == 200
    assert resp.json() == {"ok": True}


def test_compliance_scan_endpoint_passes():
    resp = client.post("/compliance-scan", json={
        "video_id": "vid-cs-1",
        "assets": [
            {"video_id": "vid-cs-1", "type": "image", "scene_index": 0,
             "source_tool": "pollinations"},
        ],
    })
    assert resp.status_code == 200
    body = resp.json()
    assert body["passed"] is True


def test_compliance_scan_endpoint_fails_on_disallowed_tool():
    resp = client.post("/compliance-scan", json={
        "video_id": "vid-cs-2",
        "assets": [
            {"video_id": "vid-cs-2", "type": "image", "scene_index": 0, "source_tool": "stock-api"},
        ],
    })
    assert resp.status_code == 200
    body = resp.json()
    assert body["passed"] is False


def test_image_endpoint_writes_file(monkeypatch):
    async def fake_fetch_image(prompt, width, height, seed=None):
        return TINY_PNG

    monkeypatch.setattr(image_module, "fetch_image", fake_fetch_image)

    resp = client.post("/image", json={
        "channel_id": "chan-int", "video_id": "vid-image-1", "scene_index": 0,
        "prompt": "a red fox in a forest", "width": 64, "height": 64,
    })
    assert resp.status_code == 200
    file_path = Path(resp.json()["file_path"])
    assert file_path.exists()
    assert file_path.read_bytes() == TINY_PNG


def test_thumbnail_endpoint_writes_file(monkeypatch):
    async def fake_fetch_image(prompt, width, height, seed=None):
        return TINY_PNG

    monkeypatch.setattr(thumbnail_module, "fetch_image", fake_fetch_image)

    resp = client.post("/thumbnail", json={
        "channel_id": "chan-int", "video_id": "vid-thumb-1",
        "art_prompt": "bold contrast subject", "overlay_text": "Wild Fact",
    })
    assert resp.status_code == 200
    file_path = Path(resp.json()["file_path"])
    assert file_path.exists()
    assert file_path.stat().st_size > 0


def test_tts_endpoint_writes_narration_and_timestamps(monkeypatch, tmp_path):
    async def fake_synthesize_to_file(text, voice, output_path):
        _make_video(output_path.with_suffix(".mp4"), duration=1.0)
        subprocess.run(
            ["ffmpeg", "-y", "-f", "lavfi", "-i", "anullsrc=r=44100:cl=mono:d=1",
             str(output_path)],
            capture_output=True, check=True,
        )

    monkeypatch.setattr(tts_module, "synthesize_to_file", fake_synthesize_to_file)

    ssml = (
        '<speak><mark name="scene_0"/>First scene narration.'
        '<mark name="scene_1"/>Second scene narration.</speak>'
    )
    resp = client.post("/tts", json={
        "video_id": "vid-tts-1", "channel_id": "chan-int", "ssml": ssml,
        "voice": "en-US-AndrewNeural",
    })
    assert resp.status_code == 200
    body = resp.json()
    assert Path(body["audio_path"]).exists()
    assert len(body["scene_timestamps"]) == 2
    assert body["scene_timestamps"][0]["scene_index"] == 0
    assert body["duration_sec"] > 0


def test_render_endpoint_clip_mode_writes_file():
    src = MEDIA_ROOT / "tmp" / "fixture_src.mp4"
    _make_video(src, duration=3.0)

    resp = client.post("/render", json={
        "channel_id": "chan-int", "video_id": "vid-render-1",
        "source": str(src), "start_ts": 0.0, "end_ts": 2.0,
        "aspect": "9:16", "clip_index": 0,
    })
    assert resp.status_code == 200
    body = resp.json()
    render_path = Path(body["render_path"])
    assert render_path.exists()
    assert body["duration_sec"] > 0
    assert len(body["checksum"]) == 64


def test_caption_endpoint_transcribes_and_burns(monkeypatch):
    render_path = MEDIA_ROOT / "tmp" / "fixture_caption_src.mp4"
    _make_video(render_path, duration=2.0)

    class FakeSegment:
        def __init__(self, start, end, text):
            self.start = start
            self.end = end
            self.text = text

    def fake_transcribe(path, model_size):
        return [{"start": 0.0, "end": 2.0, "text": "a fixture sentence"}]

    monkeypatch.setattr(caption_module, "transcribe", fake_transcribe)

    resp = client.post("/caption", json={
        "channel_id": "chan-int", "video_id": "vid-caption-1",
        "render_path": str(render_path), "model_size": "tiny",
    })
    assert resp.status_code == 200
    body = resp.json()
    assert Path(body["srt_path"]).exists()
    assert Path(body["captioned_render_path"]).exists()


def test_clip_endpoint_returns_ranked_candidates(tmp_path):
    srt_path = tmp_path / "captions.srt"
    srt_path.write_text(
        "1\n00:00:00,000 --> 00:00:09,000\nThis is the amazing hook about robots\n\n"
        "2\n00:00:09,000 --> 00:00:39,000\nRobots robots factories transforming everywhere\n\n"
        "3\n00:01:30,000 --> 00:01:32,000\nquiet\n",
        encoding="utf-8",
    )
    script_json = {
        "scenes": [
            {"narration": "This is the amazing hook about robots.",
             "visual_prompt": "x", "duration_estimate_sec": 9, "start_ts": 0.0},
            {"narration": "Robots are transforming factories everywhere today.",
             "visual_prompt": "x", "duration_estimate_sec": 30, "start_ts": 9.0},
        ]
    }
    resp = client.post("/clip", json={
        "video_id": "vid-clip-1", "captions_path": str(srt_path),
        "script_json": script_json, "top_n": 2,
    })
    assert resp.status_code == 200
    candidates = resp.json()["candidates"]
    assert 1 <= len(candidates) <= 2
    assert candidates[0]["score"] >= candidates[-1]["score"]


@pytest.mark.parametrize("video_id", ["vid-missing-clip"])
def test_clip_endpoint_422_on_missing_captions_file(video_id):
    resp = client.post("/clip", json={
        "video_id": video_id, "captions_path": "/nonexistent/path.srt",
        "script_json": {"scenes": []}, "top_n": 2,
    })
    assert resp.status_code == 422
