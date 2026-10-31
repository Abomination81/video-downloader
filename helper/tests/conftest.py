import functools
import http.server
import subprocess
import threading
from pathlib import Path

import pytest


def ffmpeg(*args):
    result = subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-nostdin", "-y", *map(str, args)], capture_output=True, text=True, timeout=60)
    if result.returncode:
        raise RuntimeError(result.stderr)


@pytest.fixture(scope="session")
def media_files(tmp_path_factory):
    root = tmp_path_factory.mktemp("media")
    chapters = root / "chapters.txt"
    chapters.write_text(";FFMETADATA1\n[CHAPTER]\nTIMEBASE=1/1000\nSTART=0\nEND=1200\ntitle=PRIVATE_CHAPTER\n")
    ffmpeg("-f", "lavfi", "-i", "testsrc2=size=320x180:rate=24", "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000", "-f", "ffmetadata", "-i", chapters,
           "-t", "1.5", "-map", "0:v", "-map", "1:a", "-map_chapters", "2", "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", "-c:a", "aac",
           "-metadata", "title=PRIVATE_TITLE", "-metadata", "artist=PRIVATE_AUTHOR", "-metadata", "comment=PRIVATE_COMMENT", "-metadata", "location=+37.3317-122.0307/", "-metadata", "creation_time=2020-01-02T03:04:05Z",
           "-metadata:s:v", "handler_name=PRIVATE_HANDLER", root / "source.mp4")
    ffmpeg("-display_rotation", "90", "-i", root / "source.mp4", "-map", "0:v", "-map", "0:a", "-c", "copy", root / "rotated.mp4")
    ffmpeg("-f", "lavfi", "-i", "testsrc2=size=160x90:rate=12", "-t", "0.5", "-c:v", "libx265", "-pix_fmt", "yuv420p10le", "-preset", "ultrafast",
           "-color_primaries", "bt2020", "-color_trc", "smpte2084", "-colorspace", "bt2020nc",
           "-x265-params", "pools=1:log-level=error:master-display=G(13250,34500)B(7500,3000)R(34000,16000)WP(15635,16450)L(10000000,1):max-cll=1000,400", root / "hdr.mp4")
    ffmpeg("-f", "lavfi", "-i", "testsrc2=size=160x90:rate=12", "-t", "0.5", "-c:v", "libvpx-vp9", "-deadline", "realtime", root / "vp9.webm")
    ffmpeg("-f", "lavfi", "-i", "testsrc2=size=160x96:rate=12", "-t", "0.5", "-c:v", "libsvtav1", "-preset", "12", "-crf", "35", "-svtav1-params", "lp=1", root / "av1.mkv")
    for name, size in (("low", "160x90"), ("high", "320x180")):
        directory = root / name
        directory.mkdir(exist_ok=True)
        ffmpeg("-f", "lavfi", "-i", f"testsrc2=size={size}:rate=24", "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000", "-t", "2", "-c:v", "libx264", "-profile:v", "baseline", "-level", "3.0", "-preset", "ultrafast", "-g", "24", "-c:a", "aac", "-f", "hls", "-hls_time", "1", "-hls_segment_type", "fmp4", "-hls_playlist_type", "vod", directory / "index.m3u8")
    (root / "master.m3u8").write_text('#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=180000,RESOLUTION=160x90,FRAME-RATE=24,CODECS="avc1.42c01e,mp4a.40.2"\nlow/index.m3u8\n#EXT-X-STREAM-INF:BANDWIDTH=800000,RESOLUTION=320x180,FRAME-RATE=24,CODECS="avc1.42c01e,mp4a.40.2"\nhigh/index.m3u8\n')
    encrypted = root / "encrypted"
    encrypted.mkdir(exist_ok=True)
    key = encrypted / "key.bin"
    key.write_bytes(b"0123456789abcdef")
    key_info = root / "key-info.txt"
    key_info.write_text(f"key.bin\n{key}\n")
    ffmpeg("-i", root / "source.mp4", "-map", "0:v", "-map", "0:a", "-c", "copy", "-f", "hls", "-hls_time", "1", "-hls_playlist_type", "vod", "-hls_key_info_file", key_info, encrypted / "index.m3u8")
    dash = root / "dash"
    dash.mkdir(exist_ok=True)
    ffmpeg("-i", root / "source.mp4", "-filter_complex", "[0:v]split=2[lowin][high];[lowin]scale=160:90[low]", "-map", "[low]", "-map", "[high]", "-map", "0:a:0", "-c:v", "libx264", "-preset", "ultrafast", "-g", "24", "-b:v:0", "100k", "-b:v:1", "600k", "-c:a", "aac", "-f", "dash", "-seg_duration", "1", "-adaptation_sets", "id=0,streams=v id=1,streams=a", dash / "manifest.mpd")
    (root / "multiple.html").write_text('<!doctype html><html><head><title>Multiple videos</title></head><body><video src="/vp9.webm"></video><video src="/source.mp4"></video></body></html>')
    (root / "single.html").write_text('<!doctype html><html><head><title>Fresh video link</title></head><body><video src="/source.mp4?signature=fresh"></video></body></html>')
    ffmpeg("-f", "lavfi", "-i", "testsrc2=size=320x180:rate=24", "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000", "-t", "8", "-c:v", "libx264", "-preset", "medium", "-g", "72", "-bf", "2", "-c:a", "aac", root / "reordered.mp4")
    ffmpeg("-i", root / "reordered.mp4", "-c", "copy", root / "reordered.mkv")
    return root


@pytest.fixture
def isolated_app(tmp_path, monkeypatch):
    import json
    app = tmp_path / "app"
    app.mkdir()
    (app / "config.json").write_text(json.dumps({"download_dir": str(tmp_path / "downloads")}))
    monkeypatch.setenv("VIDEO_DOWNLOADER_HOME", str(app))
    return app


@pytest.fixture
def media_server(media_files):
    class Handler(http.server.SimpleHTTPRequestHandler):
        extensions_map = {**http.server.SimpleHTTPRequestHandler.extensions_map, ".m3u8": "application/vnd.apple.mpegurl", ".mp4": "video/mp4", ".m4s": "video/iso.segment"}
        def log_message(self, *_): pass
        def do_GET(self):
            if self.path == "/fingerprinted.mp4":
                if not self.headers.get("Sec-Ch-Ua"):
                    self.send_error(403)
                    return
                self.path = "/source.mp4"
            super().do_GET()
    server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), functools.partial(Handler, directory=str(media_files)))
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    yield f"http://127.0.0.1:{server.server_port}"
    server.shutdown()
    thread.join()
