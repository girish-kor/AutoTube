"""edge-tts client (docs/TECH_STACK.md §6). One module per provider so a
provider swap (e.g. to the Coqui TTS fallback) is a one-file change."""

import re
from pathlib import Path

import edge_tts

# e.g. en-US-AndrewNeural, en-GB-SoniaNeural
VOICE_ID_PATTERN = re.compile(r"^[a-z]{2}-[A-Z]{2}-[A-Za-z]+Neural$")


def is_valid_voice(voice: str) -> bool:
    return bool(VOICE_ID_PATTERN.match(voice))


async def synthesize_to_file(text: str, voice: str, output_path: Path) -> None:
    if not text.strip():
        raise ValueError("cannot synthesize empty narration")
    if not is_valid_voice(voice):
        raise ValueError(f"invalid voice id: {voice}")
    output_path.parent.mkdir(parents=True, exist_ok=True)
    communicate = edge_tts.Communicate(text, voice)
    await communicate.save(str(output_path))
