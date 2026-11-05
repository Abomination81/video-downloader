import json
import os
import shutil
import sys
from pathlib import Path

HOST_NAME = "com.video_downloader.helper"
EXTENSION_ID = "bhglpjejpddnmfgkaakboniplnoemoak"
SCREENSHOT_COMPANION_ID = "eilmbbmdgiccchbfkbmejpdnbnhddabi"
YOUTUBE_COMPANION_ID = "hpbfmepggeinhmoamadigfdfgohagacf"
AUDIO_COMPANION_ID = "pfbibbaockflnnpdicbkgcnicplpmiif"


def app_dir() -> Path:
    override = os.environ.get("VIDEO_DOWNLOADER_HOME")
    if override:
        return Path(override).expanduser().resolve()
    if sys.platform == "darwin":
        return Path.home() / "Library/Application Support/Video Downloader"
    if os.name == "nt":
        return Path(os.environ.get("LOCALAPPDATA", Path.home() / "AppData/Local")) / "Video Downloader"
    return Path(os.environ.get("XDG_DATA_HOME", Path.home() / ".local/share")) / "video-downloader"


def private_dir(path: Path) -> Path:
    path.mkdir(mode=0o700, parents=True, exist_ok=True)
    if os.name != "nt":
        path.chmod(0o700)
    return path


def settings() -> dict:
    path = app_dir() / "config.json"
    result = json.loads(path.read_text()) if path.is_file() else {}
    result.setdefault("download_dir", str(Path.home() / "Downloads"))
    if Path(result["download_dir"]).expanduser().resolve() == (Path.home() / "Downloads/Video Downloader").resolve():
        result["download_dir"] = str(Path.home() / "Downloads")
    return result


def binary(name: str) -> str:
    configured = settings().get("binaries", {}).get(name)
    if configured and Path(configured).is_file():
        return configured
    search = [shutil.which(name), f"/opt/homebrew/bin/{name}", f"/usr/local/bin/{name}"]
    for item in search:
        if item and Path(item).is_file():
            return str(item)
    raise FileNotFoundError(name)


def output_dir() -> Path:
    path = Path(settings()["download_dir"]).expanduser().resolve()
    path.mkdir(mode=0o700, parents=True, exist_ok=True)
    return path


def downloaded_file(filename: str) -> Path | None:
    if Path(filename).name != filename:
        return None
    # Keep existing history entries usable after changing the old default.
    for directory in (output_dir(), Path.home() / "Downloads/Video Downloader"):
        path = directory / filename
        if path.is_file() and not path.is_symlink():
            return path
    return None
