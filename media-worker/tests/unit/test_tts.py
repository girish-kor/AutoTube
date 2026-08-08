import pytest

from app import tts


def test_split_ssml_scenes_produces_correct_boundaries():
    ssml = (
        '<speak><mark name="scene_0"/>Hello there.'
        '<mark name="scene_1"/>Second scene text.'
        '<mark name="scene_2"/>Third.</speak>'
    )
    scenes = tts.split_ssml_scenes(ssml)
    assert scenes == [
        (0, "Hello there."),
        (1, "Second scene text."),
        (2, "Third."),
    ]


def test_split_ssml_scenes_rejects_no_marks():
    with pytest.raises(ValueError):
        tts.split_ssml_scenes("<speak>no marks here</speak>")


def test_split_ssml_scenes_rejects_empty_scene():
    ssml = '<speak><mark name="scene_0"/><mark name="scene_1"/>Text</speak>'
    with pytest.raises(ValueError):
        tts.split_ssml_scenes(ssml)


def test_validate_voice_accepts_known_pattern():
    tts.validate_voice("en-US-AndrewNeural")


def test_validate_voice_rejects_bad_pattern():
    with pytest.raises(ValueError):
        tts.validate_voice("not-a-voice")
