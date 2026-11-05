import base64
import hashlib
import io
import json
import os
import stat
import shutil
import subprocess
import sys
import uuid
import zipfile
import time
from pathlib import Path

import pytest
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

from video_downloader import __version__, bootstrap, native, store, updater

NEXT_VERSION = ".".join([*__version__.split(".")[:2], str(int(__version__.split(".")[2]) + 1)])


@pytest.mark.parametrize('change', [None, 'external', 'child', 'permission', 'resource', 'missing'])
def test_unified_extension_keeps_one_manifest_and_private_pages(tmp_path, change):
    root = Path(__file__).resolve().parents[2]
    path = root / '.output/chrome-mv3/manifest.json'
    if not path.is_file():
        pytest.skip('Build the extension for the combined artifact policy test')
    value = json.loads(path.read_text())
    ext = tmp_path / 'extension'
    (ext / 'integration').mkdir(parents=True)
    (ext / 'integration/services.js').write_text('')
    (ext / 'manifest.json').write_text(json.dumps(value))
    if change == 'external': value['externally_connectable'] = {'matches': ['https://*/*']}
    if change == 'permission': value['permissions'].append('debugger')
    if change == 'resource': value['web_accessible_resources'][0]['resources'] = ['screenshot/preview.html']
    if change == 'child':
        (ext / 'child').mkdir()
        (ext / 'child/manifest.json').write_text('{}')
    if change == 'missing': (ext / 'integration/services.js').unlink()
    if change is None:
        updater.validate_unified_extension(tmp_path, value)
    else:
        with pytest.raises(updater.UpdateError, match='unified extension'):
            updater.validate_unified_extension(tmp_path, value)


@pytest.fixture
def signed():
    key = Ed25519PrivateKey.generate()
    public = key.public_key().public_bytes(serialization.Encoding.Raw, serialization.PublicFormat.Raw)
    value = {"schema": 1, "repository": updater.REPOSITORY, "version": NEXT_VERSION, "sha256": "a" * 64, "size": 123, "commit": "b" * 40, "minimumChrome": 127, "bootstrap": 1}
    def sign(value):
        raw = json.dumps(value, sort_keys=True).encode()
        return raw, base64.b64encode(key.sign(raw)), public
    return value, sign


def test_signatures_reject_tampering_and_other_publishers(signed):
    value, sign = signed
    raw, signature, public = sign(value)
    assert updater.verify_manifest(raw, signature, public) == value
    for body, sig, key in [(raw + b" ", signature, public), (raw, signature, b"x" * 32), (raw, b"invalid", public)]:
        with pytest.raises(updater.UpdateError, match="signature"):
            updater.verify_manifest(body, sig, key)


@pytest.mark.parametrize("change", [{"repository": "someone/else"}, {"version": "../evil"}, {"schema": 2}, {"size": updater.MAX_ARCHIVE + 1}, {"bootstrap": 99}])
def test_even_signed_invalid_manifests_are_rejected(signed, change):
    value, sign = signed
    with pytest.raises(updater.UpdateError):
        updater.verify_manifest(*sign({**value, **change}))


@pytest.mark.parametrize("url", ["http://github.com/test", "https://github.com.evil.test/", "https://user:password@github.com/", "https://127.0.0.1/", "file:///tmp/update", "https://github.com:444/update"])
def test_update_urls_reject_foreign_sources(url):
    with pytest.raises(updater.UpdateError): updater.safe_url(url)


@pytest.mark.parametrize("name", ["../outside", "/outside", "Video Downloader/../../outside", "Video Downloader/..\\outside"])
def test_archive_paths_cannot_escape(tmp_path, name):
    archive = tmp_path / "update.zip"
    with zipfile.ZipFile(archive, "w") as z: z.writestr(name, "bad")
    with pytest.raises(updater.UpdateError): updater.unpack(archive, tmp_path / "extract")
    assert not (tmp_path / "outside").exists()


def test_archive_rejects_symlinks_and_case_collisions(tmp_path):
    archive = tmp_path / "update.zip"
    link = zipfile.ZipInfo("Video Downloader/link")
    link.external_attr = (stat.S_IFLNK | 0o777) << 16
    with zipfile.ZipFile(archive, "w") as z: z.writestr(link, "../../outside")
    with pytest.raises(updater.UpdateError): updater.unpack(archive, tmp_path / "extract")
    with zipfile.ZipFile(archive, "w") as z:
        z.writestr("Video Downloader/a", "one")
        z.writestr("Video Downloader/A", "two")
    with pytest.raises(updater.UpdateError): updater.unpack(archive, tmp_path / "extract")


