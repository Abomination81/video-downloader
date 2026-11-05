import domains from '../site-exceptions.json';

export const siteExceptions: readonly string[] = domains;
export function isExemptHost(host: string | undefined) {
  const normalized = host?.toLowerCase().replace(/\.$/, '') ?? '';
  return siteExceptions.some(site => normalized === site || normalized.endsWith(`.${site}`));
}
export function isExemptUrl(url: string | undefined) {
  try { const value = new URL(url ?? ''); return /^https?:$/.test(value.protocol) && isExemptHost(value.hostname); }
  catch { return false; }
}
export function isExemptDocument() {
  return [location.href, ...Array.from(location.ancestorOrigins ?? [])].some(isExemptUrl);
}
export function isExemptFrame(frameId: number, frames: ReadonlyArray<{ frameId: number; parentFrameId: number; url: string }>, tabUrl: string | undefined) {
  if (isExemptUrl(tabUrl)) return true;
  const visited = new Set<number>();
  while (frameId >= 0 && !visited.has(frameId)) {
    visited.add(frameId);
    const frame = frames.find(value => value.frameId === frameId);
    if (!frame) return false;
    if (isExemptUrl(frame.url)) return true;
    frameId = frame.parentFrameId;
  }
  return false;
}
