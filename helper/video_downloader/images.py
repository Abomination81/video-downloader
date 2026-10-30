"""Lossless image metadata cleanup. Image encoders are never used to save pixels."""
import hashlib
import json
import re
import shutil
import struct
import warnings
from pathlib import Path

from lxml import etree
from PIL import Image

from .config import binary
from .media import MediaError, clear_source_attributes, run

FORMATS = {
    "JPEG": ("jpg", "image/jpeg"), "PNG": ("png", "image/png"),
    "WEBP": ("webp", "image/webp"), "GIF": ("gif", "image/gif"),
    "TIFF": ("tiff", "image/tiff"), "AVIF": ("avif", "image/avif"),
    "HEIC": ("heic", "image/heic"), "HEIF": ("heif", "image/heif"),
    "JXL": ("jxl", "image/jxl"), "SVG": ("svg", "image/svg+xml"),
}
EXTENSIONS = {"jpg", "jpeg", "png", "webp", "gif", "tif", "tiff", "avif", "heic", "heif", "jxl", "svg"}
MAX_BYTES = 512 * 1024 * 1024


def exif(path, *arguments):
    try: return run([binary("exiftool"), *arguments, str(path)], timeout=120)
    except MediaError as error:
        raise MediaError("image_processing_failed", "The image could not be cleaned safely. Its original file was kept.") from error


def tags(path):
    data = json.loads(exif(path, "-j", "-G1", "-a", "-u", "-n"))[0]
    if any(key.rsplit(":", 1)[-1] in ("Warning", "Error") for key in data):
        raise MediaError("unverified_image", "This image has a structure that could not be checked safely.")
    return data


def value(info, name):
    return next((v for key, v in info.items() if key.rsplit(":", 1)[-1] == name), None)


# Numeric calibration/LUT tags. Descriptions, source devices, dates, profile
# histories, private dictionaries and unknown vendor tags are not retained.
ICC_COLOR = set(b"rXYZ gXYZ bXYZ wtpt bkpt rTRC gTRC bTRC kTRC A2B0 A2B1 A2B2 B2A0 B2A1 B2A2 B2D0 B2D1 B2D2 B2D3 D2B0 D2B1 D2B2 D2B3 gamt chad chrm lumi meas view vcgt tech pre0 pre1 pre2 resp cicp MHC2".split())
ICC_INFO = set(b"desc cprt dmnd dmdd vued pseq psid meta targ calt mmod arts".split())


def neutral_icc(data):
    if len(data) < 132 or data[36:40] != b"acsp" or int.from_bytes(data[:4], "big") > len(data):
        raise MediaError("unverified_image", "The image's color profile is malformed.")
    if data[16:20] not in (b"RGB ", b"GRAY", b"CMYK"):
        raise MediaError("unsupported_color_profile", "This image uses a color profile that cannot yet be cleaned without changing its appearance.")
    count = int.from_bytes(data[128:132], "big")
    if count > 1024 or 132 + count * 12 > len(data):
        raise MediaError("unverified_image", "The color-profile directory is malformed.")
    retained = {}
    for index in range(count):
        entry = data[132 + index * 12:144 + index * 12]
        name, offset, length = entry[:4], int.from_bytes(entry[4:8], "big"), int.from_bytes(entry[8:12], "big")
        if offset + length > len(data) or length < 8:
            raise MediaError("unverified_image", "The color-profile directory is malformed.")
        if name in ICC_COLOR: retained[name] = data[offset:offset + length]
        elif name not in ICC_INFO:
            raise MediaError("unsupported_color_profile", "The color profile contains unknown information that cannot safely be removed without changing its colors.")
    text = "Color profile".encode("utf-16-be")
    neutral = b"mluc" + b"\0" * 4 + struct.pack(">II", 1, 12) + b"enUS" + struct.pack(">II", len(text), 28) + text
    if data[8] >= 4:
        retained[b"desc"] = neutral
        retained[b"cprt"] = b"mluc" + b"\0" * 4 + struct.pack(">II", 1, 12) + b"enUS" + struct.pack(">II", 0, 28)
    else:
        name = b"Color profile\0"
        retained[b"desc"] = b"desc" + b"\0" * 4 + struct.pack(">I", len(name)) + name + b"\0" * 78
        retained[b"cprt"] = b"text" + b"\0" * 5
    header = bytearray(data[:128])
    header[4:8] = b"\0" * 4
    header[24:36] = struct.pack(">6H", 2000, 1, 1, 0, 0, 0)
    header[40:44] = b"\0" * 4
    header[48:56] = b"\0" * 8
    header[80:128] = b"\0" * 48
    table, content = bytearray(), bytearray()
    offset = 132 + len(retained) * 12
    for name, payload in sorted(retained.items()):
        table.extend(name + struct.pack(">II", offset + len(content), len(payload)))
        content.extend(payload)
        content.extend(b"\0" * (-len(payload) % 4))
    result = header + struct.pack(">I", len(retained)) + table + content
    result[:4] = struct.pack(">I", len(result))
    # ICC v4 profile ID excludes flags, rendering intent and the ID itself.
    if data[8] >= 4:
        identity = bytearray(result)
        identity[44:48] = identity[64:68] = b"\0" * 4
        result[84:100] = hashlib.md5(identity, usedforsecurity=False).digest()
    return bytes(result)


