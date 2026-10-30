"""Lossless packet remuxing and verified removal of descriptive metadata.

SEI user_data_unregistered is removed selectively. Other SEI messages may carry
HDR, captions, timing or orientation, so deleting every SEI NAL is incorrect.
"""
import json
import os
import re
import subprocess
import sys
import time
from pathlib import Path

import av

from .config import binary


class MediaError(Exception):
    def __init__(self, code: str, message: str):
        self.code, self.message = code, message


class Cancelled(Exception):
    pass


def run(command, cancelled=lambda: False, timeout=3600):
    """Bounded external processes; argument arrays only, never a shell."""
    import tempfile
    # Spool potentially verbose codec errors, never log source addresses.
    with tempfile.TemporaryFile() as stdout, tempfile.TemporaryFile() as stderr:
        process = subprocess.Popen(command, stdin=subprocess.DEVNULL, stdout=stdout, stderr=stderr)
        started = time.monotonic()
        try:
            while process.poll() is None:
                if cancelled():
                    raise Cancelled()
                if time.monotonic() - started > timeout:
                    raise MediaError("processing_timeout", "Processing took too long. The source may be damaged.")
                time.sleep(0.1)
        except BaseException:
            process.terminate()
            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait()
            raise
        stdout.seek(0)
        data = stdout.read(16 * 1024 * 1024)
        if process.returncode:
            raise MediaError("processing_failed", "The highest-quality source could not be saved as a clean MP4. No lower-quality version was substituted.")
        return data


def probe(path: Path, cancelled=lambda: False):
    raw = run([binary("ffprobe"), "-v", "error", "-show_format", "-show_streams", "-show_chapters", "-of", "json", str(path)], cancelled, 120)
    return json.loads(raw)


def frame_side_data(path: Path, cancelled=lambda: False):
    raw = run([binary("ffprobe"), "-v", "error", "-select_streams", "v:0", "-read_intervals", "%+#10", "-show_frames", "-show_entries", "frame=side_data_list", "-of", "json", str(path)], cancelled, 120)
    frames = json.loads(raw).get("frames", [])
    return [side for frame in frames for side in frame.get("side_data_list", [])]


def unescape_rbsp(data: bytes) -> bytes:
    out = bytearray()
    zeros = 0
    for byte in data:
        if zeros >= 2 and byte == 3:
            zeros = 0
            continue
        out.append(byte)
        zeros = zeros + 1 if byte == 0 else 0
    return bytes(out)


def escape_rbsp(data: bytes) -> bytes:
    out = bytearray()
    zeros = 0
    for byte in data:
        if zeros >= 2 and byte <= 3:
            out.append(3)
            zeros = 0
        out.append(byte)
        zeros = zeros + 1 if byte == 0 else 0
    return bytes(out)


def scrub_sei(nal: bytes, codec: str) -> tuple[bytes, int]:
    header_size = 1 if codec == "h264" else 2
    nal_type = nal[0] & 31 if codec == "h264" else (nal[0] >> 1) & 63
    if nal_type not in ((6,) if codec == "h264" else (39, 40)):
        return nal, 0
    rbsp = unescape_rbsp(nal[header_size:])
    messages = []
    index = 0
    removed = 0
    while index < len(rbsp):
        if rbsp[index] == 0x80 and not any(rbsp[index + 1:]):
            break
        start = index
        payload_type = 0
        while index < len(rbsp) and rbsp[index] == 255:
            payload_type += 255
            index += 1
        if index >= len(rbsp):
            raise MediaError("unverified_metadata", "The video's embedded metadata could not be checked safely.")
        payload_type += rbsp[index]
        index += 1
        size = 0
        while index < len(rbsp) and rbsp[index] == 255:
            size += 255
            index += 1
        if index >= len(rbsp):
            raise MediaError("unverified_metadata", "The video's embedded metadata could not be checked safely.")
        size += rbsp[index]
        index += 1
        if size > len(rbsp) - index:
            raise MediaError("unverified_metadata", "The video's embedded metadata is malformed.")
        index += size
        if payload_type == 5:
            removed += 1
        else:
            messages.append(rbsp[start:index])
    if not removed:
        return nal, 0
    if not messages:
        return b"", removed
    return nal[:header_size] + escape_rbsp(b"".join(messages) + b"\x80"), removed


