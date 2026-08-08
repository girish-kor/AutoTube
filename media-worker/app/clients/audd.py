"""AudD.io audio-fingerprint client (docs/TECH_STACK.md §12 safety net).
Not called by this service today — docs/CONFIG.md §2 lists the `audd-api`
n8n credential as used directly by workflow 12 — but kept here so the
provider integration lives in one place if that call is ever moved server-side."""

import httpx

AUDD_URL = "https://api.audd.io/"
TIMEOUT_SECONDS = 30


async def fingerprint_scan(audio_path: str, api_key: str) -> dict:
    async with httpx.AsyncClient(timeout=TIMEOUT_SECONDS) as client:
        with open(audio_path, "rb") as f:
            response = await client.post(
                AUDD_URL,
                data={"api_token": api_key, "return": "apple_music,spotify"},
                files={"file": f},
            )
        response.raise_for_status()
        return response.json()