@pytest.fixture
def installed(tmp_path, monkeypatch):
    app = tmp_path / "friend with spaces"
    monkeypatch.setenv("VIDEO_DOWNLOADER_HOME", str(app))
    app.mkdir()
    extension = app / "extension"
    extension.mkdir()
    root = Path(__file__).resolve().parents[2]
    identity = json.loads((root / "extension-identity.json").read_text())
    manifest = {"key": identity["key"], "version": __version__, "permissions": ["storage"], "host_permissions": ["https://*/*"]}
    (extension / "manifest.json").write_text(json.dumps(manifest))
    (extension / "old.txt").write_text("working extension")
    return app, identity, manifest


def bundle(tmp_path, identity, manifest, version=NEXT_VERSION):
    root = tmp_path / "new bundle"
    (root / "extension").mkdir(parents=True)
    (root / "extension/manifest.json").write_text(json.dumps({**manifest, "version": version}))
    (root / "extension-identity.json").write_text(json.dumps(identity))
    (root / "helper-wheel").mkdir()
    (root / f"helper-wheel/video_downloader_helper-{version}-py3-none-any.whl").touch()
    (root / "update-requirements.txt").touch()
    return root


def test_update_waits_for_jobs_and_preserves_settings(installed, tmp_path, signed):
    app, identity, manifest = installed
    update, _ = signed
    new = bundle(tmp_path, identity, manifest)
    (app / "config.json").write_text('{"download_dir":"/friend/Downloads","auto_updates":true}')
    original_config = (app / "config.json").read_bytes()
    job, _ = store.create(str(uuid.uuid4()), "Playing video")
    assert updater.commit(new, update) is False
    assert (app / "extension/old.txt").read_text() == "working extension"
    assert bootstrap.pointer(app) is None
    store.update(job, state="done")
    assert updater.commit(new, update) is True
    assert bootstrap.pointer(app) == {"version": NEXT_VERSION}
    assert (app / "config.json").read_bytes() == original_config
    assert (app / "extension.previous/old.txt").exists()
    assert updater.status()["state"] == "ready"


def test_permission_expansion_needs_manual_install(installed, tmp_path, signed):
    _, identity, manifest = installed
    update, _ = signed
    new = bundle(tmp_path, identity, {**manifest, "permissions": ["storage", "debugger"]})
    with pytest.raises(updater.UpdateError, match="permissions"):
        updater.validate_bundle(new, update)


def test_optional_ad_permission_keeps_signed_updates_automatic(installed, tmp_path, signed):
    _, identity, manifest = installed
    update, _ = signed
    new = bundle(tmp_path, identity, {**manifest, "optional_permissions": ["declarativeNetRequestWithHostAccess"]})
    updater.validate_bundle(new, update)
    # Optional permissions still require Chrome's separate user gesture/grant.
    assert json.loads((new / "extension/manifest.json").read_text())["permissions"] == manifest["permissions"]


def test_failed_commit_restores_extension_and_runtime(installed, tmp_path, signed, monkeypatch):
    app, identity, manifest = installed
    update, _ = signed
    new = bundle(tmp_path, identity, manifest)
    old_rename = Path.rename
    def fail(source, target):
        if source == new / "extension": raise OSError("injected interrupted install")
        return old_rename(source, target)
    monkeypatch.setattr(Path, "rename", fail)
    with pytest.raises(OSError): updater.commit(new, update)
    assert (app / "extension/old.txt").read_text() == "working extension"
    assert bootstrap.pointer(app) is None
    assert not (app / "update-journal.json").exists()


def test_bootstrap_recovers_interrupted_commit(installed):
    app, _, _ = installed
    (app / "extension").rename(app / "extension.previous")
    (app / "extension").mkdir()
    bootstrap.atomic_json(app / "active-runtime.json", {"version": NEXT_VERSION})
    bootstrap.atomic_json(app / "update-journal.json", {"pointer": None})
    with bootstrap.locked(app): bootstrap.recover(app)
    assert (app / "extension/old.txt").exists()
    assert bootstrap.pointer(app) is None
    assert updater.status()["state"] == "error"