def scrub_packet(data: bytes, codec: str, length_size: int | None) -> tuple[bytes, int]:
    if codec not in ("h264", "hevc"):
        return data, 0
    removed = 0
    if length_size:
        out = bytearray()
        index = 0
        while index < len(data):
            size = int.from_bytes(data[index:index + length_size], "big")
            index += length_size
            if size <= 0 or size > len(data) - index:
                raise MediaError("unverified_metadata", "The video packet layout could not be checked safely.")
            nal, count = scrub_sei(data[index:index + size], codec)
            removed += count
            if nal:
                out.extend(len(nal).to_bytes(length_size, "big"))
                out.extend(nal)
            index += size
        return (bytes(out), removed) if removed else (data, 0)
    pieces = re.split(b"\x00\x00\x00?\x01", data)
    if len(pieces) < 2:
        raise MediaError("unverified_metadata", "The video packet layout could not be checked safely.")
    out = []
    for piece in pieces[1:]:
        if not piece:
            continue
        nal, count = scrub_sei(piece, codec)
        removed += count
        if nal:
            out.append(b"\x00\x00\x00\x01" + nal)
    return (b"".join(out), removed) if removed else (data, 0)


def scrub_hevc_config(data: bytes) -> tuple[bytes, int]:
    if len(data) < 23 or data[0] != 1:
        return data, 0
    index, arrays, removed = 23, [], 0
    for _ in range(data[22]):
        if index + 3 > len(data):
            raise MediaError("unverified_metadata", "The video configuration is malformed.")
        head = data[index:index + 1]
        count = int.from_bytes(data[index + 1:index + 3], "big")
        index += 3
        nals = []
        for _ in range(count):
            size = int.from_bytes(data[index:index + 2], "big")
            index += 2
            if size <= 0 or index + size > len(data):
                raise MediaError("unverified_metadata", "The video configuration is malformed.")
            nal, n = scrub_sei(data[index:index + size], "hevc")
            removed += n
            if nal:
                nals.append(len(nal).to_bytes(2, "big") + nal)
            index += size
        if nals:
            arrays.append(head + len(nals).to_bytes(2, "big") + b"".join(nals))
    return (data[:22] + bytes([len(arrays)]) + b"".join(arrays), removed) if removed else (data, 0)


def remux_packets(source: Path, target: Path, cancelled=lambda: False) -> int:
    removed = 0
    av.logging.set_level(av.logging.ERROR)
    with av.open(str(source)) as input_file, av.open(str(target), "w", format="mp4", options={"movflags": "+faststart", "fflags": "+bitexact", "strict": "experimental"}) as output_file:
        selected = [s for s in input_file.streams if s.type in ("video", "audio") and not (int(s.disposition) & 0x400)]
        mapping = {}
        lengths = {}
        for stream in selected:
            new = output_file.add_stream_from_template(stream, opaque=True)
            new.metadata.clear()
            mapping[stream.index] = new
            codec = stream.codec_context.name
            extra = stream.codec_context.extradata or b""
            lengths[stream.index] = ((extra[4] & 3) + 1 if codec == "h264" and len(extra) > 4 and extra[0] == 1 else (extra[21] & 3) + 1 if codec == "hevc" and len(extra) > 22 and extra[0] == 1 else None)
            if codec == "hevc":
                cleaned, count = scrub_hevc_config(extra)
                new.codec_context.extradata = cleaned
                removed += count
        if not any(s.type == "video" for s in selected):
            raise MediaError("no_video", "No downloadable video track was found.")
        for packet in input_file.demux(selected):
            if cancelled():
                raise Cancelled()
            if packet.size == 0:
                continue
            if packet.dts is None:
                raise MediaError("invalid_timestamps", "The video's decode timestamps could not be prepared safely. No opening frames were discarded.")
            original = packet
            data, count = scrub_packet(bytes(packet), packet.stream.codec_context.name, lengths[packet.stream.index])
            removed += count
            if not data:
                continue
            if count:
                packet = av.Packet(data)
                packet.pts, packet.dts, packet.duration, packet.time_base = original.pts, original.dts, original.duration, original.time_base
                packet.is_keyframe = original.is_keyframe
                for side in original.iter_sidedata():
                    packet.set_sidedata(side)
            packet.stream = mapping[original.stream.index]
            output_file.mux(packet)
    return removed


