import json
import struct
import time
import uuid
from pathlib import Path

import pytest
from PIL import Image

from conftest import ffmpeg
from video_downloader import delivery, formats, store
from video_downloader.media import Cancelled, MediaError, probe
from video_downloader.models import Inspect, Start
from video_downloader.mp3 import audio_hash, clean, frames
from video_downloader.worker import run_job


def payload(url, cls=Start, **options):
    return cls(id='test', type='inspect' if cls is Inspect else 'start', requestId=str(uuid.uuid4()), sources=[{'url': url, 'kind': 'manifest'}], **options)


@pytest.mark.parametrize('bitrate', [128, 192, 256, 320])
def test_mp3_encoding_removes_metadata_and_preserves_duration(media_files, tmp_path, bitrate):
    target = tmp_path / 'clean.mp3'
    result = clean(media_files / 'source.mp4', target, bitrate)
    assert result['bitrate'] == bitrate and not result['copied']
    info = probe(target)
    assert len(info['streams']) == 1 and info['streams'][0]['codec_name'] == 'mp3'
    assert info['streams'][0]['sample_rate'] == '48000'
    assert not info['format'].get('tags') and not info['streams'][0].get('tags')
    assert not info['chapters'] and b'PRIVATE_' not in target.read_bytes()
    assert abs(float(info['format']['duration']) - 1.5) < .15


def test_original_mp3_preserves_decoded_audio_without_id3_art_or_ape(media_files, tmp_path):
    cover = tmp_path / 'cover.png'
    Image.new('RGB', (32, 32), 'green').save(cover)
    source, target = tmp_path / 'tagged.mp3', tmp_path / 'clean.mp3'
    ffmpeg('-i', media_files / 'source.mp4', '-i', cover, '-map', '0:a:0', '-map', '1:v', '-c:a', 'libmp3lame', '-q:a', '0', '-c:v', 'copy', '-disposition:v', 'attached_pic', '-metadata', 'title=PRIVATE_TITLE', '-metadata', 'artist=PRIVATE_ARTIST', '-metadata', 'comment=PRIVATE_COMMENT', '-id3v2_version', '3', '-write_id3v1', '1', source)
    # Real APEv2 item/footer in addition to ID3v2, ID3v1 and attached artwork.
    item = struct.pack('<II', 14, 0) + b'Comment\0PRIVATE_APEV2!'
    with source.open('ab') as file:
        file.write(item + b'APETAGEX' + struct.pack('<IIII', 2000, len(item) + 32, 1, 0) + b'\0' * 8)
    assert probe(source)['format'].get('tags')
    before = audio_hash(source, lambda: False)
    result = clean(source, target)
    assert result['copied']
    assert audio_hash(target, lambda: False) == before
    assert len(probe(target)['streams']) == 1
    for forbidden in (b'ID3', b'APETAGEX', b'PRIVATE_', b'PNG'):
        assert forbidden not in target.read_bytes()


def test_silent_video_and_cancellation_do_not_publish(media_files, tmp_path):
    with pytest.raises(MediaError) as error:
        clean(media_files / 'vp9.webm', tmp_path / 'none.mp3')
    assert error.value.code == 'no_audio'
    with pytest.raises(Cancelled): clean(media_files / 'source.mp4', tmp_path / 'cancel.mp3', cancelled=lambda: True)
    target = tmp_path / 'junk.mp3'
    target.write_bytes(b'ID3\0\0\0')
    with pytest.raises(MediaError): frames(target)


def inspect(url):
    request = payload(url, Inspect)
    job, _ = store.create(request.requestId, 'Format inspection', 'probe')
    formats.run_probe(request, job)
    assert store.get(job)['state'] == 'done', store.get(job)
    return request, job, formats.status(job)['options']