TECHNICAL = set("""
ExifToolVersion FileName Directory FileSize FileModifyDate FileAccessDate FileInodeChangeDate FileCreateDate FilePermissions
FileType FileTypeExtension MIMEType ExifByteOrder ImageWidth ImageHeight ImageSize Megapixels ImageDataHash
EncodingProcess BitsPerSample ColorComponents YCbCrSubSampling JFIFVersion ResolutionUnit XResolution YResolution
Orientation ColorSpace ExifVersion FlashpixVersion ComponentsConfiguration InteropIndex InteropVersion
DCTEncodeVersion APP14Flags0 APP14Flags1 ColorTransform Gamma SRGBRendering Chromaticities WhitePoint PrimaryChromaticities
BitDepth ColorType Compression Filter Interlace PixelsPerUnitX PixelsPerUnitY PixelUnits BackgroundColor Palette Transparency
ImageLength ImageDepth ImagePixelDepth AlphaBitDepth LuminanceBitDepth NumChannels ColorPlanes PhotometricInterpretation
SamplesPerPixel RowsPerStrip StripOffsets StripByteCounts PlanarConfiguration Predictor FillOrder ExtraSamples SampleFormat
TileWidth TileLength TileOffsets TileByteCounts ColorMap TransferFunction YCbCrCoefficients YCbCrPositioning ReferenceBlackWhite
RIFFType VP8Version ImageWidth ImageHeight HorizontalScale VerticalScale AlphaIsUsed Animation BackgroundColor HasAlpha IsAnimated
VP8XFlags AnimationLoopCount AnimationFrameCount Duration FrameCount FrameRate FrameDuration FrameX FrameY FrameWidth FrameHeight
Dispose Blend CompressionSpeed LoopCount AnimationIterations GIFVersion ColorResolution HasColorMap ColorMapSize BackgroundColorIndex
BitsPerPixel CanvasWidth CanvasHeight MaxCanvasWidth MaxCanvasHeight PixelAspectRatio HasTransparency TransparentColorIndex
ScreenWidth ScreenHeight GlobalColorTableSize ColorTableSize Interlaced DisposalMethod Delay TimeStamp
ColorResolutionDepth ProfileName AV1ConfigurationVersion SeqProfile SeqLevelIdx0 SeqTier0 HighBitDepth TwelveBit ChromaFormat InitialDelaySamples ColorProfiles MediaData
WebP_Flags TransparentColor AnimationFrames AnimationPlays NewSubfileType SubfileType PageNumber SubIFD SubIFDOffset
MajorBrand MinorVersion CompatibleBrands HandlerType HandlerDescription HandlerVendorID ImageSpatialExtent ImageBitDepth
ImagePixelDepths PixelInformation ColorPrimaries TransferCharacteristics MatrixCoefficients VideoFullRangeFlag
PrimaryItemReference ItemID ItemType ItemProtectionIndex MediaDataSize MediaDataOffset Rotation Mirror ExifImageWidth ExifImageHeight
CompressionFormat ChromaSubsampling ChromaSamplePosition BitstreamVersion SpatialResolution DisplayWidth DisplayHeight
""".split())


