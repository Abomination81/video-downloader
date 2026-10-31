import http.cookiejar
import json
import os
import random
import shutil
import sys
import threading
import time
from datetime import datetime
from pathlib import Path

import yt_dlp

from . import delivery, store
from .config import app_dir, binary, output_dir, private_dir
from .media import Cancelled, MediaError, clear_source_attributes, sanitize
from .models import CleanImage, Start


def engine_options(source, directory: Path, progress_hook, impersonate=False, output_profile='original'):
    options = {
        "format": "bv*+ba/b",
        "format_sort": ["res", "fps", "hdr", "vcodec", "acodec", "br"],
        "format_sort_force": True,
        "outtmpl": str(directory / "source.%(ext)s"),
        "merge_output_format": "mkv",
        "noplaylist": True, "playlistend": None if source.entryIndex else 1,
        "playlist_items": str(source.entryIndex) if source.entryIndex else None,
        "socket_timeout": 20, "retries": 4, "fragment_retries": 4, "extractor_retries": 2,
        "retry_sleep_functions": {"http": lambda n: min(30, 2 ** n) * random.uniform(0.8, 1.2), "fragment": lambda n: min(20, 2 ** n) * random.uniform(0.8, 1.2)},
        "concurrent_fragment_downloads": 4,
        "continuedl": True, "skip_unavailable_fragments": False,
        "quiet": True, "no_warnings": True, "noprogress": True,
        "writeinfojson": False, "writethumbnail": False, "writesubtitles": False,
        "addmetadata": False, "embed_infojson": False,
        "cachedir": False, "overwrites": True,
        "ffmpeg_location": str(Path(binary("ffmpeg")).parent),
        "js_runtimes": {"deno": {"path": binary("deno")}},
        "http_headers": source.headers,
        "progress_hooks": [progress_hook],
        "logger": SilentLogger(),
    }
    if output_profile == 'compatible':
        # Keep the best resolution/fps. At equal resolution/fps prefer SDR and
        # original AVC/AAC tracks so a needless re-encode can be avoided.
        options['format_sort'] = ['res', 'fps', 'hdr:sdr', 'vcodec:h264', 'acodec:aac', 'br']
    if impersonate:
        from yt_dlp.networking.impersonate import ImpersonateTarget
        options["impersonate"] = ImpersonateTarget(client="chrome")
    return options


class SilentLogger:
    # yt-dlp logs may include signed URLs or headers. Only safe status is retained.
    def debug(self, *_): pass
    def warning(self, *_): pass
    def error(self, *_): pass


def cookie_jar(cookies):
    jar = http.cookiejar.CookieJar()
    for c in cookies:
        jar.set_cookie(http.cookiejar.Cookie(
            version=0, name=c.name, value=c.value, port=None, port_specified=False,
            domain=c.domain, domain_specified=not c.hostOnly, domain_initial_dot=c.domain.startswith('.'),
            path=c.path, path_specified=True, secure=c.secure,
            expires=int(c.expirationDate) if c.expirationDate else None, discard=not c.expirationDate,
            comment=None, comment_url=None, rest={"HttpOnly": c.httpOnly}, rfc2109=False,
        ))
    return jar


def classify_download_error(error) -> MediaError:
    # Only inspect internally; do not store or return raw messages containing URLs.
    text = str(error).lower()
    if any(word in text for word in ("drm", "protected content", "encrypted media")):
        return MediaError("drm", "This video is protected by DRM and cannot be downloaded by this extension.")
    if any(word in text for word in ("sign in", "login", "cookies", "403", "401", "authentication")):
        return MediaError("session_required", "The site refused the download. Keep the video playing, check that site sessions are enabled, and try again.")
    if "404" in text or "expired" in text:
        return MediaError("source_expired", "The video address has expired. Reload the page, play the video, and try again.")
    return MediaError("unsupported_source", "No downloadable video was found. Play the video first, then try the toolbar button or another source in the list.")


