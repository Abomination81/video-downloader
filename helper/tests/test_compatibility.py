import hashlib
import subprocess
import uuid
from pathlib import Path

import av
import pytest

from video_downloader import store
from video_downloader.compatibility import prepare
from video_downloader.media import Cancelled, MediaError, probe, sanitize
from video_downloader.models import Start
from video_downloader.worker import run_job


def encode(*args):
    subprocess.run(['ffmpeg', '-v', 'error', '-nostdin', '-y', *map(str, args)], check=True, capture_output=True)


def track_hash(path, kind):
    result = hashlib.sha256()
    with av.open(str(path)) as media:
        for packet in media.demux(**{kind: 0}):
            if packet.size: result.update(bytes(packet))
    return result.hexdigest()


def test_existing_h264_aac_is_never_reencoded(media_files, tmp_path):
    source = media_files/'source.mp4'
    target = tmp_path/'compatible.mp4'
    path, converted = prepare(source, target)
    assert path == source and not converted and not target.exists()


def test_av1_opus_becomes_h264_aac_and_is_cleaned(media_files, tmp_path):
    source = tmp_path/'av1-opus.mkv'
    encode('-i', media_files/'av1.mkv', '-i', media_files/'source.mp4', '-map', '0:v:0', '-map', '1:a:0', '-c:v', 'copy', '-c:a', 'libopus', '-shortest', source)
    original = hashlib.sha256(source.read_bytes()).digest()
    prepared, converted = prepare(source, tmp_path/'converted.mp4')
    assert converted
    clean = tmp_path/'clean.mp4'
    sanitize(prepared, clean)
    streams = probe(clean)['streams']
    assert [(s['codec_name'], s.get('profile')) for s in streams] == [('h264', 'High'), ('aac', 'LC')]
    assert streams[0]['pix_fmt'] == 'yuv420p'
    assert (streams[0]['width'], streams[0]['height']) == (160, 96)
    assert streams[1]['channels'] == 1
    assert float(streams[0]['start_time']) < 0.1 and float(streams[1]['start_time']) < 0.1
    assert b'PRIVATE_' not in clean.read_bytes() and b'x264 - core' not in clean.read_bytes()
    assert hashlib.sha256(source.read_bytes()).digest() == original
    for file in [source, clean]:
        with av.open(str(file)) as media:
            count = sum(1 for _ in media.decode(video=0))
        if file == source: frames = count
        else: assert count == frames


def test_only_opus_audio_is_reencoded_when_video_already_compatible(media_files, tmp_path):
    source = tmp_path/'h264-opus.mkv'
    encode('-i', media_files/'source.mp4', '-c:v', 'copy', '-c:a', 'libopus', source)
    output, converted = prepare(source, tmp_path/'compatible.mp4')
    assert converted and track_hash(source, 'video') == track_hash(output, 'video')
    assert probe(output)['streams'][1]['codec_name'] == 'aac'


def test_unsupported_video_without_audio_stays_silent(media_files, tmp_path):
    source = media_files/'vp9.webm'
    output, converted = prepare(source, tmp_path/'compatible.mp4')
    assert converted
    streams = probe(output)['streams']
    assert len(streams) == 1 and streams[0]['codec_name'] == 'h264'


def test_hdr_is_not_silently_exported_with_wrong_colors(media_files, tmp_path):
    with pytest.raises(MediaError) as error:
        prepare(media_files/'hdr.mp4', tmp_path/'compatible.mp4')
    assert error.value.code == 'hdr_conversion_unavailable'
    assert not (tmp_path/'compatible.mp4').exists()


def test_cancellation_removes_an_unfinished_conversion(media_files, tmp_path):
    with pytest.raises(Cancelled): prepare(media_files/'vp9.webm', tmp_path/'compatible.mp4', lambda: True)
    assert not (tmp_path/'compatible.mp4').exists()


@pytest.mark.parametrize('mode,expected', [('compatible', 'h264'), ('original', 'vp9')])
def test_real_job_obeys_output_mode(isolated_app, media_server, mode, expected):
    request = Start(id='test', type='start', requestId=str(uuid.uuid4()), title='Fixture', sources=[{'url':media_server+'/vp9.webm','kind':'file'}], outputProfile=mode)
    job, _ = store.create(request.requestId, request.title)
    run_job(request, job)
    row = store.get(job)
    assert row['state'] == 'done', row
    from video_downloader.config import output_dir
    assert probe(output_dir()/row['filename'])['streams'][0]['codec_name'] == expected


def test_old_extension_requests_default_to_compatible_output():
    request = Start(id='old', type='start', requestId=str(uuid.uuid4()), sources=[{'url':'https://example.com/video','kind':'page'}])
    assert request.outputProfile == 'compatible'


def test_conversion_counts_as_active_for_capacity_and_installer(isolated_app):
    import importlib.util
    for _ in range(3):
        job, _ = store.create(str(uuid.uuid4()), 'Encoding')
        store.update(job, state='converting')
    with pytest.raises(ValueError, match='queue_full'): store.create(str(uuid.uuid4()), 'Fourth job')
    spec = importlib.util.spec_from_file_location('installer', Path(__file__).resolve().parents[2]/'scripts/install.py')
    installer = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(installer)
    with pytest.raises(RuntimeError, match='current downloads'): installer.ensure_idle(isolated_app)


@pytest.mark.parametrize('mode,higher,expected', [('compatible', False, 'avc480'), ('compatible', True, 'av1720'), ('original', False, 'av1480')])
def test_format_choice_avoids_reencoding_without_a_resolution_downgrade(mode, higher, expected, tmp_path):
    import yt_dlp
    from video_downloader.models import Source
    from video_downloader.worker import engine_options
    formats = [{'format_id':name,'url':'https://example.com/'+name+'.mp4','ext':'mp4','width':width,'height':height,'fps':30,'vcodec':codec,'acodec':'mp4a.40.2','abr':128,'tbr':1000} for name,width,height,codec in [('avc480',854,480,'avc1.64001e'),('av1480',854,480,'av01.0.04M.08')]]
    if higher: formats.append({**formats[1], 'format_id':'av1720', 'width':1280, 'height':720})
    options = engine_options(Source(url='https://example.com/watch',kind='page'), tmp_path, lambda _:None, output_profile=mode)
    with yt_dlp.YoutubeDL(options) as client:
        info = client.process_ie_result({'id':'fixture','title':'Fixture','formats':formats},download=False)
    assert info['format_id'] == expected