def test_old_runtime_cleanup_keeps_active_and_rollback_versions(installed):
    app, _, _ = installed
    for value in ["0.4.8", "0.4.9", "0.5.0"]: (app / "runtimes" / value).mkdir(parents=True)
    updater.prune_runtimes(app, {"0.4.9", "0.5.0"})
    assert sorted(p.name for p in (app / "runtimes").iterdir()) == ["0.4.9", "0.5.0"]


def test_turning_updates_off_preserves_working_install(installed, tmp_path, signed):
    app, identity, manifest = installed
    update, _ = signed
    new = bundle(tmp_path, identity, manifest)
    updater.configure(False)
    with pytest.raises(updater.UpdateError, match="turned off"): updater.commit(new, update)
    assert (app / "extension/old.txt").exists()
    assert updater.status()["enabled"] is False


def test_old_installs_get_one_time_migration_message(installed):
    result = native.handle({"id": "update", "type": "updates", "enabled": True})
    assert result["state"] == "manual"
    assert "once" in result["message"]


def test_mac_checks_use_the_registered_agent(installed, monkeypatch):
    app, _, _ = installed
    label = bootstrap.AGENT_LABEL + ".test." + "a" * 32
    (app / "bootstrap.py").touch()
    uv = app / "uv"
    uv.touch()
    bootstrap.atomic_json(app / "config.json", {"updater_uv": str(uv), "update_agent": label})
    monkeypatch.setattr(sys, "platform", "darwin")
    calls = []
    monkeypatch.setattr(updater.subprocess, "run", lambda args, **kwargs: calls.append(args))
    assert updater.start(force=True, chrome_version=156)["state"] == "checking"
    assert calls == [["/bin/launchctl", "kickstart", f"gui/{os.getuid()}/{label}"]]
    request = json.loads((app / "update-request.json").read_text())
    assert request["manual"] is True and request["chromeVersion"] == 156


def test_agent_respects_opt_out_and_consumes_manual_requests(installed, monkeypatch):
    app, _, _ = installed
    calls = []
    monkeypatch.setattr(updater, "run", lambda chrome, manual: calls.append((chrome, manual)))
    updater.configure(False, 156)
    updater.agent()
    assert calls == []
    bootstrap.atomic_json(app / "update-request.json", {"manual": True, "chromeVersion": 156, "created": time.time()})
    updater.agent()
    assert calls == [(156, True)]
    assert not (app / "update-request.json").exists()


def test_agent_interval_does_not_repeat_recent_checks(installed, monkeypatch):
    app, _, _ = installed
    calls = []
    monkeypatch.setattr(updater, "run", lambda chrome, manual: calls.append((chrome, manual)))
    updater.configure(True, 156)
    updater.state(state="current", message="Current", checked=time.time())
    updater.agent()
    assert calls == []
    bootstrap.atomic_json(app / "update-request.json", {"manual": False, "chromeVersion": 156, "created": time.time()})
    updater.agent()
    assert calls == [(156, False)]


def test_update_requests_cannot_supply_commands_or_urls():
    from pydantic import ValidationError
    for extra in [{"url": "https://evil.test"}, {"command": "anything"}, {"chromeVersion": 1}]:
        with pytest.raises(ValidationError):
            native.handle({"id": "update", "type": "updates", **extra})


def test_bootstrap_switches_to_selected_runtime(installed):
    app, _, _ = installed
    runtime = app / f"runtimes/{NEXT_VERSION}/.venv/bin"
    runtime.mkdir(parents=True)
    python = runtime / "python"
    python.symlink_to(sys.executable)
    bootstrap.atomic_json(app / "active-runtime.json", {"version": NEXT_VERSION})
    assert bootstrap.runtime_python(app) == python
    with bootstrap.locked(app):
        with pytest.raises(TimeoutError):
            with bootstrap.locked(app, timeout=0): pass


