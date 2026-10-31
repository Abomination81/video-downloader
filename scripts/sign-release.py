"""Sign exact release bytes. The private key is supplied only by Actions."""
import base64
import hashlib
import json
import os
import re
import subprocess
from pathlib import Path

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from video_downloader.bootstrap import VERSION

ROOT = Path(__file__).resolve().parent.parent


def main():
    archive = ROOT / "dist/Video-Downloader.zip"
    version = json.loads((ROOT / "package.json").read_text())["version"]
    manifest = json.loads((ROOT / ".output/chrome-mv3/manifest.json").read_text())
    if not re.fullmatch(r"\d+\.\d+\.\d+", version) or manifest["version"] != version:
        raise RuntimeError("Release versions do not match")
    commit = subprocess.check_output(["git", "rev-parse", "HEAD"], text=True, cwd=ROOT).strip()
    key = serialization.load_pem_private_key(os.environ["UPDATE_SIGNING_KEY"].encode(), password=None)
    if not isinstance(key, Ed25519PrivateKey):
        raise RuntimeError("Invalid release signing key type")
    public = key.public_key().public_bytes(serialization.Encoding.Raw, serialization.PublicFormat.Raw)
    pinned = json.loads((ROOT / "helper/video_downloader/update-key.json").read_text())["publicKey"]
    if base64.b64encode(public).decode() != pinned:
        raise RuntimeError("Release signing key does not match the pinned public key")
    digest = hashlib.sha256(archive.read_bytes()).hexdigest()
    payload = {"schema": 1, "repository": "Abomination81/video-downloader", "version": version, "sha256": digest, "size": archive.stat().st_size, "commit": commit, "minimumChrome": int(manifest["minimum_chrome_version"]), "bootstrap": VERSION}
    raw = json.dumps(payload, sort_keys=True, separators=(",", ":")).encode()
    (ROOT / "dist/update.json").write_bytes(raw)
    (ROOT / "dist/update.json.sig").write_bytes(base64.b64encode(key.sign(raw)))
    (ROOT / "dist/SHA256SUMS.txt").write_text(f"{digest}  Video-Downloader.zip\n")
    print(f"Signed Video Downloader {version}")


if __name__ == "__main__":
    main()
