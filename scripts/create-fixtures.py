"""Build deterministic test media shared by Python and browser checks."""
import importlib.util
import subprocess
from pathlib import Path
from PIL import Image, ImageCms

root = Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location("fixture_definitions", root / "helper/tests/conftest.py")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
destination = root / "output/fixtures"
destination.mkdir(parents=True, exist_ok=True)


class Factory:
    def mktemp(self, _):
        return destination


if not all((destination / name).exists() for name in ("master.m3u8", "dash/manifest.mpd", "source.mp4")):
    module.media_files.__wrapped__(Factory())
profile = ImageCms.ImageCmsProfile(ImageCms.createProfile('sRGB')).tobytes()
for name, size in [('preview.jpg', (160, 96)), ('original.jpg', (1200, 720))]:
    path = destination / name
    Image.new('RGB', size, (120, 40, 70)).save(path, icc_profile=profile)
    subprocess.run(['exiftool', '-overwrite_original', '-Artist=PRIVATE_AUTHOR', '-Comment=PRIVATE_COMMENT', '-GPSLatitude=37.2', '-GPSLongitude=-122.1', '-Orientation#=6', str(path)], check=True, capture_output=True)
print(destination)
