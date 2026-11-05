// Small, store-only ZIP writer. PNG is already compressed; no third-party runtime code.
// Names are generated timestamps, never page titles, URLs, or caller-selected paths.
const table = Uint32Array.from({ length: 256 }, (_, n) => {
  for (let bit = 0; bit < 8; bit++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1;
  return n >>> 0;
});
const crc32 = bytes => {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = table[(crc ^ byte) & 255] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
};
export async function pngArchive(entries) {
  if (!Array.isArray(entries) || !entries.length || entries.length > 64) throw new Error('Invalid image archive');
  const local = [], directory = [], names = new Set();
  let offset = 0, directorySize = 0;
  for (const { name, blob } of entries) {
    if (!/^still-[\w.-]+\.png$/.test(name) || name.length > 160 || names.has(name) || !(blob instanceof Blob) || blob.type !== 'image/png') throw new Error('Invalid image archive');
    names.add(name);
    const nameBytes = new TextEncoder().encode(name), size = blob.size;
    if (!size || size > 0xffffffff || offset + size + nameBytes.length + 30 > 0xffffffff) throw new Error('Image archive too large');
    const crc = crc32(new Uint8Array(await blob.arrayBuffer()));
    const header = new Uint8Array(30), h = new DataView(header.buffer);
    h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true);
    h.setUint16(12, 33, true); // ZIP's fixed 1980-01-01 date; timestamp is in the filename.
    h.setUint32(14, crc, true); h.setUint32(18, size, true); h.setUint32(22, size, true); h.setUint16(26, nameBytes.length, true);
    local.push(header, nameBytes, blob);
    const central = new Uint8Array(46), c = new DataView(central.buffer);
    c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(14, 33, true);
    c.setUint32(16, crc, true); c.setUint32(20, size, true); c.setUint32(24, size, true); c.setUint16(28, nameBytes.length, true); c.setUint32(42, offset, true);
    directory.push(central, nameBytes); directorySize += central.length + nameBytes.length;
    offset += header.length + nameBytes.length + size;
  }
  const end = new Uint8Array(22), e = new DataView(end.buffer);
  e.setUint32(0, 0x06054b50, true); e.setUint16(8, entries.length, true); e.setUint16(10, entries.length, true);
  e.setUint32(12, directorySize, true); e.setUint32(16, offset, true);
  return new Blob([...local, ...directory, end], { type: 'application/zip' });
}
