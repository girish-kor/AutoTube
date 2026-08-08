"""Pydantic request/response models — the contract n8n's HTTP Request nodes
rely on (docs/CODING_RULES.md §4). Field sets match docs/N8N_NODES.md call
bodies, plus `channel_id`/`captions_path` where the on-disk layout in
docs/STORAGE.md §2 requires information the node tables summarize away."""


from pydantic import BaseModel


class SceneTimestamp(BaseModel):
    scene_index: int
    start_ts: float
    end_ts: float


class TTSRequest(BaseModel):
    video_id: str
    channel_id: str
    ssml: str
    voice: str = "en-US-AndrewNeural"


class TTSResponse(BaseModel):
    audio_path: str
    duration_sec: float
    scene_timestamps: list[SceneTimestamp]


class ImageRequest(BaseModel):
    channel_id: str
    video_id: str
    scene_index: int
    prompt: str
    width: int = 1920
    height: int = 1080
    seed: int | None = None


class ImageResponse(BaseModel):
    file_path: str


class RenderImage(BaseModel):
    path: str
    start_ts: float
    end_ts: float


class RenderRequest(BaseModel):
    channel_id: str
    video_id: str
    # Long-form Ken-Burns assembly mode (workflow 08-Render)
    audio_path: str | None = None
    images: list[RenderImage] | None = None
    resolution: str = "1920x1080"
    # Shorts clip mode (workflow 14-Shorts-Extraction)
    source: str | None = None
    start_ts: float | None = None
    end_ts: float | None = None
    aspect: str | None = None
    burn_captions: bool = False
    captions_path: str | None = None
    clip_index: int | None = None


class RenderResponse(BaseModel):
    render_path: str
    checksum: str
    duration_sec: float


class CaptionRequest(BaseModel):
    channel_id: str
    video_id: str
    render_path: str
    model_size: str = "small"


class CaptionResponse(BaseModel):
    srt_path: str
    captioned_render_path: str


class ThumbnailRequest(BaseModel):
    channel_id: str
    video_id: str
    art_prompt: str
    overlay_text: str


class ThumbnailResponse(BaseModel):
    file_path: str


class ClipCandidate(BaseModel):
    start_ts: float
    end_ts: float
    score: float


class ScriptScene(BaseModel):
    narration: str
    visual_prompt: str
    duration_estimate_sec: float
    start_ts: float | None = None


class ClipRequest(BaseModel):
    video_id: str
    captions_path: str
    script_json: dict
    top_n: int = 3


class ClipResponse(BaseModel):
    candidates: list[ClipCandidate]


class AssetProvenanceItem(BaseModel):
    video_id: str
    type: str
    scene_index: int | None = None
    source_tool: str


class ComplianceScanRequest(BaseModel):
    video_id: str
    assets: list[AssetProvenanceItem]


class ComplianceScanResponse(BaseModel):
    passed: bool
    details: str