def container_clean(source: Path, target: Path, cancelled=lambda: False):
    run([binary("ffmpeg"), "-hide_banner", "-loglevel", "error", "-nostdin", "-y", "-i", str(source),
         "-map", "0:v:0", "-map", "0:a?", "-sn", "-dn", "-map_metadata", "-1", "-map_metadata:s", "-1", "-map_chapters", "-1",
         "-c", "copy", "-strict", "-2", "-bitexact", "-metadata", "encoder=", "-metadata:s", "encoder=",
         "-metadata:s", "handler_name=", "-metadata:s", "language=und", "-metadata:s", "vendor_id=0000",
         "-movflags", "+faststart", str(target)], cancelled)
    clear_user_boxes(target)


def clear_user_boxes(path: Path):
    """Zero user-data containers without moving any sample or chunk offsets."""
    containers = {b"moov", b"trak", b"mdia", b"minf", b"stbl", b"edts"}
    with path.open("r+b") as file:
        def visit(start, end, depth=0):
            if depth > 12:
                raise MediaError("unverified_metadata", "The MP4 structure could not be checked safely.")
            position = start
            while position + 8 <= end:
                file.seek(position)
                head = file.read(8)
                size, kind = int.from_bytes(head[:4], "big"), head[4:8]
                header = 8
                if size == 1:
                    size = int.from_bytes(file.read(8), "big")
                    header = 16
                elif size == 0:
                    size = end - position
                if size < header or position + size > end:
                    raise MediaError("unverified_metadata", "The MP4 structure is malformed.")
                if kind in (b"udta", b"meta", b"uuid"):
                    file.seek(position + 4)
                    file.write(b"free")
                    file.seek(position + header)
                    remaining = size - header
                    while remaining:
                        amount = min(remaining, 1024 * 1024)
                        file.write(b"\0" * amount)
                        remaining -= amount
                elif kind in containers:
                    visit(position + header, position + size, depth + 1)
                position += size
        visit(0, path.stat().st_size)


TECHNICAL_TAGS = set("""
FileType FileTypeExtension MIMEType MajorBrand MinorVersion CompatibleBrands
MovieHeaderVersion TimeScale Duration PreferredRate PreferredVolume PreviewTime
PreviewDuration PosterTime SelectionTime SelectionDuration CurrentTime NextTrackID
TrackHeaderVersion TrackID TrackDuration TrackLayer TrackVolume MatrixStructure
ImageWidth ImageHeight MediaHeaderVersion MediaTimeScale MediaDuration MediaLanguageCode
HandlerClass HandlerType HandlerDescription GraphicsMode OpColor Balance AudioFormat
AudioChannels AudioBitsPerSample AudioSampleRate CompressorID CompressorName SourceImageWidth
SourceImageHeight XResolution YResolution BitDepth VideoFrameRate MediaDataSize MediaDataOffset
ImageSize Megapixels AvgBitrate Rotation VideoFullRangeFlag ColorPrimaries TransferCharacteristics
MatrixCoefficients PixelAspectRatio ColorRepresentation ColorProfiles PixelDepth VideoPixelDepth
CleanApertureDimensions EncodedPixelsDimensions ProductionApertureDimensions
BitRate MaxBitrate AverageBitrate BufferSize ChannelLayout AudioChannelLayout AudioChannelCount
SpatialQuality TemporalQuality VideoFieldOrder SampleRate SampleCount VideoFormat
CompatibleBrands VideoCodecID AudioCodecID MaxContentLightLevel MaxFrameAverageLightLevel
MasteringDisplayColorPrimaries MasteringDisplayWhitePoint MasteringDisplayLuminance
HEVCConfigurationVersion GeneralProfileSpace GeneralTierFlag GeneralProfileIDC
GeneralProfileCompatibilityFlags GeneralConstraintIndicatorFlags GeneralLevelIDC
MinSpatialSegmentationIDC ParallelismType ChromaFormat BitDepthLumaMinus8 BitDepthChromaMinus8
AverageFrameRate ConstantFrameRate NumTemporalLayers TemporalIDNested LengthSizeMinusOne
NumberOfArrays AVCConfigurationVersion AVCProfileIndication AVCProfileCompatibility AVCLevelIndication
NALUnitLength NumberOfSPS NumberOfPPS MediaFlags HandlerVendorID VendorID AudioVendorID
ContentLightLevel MaxCLL MaxFALL HDRFormat HDRFormatVersion HDRFormatProfile HDRFormatLevel
HDRFormatSettings HDRFormatCompatibility DolbyVisionConfigurationVersion DolbyVisionProfile
DolbyVisionLevel DolbyVisionRPU DolbyVisionEL DolbyVisionBL
""".split())
ZERO_DATES = {"CreateDate", "ModifyDate", "TrackCreateDate", "TrackModifyDate", "MediaCreateDate", "MediaModifyDate"}


