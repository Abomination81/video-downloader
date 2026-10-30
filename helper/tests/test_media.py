import json
import subprocess

import pytest

from video_downloader.media import Cancelled, MediaError, clear_source_attributes, frame_side_data, probe, sanitize, scrub_packet, scrub_sei, verify


def digest(path, stream):
    return subprocess.run(["ffmpeg", "-v", "error", "-nostdin", "-noautorotate", "-i", str(path), "-map", stream, "-f", "hash", "-hash", "sha256", "-"], capture_output=True, text=True, check=True).stdout


@pytest.mark.parametrize("filename", ["source.mp4", "hdr.mp4", "vp9.webm", "av1.mkv", "rotated.mp4"])
def test_cleaning_preserves_decoded_video_and_removes_identifying_metadata(media_files, tmp_path, filename):
    source, target = media_files / filename, tmp_path / "clean.mp4"
    result = sanitize(source, target)
    assert result["width"] > 0
    assert digest(source, "0:v:0") == digest(target, "0:v:0")
    if filename in ("source.mp4", "rotated.mp4"):
        assert digest(source, "0:a:0") == digest(target, "0:a:0")
    data = target.read_bytes()
    assert b"PRIVATE_" not in data
    assert b"x264 - core" not in data
    assert b"x265 (build" not in data
    info = probe(target)
    assert not info["chapters"]
    if filename in ("hdr.mp4", "rotated.mp4"):
        before = probe(source)["streams"][0].get("side_data_list", [])
        after = info["streams"][0].get("side_data_list", [])
        if filename == "rotated.mp4":
            assert any(s["side_data_type"] == "Display Matrix" for s in before)
        for side in before:
            assert side in after
        source_frames = frame_side_data(source)
        cleaned_frames = frame_side_data(target)
        if filename == "hdr.mp4":
            assert any(s["side_data_type"] == "Mastering display metadata" for s in source_frames)
            assert any(s["side_data_type"] == "Content light level metadata" for s in source_frames)
        for side in source_frames:
            if "User Data Unregistered" not in side["side_data_type"]:
                assert side in cleaned_frames
        assert not any("User Data Unregistered" in s["side_data_type"] for s in cleaned_frames)


def test_selective_sei_removal_keeps_hdr_payload():
    # One SEI NAL holds both private UUID data and content light level metadata.
    data = b"PRIVATE_UUID_AND_DATA"
    private = bytes([5, len(data)]) + data
    functional = bytes([144, 4, 3, 232, 1, 144])
    nal = b"\x06" + private + functional + b"\x80"
    cleaned, count = scrub_sei(nal, "h264")
    assert count == 1 and b"PRIVATE" not in cleaned
    assert functional in cleaned
    prefix = len(nal).to_bytes(4, "big")
    packet, removed = scrub_packet(prefix + nal, "h264", 4)
    assert removed == 1
    assert int.from_bytes(packet[:4], "big") == len(packet) - 4


def test_malformed_bitstream_is_not_published():
    with pytest.raises(MediaError):
        scrub_packet(b"\0\0\0\xff\x06bad", "h264", 4)


def test_cancel_is_observed_before_processing(media_files, tmp_path):
    with pytest.raises(Cancelled):
        sanitize(media_files / "source.mp4", tmp_path / "cancelled.mp4", lambda: True)


def test_matroska_missing_opening_decode_timestamps_preserves_first_keyframe(media_files, tmp_path):
    import av
    source, target = media_files / "reordered.mkv", tmp_path / "clean.mp4"
    with av.open(str(source)) as container:
        first = next(p for p in container.demux(video=0) if p.size)
        assert first.dts is None and first.is_keyframe
    sanitize(source, target)
    info = probe(target)
    video, audio = info["streams"]
    assert int(video["nb_frames"]) == 192
    assert float(video["start_time"]) < 0.1
    assert abs(float(video["start_time"]) - float(audio["start_time"])) < 0.1
    assert digest(source, "0:v:0") == digest(target, "0:v:0")
    # Matroska's millisecond clock rounds AAC priming by a fraction of a
    # millisecond in MP4 edit lists. Check the encoded audio is byte-for-byte
    # unchanged, rather than comparing decoder padding selected by containers.
    import hashlib
    def audio_packets(path):
        result = hashlib.sha256()
        with av.open(str(path)) as container:
            for packet in container.demux(audio=0):
                if packet.size:
                    result.update(bytes(packet))
        return result.digest()
    assert audio_packets(source) == audio_packets(target)


def test_verification_rejects_a_delayed_video_track(media_files, tmp_path):
    bad = tmp_path / "delayed.mp4"
    subprocess.run(["ffmpeg", "-v", "error", "-nostdin", "-y", "-itsoffset", "3", "-i", str(media_files / "reordered.mp4"), "-i", str(media_files / "reordered.mp4"), "-map", "0:v:0", "-map", "1:a:0", "-c", "copy", str(bad)], check=True)
    with pytest.raises(MediaError) as error:
        verify(media_files / "reordered.mp4", bad)
    assert error.value.code == "timing_changed"


@pytest.mark.skipif(__import__('sys').platform != 'darwin', reason='macOS extended attributes')
def test_source_url_attributes_are_cleared_without_removing_quarantine(tmp_path):
    path = tmp_path / 'attributes.mp4'
    path.write_bytes(b'test data')
    subprocess.run(['/usr/bin/xattr', '-w', 'com.apple.metadata:kMDItemWhereFroms', 'https://example.com/private-origin', str(path)], check=True)
    subprocess.run(['/usr/bin/xattr', '-w', 'com.apple.quarantine', '0083;00000000;Test;', str(path)], check=True)
    clear_source_attributes(path)
    names = subprocess.run(['/usr/bin/xattr', str(path)], capture_output=True, text=True, check=True).stdout.splitlines()
    assert 'com.apple.metadata:kMDItemWhereFroms' not in names
    assert 'com.apple.quarantine' in names
