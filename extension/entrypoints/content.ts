import { defaults, httpUrl, settingsSchema } from '../lib/schema';
import { contains } from '../lib/detection';
import { uuid } from '../lib/uuid';
import { isEditing, isSelectionControl } from '../lib/copy-policy';
import { imageSources } from '../lib/images';

export default defineContentScript({
  matches: ['http://*/*', 'https://*/*'],
  allFrames: true, matchAboutBlank: true, matchOriginAsFallback: true, runAt: 'document_start',
  main(ctx) {
    const token = uuid();
    const frameTokens = new WeakMap<HTMLIFrameElement, string>();
    const ids = new WeakMap<Element, string>();
    let point: { x: number; y: number; at: number } | undefined;
    let restoreMenus = defaults.restoreMenus;
    let restoreCopy = defaults.restoreCopy;
    let tabHasMedia = false;
    let announced = false;
    let adSheet:CSSStyleSheet|undefined;
    let adCSS='';
    function applyAdCSS(css:string) {
      if(css===adCSS)return;
      adCSS=css;
      if(!css&&!adSheet)return;
      adSheet??=new CSSStyleSheet();
      adSheet.replaceSync(css);
      const sheets=document.adoptedStyleSheets.filter(sheet=>sheet!==adSheet);
      document.adoptedStyleSheets=css?[...sheets,adSheet]:sheets;
    }
    ctx.onInvalidated(()=>{if(adSheet)document.adoptedStyleSheets=document.adoptedStyleSheets.filter(sheet=>sheet!==adSheet);});
    const channel = '__video_downloader_frames_v1__';
    const box = (el: Element) => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; };
    function elements(): Element[] {
      const found: Element[] = [];
      const roots: (Document | ShadowRoot)[] = [document];
      for (let i = 0; i < roots.length && found.length < 30000; i++) {
        for (const element of roots[i]!.querySelectorAll('*')) {
          found.push(element);
          const root = element instanceof HTMLElement ? chrome.dom.openOrClosedShadowRoot(element) as ShadowRoot | null : null;
          if (root) roots.push(root);
          if (found.length >= 30000) break;
        }
      }
      return found;
    }
    function announce() {
      if (window.parent !== window) window.parent.postMessage({ channel, type: 'hello', token }, '*');
    }
    ctx.addEventListener(window, 'message', (event) => {
      const data = event.data;
      if (!data || data.channel !== channel) return;
      if (data.type === 'identify') { announce(); return; }
      if (data.type !== 'hello' || typeof data.token !== 'string' || !/^[0-9a-f-]{36}$/.test(data.token)) return;
      for (const element of elements()) {
        if (element instanceof HTMLIFrameElement && element.contentWindow === event.source) frameTokens.set(element, data.token);
      }
    });
    function snapshot() {
      const all = elements();
      const videos = all.filter((el): el is HTMLVideoElement => el instanceof HTMLVideoElement).slice(0, 100);
      if (videos.length && !announced) {
        announced = true;
        void chrome.runtime.sendMessage({ type: 'media-present' }).catch(() => { /* Extension may have been reloaded; a page reload reconnects it. */ });
      }
      const media = videos.map((video) => {
        if (!ids.has(video)) ids.set(video, uuid());
        const rect = box(video);
        const style = getComputedStyle(video);
        let permalink: string | undefined;
        let parent: Element | null = video;
        for (let i = 0; parent && i < 5; i++, parent = parent.parentElement) {
          const links = [...parent.querySelectorAll<HTMLAnchorElement>('a[href]')].filter((a) => /\/(status|reels?|videos?|shorts?|clips?)\//.test(a.pathname));
          if (links.length === 1) { permalink = links[0]!.href; break; }
        }
        return {
          id: ids.get(video)!, sources: [...new Set([video.currentSrc, video.src, ...[...video.querySelectorAll('source')].map((s) => s.src)].filter(Boolean))].slice(0, 12),
          ...(permalink ? { permalink } : {}), rect, width: video.videoWidth, height: video.videoHeight,
          duration: Number.isFinite(video.duration) ? video.duration : 0, currentTime: Number.isFinite(video.currentTime) ? video.currentTime : 0,
          playing: !video.paused && !video.ended, visible: rect.width > 20 && rect.height > 20 && style.display !== 'none' && style.visibility !== 'hidden',
          protected: video.mediaKeys !== null,
          title: (video.getAttribute('aria-label') || video.title || document.title).slice(0, 300),
        };
      });
      const frames = all.filter((el): el is HTMLIFrameElement => el instanceof HTMLIFrameElement).slice(0, 100).map((frame) => {
        frame.contentWindow?.postMessage({ channel, type: 'identify' }, '*');
        return { ...(frameTokens.has(frame) ? { token: frameTokens.get(frame) } : {}), src: frame.src.slice(0, 16384), rect: box(frame) };
      });
      const imageElements = all.filter((el): el is HTMLImageElement => el instanceof HTMLImageElement);
      const pointed = point ? imageElements.find((image) => contains(box(image), point!)) : undefined;
      const images = (pointed ? [pointed, ...imageElements.filter((image) => image !== pointed)] : imageElements).slice(0, 100).map((image) => {
        if (!ids.has(image)) ids.set(image, uuid());
        return { id: ids.get(image)!, currentSrc: image.currentSrc.length <= 16384 ? image.currentSrc : '', sources: imageSources(image), rect: box(image), width: image.naturalWidth, height: image.naturalHeight, inline: /^(data:|blob:)/.test(image.currentSrc || image.src), title: (image.alt || image.title || 'Image').slice(0, 300) };
      });
      return { token, url: location.href.slice(0, 16384), title: document.title.slice(0, 300), viewport: { width: innerWidth, height: innerHeight }, media, images, frames, ...(point ? { point } : {}) };
    }
    // Capture before site bubble/inline handlers. Do not prevent the native menu.
    function clickedLink(event: MouseEvent | PointerEvent) {
      const anchor = event.composedPath().find((node): node is HTMLAnchorElement => node instanceof HTMLAnchorElement);
      return anchor && httpUrl.safeParse(anchor.href).success ? { linkUrl: anchor.href } : {};
    }
    ctx.addEventListener(window, 'contextmenu', (event) => {
      if (restoreMenus) event.stopImmediatePropagation();
      point = { x: event.clientX, y: event.clientY, at: Date.now() };
      const data = snapshot();
      void chrome.runtime.sendMessage({ type: 'context', snapshot: data, ...clickedLink(event) }).catch(() => { /* A stale content script has no privileged fallback. */ });
    }, { capture: true });
    ctx.addEventListener(window, 'pointerdown', (event) => {
      // Left-button events belong to the page: custom seek bars, sliders and
      // drag controls often use plain divs without roles or tabindex.
      if (event.button !== 2) return;
      if (restoreMenus) event.stopImmediatePropagation();
      point = { x: event.clientX, y: event.clientY, at: Date.now() };
      const data = snapshot();
      void chrome.runtime.sendMessage({ type: 'context', snapshot: data, ...clickedLink(event) }).catch(() => { /* Page reload reconnects an invalidated content script. */ });
    }, { capture: true });
    ctx.addEventListener(window, 'mousedown', (event) => {
      if (event.button === 2 && restoreMenus) event.stopImmediatePropagation();
    }, { capture: true });
    for (const name of ['copy', 'selectstart']) ctx.addEventListener(window, name, (event) => {
      if (restoreCopy && !isEditing(event.target) && (name !== 'selectstart' || !isSelectionControl(event))) event.stopImmediatePropagation();
    }, { capture: true });
    ctx.addEventListener(window, 'keydown', (event) => {
      if (restoreCopy && !isEditing(event.target) && (event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey && ['a', 'c'].includes(event.key.toLowerCase())) event.stopImmediatePropagation();
    }, { capture: true });
    const onRuntimeMessage: Parameters<typeof chrome.runtime.onMessage.addListener>[0] = (message, sender, respond) => {
      if(message?.type==='ad-policy') {
        if(sender.id!==chrome.runtime.id||sender.tab||typeof message.css!=='string'||message.css.length>750000)return;
        try{applyAdCSS(message.css);respond({ok:true});}catch{respond({ok:false});}
        return;
      }
      if (message?.type === 'probe') respond(snapshot());
      if (message?.type === 'ocr-image-data' && sender.id === chrome.runtime.id && !sender.tab && typeof message.id === 'string') {
        const image = elements().find(el => el instanceof HTMLImageElement && ids.get(el) === message.id) as HTMLImageElement | undefined;
        if (!image) { respond(null); return; }
        if (!/^(blob:|data:)/.test(image.currentSrc || image.src)) {
          try {
            if (!image.complete || !image.naturalWidth || image.naturalWidth * image.naturalHeight > 40_000_000) throw new Error('Image unavailable');
            const scale = Math.min(1, Math.sqrt(6_000_000 / (image.naturalWidth * image.naturalHeight)));
            const canvas = document.createElement('canvas'); canvas.width = Math.round(image.naturalWidth * scale); canvas.height = Math.round(image.naturalHeight * scale);
            canvas.getContext('2d')!.drawImage(image, 0, 0, canvas.width, canvas.height);
            const data = canvas.toDataURL('image/png');
            respond(data.length <= 17_000_000 ? { data } : null);
          } catch { respond(null); } // Cross-origin pixels need the cookieless background fetch.
          return;
        }
        void (async () => {
          const response = await fetch(image.currentSrc || image.src, { signal: AbortSignal.timeout(10000) });
          const reader = response.body?.getReader(); if (!reader) throw new Error('No image body');
          const chunks: Uint8Array[] = []; let size = 0;
          while (true) { const { done, value } = await reader.read(); if (done) break; size += value.length; if (size > 12 * 1024 * 1024) { await reader.cancel(); throw new Error('Image too large'); } chunks.push(value); }
          const type = response.headers.get('content-type')?.split(';')[0] ?? '';
          if (!/^image\/(png|jpeg|webp|gif|bmp)$/.test(type)) throw new Error('Unsupported image');
          let binary = ''; for (const chunk of chunks) for (let i = 0; i < chunk.length; i += 16384) binary += String.fromCharCode(...chunk.subarray(i, i + 16384));
          respond({ data: `data:${type};base64,${btoa(binary)}` });
        })().catch(() => respond(null)); return true;
      }
      if (message?.type === 'image-data' && typeof message.id === 'string') {
        const image = elements().find((el) => el instanceof HTMLImageElement && ids.get(el) === message.id) as HTMLImageElement | undefined;
        if (!image || !/^(blob:|data:)/.test(image.currentSrc || image.src)) { respond({ ok: false }); return; }
        void (async () => {
          const response = await fetch(image.currentSrc || image.src, { signal: AbortSignal.timeout(10000) });
          const reader = response.body?.getReader();
          if (!reader) throw new Error('No image body');
          const chunks: Uint8Array[] = []; let length = 0;
          while (true) { const { done, value } = await reader.read(); if (done) break; length += value.length; if (length > 512 * 1024) { await reader.cancel(); throw new Error('Inline image too large'); } chunks.push(value); }
          const bytes = new Uint8Array(length); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
          let value = ''; for (const byte of bytes) value += String.fromCharCode(byte);
          respond({ ok: true, data: btoa(value) });
        })().catch(() => respond({ ok: false }));
        return true;
      }
      if (message?.type === 'menu-policy') { tabHasMedia = message.hasMedia === true; restoreMenus = message.restoreMenus !== false; restoreCopy = message.restoreCopy !== false; respond({ ok: true }); }
    };
    chrome.runtime.onMessage.addListener(onRuntimeMessage);
    ctx.onInvalidated(() => { if (chrome.runtime?.id) chrome.runtime.onMessage.removeListener(onRuntimeMessage); });
    void chrome.storage.local.get('settings').then((result) => { const value = settingsSchema.parse({ ...defaults, ...(result.settings as object ?? {}) }); restoreMenus = value.restoreMenus; restoreCopy = value.restoreCopy; });
    const onSettingsChanged: Parameters<typeof chrome.storage.onChanged.addListener>[0] = (changes, area) => {
      if (area === 'local' && changes.settings) {
        const parsed = settingsSchema.safeParse(changes.settings.newValue);
        if (parsed.success) { restoreMenus = parsed.data.restoreMenus; restoreCopy = parsed.data.restoreCopy; }
      }
    };
    chrome.storage.onChanged.addListener(onSettingsChanged);
    ctx.onInvalidated(() => { if (chrome.runtime?.id) chrome.storage.onChanged.removeListener(onSettingsChanged); });
    ctx.addEventListener(document, 'loadedmetadata', () => { if (!announced) snapshot(); }, { capture: true });
    ctx.addEventListener(document, 'play', () => { if (!announced) snapshot(); }, { capture: true });
    ctx.addEventListener(document, 'DOMContentLoaded', () => { announce(); snapshot(); }, { once: true });
    announce();
    void chrome.runtime.sendMessage({ type: 'frame-ready' }).catch(() => { /* No privileges are available after an extension reload. */ });
    // Start the page-window guard before document_idle/UI initialization.
    void chrome.runtime.sendMessage({ type: 'browsing-policy' }).catch(() => {});
    ctx.setTimeout(announce, 250);
    ctx.setTimeout(announce, 1000);
  },
});
