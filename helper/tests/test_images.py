import hashlib
import io
import functools
import http.server
import json
import shutil
import subprocess
import uuid
import threading
from pathlib import Path

import pytest
from PIL import Image, ImageCms

from video_downloader import delivery, store
from video_downloader.images import decoded_signature, exif, neutral_icc, sanitize_image, tags, value
from video_downloader.media import MediaError
from video_downloader.models import CleanImage, Start
from video_downloader.worker import run_job


@pytest.fixture
def pictures(tmp_path):
    root = tmp_path / "pictures"
    root.mkdir()
    image = Image.new("RGB", (80, 48), (120, 40, 70))
    profile = bytearray(ImageCms.ImageCmsProfile(ImageCms.createProfile('sRGB')).tobytes())
    profile[48:52] = b"PRIV"
    profile[52:56] = b"USER"
    profile[80:84] = b"NAME"
    for name, fmt in [('jpg', 'JPEG'), ('png', 'PNG'), ('webp', 'WEBP'), ('tiff', 'TIFF'), ('avif', 'AVIF')]:
        path = root / ('source.' + name)
        kwargs = {'icc_profile': bytes(profile)}
        image.save(path, format=fmt, **kwargs)
        subprocess.run(['exiftool', '-overwrite_original', '-Artist=PRIVATE_AUTHOR', '-Comment=PRIVATE_COMMENT', '-GPSLatitude=37.2', '-GPSLongitude=-122.1', '-DateTimeOriginal=2020:01:02 03:04:05', '-Orientation#=6', str(path)], check=True, capture_output=True)
    frames = [Image.new('RGB', (48, 32), color) for color in ['red', 'green', 'blue']]
    for name, fmt in [('gif', 'GIF'), ('webp', 'WEBP'), ('png', 'PNG')]:
        path = root / ('animated.' + name)
        frames[0].save(path, format=fmt, save_all=True, append_images=frames[1:], duration=[80, 120, 160], loop=2, comment=b'PRIVATE_COMMENT')
        if name != 'gif': subprocess.run(['exiftool', '-overwrite_original', '-Comment=PRIVATE_COMMENT', '-Artist=PRIVATE_AUTHOR', str(path)], check=True, capture_output=True)
    return root


@pytest.mark.parametrize('ext', ['jpg', 'png', 'webp', 'tiff', 'avif'])
def test_image_metadata_removed_without_changing_pixels_orientation_or_color(pictures, tmp_path, ext):
    source = pictures / ('source.' + ext)
    original = source.read_bytes()
    folder = tmp_path / 'clean'
    folder.mkdir()
    target, info = sanitize_image(source, folder)
    assert source.read_bytes() == original
    assert info['width'] == 80 and info['height'] == 48
    result = tags(target)
    assert not any(any(word in key.lower() for word in ['gps', 'artist', 'author', 'comment', 'datetimeoriginal']) for key in result)
    assert b'PRIVATE_' not in target.read_bytes()
    assert value(result, 'Orientation') == 6
    before_icc, after_icc = exif(source, '-b', '-ICC_Profile'), exif(target, '-b', '-ICC_Profile')
    assert after_icc == neutral_icc(before_icc)
    assert b'PRIV' not in after_icc and b'USER' not in after_icc and b'NAME' not in after_icc
    with Image.open(source) as before, Image.open(target) as after:
        assert before.size == after.size and before.tobytes() == after.tobytes()
        first = ImageCms.profileToProfile(before.convert('RGB'), ImageCms.ImageCmsProfile(io.BytesIO(before_icc)), ImageCms.createProfile('sRGB'))
        second = ImageCms.profileToProfile(after.convert('RGB'), ImageCms.ImageCmsProfile(io.BytesIO(after_icc)), ImageCms.createProfile('sRGB'))
        assert first.tobytes() == second.tobytes()


@pytest.mark.parametrize('ext', ['gif', 'webp', 'png'])
def test_animation_frames_timing_and_loop_survive_cleanup(pictures, tmp_path, ext):
    source = pictures / ('animated.' + ext)
    folder = tmp_path / 'clean'
    folder.mkdir()
    target, _ = sanitize_image(source, folder)
    assert decoded_signature(source) == decoded_signature(target)
    assert b'PRIVATE_' not in target.read_bytes()


