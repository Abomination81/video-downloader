import json
import uuid
from pathlib import Path

import pytest
import yt_dlp

from video_downloader import formats, store
from video_downloader.media import Cancelled, probe
from video_downloader.models import Cookie, Inspect, Source, Start
from video_downloader.worker import extracted_source, run_job


URL = 'https://www.facebook.com/reel/123456789'
COOKIE = Cookie(name='c_user', value='PRIVATE_SESSION', domain='.facebook.com', path='/',
                secure=True, httpOnly=True, hostOnly=False)


@pytest.mark.parametrize('kind', ['video', 'audio', 'inspect'])
def test_authenticated_facebook_parse_failure_recovers_public_media(isolated_app, media_server, monkeypatch, kind):
    original = yt_dlp.YoutubeDL.extract_info
    sessions = []

    def extract(self, url, *args, **kwargs):
        if url == URL:
            authenticated = bool(list(self.cookiejar))
            sessions.append(authenticated)
            if authenticated:
                raise yt_dlp.utils.DownloadError('ERROR: [facebook] Cannot parse data')
            assert 'Referer' not in self.params['http_headers']
            url = media_server + '/master.m3u8'
        return original(self, url, *args, **kwargs)

    monkeypatch.setattr(yt_dlp.YoutubeDL, 'extract_info', extract)
    cls = Inspect if kind == 'inspect' else Start
    request = cls(id='fb-test', type='inspect' if kind == 'inspect' else 'start',
                  requestId=str(uuid.uuid4()), sources=[{'url': URL, 'kind': 'page',
                  'headers': {'Referer': 'https://www.facebook.com/private-page'}}],
                  cookies=[COOKIE], outputProfile='compatible',
                  **({'assetType': kind} if kind != 'inspect' else {}))
    job, _ = store.create(request.requestId, 'Facebook test', 'probe' if kind == 'inspect' else 'download')
    if kind == 'inspect':
        formats.run_probe(request, job)
    else:
        run_job(request, job)
    result = store.get(job)
    assert result['state'] == 'done', result
    assert sessions == [True, False]
    assert request.cookies == [COOKIE]
    if kind == 'inspect':
        choices = formats.status(job)['options']
        assert max(o.get('height', 0) for o in choices) == 180
        assert any(o['kind'] == 'audio' for o in choices)
    else:
        directory = Path(json.loads((isolated_app / 'config.json').read_text())['download_dir'])
        output = directory / result['filename']
        streams = probe(output)['streams']
        if kind == 'video':
            assert [(s['codec_name'], s.get('height')) for s in streams] == [('h264', 180), ('aac', None)]
        else:
            assert [s['codec_name'] for s in streams] == ['mp3']
        assert b'PRIVATE_' not in output.read_bytes()
    assert b'PRIVATE_SESSION' not in (isolated_app / 'state/jobs.sqlite3').read_bytes()


@pytest.mark.parametrize('url,kind,cookies,message', [
    ('https://other.example/video', 'page', [COOKIE], 'Cannot parse data'),
    ('https://facebook.com.other.example/reel/123', 'page', [COOKIE], 'Cannot parse data'),
    (URL, 'file', [COOKIE], 'Cannot parse data'),
    (URL, 'page', [], 'Cannot parse data'),
    (URL, 'page', [COOKIE], 'This video is private. Login required'),
    (URL, 'page', [COOKIE], 'DRM protected content'),
])
def test_public_retry_is_limited_to_authenticated_facebook_parse_errors(monkeypatch, url, kind, cookies, message):
    calls = []
    def fail(self, source, **kwargs):
        calls.append(source)
        raise yt_dlp.utils.DownloadError(message)
    monkeypatch.setattr(yt_dlp.YoutubeDL, 'extract_info', fail)
    with pytest.raises(yt_dlp.utils.DownloadError):
        with extracted_source({'quiet': True}, Source(url=url, kind=kind), cookies, lambda: False):
            pytest.fail('No result should be yielded')
    assert calls == [url]


def test_public_retry_stops_after_one_attempt_and_does_not_mask_private_video(monkeypatch):
    sessions = []
    def fail(self, url, **kwargs):
        authenticated = bool(list(self.cookiejar))
        sessions.append(authenticated)
        raise yt_dlp.utils.DownloadError('Cannot parse data' if authenticated else 'Login required for private video')
    monkeypatch.setattr(yt_dlp.YoutubeDL, 'extract_info', fail)
    with pytest.raises(yt_dlp.utils.DownloadError, match='Login required'):
        with extracted_source({'quiet': True}, Source(url=URL, kind='page'), [COOKIE], lambda: False):
            pytest.fail('A private video must not become a successful public download')
    assert sessions == [True, False]


def test_success_keeps_authenticated_session_and_does_not_retry_download_errors(monkeypatch):
    calls = []
    def extract(self, url, **kwargs):
        calls.append(url)
        return {'id': '123456789'}
    monkeypatch.setattr(yt_dlp.YoutubeDL, 'extract_info', extract)
    with pytest.raises(yt_dlp.utils.DownloadError, match='Cannot parse data during download'):
        with extracted_source({'quiet': True}, Source(url=URL, kind='page'), [COOKIE], lambda: False) as (ydl, info):
            assert len(list(ydl.cookiejar)) == 1
            assert info['id'] == '123456789'
            raise yt_dlp.utils.DownloadError('Cannot parse data during download')
    assert calls == [URL]


def test_cancellation_stops_before_public_retry(monkeypatch):
    calls = []
    def fail(self, url, **kwargs):
        calls.append(url)
        raise yt_dlp.utils.DownloadError('Cannot parse data')
    monkeypatch.setattr(yt_dlp.YoutubeDL, 'extract_info', fail)
    with pytest.raises(Cancelled):
        with extracted_source({'quiet': True}, Source(url=URL, kind='page'), [COOKIE], lambda: bool(calls)):
            pytest.fail('Cancelled work must not continue')
    assert calls == [URL]
