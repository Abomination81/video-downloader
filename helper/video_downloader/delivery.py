"""Private, expiring loopback transfer of one already-verified file to Chrome."""
import hashlib
import hmac
import http.server
import json
import os
import queue
import re
import secrets
import shutil
import subprocess
import sys
import threading
import time
from pathlib import Path
from urllib.parse import quote

from . import store
from .config import EXTENSION_ID, app_dir, private_dir
from .media import MediaError, clear_source_attributes


def directory(job_id):
    if not re.fullmatch(r"[0-9a-f]{32}", job_id):
        raise MediaError("job_missing", "This download is no longer available.")
    return app_dir() / "ready" / job_id


def digest(path):
    with path.open("rb") as file:
        return hashlib.file_digest(file, "sha256").hexdigest()


def receipt(job_id):
    try:
        return json.loads((directory(job_id) / "receipt.json").read_text())
    except (OSError, ValueError):
        raise MediaError("file_missing", "The prepared file is no longer available. Start the download again.") from None


def write_receipt(job_id, value):
    folder = private_dir(directory(job_id))
    temporary = folder / "receipt.new"
    temporary.write_text(json.dumps(value))
    temporary.replace(folder / "receipt.json")


def prepared_file(job_id):
    info = receipt(job_id)
    name = info.get("prepared_name", "clean.mp4")
    if not re.fullmatch(r"clean\.(?:mp4|jpg|png|webp|gif|tiff|avif|heic|heif|jxl|svg)", name):
        raise MediaError("file_missing", "The prepared file could not be found safely.")
    return directory(job_id) / name


def has_prepared(job_id):
    try: return prepared_file(job_id).is_file()
    except MediaError: return any(path.is_file() and not path.is_symlink() for path in directory(job_id).glob("clean.*"))


def stage(job_id, target, filename, detail=None, mime="video/mp4"):
    folder = private_dir(directory(job_id))
    checksum, size = digest(target), target.stat().st_size
    name = "clean" + Path(filename).suffix
    target.replace(folder / name)
    write_receipt(job_id, {"filename": filename, "sha256": checksum, "size": size, "created": time.time(), "detail": detail, "mime": mime, "prepared_name": name})


def final_file(job_id):
    try:
        path = Path(receipt(job_id)["final_path"])
        return path if path.is_file() and not path.is_symlink() else None
    except (MediaError, KeyError):
        return None


def discard(job_id):
    shutil.rmtree(directory(job_id), ignore_errors=True)


_last_prune = 0.0


def prune():
    global _last_prune
    now = time.time()
    if now - _last_prune < 3600: return
    _last_prune = now
    for folder in (app_dir() / "ready").glob("*"):
        if not folder.is_dir() or folder.is_symlink() or not re.fullmatch(r"[0-9a-f]{32}", folder.name): continue
        age = now - folder.stat().st_mtime
        if has_prepared(folder.name) and age > 7 * 86400:
            store.update(folder.name, state="error", error="The prepared file expired after seven days. Start the download again.", detail="save_expired")
            discard(folder.name)
        elif age > 30 * 86400:
            discard(folder.name)


class TransferServer(http.server.HTTPServer):
    allow_reuse_address = False

    def __init__(self, job_id, token, ttl=3600):
        self.job_id, self.token = job_id, token
        self.file = prepared_file(job_id)
        self.info = receipt(job_id)
        self.deadline = time.monotonic() + ttl
        self.requests = 0
        super().__init__(("127.0.0.1", 0), TransferHandler)
        self.timeout = 1
        self.route = f"/video/{token}/{quote(self.info['filename'])}"

    def get_request(self):
        connection, address = super().get_request()
        connection.settimeout(15)
        return connection, address


class TransferHandler(http.server.BaseHTTPRequestHandler):
    server_version = "LocalTransfer"
    sys_version = ""

    def log_message(self, *_):
        pass  # A capability URL and local file names must never enter logs.

    def error(self, status):
        self.send_response(status)
        self.send_header("Content-Length", "0")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Connection", "close")
        self.end_headers()

    def do_POST(self): self.error(405)
    def do_OPTIONS(self): self.error(405)
    def do_PUT(self): self.error(405)
    def do_DELETE(self): self.error(405)
    def do_HEAD(self): self.transfer(False)
    def do_GET(self): self.transfer(True)

    def transfer(self, body):
        server = self.server
        server.requests += 1
        if server.requests > 128:
            self.error(429)
            return
        if time.monotonic() >= server.deadline:
            self.error(410)
            return
        # Reject DNS rebinding and website-origin requests, even with a token.
        origin = self.headers.get("Origin")
        if self.headers.get("Host") != f"127.0.0.1:{server.server_port}" or (origin and origin != f"chrome-extension://{EXTENSION_ID}"):
            self.error(403)
            return
        if len(self.path) > 512 or not self.path.isascii() or not hmac.compare_digest(self.path, server.route) or self.headers.get("Transfer-Encoding") or self.headers.get("Content-Length", "0") != "0":
            self.error(404)
            return
        path = server.file
        if not path.is_file() or path.is_symlink():
            self.error(410)
            return
        size = server.info["size"]
        start, end, status = 0, size - 1, 200
        value = self.headers.get("Range")
        if value:
            match = re.fullmatch(r"bytes=(\d*)-(\d*)", value)
            if not match or not any(match.groups()):
                self.error(416)
                return
            left, right = match.groups()
            start = int(left) if left else max(0, size - int(right))
            end = min(size - 1, int(right)) if left and right else size - 1
            if start > end or start >= size:
                self.error(416)
                return
            status = 206
        try:
            with path.open("rb") as file:
                self.send_response(status)
                self.send_header("Content-Type", server.info.get("mime", "video/mp4"))
                self.send_header("Content-Length", str(end - start + 1))
                self.send_header("Content-Disposition", f'attachment; filename="{server.info["filename"]}"')
                self.send_header("Accept-Ranges", "bytes")
                self.send_header("Cache-Control", "no-store")
                self.send_header("Referrer-Policy", "no-referrer")
                self.send_header("X-Content-Type-Options", "nosniff")
                if status == 206:
                    self.send_header("Content-Range", f"bytes {start}-{end}/{size}")
                self.end_headers()
                if body:
                    file.seek(start)
                    remaining = end - start + 1
                    while remaining and time.monotonic() < server.deadline:
                        data = file.read(min(1024 * 1024, remaining))
                        if not data: break
                        self.wfile.write(data)
                        remaining -= len(data)
        except (OSError, TimeoutError):
            return  # Chrome can retry or resume; the prepared file is retained.


