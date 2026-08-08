"""Pollinations.ai image client (docs/TECH_STACK.md §7). Retries with an
alternate seed on failure; validates content-type/size before writing to
disk (docs/SECURITY.md §4 — "malicious/oversized file from Pollinations.ai")."""

import random
import urllib.parse

import httpx

BASE_URL = "https://image.pollinations.ai/prompt"
MAX_BYTES = 15 * 1024 * 1024
ALLOWED_CONTENT_TYPES = {"image/png", "image/jpeg", "image/webp"}
TIMEOUT_SECONDS = 60


def build_url(prompt: str, width: int, height: int, seed: int) -> str:
    encoded = urllib.parse.quote(prompt, safe="")
    return f"{BASE_URL}/{encoded}?width={width}&height={height}&seed={seed}&nologo=true"


async def fetch_image(prompt: str, width: int, height: int, seed: int | None = None,
                       max_attempts: int = 3) -> bytes:
    if not prompt or len(prompt) > 2000:
        raise ValueError("prompt must be non-empty and at most 2000 characters")

    seed = seed if seed is not None else random.randint(0, 2**31 - 1)
    last_error: Exception | None = None

    async with httpx.AsyncClient(timeout=TIMEOUT_SECONDS) as client:
        for attempt in range(max_attempts):
            attempt_seed = seed if attempt == 0 else random.randint(0, 2**31 - 1)
            url = build_url(prompt, width, height, attempt_seed)
            try:
                response = await client.get(url)
                response.raise_for_status()
                content_type = response.headers.get("content-type", "").split(";")[0].strip()
                if content_type not in ALLOWED_CONTENT_TYPES:
                    raise ValueError(f"unexpected content-type: {content_type}")
                if len(response.content) > MAX_BYTES:
                    raise ValueError("image exceeds max allowed size")
                return response.content
            except Exception as exc:  # noqa: BLE001 - retried below
                last_error = exc
                continue

    raise RuntimeError(f"pollinations fetch failed after {max_attempts} attempts: {last_error}")
