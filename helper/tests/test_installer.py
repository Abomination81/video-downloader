"""Exercise per-user deployment without installing tools into the test account."""
import importlib.util
import json
import sys
from pathlib import Path

import pytest


@pytest.mark.parametrize("account", ["friend-one", "friend with spaces"])
@pytest.mark.parametrize("destination", ["fresh", "legacy", "custom"])
def test_shared_bundle_uses_each_accounts_downloads(tmp_path, monkeypatch, account, destination):
    root = Path(__file__).resolve().parents[2]
    spec = importlib.util.spec_from_file_location("vd_installer", root / "scripts/install.py")
    installer = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(installer)
    home = tmp_path / account
    app = home / "app"
    bundle = tmp_path / "Shared Video Downloader"
    (bundle / "extension").mkdir(parents=True)
    identity = json.loads((root / "extension-identity.json").read_text())
    (bundle / "extension-identity.json").write_text(json.dumps(identity))
    (bundle / "extension/manifest.json").write_text(json.dumps({"key": identity["key"]}))
    wheel = bundle / "helper-wheel/video_downloader_helper-0.4.0-py3-none-any.whl"
    wheel.parent.mkdir()
    wheel.touch()
    constraints = bundle / "runtime-requirements.txt"
    constraints.touch()
    if destination != "fresh":
        app.mkdir(parents=True)
        configured = home / ("Downloads/Video Downloader" if destination == "legacy" else "custom-videos")
        (app / "config.json").write_text(json.dumps({"download_dir": str(configured)}))
    calls = []
    monkeypatch.setattr(Path, "home", classmethod(lambda cls: home))
    monkeypatch.setattr(installer, "ROOT", bundle)
    monkeypatch.setattr(installer, "app_directory", lambda: app)
    monkeypatch.setattr(installer, "native_directories", lambda: [home / "registration"])
    monkeypatch.setattr(installer, "install_tools", lambda: {"ffmpeg": "/tools/ffmpeg"})
    monkeypatch.setattr(installer, "execute", lambda args, **kwargs: calls.append(args))
    monkeypatch.setattr(sys, "argv", ["install.py", "--uv", "/tools/uv", "--no-open"])
    installer.main()
    config = json.loads((app / "config.json").read_text())
    expected = home / ("custom-videos" if destination == "custom" else "Downloads")
    assert config["download_dir"] == str(expected)
    assert config["extension_id"] == identity["id"]
    assert (app / "extension/manifest.json").exists()
    install_call = next(args for args in calls if "pip" in args)
    assert install_call[-1] == wheel.as_uri()  # Paths containing spaces stay one requirement.
    assert install_call[install_call.index("--constraint") + 1] == constraints.as_uri()
