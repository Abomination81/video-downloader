import io
import json
import struct

import pytest
from pydantic import ValidationError

from video_downloader.models import RequestAdapter, Source
from video_downloader.native import MAX_MESSAGE, read_message, serve, write_message


def test_native_protocol_handles_multiple_requests_and_eof(isolated_app):
    incoming, outgoing = io.BytesIO(), io.BytesIO()
    write_message(incoming, {"id": "first", "type": "jobs"})
    write_message(incoming, {"id": "second", "type": "clear"})
    incoming.seek(0)
    assert serve(incoming, outgoing) == 0
    outgoing.seek(0)
    assert read_message(outgoing) == {"id": "first", "ok": True, "result": {"jobs": []}}
    assert read_message(outgoing)["id"] == "second"
    assert read_message(outgoing) is None


def test_native_protocol_rejects_oversized_and_partial_messages():
    with pytest.raises(ValueError):
        read_message(io.BytesIO(struct.pack("=I", MAX_MESSAGE + 1)))
    with pytest.raises(EOFError):
        read_message(io.BytesIO(struct.pack("=I", 10) + b"{}"))


@pytest.mark.parametrize("url", ["file:///etc/passwd", "javascript:alert(1)", "https://user:password@example.com/video", "https://example.com/\r\nX-Test:1"])
def test_rejects_non_http_and_credential_urls(url):
    with pytest.raises(ValidationError):
        Source(url=url, kind="file")


def test_rejects_arbitrary_commands_and_unscoped_secret_headers():
    with pytest.raises(ValidationError):
        RequestAdapter.validate_python({"id": "a", "type": "start", "command": "anything"})
    with pytest.raises(ValidationError):
        Source(url="https://example.com/video.mp4", kind="file", headers={"Cookie": "private=value"})
    with pytest.raises(ValidationError):
        Source(url="https://example.com/video.mp4", kind="file", headers={"Authorization": "Bearer private"})
