/** Validate raster signatures before handing untrusted bytes to the decoder. */
export function rasterType(bytes: Uint8Array): string | undefined {
  const ascii = (start: number, end: number) => String.fromCharCode(...bytes.slice(start, end));
  if (bytes.length >= 24 && bytes[0] === 137 && ascii(1, 4) === 'PNG' && bytes[4] === 13 && bytes[5] === 10 && bytes[6] === 26 && bytes[7] === 10) return 'image/png';
  if (bytes.length >= 4 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return 'image/jpeg';
  if (bytes.length >= 12 && ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return 'image/webp';
  if (bytes.length >= 10 && ['GIF87a', 'GIF89a'].includes(ascii(0, 6))) return 'image/gif';
  if (bytes.length >= 26 && ascii(0, 2) === 'BM') return 'image/bmp';
  return undefined;
}

/** Read dimensions before decoding, including JPEGs with application segments. */
export function rasterDimensions(bytes: Uint8Array): { width: number; height: number } | undefined {
  const type = rasterType(bytes), view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let width = 0, height = 0;
  if (type === 'image/png') { width = view.getUint32(16); height = view.getUint32(20); }
  else if (type === 'image/gif') { width = view.getUint16(6, true); height = view.getUint16(8, true); }
  else if (type === 'image/bmp') {
    if (view.getUint32(14, true) === 12) { width = view.getUint16(18, true); height = view.getUint16(20, true); }
    else { width = view.getInt32(18, true); height = Math.abs(view.getInt32(22, true)); }
  } else if (type === 'image/webp' && bytes.length >= 30) {
    const chunk = String.fromCharCode(...bytes.slice(12, 16));
    const uint24 = (at: number) => bytes[at]! + bytes[at + 1]! * 256 + bytes[at + 2]! * 65536;
    if (chunk === 'VP8X') { width = uint24(24) + 1; height = uint24(27) + 1; }
    else if (chunk === 'VP8 ' && bytes[23] === 157 && bytes[24] === 1 && bytes[25] === 42) { width = view.getUint16(26, true) & 16383; height = view.getUint16(28, true) & 16383; }
    else if (chunk === 'VP8L' && bytes[20] === 47) { const bits = view.getUint32(21, true); width = (bits & 16383) + 1; height = ((bits >>> 14) & 16383) + 1; }
  } else if (type === 'image/jpeg') {
    let at = 2;
    while (at < bytes.length) {
      if (bytes[at++] !== 255) return;
      while (bytes[at] === 255) at++;
      const marker = bytes[at++];
      if (marker === undefined || marker === 217 || marker === 218) break;
      if (marker === 1 || marker >= 208 && marker <= 215) continue;
      if (at + 2 > bytes.length) return;
      const length = view.getUint16(at);
      if (length < 2 || at + length > bytes.length) return;
      if (marker >= 192 && marker <= 207 && ![196, 200, 204].includes(marker)) {
        if (length < 7) return;
        height = view.getUint16(at + 3); width = view.getUint16(at + 5); break;
      }
      at += length;
    }
  }
  if (width > 0 && height > 0) return { width, height };
}