def clear_windows_origin(path: Path):
    zone = Path(str(path) + ":Zone.Identifier")
    try:
        data = zone.read_bytes()
    except FileNotFoundError:
        return
    if len(data) > 65536:
        raise OSError("Unexpected zone identifier size")
    kept = b"".join(line for line in data.splitlines(keepends=True) if not line.lower().startswith((b"hosturl=", b"referrerurl=")))
    if kept != data: zone.write_bytes(kept)


def clear_source_attributes(path: Path):
    attributes = ("com.apple.metadata:kMDItemWhereFroms", "user.xdg.origin.url", "user.xdg.referrer.url")
    try:
        if sys.platform == "darwin":
            # CPython on macOS does not expose os.listxattr/removexattr.
            names = run(["/usr/bin/xattr", str(path)], timeout=10).decode().splitlines()
            for name in attributes:
                if name in names:
                    run(["/usr/bin/xattr", "-d", name, str(path)], timeout=10)
        elif os.name == "nt":
            clear_windows_origin(path)
        elif hasattr(os, "removexattr"):
            for name in attributes:
                if name in os.listxattr(path):
                    os.removexattr(path, name)
    except (OSError, MediaError, UnicodeError) as error:
        raise MediaError("unverified_metadata", "The file's source attributes could not be cleared.") from error