def test_static_svg_keeps_drawing_but_removes_editor_and_descriptive_metadata(tmp_path):
    source = tmp_path/'source.svg'
    source.write_text('<svg xmlns="http://www.w3.org/2000/svg" xmlns:ink="http://www.inkscape.org/namespaces/inkscape" width="80" height="48" ink:label="PRIVATE_LABEL"><metadata>PRIVATE_AUTHOR</metadata><title>PRIVATE_TITLE</title><!-- PRIVATE_COMMENT --><path d="M0 0h80v48H0z" fill="#772211"/></svg>')
    target, info = sanitize_image(source, tmp_path)
    assert info['format'] == 'SVG'
    assert b'PRIVATE_' not in target.read_bytes()
    assert b'M0 0h80v48H0z' in target.read_bytes()


@pytest.mark.parametrize('content', ['<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>', '<!DOCTYPE svg [<!ENTITY private "PRIVATE_VALUE">]><svg xmlns="http://www.w3.org/2000/svg">&private;</svg>', '<svg xmlns="http://www.w3.org/2000/svg"><rect><animate attributeName="fill" values="red;blue" dur="1s"/></rect></svg>', '<svg xmlns="http://www.w3.org/2000/svg"><rect style="fill:url(https://example.com/paint.svg#color)"/></svg>'])
def test_active_or_entity_svg_is_never_published_as_clean(tmp_path, content):
    source = tmp_path/'source.svg'
    source.write_text(content)
    with pytest.raises(MediaError): sanitize_image(source, tmp_path)


def test_existing_saved_image_is_replaced_atomically_in_place(isolated_app, pictures, tmp_path):
    path = tmp_path/'Chosen filename.jpg'
    shutil.copyfile(pictures/'source.jpg', path)
    request = CleanImage(id='test', type='clean-image', requestId=str(uuid.uuid4()), path=str(path))
    job, _ = store.create(request.requestId, 'Saved image', 'cleanup')
    run_job(request, job)
    assert store.get(job)['state'] == 'done', store.get(job)
    assert path.exists() and b'PRIVATE_' not in path.read_bytes()
    assert delivery.final_file(job) == path
    assert not list(tmp_path.glob('.vd-image-*'))


def test_cleanup_is_idempotent_and_has_capacity_during_three_video_downloads(isolated_app):
    for _ in range(3): store.create(str(uuid.uuid4()), 'Video')
    key = str(uuid.uuid4())
    first, created = store.create(key, 'Saved image', 'cleanup')
    second, duplicate = store.create(key, 'Saved image', 'cleanup')
    assert first == second and created and not duplicate


def test_failed_automatic_cleanup_keeps_the_original_file(isolated_app, tmp_path):
    path = tmp_path/'Original drawing.svg'
    original = b'<svg xmlns="http://www.w3.org/2000/svg"><metadata>PRIVATE_AUTHOR</metadata><script>alert(1)</script></svg>'
    path.write_bytes(original)
    request = CleanImage(id='test', type='clean-image', requestId=str(uuid.uuid4()), path=str(path))
    job, _ = store.create(request.requestId, 'Saved image', 'cleanup')
    run_job(request, job)
    assert store.get(job)['state'] == 'error'
    assert path.read_bytes() == original
    assert not list(tmp_path.glob('.vd-image-*'))


def test_image_download_uses_the_original_file_and_generic_chrome_delivery(isolated_app, pictures, tmp_path):
    class Handler(http.server.SimpleHTTPRequestHandler):
        def log_message(self, *_): pass
    server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(Handler, directory=str(pictures)))
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        payload = Start(id='image', type='start', requestId=str(uuid.uuid4()), title='Original image', assetType='image', browserDownload=True, sources=[{'url': f'http://127.0.0.1:{server.server_port}/source.jpg', 'kind': 'file'}])
        job, _ = store.create(payload.requestId, payload.title)
        run_job(payload, job)
        row = store.get(job)
        assert row['state'] == 'ready', row
        assert row['filename'].startswith('Image ') and row['filename'].endswith('.jpg')
        info = delivery.receipt(job)
        assert info['mime'] == 'image/jpeg'
        destination = tmp_path / row['filename']
        shutil.copyfile(delivery.prepared_file(job), destination)
        delivery.finish(job, str(destination))
        assert store.get(job)['state'] == 'done'
        assert b'PRIVATE_' not in destination.read_bytes()
        assert not delivery.prepared_file(job).exists()
    finally:
        server.shutdown()
        thread.join()
