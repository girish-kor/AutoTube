import os
from pathlib import Path

MEDIA_ROOT = Path(os.environ.get("MEDIA_ROOT", "/data/autotube"))
WHISPER_MODEL_SIZE = os.environ.get("WHISPER_MODEL_SIZE", "small")
TTS_DEFAULT_VOICE = os.environ.get("TTS_DEFAULT_VOICE", "en-US-AndrewNeural")

# Structural compliance rule (docs/CONTENT_PIPELINE.md §4.1, docs/TECH_STACK.md §12):
# no asset may enter the render pipeline unless it was produced by one of these tools.
ALLOWED_ASSET_SOURCE_TOOLS = {"pollinations", "edge-tts", "ffmpeg", "pillow"}