def verify_tags(path, expected_icc):
    info = tags(path)
    if value(info, "ProfileName") not in (None, "ICC Profile"):
        raise MediaError("unverified_image_metadata", "The image's profile label could not be verified.")
    for key, val in info.items():
        if key == "SourceFile": continue
        group, _, name = key.rpartition(":")
        if group.startswith("ICC"):
            continue  # The entire binary profile is checked against our scrubbed calibration profile below.
        if name not in TECHNICAL:
            raise MediaError("unverified_image_metadata", "Some image metadata could not be verified. The original file was kept.")
    actual = exif(path, "-b", "-ICC_Profile")
    if actual != expected_icc:
        raise MediaError("image_color_changed", "The image's color information changed unexpectedly. No changed image was saved.")
    return info


def decoded_signature(path):
    # Used for animation and to supplement compressed-data hashes. Do not let a
    # malicious compressed image allocate unbounded frames or raster memory.
    with warnings.catch_warnings():
        warnings.simplefilter("error", Image.DecompressionBombWarning)
        with Image.open(path) as image:
            if image.width * image.height > 90_000_000 or getattr(image, "n_frames", 1) > 20000:
                raise MediaError("image_too_large", "This image is too large to verify safely.")
            result, total = [], 0
            loop = image.info.get("loop")
            for index in range(getattr(image, "n_frames", 1)):
                image.seek(index)
                total += image.width * image.height
                if total > 1_000_000_000: raise MediaError("image_too_large", "This animation is too large to verify safely.")
                result.append((image.size, image.mode, image.info.get("duration", 0), hashlib.sha256(image.convert("RGBA").tobytes()).hexdigest()))
            return loop, result


SVG = "http://www.w3.org/2000/svg"
XLINK = "http://www.w3.org/1999/xlink"
XML = "http://www.w3.org/XML/1998/namespace"


def sanitize_svg(source, target):
    parser = etree.XMLParser(resolve_entities=False, load_dtd=False, no_network=True, huge_tree=False)
    tree = etree.parse(str(source), parser)
    root = tree.getroot()
    if tree.docinfo.doctype or tree.xpath("//processing-instruction('xml-stylesheet')") or root.tag != f"{{{SVG}}}svg" or source.stat().st_size > 32 * 1024 * 1024:
        raise MediaError("unsupported_svg", "This SVG cannot be cleaned safely without changing its artwork.")
    for node in list(root.iter()):
        if not isinstance(node.tag, str):
            if node.getparent() is not None: node.getparent().remove(node)
            continue
        name = etree.QName(node)
        if name.namespace != SVG or name.localname in ("metadata", "title", "desc"):
            if node.getparent() is not None: node.getparent().remove(node)
            continue
        if name.localname in ("script", "foreignObject", "image", "animate", "animateMotion", "animateTransform", "set", "mpath") or any(key.lower().startswith("on") for key in node.attrib):
            raise MediaError("unsupported_svg", "This SVG contains dynamic or embedded content that cannot yet be verified safely.")
        for key in list(node.attrib):
            attr = etree.QName(key)
            if attr.namespace not in (None, SVG, XLINK, XML) or attr.localname.startswith("data-"):
                del node.attrib[key]
            elif attr.localname in ("href", "base") and not node.attrib[key].startswith("#"):
                raise MediaError("unsupported_svg", "This SVG depends on external resources and cannot yet be verified safely.")
        styles = [val for key, val in node.attrib.items() if etree.QName(key).localname == 'style' or re.search(r'url\(', val, re.I)]
        if name.localname == 'style': styles.append(node.text or '')
        for style in styles:
            links = re.findall(r'url\(\s*([^)]*?)\s*\)', style, re.I)
            if '\\' in style or any(not link.strip(' \t\r\n\"\'').startswith('#') for link in links) or re.search(r"@import|:has|:nth|:first|:last|:empty|:only|\[|[+~]|\b(?:metadata|title|desc)\b", style, re.I):
                raise MediaError("unsupported_svg", "This SVG's styling cannot yet be verified safely after metadata removal.")
    etree.cleanup_namespaces(root)
    expected = etree.tostring(root, method="c14n")
    target.write_bytes(etree.tostring(root, encoding="utf-8", xml_declaration=True))
    if etree.tostring(etree.parse(str(target), parser).getroot(), method="c14n") != expected:
        raise MediaError("image_changed", "The SVG drawing structure changed unexpectedly.")
    clear_source_attributes(target)
    width = re.match(r"[\d.]+", root.get("width", ""))
    height = re.match(r"[\d.]+", root.get("height", ""))
    return {"ext": "svg", "mime": "image/svg+xml", "width": width.group() if width else "", "height": height.group() if height else "", "format": "SVG"}


