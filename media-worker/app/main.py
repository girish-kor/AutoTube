"""FastAPI app wiring the 7 media-worker endpoints (docs/ARCHITECTURE.md).
No global mutable state between requests (docs/CODING_RULES.md §4) — every
handler is a stateless function over its request body."""

import hmac
import logging

from fastapi import FastAPI, HTTPException, Request
from starlette.responses import JSONResponse

from . import caption, clip, compliance_scan, image, render, thumbnail, tts
from .config import MEDIA_WORKER_API_KEY, WHISPER_MODEL_SIZE
from .models import (
    CaptionRequest,
    CaptionResponse,
    ClipRequest,
    ClipResponse,
    ComplianceScanRequest,
    ComplianceScanResponse,
    ImageRequest,
    ImageResponse,
    RenderRequest,
    RenderResponse,
    ThumbnailRequest,
    ThumbnailResponse,
    TTSRequest,
    TTSResponse,
)

# Endpoints log paths/durations/status only — never request/response bodies
# containing file contents (docs/CODING_RULES.md §4, docs/SECURITY.md §1).
logger = logging.getLogger("media_worker")

app = FastAPI(title="AutoTube media-worker")


@app.middleware("http")
async def require_api_key(request: Request, call_next):
    # No-op when MEDIA_WORKER_API_KEY is unset — the default Docker Compose
    # deployment has no published port and relies on network isolation
    # instead (docs/SECURITY.md §3). Required once the service has a public
    # URL (e.g. deployed standalone on Render).
    if MEDIA_WORKER_API_KEY and request.url.path != "/healthz":
        supplied = request.headers.get("x-api-key", "")
        if not hmac.compare_digest(supplied, MEDIA_WORKER_API_KEY):
            return JSONResponse(status_code=401, content={"detail": "invalid or missing X-API-Key"})
    return await call_next(request)


@app.get("/healthz")
def healthz() -> dict:
    return {"ok": True}


@app.post("/tts", response_model=TTSResponse)
async def tts_endpoint(req: TTSRequest) -> TTSResponse:
    try:
        result = await tts.synthesize(req.video_id, req.channel_id, req.ssml, req.voice)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    logger.info("tts complete video_id=%s duration_sec=%.2f", req.video_id, result["duration_sec"])
    return TTSResponse(**result)


@app.post("/image", response_model=ImageResponse)
async def image_endpoint(req: ImageRequest) -> ImageResponse:
    try:
        result = await image.generate(
            req.channel_id, req.video_id, req.scene_index, req.prompt,
            req.width, req.height, req.seed,
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    logger.info("image complete video_id=%s scene_index=%s", req.video_id, req.scene_index)
    return ImageResponse(**result)


@app.post("/render", response_model=RenderResponse)
async def render_endpoint(req: RenderRequest) -> RenderResponse:
    manifest = req.model_dump()
    try:
        result = render.render(manifest)
    except (ValueError, render.ffmpeg_utils.FFmpegError) as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    logger.info(
        "render complete video_id=%s duration_sec=%.2f", req.video_id, result["duration_sec"]
    )
    return RenderResponse(**result)


@app.post("/caption", response_model=CaptionResponse)
async def caption_endpoint(req: CaptionRequest) -> CaptionResponse:
    try:
        result = caption.caption(
            req.channel_id, req.video_id, req.render_path, req.model_size or WHISPER_MODEL_SIZE
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    logger.info("caption complete video_id=%s", req.video_id)
    return CaptionResponse(**result)


@app.post("/thumbnail", response_model=ThumbnailResponse)
async def thumbnail_endpoint(req: ThumbnailRequest) -> ThumbnailResponse:
    try:
        result = await thumbnail.generate(
            req.channel_id, req.video_id, req.art_prompt, req.overlay_text
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    logger.info("thumbnail complete video_id=%s", req.video_id)
    return ThumbnailResponse(**result)


@app.post("/clip", response_model=ClipResponse)
async def clip_endpoint(req: ClipRequest) -> ClipResponse:
    try:
        result = clip.extract(req.video_id, req.captions_path, req.script_json, req.top_n)
    except (ValueError, FileNotFoundError) as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    logger.info("clip complete video_id=%s candidates=%d", req.video_id, len(result["candidates"]))
    return ClipResponse(**result)


@app.post("/compliance-scan", response_model=ComplianceScanResponse)
async def compliance_scan_endpoint(req: ComplianceScanRequest) -> ComplianceScanResponse:
    assets = [a.model_dump() for a in req.assets]
    result = compliance_scan.scan(req.video_id, assets)
    logger.info("compliance-scan complete video_id=%s passed=%s", req.video_id, result["passed"])
    return ComplianceScanResponse(**result)
