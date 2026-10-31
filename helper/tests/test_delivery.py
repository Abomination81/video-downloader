import http.client
import shutil
import threading
import time
import uuid
from pathlib import Path

import pytest

from video_downloader import delivery, store
from video_downloader.media import MediaError, clear_windows_origin, probe
from video_downloader.models import Start
from video_downloader.native import handle
from video_downloader.worker import run_job


def ready_file(app, data=b"verified test payload"):
    job, _ = store.create(str(uuid.uuid4()), "Video")
    source = app / "input.mp4"
    source.write_bytes(data)
    name = f"Video 2026-10-30 12-00-00 {job[:6]}.mp4"
    delivery.stage(job, source, name)
    store.update(job, state="ready", filename=name)
    return job, name


def test_transfer_is_private_range_capable_and_rejects_untrusted_requests(isolated_app):
    job, _ = ready_file(isolated_app)
    with delivery.TransferServer(job, "test-token") as server:
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        def request(path=None, method="GET", headers=None):
            conn = http.client.HTTPConnection("127.0.0.1", server.server_port, timeout=2)
            conn.request(method, path or server.route, headers=headers or {})
            response = conn.getresponse()
            status, data, headers = response.status, response.read(), dict(response.getheaders())
            conn.close()
            return status, data, headers
        try:
            assert request("/video/wrong/anything.mp4")[0] == 404
            assert request(headers={"Host": "evil.example"})[0] == 403
            assert request(headers={"Origin": "https://evil.example"})[0] == 403
            assert request(method="POST")[0] == 405
            assert request(headers={"Range": "bytes=0-2,8-9"})[0] == 416
            assert request(headers={"Range": "bytes=99999-"})[0] == 416
            status, data, headers = request(headers={"Range": "bytes=0-7"})
            assert status == 206 and data == b"verified"
            assert headers["Content-Range"] == "bytes 0-7/21"
            assert headers["Cache-Control"] == "no-store"
            assert "Access-Control-Allow-Origin" not in headers
            assert request(headers={"Range": "bytes=-7"})[1] == b"payload"
            assert request()[1] == b"verified test payload"
            server.deadline = 0
            assert request()[0] == 410
        finally:
            server.shutdown()
            thread.join()


def test_finish_verifies_exact_bytes_and_accepts_chromes_collision_suffix(isolated_app, tmp_path):
    job, name = ready_file(isolated_app)
    destination = tmp_path / "Chrome Downloads" / (Path(name).stem + " (1).mp4")
    destination.parent.mkdir()
    shutil.copyfile(delivery.directory(job) / "clean.mp4", destination)
    delivery.finish(job, str(destination))
    assert store.get(job)["state"] == "done"
    assert delivery.final_file(job) == destination
    assert not (delivery.directory(job) / "clean.mp4").exists()
    assert handle({"id": "retry", "type": "finish", "jobId": job, "path": str(destination)}) == {}


@pytest.mark.parametrize("change", ["bytes", "name", "symlink"])
def test_unrelated_or_modified_files_are_never_marked_verified(isolated_app, tmp_path, change):
    job, name = ready_file(isolated_app)
    destination = tmp_path / name
    shutil.copyfile(delivery.directory(job) / "clean.mp4", destination)
    if change == "bytes": destination.write_bytes(b"x" * destination.stat().st_size)
    if change == "name": destination = destination.rename(tmp_path / "unrelated.mp4")
    if change == "symlink":
        backing = destination.rename(tmp_path / "backing.mp4")
        destination.symlink_to(backing)
    original = destination.read_bytes()
    delivery.finish(job, str(destination))
    assert store.get(job)["state"] == "error"
    assert (delivery.directory(job) / "clean.mp4").exists()
    assert destination.read_bytes() == original


def test_cancel_waiting_for_chrome_removes_only_the_private_copy(isolated_app):
    job, _ = ready_file(isolated_app)
    handle({"id": "cancel", "type": "cancel", "jobId": job})
    assert store.get(job)["state"] == "cancelled"
    assert not delivery.directory(job).exists()


def test_real_stream_is_private_until_chrome_finishes_and_keeps_highest_quality(isolated_app, media_server, tmp_path):
    payload = Start(id="test", type="start", requestId=str(uuid.uuid4()), title="Video", browserDownload=True,
                    sources=[{"url": media_server + "/master.m3u8", "kind": "manifest"}])
    job, _ = store.create(payload.requestId, payload.title)
    run_job(payload, job)
    row = store.get(job)
    assert row["state"] == "ready"
    assert not list((tmp_path / "downloads").glob("*.mp4"))
    staged = delivery.directory(job) / "clean.mp4"
    assert probe(staged)["streams"][0]["width"] == 320
    destination = tmp_path / row["filename"]
    shutil.copyfile(staged, destination)
    delivery.finish(job, str(destination))
    assert store.get(job)["state"] == "done"
    assert not probe(destination)["chapters"]


def test_windows_zone_urls_are_removed_without_removing_security_marking(tmp_path):
    path = tmp_path / "video.mp4"
    zone = Path(str(path) + ":Zone.Identifier")
    zone.write_bytes(b"[ZoneTransfer]\r\nZoneId=3\r\nHostUrl=http://private-source/\r\nReferrerUrl=https://private-page/\r\n")
    clear_windows_origin(path)
    assert zone.read_bytes() == b"[ZoneTransfer]\r\nZoneId=3\r\n"


@pytest.mark.parametrize("receipt_present", [True, False])
def test_interrupted_final_check_can_resume_from_the_verified_private_copy(isolated_app, receipt_present):
    job, _ = ready_file(isolated_app)
    store.update(job, state="finalizing")
    with store.connection() as connection:
        connection.execute("UPDATE jobs SET updated=? WHERE id=?", (time.time() - 100, job))
    if not receipt_present: (delivery.directory(job) / "receipt.json").unlink()
    jobs = handle({"id": "recover", "type": "jobs"})["jobs"]
    assert jobs[0]["state"] == ("ready" if receipt_present else "error")
    assert (store.get(job)["error"] is None) == receipt_present
    assert (delivery.directory(job) / "clean.mp4").exists()


@pytest.mark.parametrize('audio', [False, True])
def test_real_transfer_subprocess_starts_and_serves_verified_bytes(isolated_app, monkeypatch, audio):
    import urllib.request
    job, name = ready_file(isolated_app)
    if audio:
        old = delivery.prepared_file(job)
        old.rename(old.with_suffix('.mp3'))
        info = delivery.receipt(job)
        info.update(filename=name.replace('Video ', 'Audio ').replace('.mp4', '.mp3'), prepared_name='clean.mp3', mime='audio/mpeg')
        delivery.write_receipt(job, info)
    processes = []
    original = delivery.spawn
    def tracked(*args, **kwargs):
        process = original(*args, **kwargs)
        processes.append(process)
        return process
    monkeypatch.setattr(delivery, 'spawn', tracked)
    try:
        value = delivery.prepare(job)
        with urllib.request.urlopen(value['url'], timeout=5) as response:
            assert response.read() == b'verified test payload'
            assert response.headers['Content-Type'] == ('audio/mpeg' if audio else 'video/mp4')
        assert store.get(job)['state'] == 'ready'
    finally:
        for process in processes:
            process.terminate()
            process.wait(timeout=5)
