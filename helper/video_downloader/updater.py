"""Signed, bounded, transactional updates for the personal unpacked install."""
import base64
import hashlib
import json
import os
import random
import re
import shutil
import stat
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
import zipfile
from pathlib import Path, PurePosixPath

from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey

from . import __version__, store
from .bootstrap import AGENT_LABEL, VERSION, atomic_json, locked, pointer, recover
from .config import SCREENSHOT_COMPANION_ID, YOUTUBE_COMPANION_ID, AUDIO_COMPANION_ID, EXTENSION_ID, app_dir, private_dir, settings

REPOSITORY = "Abomination81/video-downloader"
API = f"https://api.github.com/repos/{REPOSITORY}/releases/latest"
MAX_ARCHIVE = 64 * 1024 * 1024
MAX_EXPANDED = 128 * 1024 * 1024
HOSTS = {"api.github.com", "github.com", "release-assets.githubusercontent.com", "objects.githubusercontent.com", "github-releases.githubusercontent.com"}
WORKING = {"checking", "downloading", "preparing", "waiting", "applying"}


class UpdateError(Exception):
    pass


def version(value):
    if not isinstance(value, str) or not re.fullmatch(r"\d{1,5}\.\d{1,5}\.\d{1,5}", value):
        raise UpdateError("Invalid update version")
    parts = tuple(map(int, value.split(".")))
    if any(part > 65535 for part in parts) or any(str(part) != text for part, text in zip(parts, value.split("."))):
        raise UpdateError("Invalid update version")
    return parts


def state(**values):
    atomic_json(app_dir() / "update-state.json", {**values, "updated": time.time()})


def status():
    path = app_dir() / "update-state.json"
    value = json.loads(path.read_text()) if path.is_file() else {"state": "current", "message": "Updates are enabled. The first check will run shortly."}
    active = pointer(app_dir())
    installed = active["version"] if active else __version__
    if value["state"] == "ready" and installed == __version__:
        value.update(state="current", message="You’re up to date.")
    return {**value, "installedVersion": installed, "enabled": settings().get("auto_updates", True)}


def managed():
    return (app_dir() / "bootstrap.py").is_file() and Path(settings().get("updater_uv", "")).is_file()


def configure(enabled, chrome_version=None):
    with locked(app_dir()):
        value = settings()
        value["auto_updates"] = enabled
        if chrome_version is not None:
            value["chrome_major"] = chrome_version
        atomic_json(app_dir() / "config.json", value)


def start(enabled=True, force=False, chrome_version=127):
    if not managed() or (sys.platform == "darwin" and not settings().get("update_agent")):
        return {"state": "manual", "message": "Run the latest installer once to enable silent updates.", "installedVersion": __version__, "enabled": enabled}
    configure(enabled, chrome_version)
    previous = status()
    if not enabled and not force:
        return {**previous, "state": "disabled", "message": "Automatic updates are off."}
    if previous["state"] in WORKING and time.time() - previous.get("updated", 0) < 20 * 60:
        return previous
    if not force and time.time() - previous.get("checked", 0) < 6 * 3600:
        return previous
    state(state="checking", message="Checking for updates…", checked=time.time())
    flags = subprocess.CREATE_NEW_PROCESS_GROUP | subprocess.DETACHED_PROCESS | subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0
    try:
        if sys.platform == "darwin":
            label = settings()["update_agent"]
            if not re.fullmatch(re.escape(AGENT_LABEL) + r"(?:\.test\.[0-9a-f]{32})?", label):
                raise UpdateError("Invalid updater registration")
            with locked(app_dir()):
                atomic_json(app_dir() / "update-request.json", {"manual": force, "chromeVersion": chrome_version, "created": time.time()})
            subprocess.run(["/bin/launchctl", "kickstart", f"gui/{os.getuid()}/{label}"], stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=10, check=True)
        else:
            subprocess.Popen([sys.executable, "-m", "video_downloader.updater", str(chrome_version), "manual" if force else "auto"], stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, start_new_session=os.name != "nt", creationflags=flags)
    except (OSError, subprocess.SubprocessError, UpdateError):
        state(state="error", message="The background updater could not start. Downloads still work; rerun the latest installer if this continues.", checked=time.time() - 5 * 3600)
    return status()


