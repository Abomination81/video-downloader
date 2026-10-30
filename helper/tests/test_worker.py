import json
import uuid
import pytest

from video_downloader import store
from video_downloader.media import probe
from video_downloader.models import Start
from video_downloader.worker import run_job


def request(url):
    return Start(id="test", type="start", requestId=str(uuid.uuid4()), title="Test video", sources=[{"url": url, "kind": "manifest", "headers": {}}])


@pytest.mark.parametrize("manifest", ["master.m3u8", "dash/manifest.mpd", "encrypted/index.m3u8"])
def test_stream_download_chooses_highest_rendition_and_publishes_clean_mp4(isolated_app, media_server, manifest):
    payload = request(media_server + "/" + manifest)
    job, _ = store.create(payload.requestId, payload.title)
    run_job(payload, job)
    result = store.get(job)
    assert result["state"] == "done", result
    download_dir = json.loads((isolated_app / "config.json").read_text())["download_dir"]
    from pathlib import Path
    target = Path(download_dir) / result["filename"]
    info = probe(target)
    assert info["streams"][0]["width"] == 320
    assert info["streams"][0]["height"] == 180
    assert info["streams"][0]["codec_name"] == "h264"
    assert len([s for s in info["streams"] if s["codec_type"] == "audio"]) == 1
    assert not info["chapters"]
    assert not list((isolated_app / "work").glob("*/*"))
    database = (isolated_app / "state/jobs.sqlite3").read_bytes()
    assert b"127.0.0.1" not in database


def test_selected_entry_on_multi_video_page(isolated_app, media_server):
    payload = request(media_server + "/multiple.html")
    payload.sources[0].kind = "page"
    payload.sources[0].entryIndex = 2
    job, _ = store.create(payload.requestId, payload.title)
    run_job(payload, job)
    result = store.get(job)
    assert result["state"] == "done", result
    from pathlib import Path
    output = Path(json.loads((isolated_app / "config.json").read_text())["download_dir"]) / result["filename"]
    assert probe(output)["streams"][0]["width"] == 320


def test_idempotency_and_cancellation_state(isolated_app):
    key = str(uuid.uuid4())
    first, created = store.create(key, "Video")
    second, duplicate = store.create(key, "Video")
    assert first == second and created and not duplicate
    store.update(first, state="cancelled")
    assert store.get(first)["state"] == "cancelled"


def test_browser_transport_retry_after_a_fingerprint_header_refusal(isolated_app, media_server):
    payload = request(media_server + "/fingerprinted.mp4")
    payload.sources[0].kind = "file"
    job, _ = store.create(payload.requestId, payload.title)
    run_job(payload, job)
    assert store.get(job)["state"] == "done", store.get(job)


def test_expired_media_link_falls_back_to_fresh_page_extraction(isolated_app, media_server):
    from video_downloader.models import Source
    payload = request(media_server + "/expired.mp4?signature=old")
    payload.sources[0].kind = "file"
    payload.sources.append(Source(url=media_server + "/single.html", kind="page"))
    job, _ = store.create(payload.requestId, payload.title)
    run_job(payload, job)
    assert store.get(job)["state"] == "done", store.get(job)
