#!/usr/bin/env python3
"""Per-user installer. No source repository or Node installation is required."""
import argparse
import base64
import hashlib
import json
import os
import platform
import shlex
import shutil
import sqlite3
import subprocess
import sys
import tempfile
import time
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
HOST = "com.video_downloader.helper"


def execute(args, **kwargs):
    subprocess.run([str(a) for a in args], check=True, **kwargs)


def app_directory():
    if sys.platform == "darwin":
        return Path.home() / "Library/Application Support/Video Downloader"
    if os.name == "nt":
        return Path(os.environ["LOCALAPPDATA"]) / "Video Downloader"
    return Path(os.environ.get("XDG_DATA_HOME", Path.home() / ".local/share")) / "video-downloader"


def native_directories():
    if sys.platform == "darwin":
        return [Path.home() / "Library/Application Support" / browser / "NativeMessagingHosts" for browser in ("Google/Chrome", "Google/Chrome for Testing", "Chromium")]
    if os.name != "nt":
        return [Path.home() / ".config" / browser / "NativeMessagingHosts" for browser in ("google-chrome", "chromium")]
    return []


def find_binary(name):
    candidates = [shutil.which(name), f"/opt/homebrew/bin/{name}", f"/usr/local/bin/{name}"]
    if os.name == "nt":
        base = Path(os.environ["LOCALAPPDATA"]) / "Microsoft/WinGet"
        candidates += [str(base / "Links" / (name + ".exe")), str(Path.home() / ".deno/bin" / (name + ".exe"))]
        if (base / "Packages").is_dir():
            candidates += [str(p) for p in (base / "Packages").glob(f"*/*/{name}.exe")]
            candidates += [str(p) for p in (base / "Packages").glob(f"*/*/bin/{name}.exe")]
            candidates += [str(p) for p in (base / "Packages").glob(f"*/{name}.exe")]
    return next((str(Path(p).resolve()) for p in candidates if p and Path(p).is_file()), None)


def install_tools():
    required = ("ffmpeg", "ffprobe", "deno", "exiftool")
    missing = [name for name in required if not find_binary(name)]
    if missing and sys.platform == "darwin":
        brew = find_binary("brew")
        if not brew:
            print("Installing Homebrew, the standard Mac package manager. macOS may ask for your password.")
            with tempfile.TemporaryDirectory() as directory:
                script = Path(directory) / "install-homebrew.sh"
                with urllib.request.urlopen("https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh", timeout=30) as response:
                    script.write_bytes(response.read())
                execute(["/bin/bash", script])
            brew = find_binary("brew")
        if not brew:
            raise RuntimeError("Homebrew did not finish installing. Run Install.command again when it is ready.")
        packages = sorted({"ffmpeg" if name == "ffprobe" else name for name in missing})
        execute([brew, "install", *packages], env={**os.environ, "HOMEBREW_NO_AUTO_UPDATE": "1"})
    elif missing and os.name == "nt":
        winget = shutil.which("winget")
        if not winget:
            raise RuntimeError("Install Microsoft's App Installer from the Microsoft Store, then run the installer again.")
        packages = {"ffmpeg": "Gyan.FFmpeg", "ffprobe": "Gyan.FFmpeg", "deno": "DenoLand.Deno", "exiftool": "OliverBetz.ExifTool"}
        for package in sorted({packages[name] for name in missing}):
            execute([winget, "install", "--id", package, "--exact", "--accept-package-agreements", "--accept-source-agreements", "--disable-interactivity"])
    elif missing:
        raise RuntimeError("Install ffmpeg, deno, and exiftool with your package manager, then run this installer again.")
    result = {name: find_binary(name) for name in required}
    if not all(result.values()):
        raise RuntimeError("Some tools are not on PATH yet. Close this window and rerun the installer.")
    return result


def ensure_idle(app):
    database = app / "state/jobs.sqlite3"
    if not database.exists():
        return
    with sqlite3.connect(database, timeout=10) as connection:
        count = connection.execute("SELECT count(*) FROM jobs WHERE state IN ('queued','resolving','downloading','cleaning','verifying','finalizing') AND updated > ?", (time.time() - 90,)).fetchone()[0]
        if count:
            raise RuntimeError("Wait for current downloads to finish, then run the installer again.")


