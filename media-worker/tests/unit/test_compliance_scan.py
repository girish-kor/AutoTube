from app import compliance_scan


def test_passes_when_all_assets_from_allowed_tools():
    assets = [
        {"video_id": "v1", "type": "image", "scene_index": 0, "source_tool": "pollinations"},
        {"video_id": "v1", "type": "audio", "scene_index": None, "source_tool": "edge-tts"},
    ]
    passed, _details = compliance_scan.check_asset_provenance(assets)
    assert passed is True


def test_fails_when_disallowed_source_tool_present():
    assets = [
        {"video_id": "v1", "type": "image", "scene_index": 0, "source_tool": "pollinations"},
        {"video_id": "v1", "type": "image", "scene_index": 1, "source_tool": "stock-footage-api"},
    ]
    passed, details = compliance_scan.check_asset_provenance(assets)
    assert passed is False
    assert "stock-footage-api" in details


def test_fails_when_no_assets():
    passed, _details = compliance_scan.check_asset_provenance([])
    assert passed is False
