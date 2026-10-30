"""Image retrieval and atomic cleanup of newly saved Chrome images."""
import base64
import http.cookiejar
import os
import shutil
import stat
import sys
import time
from datetime import datetime
from pathlib import Path

import yt_dlp
from yt_dlp.networking import Request

from . import delivery, store
from .config import output_dir
from .images import MAX_BYTES, sanitize_image
from .media import Cancelled, MediaError, clear_source_attributes, run


def download_image(request, job_id, folder, cancelled):
    from .worker import cookie_jar, engine_options
    target = folder / "source.image"
    if request.imageData:
        try: data = base64.b64decode(request.imageData, validate=True)
        except ValueError: raise MediaError("invalid_image", "The inline image could not be read safely.") from None
        if len(data) > 512 * 1024: raise MediaError("image_too_large", "This inline image is too large. Save it with Chrome's normal Save image as command instead.")
        target.write_bytes(data)
        return target
    last = MediaError("image_download_failed", "The original image could not be downloaded. Try Chrome's Save image as command.")
    for source in request.sources:
        for impersonate in (False, True):
            try:
                options = engine_options(source, folder, lambda _: None, impersonate)
                with yt_dlp.YoutubeDL(options) as client:
                    client.cookiejar.set_policy(http.cookiejar.DefaultCookiePolicy(strict_ns_domain=http.cookiejar.DefaultCookiePolicy.DomainStrictNonDomain))
                    for cookie in cookie_jar(request.cookies): client.cookiejar.set_cookie(cookie)
                    with client.urlopen(Request(source.url)) as response, target.open("wb") as output:
                        length = int(response.headers.get("Content-Length", "0") or 0)
                        if length > MAX_BYTES: raise MediaError("image_too_large", "This image exceeds the safe processing limit.")
                        count, latest = 0, 0
                        while True:
                            if cancelled(): raise Cancelled()
                            chunk = response.read(128 * 1024)
                            if not chunk: break
                            count += len(chunk)
                            if count > MAX_BYTES: raise MediaError("image_too_large", "This image exceeds the safe processing limit.")
                            output.write(chunk)
                            if time.monotonic() - latest > 0.4:
                                latest = time.monotonic()
                                store.update(job_id, state="downloading", progress=min(99, count * 100 / length) if length else 0)
                if not count: raise MediaError("invalid_image", "The site returned an empty image.")
                return target
            except (Cancelled, MediaError): raise
            except Exception as error:
                if not impersonate and "403" in str(error): continue
                break
    raise last


def copy_security(source, target):
    shutil.copystat(source, target)
    if sys.platform == "darwin":
        names = run(["/usr/bin/xattr", str(source)], timeout=10).decode().splitlines()
        for name in ("com.apple.quarantine", "com.apple.provenance", "com.apple.macl"):
            if name in names:
                data = run(["/usr/bin/xattr", "-px", name, str(source)], timeout=10)
                run(["/usr/bin/xattr", "-wx", name, data.decode().replace("\n", "").replace(" ", ""), str(target)], timeout=10)
    elif os.name == "nt":
        zone = Path(str(source) + ":Zone.Identifier")
        if zone.exists(): Path(str(target) + ":Zone.Identifier").write_bytes(zone.read_bytes())
    clear_source_attributes(target)


def clean_saved_image(request, job_id, folder, cancelled):
    path = Path(request.path)
    if not path.is_absolute() or path.is_symlink() or not path.is_file():
        raise MediaError("image_missing", "The saved image could not be found safely.")
    before = path.stat()
    if before.st_size > MAX_BYTES: raise MediaError("image_too_large", "This image exceeds the safe processing limit.")
    source = folder / "source.image"
    shutil.copyfile(path, source)
    original_hash = delivery.digest(source)
    store.update(job_id, state="cleaning", filename=path.name)
    target, info = sanitize_image(source, folder, cancelled)
    if cancelled(): raise Cancelled()
    # The user may edit, replace or move the file while cleanup is running.
    current = path.stat()
    if path.is_symlink() or (before.st_dev, before.st_ino, before.st_size, before.st_mtime_ns) != (current.st_dev, current.st_ino, current.st_size, current.st_mtime_ns) or delivery.digest(path) != original_hash:
        raise MediaError("image_changed_by_user", "The image changed while metadata was being checked. It was left untouched.")
    staging = path.parent / (".vd-image-" + job_id + ".partial")
    try:
        with target.open("rb") as source_file, staging.open("xb") as destination:
            shutil.copyfileobj(source_file, destination, 1024 * 1024)
            destination.flush()
            os.fsync(destination.fileno())
        copy_security(path, staging)
        if cancelled(): raise Cancelled()
        if path.is_symlink() or delivery.digest(path) != original_hash:
            raise MediaError("image_changed_by_user", "The image changed during cleanup. It was left untouched.")
        os.replace(staging, path)
    finally: staging.unlink(missing_ok=True)
    detail = f"{info['width']} × {info['height']} {info['format']}".strip()
    delivery.write_receipt(job_id, {"final_path": str(path), "filename": path.name, "created": time.time(), "detail": detail})
    store.update(job_id, state="done", filename=path.name, detail=detail, progress=100)


def run_image(request, job_id, folder, cancelled):
    source = download_image(request, job_id, folder, cancelled)
    store.update(job_id, state="cleaning")
    target, info = sanitize_image(source, folder, cancelled)
    store.update(job_id, state="verifying")
    if cancelled(): raise Cancelled()
    filename = f"Image {datetime.now().strftime('%Y-%m-%d %H-%M-%S')} {job_id[:6]}.{info['ext']}"
    detail = f"{info['width']} × {info['height']} {info['format']}".strip()
    if request.browserDownload:
        delivery.stage(job_id, target, filename, detail, info["mime"])
    else:
        from .worker import publish
        final = output_dir() / filename
        staging = final.with_suffix(final.suffix + ".partial")
        try: publish(target, staging, final, cancelled)
        finally: staging.unlink(missing_ok=True)
    store.update(job_id, state="ready" if request.browserDownload else "done", filename=filename, detail=detail, progress=100)