def register(app, python, extension_id):
    if os.name == "nt":
        launcher = app / "native-host.cmd"
        launcher.write_text(f'@echo off\r\n"{python}" -m video_downloader.native %*\r\n')
    else:
        launcher = app / "native-host"
        launcher.write_text("#!/bin/sh\nexec " + shlex.quote(str(python)) + ' -m video_downloader.native "$@"\n')
        launcher.chmod(0o700)
    manifest = {"name": HOST, "description": "Video Downloader · Built by abomination81", "path": str(launcher), "type": "stdio", "allowed_origins": [f"chrome-extension://{extension_id}/"]}
    manifest_path = app / f"{HOST}.json"
    manifest_path.write_text(json.dumps(manifest, indent=2) + "\n")
    if os.name == "nt":
        import winreg
        for browser in ("Google\\Chrome", "Chromium"):
            with winreg.CreateKey(winreg.HKEY_CURRENT_USER, f"Software\\{browser}\\NativeMessagingHosts\\{HOST}") as key:
                winreg.SetValueEx(key, "", 0, winreg.REG_SZ, str(manifest_path))
    else:
        for directory in native_directories():
            directory.mkdir(parents=True, exist_ok=True)
            (directory / f"{HOST}.json").write_text(json.dumps(manifest, indent=2) + "\n")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--uv", default=shutil.which("uv"))
    parser.add_argument("--no-open", action="store_true")
    parser.add_argument("--engine-only", action="store_true")
    args = parser.parse_args()
    if not args.uv:
        raise RuntimeError("Run Install.command or Install-Windows.cmd to start setup.")
    app = app_directory()
    app.mkdir(parents=True, exist_ok=True, mode=0o700)
    ensure_idle(app)
    environment = app / ".venv"
    python = environment / ("Scripts/python.exe" if os.name == "nt" else "bin/python")
    if args.engine_only:
        if not python.exists():
            raise RuntimeError("Run the main installer first.")
        execute([args.uv, "pip", "install", "--python", python, "--upgrade", "yt-dlp[default,curl-cffi]"])
        print("Download engine updated. Your extension and finished videos are unchanged.")
        return
    extension = ROOT / "extension"
    if not (extension / "manifest.json").is_file():
        extension = ROOT / ".output/chrome-mv3"
    manifest = json.loads((extension / "manifest.json").read_text())
    digest = hashlib.sha256(base64.b64decode(manifest["key"])).hexdigest()[:32]
    extension_id = "".join(chr(97 + int(c, 16)) for c in digest)
    expected = json.loads((ROOT / "extension-identity.json").read_text())["id"]
    if extension_id != expected:
        raise RuntimeError("The extension identity does not match this bundle.")
    print("Video Downloader · Built by abomination81")
    print("abomination81.com · X: @Abomination81 · github.com/Abomination81")
    print("Setting up Video Downloader for your account…")
    binaries = install_tools()
    if not python.exists():
        execute([args.uv, "venv", "--python", "3.13", environment])
    wheels = sorted((ROOT / "helper-wheel").glob("*.whl"))
    package = wheels[-1] if wheels else ROOT / "helper"
    command = [args.uv, "pip", "install", "--python", python, "--upgrade"]
    constraints = ROOT / "runtime-requirements.txt"
    if constraints.exists():
        command += ["--constraint", constraints.resolve().as_uri()]
    # File URIs also work with older uv versions whose requirement parser
    # splits wheel and constraint paths containing spaces.
    execute([*command, package.resolve().as_uri()])
    # Smoke-check imports and protocol code before replacing a working extension.
    execute([python, "-c", "import video_downloader.native, yt_dlp, av, PIL, lxml.etree; print('Helper installed.')"])
    config_path = app / "config.json"
    config = json.loads(config_path.read_text()) if config_path.exists() else {}
    config.update({"binaries": binaries, "extension_id": extension_id})
    config.setdefault("download_dir", str(Path.home() / "Downloads"))
    if Path(config["download_dir"]).expanduser().resolve() == (Path.home() / "Downloads/Video Downloader").resolve():
        config["download_dir"] = str(Path.home() / "Downloads")
    config_path.write_text(json.dumps(config, indent=2) + "\n")
    temporary = app / "extension.new"
    shutil.rmtree(temporary, ignore_errors=True)
    shutil.copytree(extension, temporary)
    destination = app / "extension"
    backup = app / "extension.previous"
    shutil.rmtree(backup, ignore_errors=True)
    if destination.exists():
        destination.rename(backup)
    temporary.rename(destination)
    register(app, python, extension_id)
    shutil.rmtree(backup, ignore_errors=True)
    print("\nSetup complete. The helper starts silently when you download.")
    print("1. Open chrome://extensions and turn on Developer mode.")
    print("2. Choose Load unpacked and select this folder:")
    print(destination)
    print("3. Reload video pages that were already open.")
    print("Videos appear in Chrome's download panel and use Chrome's Downloads folder.")
    print("The normal default is:", config["download_dir"])
    if not args.no_open:
        if sys.platform == "darwin":
            execute(["open", str(destination)])
            execute(["open", "-a", "Google Chrome", "chrome://extensions/"])
        elif os.name == "nt":
            os.startfile(str(destination))
            chrome = shutil.which("chrome.exe")
            if not chrome:
                for root in (os.environ.get("PROGRAMFILES", ""), os.environ.get("PROGRAMFILES(X86)", ""), os.environ.get("LOCALAPPDATA", "")):
                    candidate = Path(root) / "Google/Chrome/Application/chrome.exe"
                    if candidate.exists(): chrome = str(candidate); break
            if chrome:
                subprocess.Popen([chrome, "chrome://extensions/"])


if __name__ == "__main__":
    try:
        main()
    except (RuntimeError, subprocess.CalledProcessError, OSError) as error:
        print("\nSetup could not finish:", error, file=sys.stderr)
        raise SystemExit(1)
