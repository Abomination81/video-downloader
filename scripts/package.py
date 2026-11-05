import json
import shutil
import subprocess
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def main():
    output = ROOT / "dist"
    bundle = output / "Video Downloader"
    shutil.rmtree(bundle, ignore_errors=True)
    bundle.mkdir(parents=True)
    subprocess.run(["uv", "build", "--wheel", "--out-dir", str(bundle / "helper-wheel"), str(ROOT / "helper")], check=True)
    requirements = subprocess.run(["uv", "export", "--project", str(ROOT / "helper"), "--no-dev", "--no-emit-project", "--no-hashes", "--no-header"], capture_output=True, text=True, check=True).stdout
    (bundle / "runtime-requirements.txt").write_text(requirements)
    update_requirements = subprocess.run(["uv", "export", "--project", str(ROOT / "helper"), "--no-dev", "--no-emit-project", "--no-header"], capture_output=True, text=True, check=True).stdout
    (bundle / "update-requirements.txt").write_text(update_requirements)
    shutil.copytree(ROOT / ".output/chrome-mv3", bundle / "extension", ignore=shutil.ignore_patterns("_metadata", ".DS_Store"))
    (bundle / "scripts").mkdir()
    for name in ("install.py", "install-windows.ps1", "uninstall.py"):
        shutil.copy2(ROOT / "scripts" / name, bundle / "scripts" / name)
    shutil.copy2(ROOT / "helper/video_downloader/bootstrap.py", bundle / "scripts/native_bootstrap.py")
    for name in ("Install.command", "Install-Windows.cmd", "Update-engine.command", "Update-engine-Windows.cmd", "Uninstall.command", "Uninstall-Windows.cmd", "extension-identity.json", "README.md", "CHANGELOG.md", "SECURITY.md", "LICENSE", "LICENSE-GPL-3.0"):
        shutil.copy2(ROOT / name, bundle / name)
    shutil.copy2(ROOT / "BUNDLE-LICENSES.md", bundle / "BUNDLE-LICENSES.md")
    # Preserve third-party source and notices without exhausting old updater
    # entry limits. Dependencies are pinned by package-lock.json.
    with zipfile.ZipFile(bundle / "browsing-source.zip", "w", compression=zipfile.ZIP_DEFLATED) as source_zip:
        for package in ("@duckduckgo/autoconsent", "tesseract.js", "tesseract.js-core", "@tesseract.js-data/eng"):
            for path in sorted((ROOT / "node_modules" / package).rglob("*")):
                if path.is_file():
                    source_zip.write(path, str(Path("browsing-source/dependencies") / path.relative_to(ROOT / "node_modules")))
        for name in ("package.json", "package-lock.json", "BUNDLE-LICENSES.md", "scripts/build-browsing.mjs"):
            source_zip.write(ROOT / name, "browsing-source/" + name)
    # GPL complete corresponding source includes the integrated downloader,
    # pinned engine distribution/source, local modifications, tests and builders.
    with zipfile.ZipFile(bundle / "extension-source.zip", "w", compression=zipfile.ZIP_DEFLATED) as source_zip:
        names = subprocess.check_output(["git", "ls-files", "--cached", "--others", "--exclude-standard"], cwd=ROOT, text=True).splitlines()
        for name in sorted(set(names)):
            path = ROOT / name
            if path.is_file() and not name.startswith(("docs/validation/", "docs/.hallmark/")):
                source_zip.write(path, "video-downloader/" + name)
    shutil.copytree(ROOT / "docs", bundle / "docs", ignore=shutil.ignore_patterns(".hallmark", ".DS_Store", "__pycache__"))
    files = [path for path in bundle.rglob("*") if path.is_file()]
    if len(files) > 1000 or sum(path.stat().st_size for path in files) > 128 * 1024 * 1024:
        raise RuntimeError("Bundle exceeds the oldest supported updater's archive limits")
    archive = output / "Video-Downloader.zip"
    with zipfile.ZipFile(archive, "w", compression=zipfile.ZIP_DEFLATED) as zip_file:
        for path in sorted(bundle.rglob("*")):
            if path.is_file():
                zip_file.write(path, str(path.relative_to(output)))
    if archive.stat().st_size > 64 * 1024 * 1024:
        raise RuntimeError("Signed archive exceeds the 64 MiB updater limit")
    print(archive)


if __name__ == "__main__":
    main()
