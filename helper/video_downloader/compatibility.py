"""Prepare broadly supported H.264/AAC tracks before metadata sanitizing."""
import math
from fractions import Fraction
from pathlib import Path

from .config import binary
from .media import MediaError, frame_side_data, probe, run


def compatible_video(video):
    return (video.get('codec_name') == 'h264' and video.get('pix_fmt') == 'yuv420p'
            and video.get('profile') in ('Baseline', 'Constrained Baseline', 'Main', 'High')
            and video.get('field_order', 'progressive') in ('progressive', 'unknown')
            and not is_hdr(video))


def compatible_audio(audio):
    return audio.get('codec_name') == 'aac' and audio.get('profile') == 'LC' and audio.get('channels', 0) in (1, 2)


def is_hdr(video):
    return video.get('color_transfer') in ('smpte2084', 'arib-std-b67') or any(any(name in item.get('side_data_type', '') for name in ('DOVI', 'Mastering display', 'Content light level')) for item in video.get('side_data_list', []))


def frame_rate(video):
    try: return float(Fraction(video.get('avg_frame_rate') or video.get('r_frame_rate') or '0'))
    except (ValueError, ZeroDivisionError): return 0


def prepare(source: Path, target: Path, cancelled=lambda: False):
    before = probe(source, cancelled)
    video = next((s for s in before['streams'] if s.get('codec_type') == 'video' and not s.get('disposition', {}).get('attached_pic')), None)
    audio = [s for s in before['streams'] if s.get('codec_type') == 'audio']
    if video is None: raise MediaError('video_missing', 'No video track was found.')
    video = {**video, 'side_data_list': [*video.get('side_data_list', []), *frame_side_data(source, cancelled)]}
    video_copy = compatible_video(video)
    audio_copy = all(compatible_audio(s) for s in audio)
    if video_copy and audio_copy:
        return source, False
    if is_hdr(video):
        # Casting PQ/HLG into ordinary 8-bit H.264 without a verified tone map
        # would produce washed-out colors. Keep the original-mode route honest.
        raise MediaError('hdr_conversion_unavailable', 'This source needs HDR-to-SDR tone mapping. Turn off Compatible MP4 in Settings to use Original source mode and preserve its HDR colors.')
    filters = []
    if video.get('field_order') not in (None, 'progressive', 'unknown'):
        filters.append('bwdif=mode=send_frame:parity=auto:deint=all')
    if video.get('width', 0) % 2 or video.get('height', 0) % 2:
        filters.append('pad=ceil(iw/2)*2:ceil(ih/2)*2')
    command = [binary('ffmpeg'), '-v', 'error', '-xerror', '-nostdin', '-y', '-noautorotate', '-i', str(source),
               '-map', f"0:{video['index']}", '-map', '0:a?', '-sn', '-dn', '-map_metadata', '-1', '-map_chapters', '-1']
    if video_copy:
        command += ['-c:v', 'copy']
    else:
        command += ['-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-profile:v', 'high', '-pix_fmt', 'yuv420p', '-flags:v', '+cgop', '-fps_mode:v', 'passthrough']
        if filters: command += ['-vf', ','.join(filters)]
    for index, track in enumerate(audio):
        if compatible_audio(track):
            command += [f'-c:a:{index}', 'copy']
        else:
            command += [f'-c:a:{index}', 'aac', f'-profile:a:{index}', 'aac_low', f'-b:a:{index}', '192k', f'-ac:a:{index}', str(min(2, track.get('channels') or 2))]
    command += ['-movflags', '+faststart', str(target)]
    duration = float(before.get('format', {}).get('duration') or 0)
    try:
        run(command, cancelled, min(86400, max(3600, duration * 6)))
        after = probe(target, cancelled)
        final = next(s for s in after['streams'] if s.get('codec_type') == 'video')
        final_audio = [s for s in after['streams'] if s.get('codec_type') == 'audio']
        expected_width, expected_height = math.ceil(video['width'] / 2) * 2, math.ceil(video['height'] / 2) * 2
        if not compatible_video(final) or not all(compatible_audio(s) for s in final_audio) or len(audio) != len(final_audio):
            raise MediaError('compatibility_failed', 'The compatible MP4 codecs could not be verified. No unverified file was saved.')
        if (final['width'], final['height']) != (expected_width, expected_height) or (not video_copy and frame_rate(video) > 0 and abs(frame_rate(video) - frame_rate(final)) > max(0.02, frame_rate(video) * 0.001)):
            raise MediaError('compatibility_failed', 'The video size or frame rate changed unexpectedly during conversion.')
        if video.get('nb_frames') and final.get('nb_frames') and video['nb_frames'] != final['nb_frames']:
            raise MediaError('frames_missing', 'Conversion lost video frames. No incomplete file was saved.')
        if abs(duration - float(after.get('format', {}).get('duration') or 0)) > max(0.2, duration * 0.001):
            raise MediaError('compatibility_failed', 'The converted file has an unexpected duration. No incomplete file was saved.')
        for old, new in zip([video, *audio], [final, *final_audio]):
            old_start = float(old.get('start_time') or 0) - float(before.get('format', {}).get('start_time') or 0)
            new_start = float(new.get('start_time') or 0) - float(after.get('format', {}).get('start_time') or 0)
            if abs(old_start - new_start) > 0.1:
                raise MediaError('timing_changed', 'Conversion changed the opening or audio/video timing. No damaged file was saved.')
        for name in ('color_primaries', 'color_transfer', 'color_space'):
            if video.get(name) not in (None, 'unknown') and video.get(name) != final.get(name):
                raise MediaError('color_changed', 'Conversion changed the video color information. Select Original source mode to preserve this format.')
        for side in video.get('side_data_list', []):
            if side.get('side_data_type') in ('Display Matrix', '3x3 displaymatrix') and side not in final.get('side_data_list', []):
                raise MediaError('orientation_changed', 'Conversion changed the display orientation. No altered file was saved.')
        return target, True
    except BaseException:
        target.unlink(missing_ok=True)
        raise
