from app import thumbnail


def test_needs_contrast_box_light_background():
    assert thumbnail.needs_contrast_box((240, 240, 240)) is True


def test_needs_contrast_box_dark_background():
    assert thumbnail.needs_contrast_box((10, 10, 10)) is False


def test_compute_text_layout_stays_within_safe_margins_short_text():
    font = thumbnail.fit_font("Wow", thumbnail.CANVAS_SIZE)
    layout = thumbnail.compute_text_layout(thumbnail.CANVAS_SIZE, "Wow", font)
    assert thumbnail.is_within_safe_margins(layout)


def test_compute_text_layout_stays_within_safe_margins_long_text():
    text = "This Is A Fairly Long Overlay Text Example"
    font = thumbnail.fit_font(text, thumbnail.CANVAS_SIZE)
    layout = thumbnail.compute_text_layout(thumbnail.CANVAS_SIZE, text, font)
    assert thumbnail.is_within_safe_margins(layout)


def test_fit_font_shrinks_for_long_text():
    short_font = thumbnail.fit_font("Hi", thumbnail.CANVAS_SIZE)
    long_font = thumbnail.fit_font("A Very Long Five Word Overlay", thumbnail.CANVAS_SIZE)
    assert long_font.size <= short_font.size