def safe_url(url):
    parsed = urllib.parse.urlsplit(url)
    if parsed.scheme != "https" or parsed.hostname not in HOSTS or parsed.username or parsed.password or parsed.port not in (None, 443):
        raise UpdateError("The update source is not trusted")
    return url


class Redirects(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return super().redirect_request(req, fp, code, msg, headers, safe_url(newurl))


def fetch(url, limit):
    opener = urllib.request.build_opener(Redirects())
    for attempt in range(3):
        try:
            request = urllib.request.Request(safe_url(url), headers={"User-Agent": "Abomination81-Video-Downloader-Updater", "Accept": "application/vnd.github+json" if url == API else "application/octet-stream"})
            with opener.open(request, timeout=20) as response:
                safe_url(response.url)
                if int(response.headers.get("Content-Length", "0")) > limit:
                    raise UpdateError("The update is too large")
                parts = []
                size = 0
                deadline = time.monotonic() + 120
                while True:
                    part = response.read(min(65536, limit - size + 1))
                    if not part:
                        break
                    parts.append(part)
                    size += len(part)
                    if size > limit or time.monotonic() > deadline:
                        raise UpdateError("The update exceeded its download limit")
                return b"".join(parts)
        except urllib.error.HTTPError as error:
            if error.code not in (429, 500, 502, 503, 504) or attempt == 2:
                raise UpdateError("The update server could not be reached") from error
            delay = min(10, max(0, float(error.headers.get("Retry-After", "1"))))
        except (urllib.error.URLError, TimeoutError, ConnectionError) as error:
            if attempt == 2:
                raise UpdateError("The update server could not be reached") from error
            delay = 2 ** attempt
        time.sleep(delay + random.random())


def verify_manifest(raw, signature, public_key=None):
    if len(raw) > 16384 or len(signature) > 256:
        raise UpdateError("Invalid update signature")
    try:
        key = public_key or base64.b64decode(json.loads(Path(__file__).with_name("update-key.json").read_text())["publicKey"], validate=True)
        Ed25519PublicKey.from_public_bytes(key).verify(base64.b64decode(signature.strip(), validate=True), raw)
        value = json.loads(raw)
        if set(value) != {"schema", "repository", "version", "sha256", "size", "commit", "minimumChrome", "bootstrap"}:
            raise ValueError("Unexpected update fields")
        version(value["version"])
        if value["schema"] != 1 or value["repository"] != REPOSITORY or value["bootstrap"] > VERSION:
            raise ValueError("Unsupported update")
        if not isinstance(value["size"], int) or not 0 < value["size"] <= MAX_ARCHIVE or not re.fullmatch(r"[0-9a-f]{64}", value["sha256"]) or not re.fullmatch(r"[0-9a-f]{40}", value["commit"]):
            raise ValueError("Invalid update digest")
        if type(value["minimumChrome"]) is not int or not 127 <= value["minimumChrome"] <= 1000:
            raise ValueError("Invalid Chrome version")
        return value
    except Exception as error:
        raise UpdateError("The update signature could not be verified. Your installed version was kept.") from error


def unpack(archive, destination):
    with zipfile.ZipFile(archive) as bundle:
        total, names = 0, set()
        entries = bundle.infolist()
        if len(entries) > 1000:
            raise UpdateError("Too many update files")
        for item in entries:
            path = PurePosixPath(item.filename)
            mode = item.external_attr >> 16
            if "\\" in item.filename or any(":" in part or any(ord(c) < 32 for c in part) for part in path.parts) or path.is_absolute() or ".." in path.parts or not path.parts or path.parts[0] != "Video Downloader" or stat.S_ISLNK(mode) or (stat.S_IFMT(mode) not in (0, stat.S_IFREG, stat.S_IFDIR)):
                raise UpdateError("Unsafe update archive")
            key = item.filename.casefold().rstrip("/")
            if key in names or item.flag_bits & 1:
                raise UpdateError("Duplicate or encrypted update file")
            names.add(key)
            total += item.file_size
            if total > MAX_EXPANDED:
                raise UpdateError("Expanded update is too large")
            target = destination.joinpath(*path.parts)
            if item.is_dir():
                target.mkdir(parents=True, exist_ok=True)
            else:
                target.parent.mkdir(parents=True, exist_ok=True)
                with bundle.open(item) as source, target.open("xb") as output:
                    shutil.copyfileobj(source, output, 65536)
                target.chmod(0o700 if mode & 0o111 else 0o600)
    return destination / "Video Downloader"


def validate_bundle(bundle, update):
    manifest = json.loads((bundle / "extension/manifest.json").read_text())
    identity = json.loads((bundle / "extension-identity.json").read_text())
    digest = hashlib.sha256(base64.b64decode(manifest["key"], validate=True)).hexdigest()[:32]
    extension_id = "".join(chr(97 + int(c, 16)) for c in digest)
    if extension_id != EXTENSION_ID or identity["id"] != EXTENSION_ID or manifest["version"] != update["version"]:
        raise UpdateError("The update identity does not match this installation")
    current = json.loads((app_dir() / "extension/manifest.json").read_text())
    if not set(manifest.get("permissions", [])) <= set(current.get("permissions", [])) or not set(manifest.get("host_permissions", [])) <= set(current.get("host_permissions", [])):
        raise UpdateError("This update needs new Chrome permissions. Install it manually from the project page.")
    child = bundle / 'extension/audio-companion/manifest.json'
    if child.is_file():
        audio = json.loads(child.read_text())
        digest = hashlib.sha256(base64.b64decode(audio['key'], validate=True)).hexdigest()[:32]
        child_id = ''.join(chr(97 + int(c, 16)) for c in digest)
        if child_id != AUDIO_COMPANION_ID or audio['version'] != update['version'] or set(audio.get('permissions', [])) != {'contextMenus', 'storage', 'alarms'} or any(audio.get(field) for field in ('host_permissions', 'optional_host_permissions', 'optional_permissions', 'content_scripts')) or audio.get('externally_connectable') != {'ids': [EXTENSION_ID]} or manifest.get('externally_connectable') != {'ids': [AUDIO_COMPANION_ID]}:
            raise UpdateError('The audio companion identity or permissions do not match this installation')
    validate_youtube_companion(bundle, update)
    validate_screenshot_companion(bundle, update)
    wheels = list((bundle / "helper-wheel").glob("*.whl"))
    if len(wheels) != 1 or wheels[0].name != f"video_downloader_helper-{update['version']}-py3-none-any.whl" or not (bundle / "update-requirements.txt").is_file():
        raise UpdateError("The update helper package is incomplete")
    return wheels[0]


def validate_youtube_companion(bundle, update):
    child = bundle / 'extension/youtube-companion'
    path = child / 'manifest.json'
    if not path.is_file():
        if (app_dir() / 'extension/youtube-companion/manifest.json').is_file():
            raise UpdateError('The YouTube companion is missing from this update')
        return  # Older installations and bundles did not include this optional companion.
    try:
        value = json.loads(path.read_text())
        digest = hashlib.sha256(base64.b64decode(value['key'], validate=True)).hexdigest()[:32]
        child_id = ''.join(chr(97 + int(c, 16)) for c in digest)
        expected_csp = "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'"
        if (child_id != YOUTUBE_COMPANION_ID or value['version'] != update['version']
                or value.get('manifest_version') != 3
                or set(value.get('permissions', [])) != {'declarativeNetRequest', 'scripting', 'storage'}
                or set(value.get('host_permissions', [])) != {'https://www.youtube.com/*', 'https://www.youtube-nocookie.com/*'}
                or value.get('externally_connectable') != {'ids': [EXTENSION_ID]}
                or value.get('content_security_policy') != {'extension_pages': expected_csp}
                or value.get('background') != {'service_worker': 'background.js'}
                or any(value.get(field) for field in ('optional_permissions', 'optional_host_permissions', 'content_scripts', 'web_accessible_resources', 'update_url', 'sandbox', 'oauth2', 'devtools_page', 'chrome_url_overrides'))
                or value.get('declarative_net_request') != {'rule_resources': [{'id': 'youtube_ads', 'enabled': True, 'path': 'rules.json'}]}):
            raise ValueError('policy')
        rules = json.loads((child / 'rules.json').read_text())
        if not isinstance(rules, list) or not 1 <= len(rules) <= 100:
            raise ValueError('rules')
        for rule in rules:
            domains = rule['condition'].get('initiatorDomains', [])
            if rule['action'] != {'type': 'block'} or not domains or not set(domains) <= {'www.youtube.com', 'www.youtube-nocookie.com'}:
                raise ValueError('rule scope')
    except (ValueError, KeyError, TypeError, AttributeError, OSError) as error:
        raise UpdateError('The YouTube companion identity or privacy boundary does not match this installation') from error


def validate_screenshot_companion(bundle, update):
    path = bundle / 'extension/screenshot-companion/manifest.json'
    if not path.is_file():
        if (app_dir() / 'extension/screenshot-companion/manifest.json').is_file():
            raise UpdateError('The screenshot companion is missing from this update')
        return
    try:
        value = json.loads(path.read_text())
        digest = hashlib.sha256(base64.b64decode(value['key'], validate=True)).hexdigest()[:32]
        child_id = ''.join(chr(97 + int(c, 16)) for c in digest)
        expected_csp = "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' blob: data:; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-src 'none'; worker-src 'none'"
        if (child_id != SCREENSHOT_COMPANION_ID or value['version'] != update['version']
                or value.get('manifest_version') != 3 or value.get('incognito') != 'not_allowed'
                or set(value.get('permissions', [])) != {'activeTab', 'scripting', 'contextMenus'}
                or value.get('externally_connectable') != {'ids': [EXTENSION_ID]}
                or value.get('content_security_policy') != {'extension_pages': expected_csp}
                or value.get('background') != {'service_worker': 'background.js', 'type': 'module'}
                or any(value.get(field) for field in ('host_permissions', 'optional_permissions', 'optional_host_permissions', 'content_scripts', 'web_accessible_resources', 'update_url', 'sandbox', 'oauth2', 'devtools_page', 'chrome_url_overrides'))):
            raise ValueError('policy')
    except (ValueError, KeyError, TypeError, AttributeError, OSError) as error:
        raise UpdateError('The screenshot companion identity or privacy boundary does not match this installation') from error


def prepare_runtime(bundle, update):
    runtime = private_dir(app_dir() / "runtimes") / update["version"]
    if runtime.exists():
        shutil.rmtree(runtime)
    runtime.mkdir(mode=0o700)
    uv = settings()["updater_uv"]
    python = runtime / ".venv" / ("Scripts/python.exe" if os.name == "nt" else "bin/python")
    command = [uv, "--no-config"]
    flags = subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0
    def run(arguments, timeout):
        subprocess.run(arguments, stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=timeout, check=True, creationflags=flags)
    try:
        run([*command, "venv", "--python", sys.executable, runtime / ".venv"], 120)
        run([*command, "pip", "install", "--python", python, "--require-hashes", "--index-url", "https://pypi.org/simple", "-r", bundle / "update-requirements.txt"], 600)
        wheel = validate_bundle(bundle, update)
        run([*command, "pip", "install", "--python", python, "--no-deps", wheel.resolve().as_uri()], 120)
        run([python, "-c", "import sys,video_downloader,video_downloader.native,video_downloader.updater,yt_dlp,av,PIL,lxml.etree;sys.exit(video_downloader.__version__ != sys.argv[1])", update["version"]], 30)
        return runtime
    except Exception:
        shutil.rmtree(runtime, ignore_errors=True)
        raise


def busy():
    return store.busy()


def prune_runtimes(app, keep):
    root = app / "runtimes"
    if root.is_dir():
        for directory in root.iterdir():
            if re.fullmatch(r"\d+\.\d+\.\d+", directory.name) and directory.name not in keep and directory.is_dir() and not directory.is_symlink():
                # Windows may still hold a DLL open briefly; retry on the next
                # successful update rather than failing an installed update.
                shutil.rmtree(directory, ignore_errors=True)


def commit(bundle, update, manual=False):
    app = app_dir()
    with locked(app):
        recover(app)
        if busy():
            return False
        if not manual and not settings().get("auto_updates", True):
            raise UpdateError("Automatic updates were turned off. Your installed version was kept.")
        if version(update["version"]) <= version((pointer(app) or {"version": __version__})["version"]):
            return True
        validate_bundle(bundle, update)
        state(state="applying", message="Finishing the update…", target=update["version"])
        backup = app / "extension.previous"
        shutil.rmtree(backup, ignore_errors=True)
        previous = pointer(app)
        atomic_json(app / "update-journal.json", {"pointer": previous})
        try:
            (app / "extension").rename(backup)
            (bundle / "extension").rename(app / "extension")
            atomic_json(app / "active-runtime.json", {"version": update["version"]})
            (app / "update-journal.json").unlink()
        except Exception:
            recover(app)
            raise
        state(state="ready", message="Update installed. Chrome will activate it automatically when the extension is idle.", target=update["version"], checked=time.time())
        prune_runtimes(app, {update["version"], (previous or {}).get("version")})
        return True


def run(chrome_version, manual=False):
    app = private_dir(app_dir())
    with locked(app, "update-check.lock", timeout=0):
        with locked(app):
            recover(app)
        checked = time.time()
        with tempfile.TemporaryDirectory(prefix="update-", dir=private_dir(app / "updates")) as temporary:
            workspace = Path(temporary)
            release = json.loads(fetch(API, 256 * 1024))
            tag = release.get("tag_name", "")
            latest = tag.removeprefix("v")
            if release.get("draft") or release.get("prerelease") or version(latest) <= version((pointer(app) or {"version": __version__})["version"]):
                state(state="current", message="You’re up to date.", checked=checked)
                return
            assets = {item["name"]: item["browser_download_url"] for item in release["assets"]}
            base = f"https://github.com/{REPOSITORY}/releases/download/{tag}/"
            for name in ("update.json", "update.json.sig", "Video-Downloader.zip"):
                if assets.get(name) != base + name:
                    raise UpdateError("The release does not contain a signed update")
            update = verify_manifest(fetch(assets["update.json"], 16384), fetch(assets["update.json.sig"], 256))
            if update["version"] != latest or version(latest) <= version(__version__):
                raise UpdateError("The signed update version does not match")
            if chrome_version < update["minimumChrome"]:
                raise UpdateError("Update Chrome first. Your installed downloader was kept.")
            state(state="downloading", message="Downloading the verified update…", target=latest, checked=checked)
            archive = workspace / "update.zip"
            data = fetch(assets["Video-Downloader.zip"], min(MAX_ARCHIVE, update["size"]))
            if len(data) != update["size"] or hashlib.sha256(data).hexdigest() != update["sha256"]:
                raise UpdateError("The update download did not match its signature")
            archive.write_bytes(data)
            bundle = unpack(archive, workspace / "files")
            validate_bundle(bundle, update)
            state(state="preparing", message="Preparing the update. Downloads can continue.", target=latest, checked=checked)
            prepare_runtime(bundle, update)
            deadline = time.monotonic() + 24 * 3600
            while not commit(bundle, update, manual):
                state(state="waiting", message="Update ready. Waiting for current downloads to finish.", target=latest, checked=checked)
                if time.monotonic() > deadline:
                    raise UpdateError("The update will retry after current downloads finish.")
                if not manual and not settings().get("auto_updates", True):
                    raise UpdateError("Automatic updates were turned off. Your installed version was kept.")
                time.sleep(15)


def agent():
    with locked(app_dir()):
        path = app_dir() / "update-request.json"
        request = json.loads(path.read_text()) if path.exists() else None
        path.unlink(missing_ok=True)
    value = settings()
    fresh = request is not None and time.time() - request.get("created", 0) < 600
    manual = fresh and request.get("manual") is True
    if not value.get("auto_updates", True) and not manual:
        return
    if not fresh and time.time() - status().get("checked", 0) < 6 * 3600:
        return
    chrome = request.get("chromeVersion", 127) if fresh else value.get("chrome_major", 127)
    if type(chrome) is not int or not 127 <= chrome <= 1000:
        raise UpdateError("Invalid Chrome version for the update check")
    run(chrome, manual)


def main():
    try:
        if sys.argv[1:] == ["agent"]:
            agent()
        else:
            run(int(sys.argv[1]), len(sys.argv) > 2 and sys.argv[2] == "manual")
    except TimeoutError:
        return  # Another updater owns the lock; its status remains authoritative.
    except Exception as error:
        state(state="error", message=str(error) if isinstance(error, UpdateError) else "The update could not finish. Your working version was kept; it will retry later.", checked=time.time() - 5 * 3600)


if __name__ == "__main__":
    main()
