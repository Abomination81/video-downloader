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
    shutil.copytree(ROOT / ".output/chrome-mv3", bundle / "extension")
    (bundle / "scripts").mkdir()
    for name in ("install.py", "install-windows.ps1", "uninstall.py"):
        shutil.copy2(ROOT / "scripts" / name, bundle / "scripts" / name)
    shutil.copy2(ROOT / "helper/video_downloader/bootstrap.py", bundle / "scripts/native_bootstrap.py")
    for name in ("Install.command", "Install-Windows.cmd", "Update-engine.command", "Update-engine-Windows.cmd", "Uninstall.command", "Uninstall-Windows.cmd", "extension-identity.json", "README.md", "CHANGELOG.md", "SECURITY.md", "LICENSE"):
        shutil.copy2(ROOT / name, bundle / name)
    shutil.copytree(ROOT / "companion/youtube", bundle / "youtube-companion-source/companion/youtube")
    (bundle / "youtube-companion-source/scripts").mkdir()
    shutil.copy2(ROOT / "scripts/build-youtube-companion.mjs", bundle / "youtube-companion-source/scripts/build-youtube-companion.mjs")
    for name in ("package.json", "extension-identity.json"):
        shutil.copy2(ROOT / name, bundle / "youtube-companion-source" / name)
    shutil.copy2(ROOT / "BUNDLE-LICENSES.md", bundle / "BUNDLE-LICENSES.md")
    shutil.copytree(ROOT / "companion/protection", bundle / "protection-companion-source/companion/protection")
    (bundle / "protection-companion-source/scripts").mkdir()
    shutil.copy2(ROOT / "scripts/build-protection-companion.mjs", bundle / "protection-companion-source/scripts/build-protection-companion.mjs")
    for name in ("package.json", "extension-identity.json"):
        shutil.copy2(ROOT / name, bundle / "protection-companion-source" / name)
    shutil.copytree(ROOT / "filters", bundle / "adblock-source/filters")
    (bundle / "adblock-source/scripts/lib").mkdir(parents=True)
    shutil.copy2(ROOT / "scripts/lib/compile-ad-filters.mjs", bundle / "adblock-source/scripts/lib/compile-ad-filters.mjs")
    shutil.copy2(ROOT / "scripts/build-adblock.mjs", bundle / "adblock-source/scripts/build-adblock.mjs")
    shutil.copytree(ROOT / "extension/adblock", bundle / "adblock-source/extension/adblock")
    (bundle / "adblock-source/extension/lib").mkdir()
    shutil.copy2(ROOT / "extension/lib/pluto-filter.ts", bundle / "adblock-source/extension/lib/pluto-filter.ts")
    shutil.copy2(ROOT / "package.json", bundle / "adblock-source/package.json")
    shutil.copy2(ROOT / "package-lock.json", bundle / "adblock-source/package-lock.json")
    shutil.copytree(ROOT / "companion/screenshot", bundle / "screenshot-companion-source/companion/screenshot")
    (bundle / "screenshot-companion-source/scripts").mkdir()
    shutil.copy2(ROOT / "scripts/build-screenshot-companion.mjs", bundle / "screenshot-companion-source/scripts/build-screenshot-companion.mjs")
    for name in ("package.json", "extension-identity.json"):
        shutil.copy2(ROOT / name, bundle / "screenshot-companion-source" / name)
    # Companion builders share the checked-in artwork and remain reproducible offline.
    for directory in ("youtube-companion-source", "screenshot-companion-source", "protection-companion-source"):
        public = bundle / directory / "extension/public"
        (public / "brand").mkdir(parents=True)
        shutil.copy2(ROOT / "extension/public/brand/mark.svg", public / "brand/mark.svg")
        for size in (16, 32, 48, 128):
            shutil.copy2(ROOT / f"extension/public/icon-{size}.png", public / f"icon-{size}.png")
    shutil.copytree(ROOT / "docs", bundle / "docs", ignore=shutil.ignore_patterns(".hallmark", ".DS_Store", "__pycache__"))
    # GPL source stays included in a standard ZIP, without exceeding the entry
    # cap in already-installed helpers. Chrome only needs the runtime tree.
    source = bundle / "protection-companion-source"
    with zipfile.ZipFile(bundle / "protection-companion-source.zip", "w", compression=zipfile.ZIP_DEFLATED) as source_zip:
        for path in sorted(source.rglob("*")):
            if path.is_file():
                source_zip.write(path, str(path.relative_to(bundle)))
    shutil.rmtree(source)
    files = [path for path in bundle.rglob("*") if path.is_file()]
    if len(files) > 1000 or sum(path.stat().st_size for path in files) > 128 * 1024 * 1024:
        raise RuntimeError("Bundle exceeds the oldest supported updater's archive limits")
    archive = output / "Video-Downloader.zip"
    with zipfile.ZipFile(archive, "w", compression=zipfile.ZIP_DEFLATED) as zip_file:
        for path in sorted(bundle.rglob("*")):
            if path.is_file():
                zip_file.write(path, str(path.relative_to(output)))
    print(archive)


if __name__ == "__main__":
    main()