def spawn(mode, job_id, data=None, stdout=subprocess.DEVNULL):
    flags = subprocess.CREATE_NEW_PROCESS_GROUP | subprocess.DETACHED_PROCESS if os.name == "nt" else 0
    process = subprocess.Popen([sys.executable, "-m", "video_downloader.delivery", mode, job_id],
                               stdin=subprocess.PIPE if data is not None else subprocess.DEVNULL,
                               stdout=stdout, stderr=subprocess.DEVNULL,
                               start_new_session=os.name != "nt", creationflags=flags)
    if data is not None:
        process.stdin.write(json.dumps(data).encode())
        process.stdin.close()
    return process


def prepare(job_id):
    job = store.get(job_id)
    if not job or job["state"] not in ("ready", "error") or not has_prepared(job_id):
        raise MediaError("file_not_ready", "The file is not ready to save with Chrome.")
    process = spawn("serve", job_id, stdout=subprocess.PIPE)
    result = queue.Queue(maxsize=1)
    threading.Thread(target=lambda: result.put(process.stdout.readline(2048)), daemon=True).start()
    try:
        line = result.get(timeout=5)
        value = json.loads(line)
        if not isinstance(value.get("url"), str) or not value["url"].startswith("http://127.0.0.1:"):
            raise ValueError()
        store.update(job_id, state="ready", error=None, detail=receipt(job_id).get("detail"))
        return value
    except (queue.Empty, ValueError, KeyError):
        process.terminate()
        raise MediaError("transfer_failed", "Chrome's local transfer could not start. Try saving the file again.") from None
    finally:
        process.stdout.close()


def validate_destination(job_id, value):
    info = receipt(job_id)
    path = Path(value)
    # Chrome may add a collision suffix. Never overwrite or edit unrelated files.
    expected = re.escape(Path(info["filename"]).stem) + r"(?: \(\d+\))?" + re.escape(Path(info["filename"]).suffix)
    if not path.is_absolute() or not re.fullmatch(expected, path.name) or path.is_symlink() or not path.is_file() or path.stat().st_size != info["size"]:
        raise MediaError("unverified_transfer", "Chrome's saved file could not be verified. The prepared copy has been retained.")
    return path


def start_finish(job_id, value):
    job = store.get(job_id)
    if job and job["state"] == "done": return {}
    if job and job["state"] == "finalizing": return {}
    if not job or job["state"] != "ready":
        raise MediaError("file_not_ready", "This file is no longer waiting for Chrome.")
    path = validate_destination(job_id, value)
    store.update(job_id, state="finalizing")
    try:
        spawn("finish", job_id, {"path": str(path)})
    except OSError:
        store.update(job_id, state="ready")
        raise MediaError("transfer_failed", "The saved file could not be checked. Try saving it again.") from None
    return {}


def finish(job_id, value):
    stopped = threading.Event()
    def heartbeat():
        while not stopped.wait(1): store.update(job_id, pid=os.getpid())
    thread = threading.Thread(target=heartbeat, daemon=True)
    thread.start()
    try:
        info = receipt(job_id)
        path = validate_destination(job_id, value)
        if digest(path) != info["sha256"]:
            raise MediaError("unverified_transfer", "Chrome's saved file does not match the verified file. The prepared copy has been retained.")
        # Chrome can add a localhost source URL after saving. Remove it as well.
        clear_source_attributes(path)
        info["final_path"] = str(path)
        write_receipt(job_id, info)
        store.update(job_id, state="done", filename=path.name, progress=100, error=None, detail=info.get("detail"))
        prepared_file(job_id).unlink(missing_ok=True)
    except MediaError as error:
        store.update(job_id, state="error", error=error.message, detail="unverified_transfer")
    except Exception:
        store.update(job_id, state="error", error="Chrome's saved file could not be checked. The prepared file is retained.", detail="transfer_failed")
    finally:
        stopped.set()
        thread.join(timeout=2)


def main():
    os.umask(0o077)
    if len(sys.argv) != 3: raise SystemExit(1)
    mode, job_id = sys.argv[1:]
    directory(job_id)
    if mode == "serve":
        with TransferServer(job_id, secrets.token_urlsafe(32)) as server:
            print(json.dumps({"url": f"http://127.0.0.1:{server.server_port}{server.route}", "filename": server.info["filename"]}), flush=True)
            while time.monotonic() < server.deadline and server.file.exists(): server.handle_request()
    elif mode == "finish":
        data = sys.stdin.buffer.read(8193)
        if len(data) > 8192: raise SystemExit(1)
        finish(job_id, json.loads(data)["path"])


if __name__ == "__main__": main()
