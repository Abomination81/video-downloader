import { z } from 'zod';
import { httpUrl, type Snapshot } from './schema';
import { selectedImage } from './images';
import { within } from './probe';

const limit = 12 * 1024 * 1024;
export function initializeOCR(contexts: Map<number, Snapshot>) {
  chrome.runtime.onMessage.addListener((raw, sender, respond) => {
    if (sender.id !== chrome.runtime.id || !['popup.html', 'options.html', 'ocr.html'].some(path => sender.url?.split(/[?#]/)[0] === chrome.runtime.getURL(path)) || !raw?.type?.startsWith('ocr-')) return;
    const parsed = z.discriminatedUnion('type', [
      z.object({ type: z.literal('ocr-open'), tabId: z.number().int().nonnegative() }).strict(),
      z.object({ type: z.literal('ocr-image'), id: z.string().uuid() }).strict(),
    ]).safeParse(raw);
    if (!parsed.success) return;
    const message = parsed.data;
    void (async () => {
      if (message.type === 'ocr-open') {
        const tab = await chrome.tabs.get(message.tabId), context = contexts.get(message.tabId);
        const match = context && selectedImage([context], context.frameId);
        if (!match || !context || !tab.url || !context.point || Date.now() - context.point.at > 60000) throw new Error('Right-click the image first, then open this toolbar and choose Copy text from image.');
        const frame = await chrome.webNavigation.getFrame({ tabId: message.tabId, frameId: context.frameId });
        if (!frame || frame.url !== context.url) throw new Error('The selected image’s page changed. Right-click the image again.');
        const id = crypto.randomUUID();
        // Only the temporary source reference is kept, never OCR text or pixels.
        const stored = await chrome.storage.session.get('ocrSources');
        const sources = z.record(z.string(), z.unknown()).catch({}).parse(stored.ocrSources);
        const source = { url: match.image.inline ? 'data:' : match.image.currentSrc, imageId: match.image.id, tabId: message.tabId, documentId: frame.documentId, at: Date.now() };
        await chrome.storage.session.set({ ocrSources: { ...Object.fromEntries(Object.entries(sources).slice(-3)), [id]: source } });
        await chrome.tabs.create({ url: chrome.runtime.getURL(`ocr.html#${id}`) }); return {};
      }
      if (!sender.url?.startsWith(chrome.runtime.getURL('ocr.html'))) throw new Error('Open the image text tool first.');
      const stored = await chrome.storage.session.get('ocrSources');
      const sources = z.record(z.string(), z.unknown()).catch({}).parse(stored.ocrSources);
      const source = z.object({ url: z.string().max(16384), imageId: z.string().max(80), tabId: z.number().int(), documentId: z.string().regex(/^(?:[0-9a-f]{32}|[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12})$/i), at: z.number() }).strict().parse(sources[message.id]);
      delete sources[message.id]; await chrome.storage.session.set({ ocrSources: sources });
      if (Date.now() - source.at > 5 * 60 * 1000) throw new Error('This image selection expired. Select it again.');
      const pixels = await within(chrome.tabs.sendMessage(source.tabId, { type: 'ocr-image-data', id: source.imageId }, { documentId: source.documentId }), 12000).catch(() => null);
      const image = z.object({ data: z.string().max(limit * 1.4).regex(/^data:image\/(?:png|jpeg|webp|gif|bmp);base64,/) }).strict().safeParse(pixels);
      if (image.success) return image.data;
      if (/^(data:|blob:)/.test(source.url)) throw new Error('The selected image is no longer available. Select it again.');
      // Use existing pixels first. A cross-origin fallback never sends cookies
      // or the source page's address to an image host or redirect destination.
      const response = await fetch(httpUrl.parse(source.url), { credentials: 'omit', signal: AbortSignal.timeout(15000), referrerPolicy: 'no-referrer' });
      if (!response.ok) throw new Error('The image server refused this image. Save it, then open it in Copy text.');
      const type = response.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase() ?? '';
      if (!/^image\/(png|jpeg|webp|gif|bmp)$/.test(type)) throw new Error('Choose a PNG, JPEG, WebP, GIF or BMP image.');
      if (Number(response.headers.get('content-length')) > limit) { await response.body?.cancel(); throw new Error('Choose an image smaller than 12 MB.'); }
      const reader = response.body?.getReader(); if (!reader) throw new Error('The image could not be read.');
      const parts: Uint8Array[] = []; let size = 0;
      while (true) { const { done, value } = await reader.read(); if (done) break; size += value.length; if (size > limit) { await reader.cancel(); throw new Error('Choose an image smaller than 12 MB.'); } parts.push(value); }
      let binary = ''; for (const part of parts) for (let i = 0; i < part.length; i += 16384) binary += String.fromCharCode(...part.subarray(i, i + 16384));
      return { data: `data:${type};base64,${btoa(binary)}` };
    })().then(result => respond({ ok: true, result }), error => respond({ ok: false, error: { code: 'ocr_failed', message: error instanceof z.ZodError ? 'This image is no longer available. Right-click it again.' : error instanceof Error ? error.message : 'The image could not be read.' } }));
    return true;
  });
}