def sanitize_image(source: Path, folder: Path, cancelled=lambda: False):
    if source.stat().st_size > MAX_BYTES: raise MediaError("image_too_large", "This image exceeds the safe processing limit.")
    with source.open("rb") as file: head = file.read(4096)
    if re.search(br"<(?:\w+:)?svg\b", head, re.I):
        target = folder / "clean.svg"
        return target, sanitize_svg(source, target)
    before = tags(source)
    kind = str(value(before, "FileType") or "").upper()
    if kind.endswith("WEBP"): kind = "WEBP"
    if kind == "APNG": kind = "PNG"
    if kind == "SVG":
        target = folder / "clean.svg"
        return target, sanitize_svg(source, target)
    if kind not in FORMATS:
        raise MediaError("unsupported_image", "This image format is not supported for verified metadata cleanup yet.")
    ext, mime = FORMATS[kind]
    target = folder / ("clean." + ext)
    shutil.copyfile(source, target)
    original_icc = exif(source, "-b", "-ICC_Profile")
    expected_icc = neutral_icc(original_icc) if original_icc else b""
    command = [binary("exiftool"), "-overwrite_original", "-all=", "-trailer:all=", "-tagsFromFile", str(source),
               "-Orientation", "-ColorSpace", "-Adobe", "-Gamma", "-SRGBRendering", "-Chromaticities", "-WhitePoint", "-PrimaryChromaticities", "-XResolution", "-YResolution", "-ResolutionUnit"]
    # TIFF's main directory contains both pixels and metadata; -all= alone
    # deliberately leaves its IFD0 descriptive fields. Clear them explicitly.
    for key in before:
        if key == "SourceFile" or key.startswith("ICC"): continue
        if key.rsplit(":", 1)[-1] not in TECHNICAL: command.append("-" + key + "=")
    if expected_icc:
        profile = folder / "color.icc"
        profile.write_bytes(expected_icc)
        command.append("-ICC_Profile<=" + str(profile))
    command.append(str(target))
    try: run(command, cancelled, 120)
    except MediaError as error:
        raise MediaError("image_processing_failed", "The image could not be cleaned safely. Its original file was kept.") from error
    before_hash = json.loads(exif(source, "-j", "-ImageDataHash", "-api", "ImageHashType=SHA256"))[0].get("ImageDataHash")
    after_hash = json.loads(exif(target, "-j", "-ImageDataHash", "-api", "ImageHashType=SHA256"))[0].get("ImageDataHash")
    if before_hash and before_hash != after_hash:
        raise MediaError("image_changed", "The encoded image changed during metadata cleanup. No changed image was saved.")
    if kind in ("GIF", "PNG", "WEBP", "TIFF") or not before_hash:
        if decoded_signature(source) != decoded_signature(target):
            raise MediaError("image_changed", "The image's pixels or animation changed during cleanup. No changed image was saved.")
    after = verify_tags(target, expected_icc)
    for name in ("ImageWidth", "ImageHeight", "Orientation", "ColorSpace", "Gamma", "SRGBRendering", "Chromaticities", "WhitePoint", "PrimaryChromaticities", "ColorTransform", "ColorPrimaries", "TransferCharacteristics", "MatrixCoefficients", "VideoFullRangeFlag", "Rotation", "Mirror", "BitDepth", "ImagePixelDepths", "ColorComponents"):
        if value(before, name) != value(after, name):
            # Missing orientation is equivalent to the ordinary unrotated value.
            if name == "Orientation" and value(before, name) in (None, 1) and value(after, name) in (None, 1): continue
            raise MediaError("image_color_changed", "The image's dimensions, orientation or color information changed. No changed image was saved.")
    clear_source_attributes(target)
    return target, {"ext": ext, "mime": mime, "width": value(after, "ImageWidth"), "height": value(after, "ImageHeight"), "format": kind}
