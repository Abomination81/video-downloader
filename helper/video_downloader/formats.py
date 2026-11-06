"""Short-lived format choices. Source addresses and cookies stay off disk."""
import hashlib
import json
import math
import os
import re
import shutil
import sys
import threading
import time
import uuid

import yt_dlp

from . import store
from .config import app_dir, private_dir
from .media import Cancelled, MediaError
from .models import Inspect
from .worker import classify_download_error, engine_options, extracted_source

TTL = 15 * 60
SAFE_ID = re.compile(r"^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$")


def expired():
    return MediaError("formats_expired", "These formats have expired or changed. Choose format again to refresh the list.")


def fingerprint(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(",", ":")).encode()).hexdigest()


def binding(request):
    return fingerprint([s.model_dump() for s in request.sources])


def identity(info):
    return fingerprint([str(info.get("extractor_key", "")), str(info.get("id", ""))])


def single(info, source):
    if not info: raise MediaError("unsupported_source", "No downloadable media was found.")
    if info.get("_type") in ("playlist", "multi_video"):
        entries = list(info.get("entries") or [])
        if len(entries) > 1 and source.entryIndex and source.entryIndex <= len(entries): entries = [entries[source.entryIndex - 1]]
        if len(entries) != 1: raise MediaError("ambiguous_video", "This page contains several videos. Choose the video first.")
        info = entries[0]
    if not info: raise MediaError("unsupported_source", "No downloadable media was found.")
    if info.get("is_live"): raise MediaError("live_stream", "Download this stream after the broadcast finishes.")
    if info.get("has_drm"): raise MediaError("drm", "This video is protected by DRM and cannot be downloaded by this extension.")
    return info


def number(value, limit):
    return value if isinstance(value, (int, float)) and math.isfinite(value) and 0 < value <= limit else None


def label(value):
    return re.sub(r"[^a-zA-Z0-9_.:+/-]", "", str(value or ""))[:40]


def catalogue(info, source_index):
    tracks = [f for f in (info.get("formats") or [info]) if not f.get("has_drm") and SAFE_ID.fullmatch(str(f.get("format_id", ""))) and f.get("url")]
    audios = [f for f in tracks if f.get("acodec") != "none"]
    audio_only = [f for f in audios if f.get("vcodec") == "none"]
    best_audio = (audio_only or audios)[-1] if audios else None
    options, selections = [], {}
    for kind, choices in (("video", [f for f in tracks if f.get("vcodec") != "none"][-80:]), ("audio", (audio_only or audios)[-30:])):
        for track in reversed(choices):
            pair = best_audio if kind == "video" and track.get("acodec") == "none" else None
            ids = [track["format_id"]] + ([pair["format_id"]] if pair else [])
            option = {"id": uuid.uuid4().hex, "kind": kind, "codec": label(track.get("vcodec") if kind == "video" else track.get("acodec")), "audioCodec": label((pair or track).get("acodec")), "hdr": label(track.get("dynamic_range")), "language": label((pair or track).get("language"))}
            for key, field, maximum in (("width", "width", 65536), ("height", "height", 65536), ("fps", "fps", 1000), ("bitrate", "abr", 100000), ("sampleRate", "asr", 1000000)):
                value = number(track.get(field), maximum)
                if value: option[key] = value
            sizes = [number(f.get("filesize") or f.get("filesize_approx"), 10**15) for f in [track] + ([pair] if pair else [])]
            if all(sizes):
                option["size"] = sum(sizes)
                option["approximate"] = any(not f.get("filesize") for f in [track] + ([pair] if pair else []))
            options.append(option)
            selections[option["id"]] = {"kind": kind, "sourceIndex": source_index, "ids": ids, "identity": identity(info), "tracks": [{key: f.get(key) for key in ("format_id", "width", "height", "fps", "vcodec", "acodec")} for f in [track] + ([pair] if pair else [])]}
    return options, selections


def cache_path(probe_id):
    if not re.fullmatch(r"[0-9a-f]{32}", probe_id): raise expired()
    return private_dir(app_dir() / "formats") / (probe_id + ".json")


def prune():
    for path in private_dir(app_dir() / "formats").glob("*"):
        try:
            if path.suffix in ('.json', '.new') and path.stat().st_mtime < time.time() - TTL: path.unlink(missing_ok=True)
        except OSError: pass
    store.prune_probes(time.time() - TTL)


