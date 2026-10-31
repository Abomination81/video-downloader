"""Publish all signed assets together, after the main-branch checks pass."""
import json
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
REPOSITORY = "Abomination81/video-downloader"


def main():
    version = json.loads((ROOT / "package.json").read_text())["version"]
    tag = "v" + version
    head = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=ROOT, text=True).strip()
    existing = subprocess.run(["gh", "release", "view", tag, "--repo", REPOSITORY, "--json", "isDraft,targetCommitish"], capture_output=True, text=True)
    if existing.returncode == 0:
        release = json.loads(existing.stdout)
        if not release["isDraft"]:
            print(f"{tag} is already published; its assets were left intact.")
            return
        if release["targetCommitish"] != head:
            raise RuntimeError("A draft for this version targets a different commit")
    else:
        notes = ROOT / f"docs/RELEASE-{tag}.md"
        if not notes.exists():
            notes = ROOT / "dist/release-notes.md"
            notes.write_text(f"Video Downloader {tag}. Built by [Abomination81](https://abomination81.com).\n\nSigned automatic update. Finished downloads and settings are kept.\n\nSee [Changelog](https://github.com/{REPOSITORY}/blob/main/CHANGELOG.md) for changes.\n")
        subprocess.run(["gh", "release", "create", tag, "--repo", REPOSITORY, "--draft", "--target", head, "--title", f"Video Downloader {tag}", "--notes-file", str(notes)], check=True)
    assets = [str(ROOT / "dist" / name) for name in ["Video-Downloader.zip", "SHA256SUMS.txt", "update.json", "update.json.sig"]]
    subprocess.run(["gh", "release", "upload", tag, "--repo", REPOSITORY, "--clobber", *assets], check=True)
    subprocess.run(["gh", "release", "edit", tag, "--repo", REPOSITORY, "--draft=false", "--latest"], check=True)


if __name__ == "__main__":
    main()
