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
    shutil.copytree(ROOT / ".output/chrome-mv3", bundle / "extension")
    (bundle / "scripts").mkdir()
    for name in ("install.py", "install-windows.ps1", "uninstall.py"):
        shutil.copy2(ROOT / "scripts" / name, bundle / "scripts" / name)
    for name in ("Install.command", "Install-Windows.cmd", "Update-engine.command", "Update-engine-Windows.cmd", "Uninstall.command", "Uninstall-Windows.cmd", "extension-identity.json", "README.md", "CHANGELOG.md", "SECURITY.md", "LICENSE"):
        shutil.copy2(ROOT / name, bundle / name)
    shutil.copytree(ROOT / "docs", bundle / "docs")
    archive = output / "Video-Downloader.zip"
    with zipfile.ZipFile(archive, "w", compression=zipfile.ZIP_DEFLATED) as zip_file:
        for path in sorted(bundle.rglob("*")):
            if path.is_file():
                zip_file.write(path, str(path.relative_to(output)))
    print(archive)


if __name__ == "__main__":
    main()
