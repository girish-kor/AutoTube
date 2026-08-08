"""`/thumbnail` endpoint logic (docs/N8N_NODES.md workflow 10) — Pollinations
art + Pillow text compositing. Safe-margin and contrast-box rules are
enforced here structurally, not left to the LLM (docs/SEO.md §7)."""

from io import BytesIO

from PIL import Image, ImageDraw, ImageFont, ImageStat

from .clients.pollinations import fetch_image
from .storage import atomic_write_bytes, thumbnail_img_path

CANVAS_SIZE = (1280, 720)
SAFE_MARGIN_RATIO = 0.08
MAX_FONT_SIZE = 96
MIN_FONT_SIZE = 32
CONTRAST_LUMINANCE_THRESHOLD = 140.0  # 0-255; above this the background reads as "light"


def relative_luminance(rgb: tuple[int, int, int]) -> float:
    r, g, b = rgb
    return 0.2126 * r + 0.7152 * g + 0.0722 * b


def needs_contrast_box(background_rgb: tuple[int, int, int]) -> bool:
    return relative_luminance(background_rgb) > CONTRAST_LUMINANCE_THRESHOLD


def fit_font(overlay_text: str, canvas_size: tuple[int, int], max_size: int = MAX_FONT_SIZE,
             min_size: int = MIN_FONT_SIZE) -> ImageFont.FreeTypeFont:
    """Shrinks font size until overlay_text fits the safe-margin width,
    however long overlay_text is."""
    width, _ = canvas_size
    safe_width = width * (1 - 2 * SAFE_MARGIN_RATIO)
    size = max_size
    while size > min_size:
        font = ImageFont.load_default(size=size)
        bbox = font.getbbox(overlay_text)
        if (bbox[2] - bbox[0]) <= safe_width:
            return font
        size -= 4
    return ImageFont.load_default(size=min_size)


def compute_text_layout(canvas_size: tuple[int, int], overlay_text: str,
                         font: ImageFont.FreeTypeFont) -> dict:
    """Bbox for the overlay text, guaranteed to stay within the safe-margin
    box regardless of overlay_text length (fit_font already bounded width;
    this clamps position)."""
    width, height = canvas_size
    margin_x = int(width * SAFE_MARGIN_RATIO)
    margin_y = int(height * SAFE_MARGIN_RATIO)
    safe_left, safe_right = margin_x, width - margin_x
    safe_top, safe_bottom = margin_y, height - margin_y

    bbox = font.getbbox(overlay_text)
    text_width = bbox[2] - bbox[0]
    text_height = bbox[3] - bbox[1]

    x = safe_left + max(0, (safe_right - safe_left - text_width) // 2)
    y = safe_bottom - text_height
    y = max(safe_top, min(y, safe_bottom - text_height))

    return {
        "x": x, "y": y, "text_width": text_width, "text_height": text_height,
        "safe_left": safe_left, "safe_right": safe_right,
        "safe_top": safe_top, "safe_bottom": safe_bottom,
    }


def is_within_safe_margins(layout: dict) -> bool:
    return (
        layout["x"] >= layout["safe_left"]
        and layout["x"] + layout["text_width"] <= layout["safe_right"]
        and layout["y"] >= layout["safe_top"]
        and layout["y"] + layout["text_height"] <= layout["safe_bottom"]
    )


def composite(art_bytes: bytes, overlay_text: str) -> bytes:
    image = Image.open(BytesIO(art_bytes)).convert("RGB").resize(CANVAS_SIZE)
    font = fit_font(overlay_text, CANVAS_SIZE)
    layout = compute_text_layout(CANVAS_SIZE, overlay_text, font)

    region = image.crop((
        layout["x"], layout["y"],
        max(layout["x"] + 1, layout["x"] + layout["text_width"]),
        max(layout["y"] + 1, layout["y"] + layout["text_height"]),
    ))
    avg_rgb = tuple(int(v) for v in ImageStat.Stat(region).mean[:3])

    draw = ImageDraw.Draw(image, "RGBA")
    if needs_contrast_box(avg_rgb):
        pad = 24
        box = (
            layout["x"] - pad, layout["y"] - pad,
            layout["x"] + layout["text_width"] + pad, layout["y"] + layout["text_height"] + pad,
        )
        draw.rectangle(box, fill=(0, 0, 0, 160))

    draw.text((layout["x"], layout["y"]), overlay_text, font=font, fill=(255, 255, 255, 255))

    buf = BytesIO()
    image.convert("RGB").save(buf, format="JPEG", quality=90)
    return buf.getvalue()


async def generate(channel_id: str, video_id: str, art_prompt: str, overlay_text: str) -> dict:
    art_bytes = await fetch_image(art_prompt, CANVAS_SIZE[0], CANVAS_SIZE[1], None)
    thumbnail_bytes = composite(art_bytes, overlay_text)
    final_path = thumbnail_img_path(channel_id, video_id)
    atomic_write_bytes(final_path, thumbnail_bytes)
    return {"file_path": str(final_path)}