def test_signed_update_installs_real_runtime_and_switches_native_host(installed, tmp_path, signed, monkeypatch):
    """Real wheel/venv/hash-locked deps/native protocol; fake remote transport."""
    app, identity, manifest = installed
    update, sign = signed
    root = Path(__file__).resolve().parents[2]
    uv = shutil.which("uv")
    assert uv
    config = {"download_dir": str(tmp_path / "Downloads"), "updater_uv": uv, "auto_updates": True}
    bootstrap.atomic_json(app / "config.json", config)
    shutil.copy2(root / "helper/video_downloader/bootstrap.py", app / "bootstrap.py")
    package = tmp_path / "helper source"
    shutil.copytree(root / "helper/video_downloader", package / "video_downloader", ignore=shutil.ignore_patterns("__pycache__"))
    project = (root / "helper/pyproject.toml").read_text().replace(f'version = "{__version__}"', f'version = "{NEXT_VERSION}"')
    (package / "pyproject.toml").write_text(project)
    (package / "video_downloader/__init__.py").write_text(f'__version__ = "{NEXT_VERSION}"\n')
    new = bundle(tmp_path, identity, manifest)
    wheel = new / f"helper-wheel/video_downloader_helper-{NEXT_VERSION}-py3-none-any.whl"
    wheel.unlink()
    subprocess.run([uv, "build", "--wheel", "--out-dir", str(wheel.parent), str(package)], check=True, capture_output=True, timeout=120)
    requirements = subprocess.check_output([uv, "export", "--project", str(root / "helper"), "--no-dev", "--no-emit-project", "--no-header"], text=True)
    (new / "update-requirements.txt").write_text(requirements)
    data = io.BytesIO()
    with zipfile.ZipFile(data, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        for path in new.rglob("*"):
            if path.is_file(): archive.write(path, "Video Downloader/" + str(path.relative_to(new)))
    payload = data.getvalue()
    update.update(size=len(payload), sha256=hashlib.sha256(payload).hexdigest())
    raw, signature, public = sign(update)
    base = f"https://github.com/{updater.REPOSITORY}/releases/download/v{NEXT_VERSION}/"
    remote = {updater.API: json.dumps({"tag_name": f"v{NEXT_VERSION}", "assets": [{"name": name, "browser_download_url": base + name} for name in ["update.json", "update.json.sig", "Video-Downloader.zip"]]}).encode(), base + "update.json": raw, base + "update.json.sig": signature, base + "Video-Downloader.zip": payload}
    original_verify = updater.verify_manifest
    monkeypatch.setattr(updater, "verify_manifest", lambda raw, sig: original_verify(raw, sig, public))
    monkeypatch.setattr(updater, "fetch", lambda url, limit: remote[url])
    updater.run(127)
    assert updater.status()["state"] == "ready"
    assert bootstrap.pointer(app)["version"] == NEXT_VERSION
    request, output = io.BytesIO(), io.BytesIO()
    native.write_message(request, {"id": "ping", "type": "ping"})
    result = subprocess.run([sys.executable, str(app / "bootstrap.py"), f"chrome-extension://{updater.EXTENSION_ID}/"], input=request.getvalue(), capture_output=True, timeout=30, check=True)
    response = native.read_message(io.BytesIO(result.stdout))
    assert response["ok"] and response["result"]["version"] == NEXT_VERSION
    assert response["result"]["downloadDir"] == config["download_dir"]
    assert json.loads((app / "config.json").read_text()) == config


@pytest.mark.parametrize('change', [None, {'version': '99.0.0'}, {'permissions': ['contextMenus', 'storage', 'alarms', 'cookies']}, {'host_permissions': ['<all_urls>']}, {'optional_permissions': ['tabs']}, {'content_scripts': [{'matches': ['<all_urls>'], 'js': ['background.js']}]}, {'externally_connectable': {'matches': ['https://*/*']}}])
def test_audio_companion_update_identity_permissions_and_shared_version(installed, tmp_path, signed, change):
    app, identity, manifest = installed
    update, _ = signed
    from video_downloader.config import AUDIO_COMPANION_ID, EXTENSION_ID
    manifest = {**manifest, 'externally_connectable': {'ids': [AUDIO_COMPANION_ID]}}
    new = bundle(tmp_path, identity, manifest)
    source = Path(__file__).resolve().parents[2] / 'companion/audio/identity.json'
    child_identity = json.loads(source.read_text())
    child = new / 'extension/audio-companion/manifest.json'
    child.parent.mkdir()
    data = {'key': child_identity['key'], 'version': update['version'], 'permissions': ['contextMenus', 'storage', 'alarms'], 'externally_connectable': {'ids': [EXTENSION_ID]}}
    if change: data.update(change)
    child.write_text(json.dumps(data))
    if change:
        with pytest.raises(updater.UpdateError, match='audio companion'): updater.validate_bundle(new, update)
    else:
        assert updater.validate_bundle(new, update).name.endswith('.whl')


@pytest.fixture
def youtube_bundle(tmp_path, installed, signed):
    _, identity, manifest = installed
    update, _ = signed
    new = bundle(tmp_path, identity, manifest)
    root = Path(__file__).resolve().parents[2]
    # Build this manifest from source to keep pytest independent of npm build.
    source = root / 'companion/youtube'
    child = new / 'extension/youtube-companion'
    shutil.copytree(source / 'upstream', child)
    value = json.loads((child / 'manifest.json').read_text())
    value.update(key=json.loads((source / 'identity.json').read_text())['key'], version=update['version'], externally_connectable={'ids': [updater.EXTENSION_ID]})
    value['content_security_policy']['extension_pages'] = value['content_security_policy']['extension_pages'].replace("connect-src 'none'", "connect-src 'self'")
    (child / 'manifest.json').write_text(json.dumps(value))
    return new, update, child, value


def test_youtube_companion_keeps_its_narrow_boundary(youtube_bundle):
    new, update, _, _ = youtube_bundle
    assert updater.validate_bundle(new, update).suffix == '.whl'


@pytest.mark.parametrize('change', [
    {'permissions': ['declarativeNetRequest', 'scripting', 'storage', 'cookies']},
    {'permissions': ['declarativeNetRequest', 'scripting', 'storage', 'nativeMessaging']},
    {'host_permissions': ['https://*/*']},
    {'optional_permissions': ['tabs']},
    {'optional_host_permissions': ['<all_urls>']},
    {'externally_connectable': {'ids': ['*']}},
    {'externally_connectable': {'ids': [updater.EXTENSION_ID], 'matches': ['https://www.youtube.com/*']}},
    {'content_security_policy': {'extension_pages': "script-src 'self'; connect-src https://evil.test"}},
    {'web_accessible_resources': [{'resources': ['*.js'], 'matches': ['<all_urls>']}]},
    {'update_url': 'https://evil.test/update'},
    {'content_scripts': [{'matches': ['<all_urls>'], 'js': ['main.js']}]},
    {'background': {'service_worker': 'unreviewed.js'}},
    {'key': 'invalid-key'}, {'version': '0.0.1'},
])
def test_youtube_companion_rejects_privilege_and_identity_changes(youtube_bundle, change):
    new, update, child, value = youtube_bundle
    (child / 'manifest.json').write_text(json.dumps({**value, **change}))
    with pytest.raises(updater.UpdateError, match='privacy boundary'):
        updater.validate_bundle(new, update)


@pytest.mark.parametrize('rules', [[], None, [{'action': {'type': 'redirect'}, 'condition': {'initiatorDomains': ['www.youtube.com']}}], [{'action': {'type': 'block'}, 'condition': {}}], [{'action': {'type': 'block'}, 'condition': {'initiatorDomains': ['evil.test']}}], [{'action': {'type': 'block'}, 'condition': []}]])
def test_youtube_rules_cannot_redirect_or_expand_to_other_sites(youtube_bundle, rules):
    new, update, child, _ = youtube_bundle
    (child / 'rules.json').write_text(json.dumps(rules))
    with pytest.raises(updater.UpdateError, match='privacy boundary'):
        updater.validate_bundle(new, update)


def test_update_cannot_silently_drop_existing_youtube_companion(youtube_bundle, installed):
    new, update, child, _ = youtube_bundle
    app, _, _ = installed
    shutil.copytree(child, app / 'extension/youtube-companion')
    shutil.rmtree(child)
    with pytest.raises(updater.UpdateError, match='missing'):
        updater.validate_bundle(new, update)


@pytest.fixture
def screenshot_bundle(tmp_path, installed, signed):
    _, identity, manifest = installed
    update, _ = signed
    new = bundle(tmp_path, identity, manifest)
    root = Path(__file__).resolve().parents[2]
    source = root / 'companion/screenshot'
    child = new / 'extension/screenshot-companion'
    shutil.copytree(source / 'upstream', child)
    value = json.loads((child / 'manifest.json').read_text())
    value.update(key=json.loads((source / 'identity.json').read_text())['key'], version=update['version'], externally_connectable={'ids': [updater.EXTENSION_ID]})
    value['content_security_policy']['extension_pages'] = value['content_security_policy']['extension_pages'].replace("connect-src 'none'", "connect-src 'self'")
    (child / 'manifest.json').write_text(json.dumps(value))
    return new, update, child, value


def test_screenshot_companion_keeps_its_click_only_boundary(screenshot_bundle):
    new, update, _, _ = screenshot_bundle
    assert updater.validate_bundle(new, update).suffix == '.whl'


@pytest.mark.parametrize('change', [
    {'permissions': ['activeTab', 'scripting', 'contextMenus', 'cookies']},
    {'permissions': ['activeTab', 'scripting', 'contextMenus', 'downloads']},
    {'permissions': ['activeTab', 'scripting', 'contextMenus', 'nativeMessaging']},
    {'host_permissions': ['https://*/*']}, {'optional_permissions': ['tabs']},
    {'optional_host_permissions': ['<all_urls>']},
    {'externally_connectable': {'ids': ['*']}},
    {'externally_connectable': {'ids': [updater.EXTENSION_ID], 'matches': ['https://*/*']}},
    {'content_security_policy': {'extension_pages': "script-src 'self'; connect-src https://evil.test"}},
    {'web_accessible_resources': [{'resources': ['*.js'], 'matches': ['<all_urls>']}]},
    {'update_url': 'https://evil.test/update'},
    {'content_scripts': [{'matches': ['<all_urls>'], 'js': ['page.js']}]},
    {'background': {'service_worker': 'other.js', 'type': 'module'}},
    {'incognito': 'spanning'}, {'key': 'invalid'}, {'version': '99.0.0'},
])
def test_screenshot_companion_rejects_privilege_and_identity_changes(screenshot_bundle, change):
    new, update, child, value = screenshot_bundle
    value.update(change); (child / 'manifest.json').write_text(json.dumps(value))
    with pytest.raises(updater.UpdateError, match='screenshot companion'):
        updater.validate_bundle(new, update)


def test_update_cannot_drop_an_installed_screenshot_companion(screenshot_bundle, installed):
    new, update, child, _ = screenshot_bundle
    app, _, _ = installed
    shutil.copytree(child, app / 'extension/screenshot-companion')
    shutil.rmtree(child)
    with pytest.raises(updater.UpdateError, match='screenshot companion is missing'):
        updater.validate_bundle(new, update)


@pytest.fixture
def protection_bundle(tmp_path, signed, installed):
    _, identity, manifest = installed
    update, _ = signed
    new = bundle(tmp_path, identity, manifest)
    root = Path(__file__).resolve().parents[2]
    source = root / 'companion/protection'
    child = new / 'extension/protection-companion'
    child.mkdir()
    value = json.loads((source / 'upstream/chromium/manifest.json').read_text())
    value.update(key=json.loads((source / 'identity.json').read_text())['key'], version=update['version'], externally_connectable={'ids': [updater.EXTENSION_ID]}, background={'service_worker': 'bundle-bridge.js', 'type': 'module'})
    (child / 'manifest.json').write_text(json.dumps(value))
    return new, update, child, value


def test_protection_companion_retains_filtering_permissions(protection_bundle):
    new, update, _, _ = protection_bundle
    assert updater.validate_bundle(new, update).suffix == '.whl'


@pytest.mark.parametrize('change', [
    {'permissions': ['cookies', 'nativeMessaging']},
    {'optional_permissions': ['downloads']},
    {'externally_connectable': {'ids': ['*']}},
    {'web_accessible_resources': [{'resources': ['/bundle-bridge.js'], 'matches': ['<all_urls>'], 'use_dynamic_url': True}]},
    {'update_url': 'https://evil.test/update'},
    {'background': {'service_worker': 'other.js', 'type': 'module'}},
    {'key': 'invalid'}, {'version': '99.0.0'},
])
def test_protection_companion_rejects_changed_boundary(protection_bundle, change):
    new, update, child, value = protection_bundle
    value.update(change); (child / 'manifest.json').write_text(json.dumps(value))
    with pytest.raises(updater.UpdateError, match='ad protection companion'):
        updater.validate_bundle(new, update)


def test_update_cannot_drop_installed_protection(protection_bundle, installed):
    new, update, child, _ = protection_bundle
    app, _, _ = installed
    shutil.copytree(child, app / 'extension/protection-companion')
    shutil.rmtree(child)
    with pytest.raises(updater.UpdateError, match='ad protection companion is missing'):
        updater.validate_bundle(new, update)
