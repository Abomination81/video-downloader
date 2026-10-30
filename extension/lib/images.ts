import { isHttp } from './detection';
import type { ImageMedia, Snapshot, Source } from './schema';

/** Parse URL tokens without splitting commas inside an image URL or data URI. */
export function srcset(value: string, base: string, naturalWidth: number): { url: string; score: number }[] {
  value = value.slice(0, 65536);
  const result: { url: string; score: number }[] = [];
  let position = 0;
  while (position < value.length && result.length < 32) {
    while (/[\s,]/.test(value[position] ?? '') && position < value.length) position++;
    const begin = position;
    while (position < value.length && !/\s/.test(value[position]!)) position++;
    let url = value.slice(begin, position), descriptor = '';
    if (url.endsWith(',')) url = url.replace(/,+$/, '');
    else {
      const start = position;
      while (position < value.length && value[position] !== ',') position++;
      descriptor = value.slice(start, position).trim();
    }
    position++;
    if (!url) continue;
    const match = descriptor.match(/^(\d+(?:\.\d+)?)(w|x)$/);
    if (descriptor && !match) continue;
    try {
      const resolved = new URL(url, base).href;
      if (isHttp(resolved) && resolved.length <= 16384) result.push({ url: resolved, score: match ? Number(match[1]) * (match[2] === 'x' ? Math.max(1, naturalWidth) : 1) : Math.max(1, naturalWidth) });
    } catch { /* An invalid alternative is not a download source. */ }
  }
  return result;
}

export function imageSources(image: HTMLImageElement): { url: string; score: number }[] {
  const width = image.naturalWidth || image.width || 1;
  const choices = srcset(image.srcset, image.baseURI, width);
  for (const source of image.closest('picture')?.querySelectorAll('source') ?? []) {
    if (!source.media || matchMedia(source.media).matches) choices.push(...srcset(source.srcset, image.baseURI, width));
  }
  for (const name of ['data-original', 'data-full', 'data-zoom-image', 'data-large_image']) {
    const value = image.getAttribute(name);
    if (!value) continue;
    try { const url = new URL(value, image.baseURI).href; if (isHttp(url)) choices.push({ url, score: 1000000 }); } catch { /* Ignore invalid markup. */ }
  }
  for (const url of [image.currentSrc, image.src]) if (isHttp(url) && url.length <= 16384) choices.push({ url, score: width });
  const seen = new Set<string>();
  return choices.sort((a, b) => b.score - a.score).filter((source) => { if (seen.has(source.url)) return false; seen.add(source.url); return true; }).slice(0, 16);
}

export function selectedImage(snapshots: Snapshot[], frameId: number, nativeSource?: string): { image: ImageMedia; frame: Snapshot } | undefined {
  const local = snapshots.find((s) => s.frameId === frameId);
  const match = local?.images?.find((image) => nativeSource && (image.currentSrc === nativeSource || image.sources.some((s) => s.url === nativeSource)));
  if (match && local) return { image: match, frame: local };
  if (local?.point && Date.now() - local.point.at < 15000) {
    const image = local.images?.find((i) => local.point!.x >= i.rect.x && local.point!.x <= i.rect.x + i.rect.width && local.point!.y >= i.rect.y && local.point!.y <= i.rect.y + i.rect.height);
    if (image) return { image, frame: local };
  }
}