def download(request: Start, job_id: str, directory: Path, cancelled):
    from . import formats
    selection = formats.resolve(request)
    latest = 0.0
    def hook(data):
        nonlocal latest
        if cancelled():
            raise Cancelled()
        now = time.monotonic()
        if now - latest < 0.4:
            return
        latest = now
        total = data.get("total_bytes") or data.get("total_bytes_estimate") or 0
        progress = min(99.0, data.get("downloaded_bytes", 0) / total * 100) if total else 0
        store.update(job_id, state="downloading", progress=progress)
    last_error = MediaError("unsupported_source", "No downloadable video was found on this page.")
    for index, source in enumerate(request.sources):
        if selection and index != selection['sourceIndex']: continue
        for impersonate in (False, True):
            if cancelled():
                raise Cancelled()
            work = private_dir(directory / str(index))
            store.update(job_id, state="resolving", progress=0)
            try:
                options = engine_options(source, work, hook, impersonate, request.outputProfile)
                if request.assetType == 'audio':
                    options.update(format='ba/b', format_sort=['abr', 'asr', 'acodec', 'br'])
                if selection: options['format'] = '+'.join(selection['ids'])
                with yt_dlp.YoutubeDL(options) as ydl:
                    ydl.cookiejar.set_policy(http.cookiejar.DefaultCookiePolicy(strict_ns_domain=http.cookiejar.DefaultCookiePolicy.DomainStrictNonDomain))
                    for cookie in cookie_jar(request.cookies):
                        ydl.cookiejar.set_cookie(cookie)
                    info = ydl.extract_info(source.url, download=False)
                    info = formats.single(info, source)
                    if selection: formats.validate(selection, info)
                    title = str(info.get("title") or request.title).replace("\x00", "")[:300]
                    store.update(job_id, title=title, state="downloading")
                    ydl.process_info(info)
                    videos = [p for p in work.glob("source.*") if p.is_file() and len(p.name.split('.')) == 2 and p.suffix not in (".part", ".ytdl", ".json", ".temp")]
                    if not videos:
                        raise MediaError("download_incomplete", "The download did not finish. No incomplete file was saved.")
                    return max(videos, key=lambda p: p.stat().st_size)
            except Cancelled:
                raise
            except MediaError as error:
                if selection or error.code in ("live_stream", "drm", "ambiguous_video", "download_incomplete"):
                    raise
                last_error = error
            except yt_dlp.utils.DownloadError as error:
                if cancelled():
                    raise Cancelled() from error
                last_error = classify_download_error(error)
                if selection and 'requested format' in str(error).lower(): raise formats.expired() from None
                if last_error.code == "drm":
                    raise last_error from error
                # A maintained browser transport can recover fingerprint refusals.
                # This retains certificate verification and the same scoped session.
                if not impersonate and "403" in str(error):
                    continue
            finally:
                if cancelled():
                    raise Cancelled()
            break
        shutil.rmtree(directory / str(index), ignore_errors=True)
    raise last_error