def verify(source: Path, output: Path, cancelled=lambda: False) -> dict:
    before, after = probe(source, cancelled), probe(output, cancelled)
    videos_before = [s for s in before["streams"] if s["codec_type"] == "video" and not s.get("disposition", {}).get("attached_pic")]
    videos_after = [s for s in after["streams"] if s["codec_type"] == "video"]
    if not videos_before or len(videos_after) != 1 or any(s["codec_type"] not in ("video", "audio") for s in after["streams"]):
        raise MediaError("verification_failed", "The finished file did not contain the expected video and audio tracks.")
    first, final = videos_before[0], videos_after[0]
    before_origin = float(before.get("format", {}).get("start_time") or 0)
    after_origin = float(after.get("format", {}).get("start_time") or 0)
    timing_tolerance = 0.1
    for original, finished in zip(
        [first] + [s for s in before["streams"] if s["codec_type"] == "audio"],
        [final] + [s for s in after["streams"] if s["codec_type"] == "audio"],
    ):
        if original.get("start_time") is not None and finished.get("start_time") is not None:
            old_start = float(original["start_time"]) - before_origin
            new_start = float(finished["start_time"]) - after_origin
            if abs(old_start - new_start) > timing_tolerance:
                raise MediaError("timing_changed", "The video's opening or audio/video timing changed during processing. No damaged file was saved.")
        if original.get("nb_frames") and finished.get("nb_frames") and original["nb_frames"] != finished["nb_frames"]:
            raise MediaError("frames_missing", "Some frames were lost during processing. No incomplete file was saved.")
    for key in ("codec_name", "width", "height", "pix_fmt", "color_primaries", "color_transfer", "color_space"):
        if first.get(key) is not None and first.get(key) != final.get(key):
            raise MediaError("quality_changed", "The source quality could not be preserved. No lower-quality file was saved.")
    functional = {"Mastering display metadata", "Content light level metadata", "3x3 displaymatrix", "Display Matrix", "DOVI configuration record", "Spherical Mapping", "Stereo 3D"}
    before_side = first.get("side_data_list", []) + frame_side_data(source, cancelled)
    after_side = final.get("side_data_list", []) + frame_side_data(output, cancelled)
    for side in before_side:
        if side.get("side_data_type") in functional and side not in after_side:
            raise MediaError("quality_changed", "The video's HDR or orientation information could not be preserved. No altered file was saved.")
    if any("User Data Unregistered" in side.get("side_data_type", "") for side in after_side):
        raise MediaError("unverified_metadata", "Private user data remained in the video after cleaning.")
    before_audio = [s for s in before["streams"] if s["codec_type"] == "audio"]
    after_audio = [s for s in after["streams"] if s["codec_type"] == "audio"]
    if len(before_audio) != len(after_audio):
        raise MediaError("audio_missing", "The original audio tracks could not be preserved.")
    for a, b in zip(before_audio, after_audio):
        if any(a.get(k) != b.get(k) for k in ("codec_name", "sample_rate", "channels")):
            raise MediaError("quality_changed", "The source audio could not be preserved without conversion.")
    duration_before = float(before.get("format", {}).get("duration", 0))
    duration_after = float(after.get("format", {}).get("duration", 0))
    if duration_before > 0 and abs(duration_before - duration_after) > max(1, duration_before * 0.001):
        raise MediaError("verification_failed", "The finished file is shorter than the source. No incomplete file was saved.")
    if after.get("chapters"):
        raise MediaError("unverified_metadata", "Chapter metadata remained after cleaning.")
    if set(after["format"].get("tags", {})) - {"major_brand", "minor_version", "compatible_brands"}:
        raise MediaError("unverified_metadata", "Descriptive metadata remained after cleaning.")
    for stream in after["streams"]:
        for key, value in stream.get("tags", {}).items():
            if key == "language" and value == "und":
                continue
            if key == "handler_name" and value in ("VideoHandler", "SoundHandler"):
                continue
            if key == "vendor_id" and value in ("0000", "[0][0][0][0]"):
                continue
            raise MediaError("unverified_metadata", "Track metadata remained after cleaning.")
    raw = run([binary("exiftool"), "-json", "-G1", "-a", "-s", "-ee", "-api", "LargeFileSupport=1", str(output)], cancelled, 3600)
    info = json.loads(raw)[0]
    for key, value in info.items():
        group, _, tag = key.rpartition(":")
        if key == "SourceFile" or group in ("ExifTool", "System"):
            continue
        if tag in ZERO_DATES and str(value) in ("0000:00:00 00:00:00", "1904:01:01 00:00:00", "0"):
            continue
        if tag in ("HandlerVendorID", "VendorID", "AudioVendorID"):
            if str(value).strip() in ("", "0000", "0", "Unknown (0000)"):
                continue
            raise MediaError("unverified_metadata", "A source vendor identifier remained after cleaning.")
        if tag == "CompressorName":
            if str(value).strip() in ("", "AVC Coding", "HEVC Coding", "AV1 Coding", "VP9 Coding"):
                continue
            raise MediaError("unverified_metadata", "An encoder description remained after cleaning.")
        if tag == "HandlerDescription" and value not in ("VideoHandler", "SoundHandler"):
            raise MediaError("unverified_metadata", "A source track description remained after cleaning.")
        if tag not in TECHNICAL_TAGS:
            raise MediaError("unverified_metadata", "The file contains metadata that this version cannot safely verify. Update the helper before downloading it.")
    clear_source_attributes(output)
    return {"width": final["width"], "height": final["height"], "codec": final["codec_name"], "fps": final.get("avg_frame_rate", ""), "audioCodecs": [s['codec_name'] for s in after_audio], "seiRemoved": True}


def sanitize(source: Path, target: Path, cancelled=lambda: False, stage=lambda _: None) -> dict:
    normalized_file = target.with_suffix(".timed.mp4")
    packet_file = target.with_suffix(".packets.mp4")
    try:
        stage("cleaning")
        # Matroska can legitimately omit DTS on the first reordered frames.
        # FFmpeg reconstructs their decode timeline losslessly before PyAV edits
        # packets. Skipping those non-empty packets would discard the first GOP.
        container_clean(source, normalized_file, cancelled)
        remux_packets(normalized_file, packet_file, cancelled)
        container_clean(packet_file, target, cancelled)
        stage("verifying")
        return verify(source, target, cancelled)
    except MediaError:
        raise
    except (av.FFmpegError, ValueError, OSError) as error:
        raise MediaError("format_not_supported", "The best-quality source could not be copied safely into MP4. No lower-quality version was substituted.") from error
    finally:
        normalized_file.unlink(missing_ok=True)
        packet_file.unlink(missing_ok=True)
