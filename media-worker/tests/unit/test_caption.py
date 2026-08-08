import pytest

from app import caption


def test_format_timestamp():
    assert caption.format_timestamp(0) == "00:00:00,000"
    assert caption.format_timestamp(61.5) == "00:01:01,500"


def test_format_srt_produces_numbered_blocks():
    segments = [
        {"start": 0.0, "end": 2.0, "text": "Hello"},
        {"start": 2.0, "end": 4.5, "text": "World"},
    ]
    srt = caption.format_srt(segments)
    assert "1\n00:00:00,000 --> 00:00:02,000\nHello" in srt
    assert "2\n00:00:02,000 --> 00:00:04,500\nWorld" in srt


def test_coverage_ratio_matches_known_fixture():
    segments = [{"start": 0.0, "end": 58.0, "text": "x"}]
    assert caption.coverage_ratio(segments, 60.0) == pytest.approx(58.0 / 60.0)


def test_coverage_ratio_zero_when_no_segments():
    assert caption.coverage_ratio([], 60.0) == 0.0


def test_parse_srt_round_trips_format_srt():
    segments = [
        {"start": 0.0, "end": 2.0, "text": "Hello"},
        {"start": 2.5, "end": 4.5, "text": "World"},
    ]
    srt = caption.format_srt(segments)
    parsed = caption.parse_srt(srt)
    assert parsed == segments


def test_offset_srt_shifts_and_filters_window():
    srt = caption.format_srt([
        {"start": 0.0, "end": 5.0, "text": "before"},
        {"start": 10.0, "end": 15.0, "text": "inside"},
        {"start": 40.0, "end": 45.0, "text": "after"},
    ])
    clipped = caption.offset_srt(srt, start_ts=8.0, end_ts=20.0)
    parsed = caption.parse_srt(clipped)
    assert len(parsed) == 1
    assert parsed[0]["text"] == "inside"
    assert parsed[0]["start"] == pytest.approx(2.0)
    assert parsed[0]["end"] == pytest.approx(7.0)