@pytest.mark.parametrize('manifest', ['master.m3u8', 'dash/manifest.mpd'])
def test_picker_downloads_exact_lower_rendition_not_automatic_best(isolated_app, media_server, manifest):
    inspected, probe_id, options = inspect(media_server + '/' + manifest)
    assert {o.get('height') for o in options if o['kind'] == 'video'} == {90, 180}
    low = next(o for o in options if o['kind'] == 'video' and o.get('height') == 90)
    request = payload(media_server + '/' + manifest, formatSelection={'probeId': probe_id, 'optionId': low['id']})
    job, _ = store.create(request.requestId, 'Selected video')
    run_job(request, job)
    result = store.get(job)
    assert result['state'] == 'done', result
    target = Path(json.loads((isolated_app / 'config.json').read_text())['download_dir']) / result['filename']
    result = probe(target)
    assert result['streams'][0]['height'] == 90
    assert len([s for s in result['streams'] if s['codec_type'] == 'audio']) == 1
    cache = formats.cache_path(probe_id).read_text()
    assert '127.0.0.1' not in cache and 'http:' not in cache
    assert len(store.list_jobs()) == 1


def test_mp3_uses_audio_only_source_and_stages_for_chrome(isolated_app, media_server):
    _, probe_id, options = inspect(media_server + '/dash/manifest.mpd')
    audio = next(o for o in options if o['kind'] == 'audio')
    request = payload(media_server + '/dash/manifest.mpd', assetType='audio', browserDownload=True, formatSelection={'probeId': probe_id, 'optionId': audio['id']})
    job, _ = store.create(request.requestId, 'Audio')
    run_job(request, job)
    assert store.get(job)['state'] == 'ready', store.get(job)
    receipt = delivery.receipt(job)
    assert receipt['mime'] == 'audio/mpeg' and receipt['filename'].endswith('.mp3')
    assert probe(delivery.prepared_file(job))['streams'][0]['codec_name'] == 'mp3'


def test_expiry_binding_kind_and_changed_formats_fail_without_substitution(isolated_app, media_server):
    _, job, options = inspect(media_server + '/master.m3u8')
    video = next(o for o in options if o['kind'] == 'video')
    request = payload(media_server + '/master.m3u8', formatSelection={'probeId': job, 'optionId': video['id']})
    choice = formats.resolve(request)
    request.assetType = 'audio'
    with pytest.raises(MediaError): formats.resolve(request)
    request.assetType = 'video'
    request.sources[0].url += '?changed=yes'
    with pytest.raises(MediaError): formats.resolve(request)
    with pytest.raises(MediaError): formats.validate(choice, {'id': 'changed'})
    cached = formats.read(job); cached['created'] = time.time() - formats.TTL - 1
    formats.cache_path(job).write_text(json.dumps(cached))
    with pytest.raises(MediaError): formats.status(job)


def test_probe_pool_is_hidden_and_blocks_updates(isolated_app):
    assert not store.busy()
    for _ in range(2): store.create(str(uuid.uuid4()), 'Format inspection', 'probe')
    assert store.busy() and not store.list_jobs()
    with pytest.raises(ValueError): store.create(str(uuid.uuid4()), 'Format inspection', 'probe')
    for _ in range(3): store.create(str(uuid.uuid4()), 'Video')
    assert len(store.list_jobs()) == 3


def test_native_inspection_is_detached_idempotent_and_cancellable(isolated_app, media_server):
    from video_downloader.native import handle
    inspected = payload(media_server + '/master.m3u8', Inspect)
    began = time.monotonic()
    first = handle(inspected.model_dump())
    second = handle(inspected.model_dump())
    assert first == second and time.monotonic() - began < 5
    assert handle({'id': 'ping', 'type': 'ping'})['ready']
    handle({'id': 'cancel', 'type': 'cancel', 'jobId': first['jobId']})
    for _ in range(50):
        result = store.get(first['jobId'])
        if result['state'] in store.TERMINAL: break
        time.sleep(.1)
    assert result['state'] == 'cancelled', result
    assert not store.busy() and not store.list_jobs()
    assert not formats.cache_path(first['jobId']).exists()


def test_native_selection_rejects_arbitrary_selector_and_unknown_fields():
    from pydantic import ValidationError
    from video_downloader.models import RequestAdapter
    base = payload('https://example.com/video').model_dump()
    with pytest.raises(ValidationError): RequestAdapter.validate_python({**base, 'formatSelection': {'probeId': 'a' * 32, 'optionId': 'bestvideo+evil'}})
    with pytest.raises(ValidationError): RequestAdapter.validate_python({**base, 'format': 'best'})
    with pytest.raises(ValidationError): RequestAdapter.validate_python({**base, 'audioBitrate': 999})