def read(probe_id):
    path = cache_path(probe_id)
    try:
        if path.stat().st_size > 256 * 1024: raise expired()
        value = json.loads(path.read_text())
        if not 0 <= time.time() - value["created"] < TTL: raise expired()
        return value
    except (OSError, ValueError, KeyError): raise expired() from None


def status(probe_id):
    job = store.get(probe_id)
    if not job: raise expired()
    if job["state"] == "done": return {"state": "done", "options": read(probe_id)["options"]}
    if job["state"] in store.TERMINAL: raise MediaError("format_check_failed", job["error"] or "The format check was cancelled. Choose format to try again.")
    return {"state": "resolving", "options": []}


def resolve(request):
    if not request.formatSelection: return None
    cache = read(request.formatSelection.probeId)
    choice = cache["selections"].get(request.formatSelection.optionId)
    kind = "audio" if request.assetType == "audio" else "video"
    if cache["binding"] != binding(request) or not choice or choice["kind"] != kind: raise expired()
    return choice


def validate(choice, info):
    if identity(info) != choice["identity"]: raise expired()
    tracks = {str(f.get("format_id")): f for f in (info.get("formats") or [info])}
    for previous in choice["tracks"]:
        current = tracks.get(str(previous["format_id"]))
        if not current or current.get("has_drm") or any(previous.get(key) != current.get(key) for key in previous if key != "format_id"): raise expired()


def run_probe(request, job_id, hard_exit=False):
    os.umask(0o077)
    prune()
    directory = private_dir(app_dir() / "work" / job_id)
    stopped, cancel = threading.Event(), threading.Event()
    started = time.monotonic()
    def heartbeat():
        while not stopped.wait(1):
            job = store.get(job_id)
            timeout = time.monotonic() - started > 180
            if not job or job["cancel_requested"] or timeout:
                cancel.set()
                if hard_exit:
                    store.update(job_id, state="error" if timeout else "cancelled", error="The format check timed out. Try again." if timeout else None)
                    shutil.rmtree(directory, ignore_errors=True)
                    os._exit(0)
            store.update(job_id, pid=os.getpid())
    store.update(job_id, state="resolving", pid=os.getpid())
    thread = threading.Thread(target=heartbeat, daemon=True)
    thread.start()
    def cancelled():
        job = store.get(job_id)
        return cancel.is_set() or not job or bool(job['cancel_requested'])
    try:
        error = MediaError("unsupported_source", "No source formats were found. Try playing the video first.")
        for index, source in enumerate(request.sources):
            for impersonate in (False, True):
                if cancelled(): raise Cancelled()
                options = engine_options(source, directory, lambda _: None, impersonate, request.outputProfile)
                options.update(socket_timeout=10, retries=1, extractor_retries=1, ignore_no_formats_error=True)
                try:
                    with extracted_source(options, source, request.cookies, cancelled) as (_, extracted):
                        info = single(extracted, source)
                        public, private = catalogue(info, index)
                    if cancelled(): raise Cancelled()
                    if not public: continue
                    value = {"created": time.time(), "binding": binding(request), "options": public, "selections": private}
                    path = cache_path(job_id)
                    temporary = path.with_suffix(".new")
                    temporary.write_text(json.dumps(value, allow_nan=False))
                    temporary.replace(path)
                    store.update(job_id, state="done")
                    return
                except yt_dlp.utils.DownloadError as caught:
                    error = classify_download_error(caught)
                    if error.code == "drm": raise error
                    if not impersonate and "403" in str(caught): continue
                except MediaError as caught:
                    if caught.code in ('drm', 'live_stream', 'ambiguous_video'): raise
                    error = caught
                break
        raise error
    except Cancelled: store.update(job_id, state="cancelled")
    except MediaError as error: store.update(job_id, state="error", error=error.message, detail=error.code)
    except Exception: store.update(job_id, state="error", error="The source formats could not be checked. Try again.")
    finally:
        stopped.set()
        thread.join(timeout=3)
        cache_path(job_id).with_suffix('.new').unlink(missing_ok=True)
        shutil.rmtree(directory, ignore_errors=True)


def main():
    if len(sys.argv) != 2 or not re.fullmatch(r"[0-9a-f]{32}", sys.argv[1]): raise SystemExit(1)
    raw = sys.stdin.buffer.read(1024 * 1024 + 1)
    if len(raw) > 1024 * 1024: raise SystemExit(1)
    run_probe(Inspect.model_validate_json(raw), sys.argv[1], hard_exit=True)


if __name__ == "__main__": main()
