"""MP3 output with descriptive tags/artwork removed and audio verified."""
import json
from pathlib import Path

from .config import binary
from .media import Cancelled, MediaError, clear_source_attributes, probe, run

TECHNICAL = set("""FileType FileTypeExtension MIMEType MPEGAudioVersion AudioLayer
AudioBitrate SampleRate ChannelMode MSStereo IntensityStereo CopyrightFlag
OriginalMedia Emphasis Duration VBRFrames VBRBytes VBRScale VBRQuality
EncoderDelay EncoderPadding
""".split())


def frames(path, cancelled=lambda: False):
    """Require an entire MPEG Layer III frame stream, without ID3/APE/junk."""
    count = 0
    with path.open("rb") as file:
        while head := file.read(4):
            if cancelled(): raise Cancelled()
            if len(head) != 4: raise MediaError("unverified_metadata", "Unexpected data remained in the MP3.")
            bits = int.from_bytes(head, "big")
            version, layer = (bits >> 19) & 3, (bits >> 17) & 3
            rate_index, sample_index = (bits >> 12) & 15, (bits >> 10) & 3
            if bits >> 21 != 0x7ff or version == 1 or layer != 1 or rate_index in (0, 15) or sample_index == 3:
                raise MediaError("unverified_metadata", "The MP3 contains tags or an unrecognized audio structure.")
            rates = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320] if version == 3 else [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160]
            sample = [44100, 48000, 32000][sample_index] // (1 if version == 3 else 2 if version == 2 else 4)
            length = (144000 if version == 3 else 72000) * rates[rate_index] // sample + ((bits >> 9) & 1)
            if len(file.read(length - 4)) != length - 4: raise MediaError("verification_failed", "The MP3 has an incomplete audio frame.")
            count += 1
    if count < 2: raise MediaError("no_audio", "No downloadable audio track was found.")


def audio_hash(path, cancelled):
    return run([binary("ffmpeg"), "-v", "error", "-xerror", "-i", str(path), "-map", "0:a:0", "-c:a", "pcm_s16le", "-f", "hash", "-hash", "sha256", "-"], cancelled)


def clean(source: Path, target: Path, bitrate=320, cancelled=lambda: False, state=lambda _: None):
    before = probe(source, cancelled)
    audio = next((s for s in before.get("streams", []) if s.get("codec_type") == "audio"), None)
    if not audio: raise MediaError("no_audio", "This video has no downloadable audio track.")
    # Preserve an existing MP3 at the default quality. Lower explicit limits
    # re-encode only when its bitrate exceeds that limit.
    copied = audio.get("codec_name") == "mp3" and (bitrate == 320 or 0 < int(audio.get("bit_rate") or 0) <= bitrate * 1000)
    state("cleaning" if copied else "converting")
    command = [binary("ffmpeg"), "-v", "error", "-nostdin", "-y", "-i", str(source), "-map", "0:a:0", "-vn", "-sn", "-dn", "-map_metadata", "-1", "-map_metadata:s:a", "-1", "-map_chapters", "-1"]
    if copied: command += ["-c:a", "copy"]
    else:
        rate = int(audio.get("sample_rate") or 48000)
        command += ["-c:a", "libmp3lame", "-b:a", f"{bitrate}k", "-compression_level", "0", "-ac", str(min(2, int(audio.get("channels") or 2))), "-ar", str(rate if rate in (32000, 44100, 48000) else 48000)]
    command += ["-fflags", "+bitexact", "-flags:a", "+bitexact", "-id3v2_version", "0", "-write_id3v1", "0", "-write_xing", "1", "-metadata", "encoder=", str(target)]
    try: run(command, cancelled)
    except MediaError as error: raise MediaError(error.code, "The audio could not be saved as a clean MP3. No incomplete file was saved.") from error
    state("verifying")
    frames(target, cancelled)
    after = probe(target, cancelled)
    streams = after.get("streams", [])
    if len(streams) != 1 or streams[0].get("codec_name") != "mp3" or after.get("chapters") or after.get("format", {}).get("tags") or streams[0].get("tags"):
        raise MediaError("unverified_metadata", "The MP3's tracks or metadata could not be verified.")
    tags = json.loads(run([binary("exiftool"), "-j", "-G1", str(target)], cancelled, 120))[0]
    for key in tags:
        group, _, name = key.partition(":")
        if key == "SourceFile" or group in ("ExifTool", "System"): continue
        if name not in TECHNICAL: raise MediaError("unverified_metadata", "Unexpected metadata remained in the MP3. No file was saved.")
    old_duration = float(audio.get("duration") or before.get("format", {}).get("duration") or 0)
    new_duration = float(streams[0].get("duration") or after.get("format", {}).get("duration") or 0)
    if old_duration and abs(old_duration - new_duration) > max(.15, old_duration * .001):
        raise MediaError("verification_failed", "The MP3 duration did not match the source audio. No incomplete file was saved.")
    decoded = audio_hash(target, cancelled)  # Full-file decode also rejects damage.
    if copied and decoded != audio_hash(source, cancelled):
        raise MediaError("audio_changed", "The original MP3 audio could not be preserved safely.")
    clear_source_attributes(target)
    return {"bitrate": round(int(streams[0].get("bit_rate") or 0) / 1000), "sampleRate": int(streams[0]["sample_rate"]), "channels": streams[0]["channels"], "copied": copied}