def run_job(request: Start | CleanImage, job_id: str):
    os.umask(0o077)
    directory = private_dir(app_dir() / "work" / job_id)
    stopped = threading.Event()
    cancel = threading.Event()
    def heartbeat():
        while not stopped.wait(1):
            job = store.get(job_id)
            if not job or job["cancel_requested"]:
                cancel.set()
            store.update(job_id, pid=os.getpid())
    store.update(job_id, state="resolving", pid=os.getpid())
    thread = threading.Thread(target=heartbeat, daemon=True)
    thread.start()
    try:
        if request.type == "clean-image":
            from .image_worker import clean_saved_image
            clean_saved_image(request, job_id, directory, cancel.is_set)
            return
        if request.assetType == "image":
            from .image_worker import run_image
            run_image(request, job_id, directory, cancel.is_set)
            return
        source = download(request, job_id, directory, cancel.is_set)
        if request.assetType == 'audio':
            from .mp3 import clean
            target = directory / 'clean.mp3'
            result = clean(source, target, request.audioBitrate, cancel.is_set, lambda state: store.update(job_id, state=state, progress=0))
            filename = f"Audio {datetime.now().strftime('%Y-%m-%d %H-%M-%S')} {job_id[:6]}.mp3"
            detail = f"MP3 · {result['bitrate']} kbps · {result['sampleRate'] / 1000:g} kHz · " + ('original audio' if result['copied'] else 'converted from source audio')
            save(request, job_id, target, filename, detail, 'audio/mpeg', cancel.is_set)
            return
        converted = False
        if request.outputProfile == 'compatible':
            from .compatibility import prepare
            store.update(job_id, state='converting', progress=0)
            source, converted = prepare(source, directory / 'compatible.mp4', cancel.is_set)
        target = directory / "clean.mp4"
        result = sanitize(source, target, cancel.is_set, lambda state: store.update(job_id, state=state, progress=100))
        if cancel.is_set() or store.get(job_id)["cancel_requested"]:
            raise Cancelled()
        filename = f"Video {datetime.now().strftime('%Y-%m-%d %H-%M-%S')} {job_id[:6]}.mp4"
        fps = result["fps"]
        try:
            numerator, denominator = fps.split('/')
            fps_label = f"{float(numerator) / float(denominator):g} fps" if float(denominator) else ""
        except (ValueError, ZeroDivisionError):
            fps_label = ""
        detail = f"{result['width']} × {result['height']} {fps_label} {result['codec'].upper()}".strip()
        detail += (' + ' + ', '.join(dict.fromkeys(result['audioCodecs'])).upper()) if result['audioCodecs'] else ' · no audio'
        if request.outputProfile == 'compatible': detail += ' · converted for compatibility' if converted else ' · original tracks'
        save(request, job_id, target, filename, detail, 'video/mp4', cancel.is_set)
    except Cancelled:
        delivery.discard(job_id)
        store.update(job_id, state="cancelled", error=None)
    except MediaError as error:
        store.update(job_id, state="error", error=error.message, detail=error.code)
    except Exception:
        store.update(job_id, state="error", error="The download could not finish. Update the helper and try again.", detail="unexpected_error")
    finally:
        stopped.set()
        thread.join(timeout=3)
        shutil.rmtree(directory, ignore_errors=True)


def save(request, job_id, target, filename, detail, mime, cancelled):
    if cancelled() or store.get(job_id)['cancel_requested']: raise Cancelled()
    if request.browserDownload:
        delivery.stage(job_id, target, filename, detail, mime)
    else:
        final = output_dir() / filename
        staging = final.with_suffix(final.suffix + '.partial')
        try: publish(target, staging, final, cancelled)
        finally: staging.unlink(missing_ok=True)
    store.update(job_id, state='ready' if request.browserDownload else 'done', filename=filename, progress=100, detail=detail)


def publish(target, staging, final, cancelled):
    with target.open("rb") as input_file, staging.open("xb") as output_file:
        while chunk := input_file.read(1024 * 1024):
            if cancelled(): raise Cancelled()
            output_file.write(chunk)
        output_file.flush()
        os.fsync(output_file.fileno())
    clear_source_attributes(staging)
    os.replace(staging, final)


def main():
    if len(sys.argv) != 2 or not re_job_id(sys.argv[1]):
        raise SystemExit(1)
    raw = sys.stdin.buffer.read(1024 * 1024 + 1)
    if len(raw) > 1024 * 1024:
        raise SystemExit(1)
    import json
    payload = json.loads(raw)
    request = CleanImage.model_validate(payload) if payload.get("type") == "clean-image" else Start.model_validate(payload)
    run_job(request, sys.argv[1])


def re_job_id(value):
    import re
    return re.fullmatch(r"[0-9a-f]{32}", value)


if __name__ == "__main__":
    main()
