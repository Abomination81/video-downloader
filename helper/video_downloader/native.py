"""Length-framed stdio broker. Downloads live in independent local workers."""
import json
import os
import struct
import subprocess
import sys
from pathlib import Path

from pydantic import ValidationError

from . import __version__, delivery, store
from .media import MediaError
from .config import EXTENSION_ID, app_dir, binary, downloaded_file, output_dir, private_dir
from .models import CleanImage, RequestAdapter, Start

MAX_MESSAGE = 1024 * 1024


class PublicError(Exception):
    def __init__(self, code, message):
        self.code, self.message = code, message


def read_exact(stream, size):
    parts = bytearray()
    while len(parts) < size:
        part = stream.read(size - len(parts))
        if not part:
            if parts:
                raise EOFError("Truncated native message")
            return None
        parts.extend(part)
    return bytes(parts)


def read_message(stream):
    header = read_exact(stream, 4)
    if header is None:
        return None
    size = struct.unpack("=I", header)[0]
    if not 0 < size <= MAX_MESSAGE:
        raise ValueError("Invalid native message length")
    payload = read_exact(stream, size)
    if payload is None:
        raise EOFError("Missing native payload")
    return json.loads(payload)


def write_message(stream, message):
    data = json.dumps(message, ensure_ascii=False, allow_nan=False).encode("utf-8")
    if len(data) > MAX_MESSAGE:
        raise ValueError("Native response too large")
    stream.write(struct.pack("=I", len(data)) + data)
    stream.flush()


def launch(request: Start | CleanImage):
    missing = []
    for name in ("ffmpeg", "ffprobe", "deno", "exiftool"):
        try:
            binary(name)
        except FileNotFoundError:
            missing.append(name)
    if missing:
        raise PublicError("dependencies_missing", "Run the installer again to finish setting up the helper.")
    try:
        title = ("Image: " + Path(request.path).name)[:300] if request.type == "clean-image" else request.title
        job_id, created = store.create(request.requestId, title, "cleanup" if request.type == "clean-image" else "download")
    except ValueError as error:
        raise PublicError("queue_full", "Three downloads are already running. Wait for one to finish.") from error
    if created:
        flags = subprocess.CREATE_NEW_PROCESS_GROUP | subprocess.DETACHED_PROCESS if os.name == "nt" else 0
        try:
            process = subprocess.Popen(
                [sys.executable, "-m", "video_downloader.worker", job_id],
                stdin=subprocess.PIPE, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                start_new_session=os.name != "nt", creationflags=flags,
            )
            # Credentials only cross this private anonymous pipe. They are never saved.
            process.stdin.write(request.model_dump_json().encode())
            process.stdin.close()
        except Exception as error:
            store.update(job_id, state="error", error="The download worker could not start.")
            raise PublicError("worker_failed", "The download worker could not start. Run the installer again.") from error
    return {"jobId": job_id}


def handle(raw):
    request = RequestAdapter.validate_python(raw)
    if request.type == "ping":
        deps = {}
        for name in ("ffmpeg", "ffprobe", "deno", "exiftool"):
            try:
                binary(name)
                deps[name] = True
            except FileNotFoundError:
                deps[name] = False
        import yt_dlp.version
        return {"version": __version__, "engine": yt_dlp.version.__version__, "dependencies": deps, "ready": all(deps.values()), "downloadDir": str(output_dir())}
    if request.type in ("start", "clean-image"):
        return launch(request)
    if request.type == "jobs":
        delivery.prune()
        jobs = store.list_jobs()
        for job in jobs:
            if job["state"] == "interrupted" and delivery.has_prepared(job["id"]):
                try:
                    info = delivery.receipt(job["id"])
                    store.update(job["id"], state="ready", error=None, filename=info["filename"])
                    job.update(state="ready", error=None, filename=info["filename"])
                except (MediaError, KeyError):
                    message = "The prepared file was interrupted before it could be verified. Start this download again."
                    store.update(job["id"], state="error", error=message, detail="save_incomplete")
                    job.update(state="error", error=message, detail="save_incomplete")
        return {"jobs": jobs}
    if request.type == "clear":
        for job in store.list_jobs():
            if job["state"] in store.TERMINAL: delivery.discard(job["id"])
        store.clear()
        return {}
    job = store.get(request.jobId)
    if not job:
        raise PublicError("job_missing", "This download is no longer in the history.")
    if request.type == "prepare": return delivery.prepare(request.jobId)
    if request.type == "finish": return delivery.start_finish(request.jobId, request.path)
    if request.type == "cancel":
        if job["state"] == "finalizing":
            raise PublicError("already_saved", "Chrome has saved this file. Its final metadata check is finishing.")
        if job["state"] == "ready" or (job["state"] == "error" and delivery.has_prepared(request.jobId)):
            delivery.discard(request.jobId)
            store.update(request.jobId, state="cancelled")
            return {}
        if job["state"] in store.ACTIVE:
            store.update(request.jobId, cancel_requested=1)
        return {}
    if request.type == "reveal":
        filename = job["filename"]
        if job["state"] != "done" or not filename or Path(filename).name != filename:
            raise PublicError("file_not_ready", "This file is not ready yet.")
        path = delivery.final_file(request.jobId) or downloaded_file(filename)
        if path is None:
            raise PublicError("file_missing", "The downloaded file has been moved or deleted.")
        if sys.platform == "darwin":
            subprocess.Popen(["open", "-R", str(path)], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        elif os.name == "nt":
            subprocess.Popen(["explorer.exe", "/select,", str(path)], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        else:
            subprocess.Popen(["xdg-open", str(path.parent)], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        return {}


def serve(input_stream, output_stream):
    while True:
        try:
            raw = read_message(input_stream)
        except (ValueError, EOFError, UnicodeError):
            return 1
        if raw is None:
            return 0
        request_id = raw.get("id", "invalid") if isinstance(raw, dict) else "invalid"
        if not isinstance(request_id, str) or len(request_id) > 80:
            request_id = "invalid"
        try:
            result = handle(raw)
            reply = {"id": request_id, "ok": True, "result": result}
        except ValidationError:
            reply = {"id": request_id, "ok": False, "error": {"code": "invalid_request", "message": "The download request was invalid. Reload the extension and try again."}}
        except (PublicError, MediaError) as error:
            reply = {"id": request_id, "ok": False, "error": {"code": error.code, "message": error.message}}
        except Exception:
            # No raw exception, request URL, token, or cookie is logged or returned.
            reply = {"id": request_id, "ok": False, "error": {"code": "internal_error", "message": "The helper encountered a problem. Run the installer again if it persists."}}
        write_message(output_stream, reply)


def main():
    if len(sys.argv) < 2 or sys.argv[1] != f"chrome-extension://{EXTENSION_ID}/":
        raise SystemExit("This helper is started by the Video Downloader extension.")
    os.umask(0o077)
    private_dir(app_dir())
    if os.name == "nt":
        import msvcrt
        msvcrt.setmode(sys.stdin.fileno(), os.O_BINARY)
        msvcrt.setmode(sys.stdout.fileno(), os.O_BINARY)
    raise SystemExit(serve(sys.stdin.buffer, sys.stdout.buffer))


if __name__ == "__main__":
    main()
