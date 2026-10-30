import json
import stat
from pathlib import Path

from video_downloader.config import downloaded_file, output_dir, settings


def test_old_default_migrates_and_existing_downloads_remain_accessible(tmp_path, monkeypatch):
    home = tmp_path / "home"
    app = tmp_path / "app"
    app.mkdir()
    old = home / "Downloads/Video Downloader"
    old.mkdir(parents=True)
    clip = old / "existing.mp4"
    clip.write_bytes(b"existing download")
    (app / "config.json").write_text(json.dumps({"download_dir": str(old)}))
    monkeypatch.setattr(Path, "home", classmethod(lambda cls: home))
    monkeypatch.setenv("VIDEO_DOWNLOADER_HOME", str(app))
    downloads = home / "Downloads"
    downloads.chmod(0o755)
    assert output_dir() == downloads
    assert stat.S_IMODE(downloads.stat().st_mode) == 0o755
    assert downloaded_file("existing.mp4") == clip
    assert downloaded_file("../existing.mp4") is None


def test_fresh_default_is_downloads_and_custom_directory_is_preserved(tmp_path, monkeypatch):
    home, app = tmp_path / "home", tmp_path / "app"
    app.mkdir()
    monkeypatch.setattr(Path, "home", classmethod(lambda cls: home))
    monkeypatch.setenv("VIDEO_DOWNLOADER_HOME", str(app))
    assert settings()["download_dir"] == str(home / "Downloads")
    custom = tmp_path / "custom"
    (app / "config.json").write_text(json.dumps({"download_dir": str(custom)}))
    assert output_dir() == custom
