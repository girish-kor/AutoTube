"""`/image` endpoint logic (docs/N8N_NODES.md workflow 07)."""

from .clients.pollinations import fetch_image
from .storage import atomic_write_bytes, image_path


async def generate(channel_id: str, video_id: str, scene_index: int, prompt: str,
                    width: int, height: int, seed: int | None) -> dict:
    image_bytes = await fetch_image(prompt, width, height, seed)
    final_path = image_path(channel_id, video_id, scene_index)
    atomic_write_bytes(final_path, image_bytes)
    return {"file_path": str(final_path)}
