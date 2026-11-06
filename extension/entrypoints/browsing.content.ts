import { browsingPolicySchema, seekTime, type BrowsingPolicy } from '../lib/browsing-policy';
import { httpUrl } from '../lib/schema';
import { isEditing } from '../lib/copy-policy';
import { request } from '../lib/ui';
import { isExemptDocument } from '../lib/site-exceptions';
import { createVideoControls, hasPlayerControls, videoControlsStyle } from '../lib/video-controls';

export default defineContentScript({
  matches: ['http://*/*', 'https://*/*'], allFrames: true, matchOriginAsFallback: true, runAt: 'document_idle',
  main(ctx) {
    if (isExemptDocument()) return;
    let policy: BrowsingPolicy | undefined;
    let current: HTMLVideoElement | undefined;
    const known = new Set<HTMLVideoElement>();
    const rates = new WeakMap<HTMLVideoElement, number>();
    const restorePiP = new Map<HTMLVideoElement, () => void>();
    const abort = new AbortController();
    const host = document.createElement('div');
    host.id = 'abomination-browsing-tools';
    const root = host.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = `:host{all:initial!important;position:fixed!important;inset:0!important;pointer-events:none!important;z-index:2147483647!important;color-scheme:dark}*{box-sizing:border-box}button,select{font:13px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#eef5ef;background:#262c29;border:1px solid #59625c;border-radius:6px;padding:6px 9px;cursor:pointer}button:hover,select:hover{border-color:#76df8b}button:focus-visible,select:focus-visible{outline:2px solid #76df8b;outline-offset:2px}[hidden]{display:none!important}.notice{position:fixed;bottom:16px;right:16px;max-width:min(520px,calc(100vw - 32px));background:#19201c;color:#eef5ef;border:1px solid #45694d;border-radius:10px;padding:12px;box-shadow:0 3px 18px #0005;pointer-events:auto;font:13px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}.notice p{margin:0 0 9px;overflow-wrap:anywhere}.notice button{margin:0 6px 3px 0}.message{position:fixed;bottom:18px;left:18px;max-width:420px;background:#19201c;color:#eef5ef;padding:10px;border-radius:8px;font:13px/1.5 sans-serif;pointer-events:auto}`;
    style.textContent += videoControlsStyle;
    root.append(style);
    const player = createVideoControls({ current: () => current, speed: changeSpeed, popOut, say: text => say(text) });
    const controls = player.element;
    const notice = document.createElement('div'); notice.className = 'notice'; notice.hidden = true; notice.setAttribute('role', 'status');
    const message = document.createElement('div'); message.className = 'message'; message.hidden = true; message.setAttribute('role', 'status');
    root.append(controls, notice, message); document.documentElement.append(host);
    let messageTimer: ReturnType<typeof setTimeout>;
    const say = (text: string) => { message.textContent = text; message.hidden = false; clearTimeout(messageTimer); messageTimer = setTimeout(() => { message.hidden = true; }, 5000); };
    const button = (text: string, label: string, action: (event: MouseEvent) => void, parent = controls) => {
      const b = document.createElement('button'); b.type = 'button'; b.textContent = text; b.setAttribute('aria-label', label);
      b.addEventListener('click', event => { if (event.isTrusted) { event.stopPropagation(); action(event); } }); parent.append(b); return b;
    };
    const seek = (delta: number) => {
      if (!current) return;
      const time = seekTime(current, delta);
      if (time === undefined) { say('This video does not expose a seekable timeline yet.'); return; }
      current.currentTime = time;
    };
    function changeSpeed(rate: number) {
      if (!current) return;
      rate = Math.max(0.25, Math.min(4, rate));
      rates.set(current, rate); current.playbackRate = rate; player.sync();
      void request({ type: 'browsing-speed', speed: rate }).catch(() => say('The speed changed, but could not be remembered.'));
    }
    async function popOut() {
      const video = current;
      if (!video) return;
      try {
        if (document.pictureInPictureElement) { await document.exitPictureInPicture(); return; }
        if (!document.pictureInPictureEnabled || !video.requestPictureInPicture) throw new Error('This frame does not allow video pop-out. Open the video’s own page and try there.');
        if (!video.videoWidth || video.readyState === 0) throw new Error('Start the video, then choose Pop out.');
        const disabled = video.disablePictureInPicture;
        const restore = () => { video.removeEventListener('leavepictureinpicture', restore); restorePiP.delete(video); video.disablePictureInPicture = disabled; };
        // Chrome exits PiP when this flag is restored while it is still open.
        // Restore only after exit (or failure), and bind to this exact video.
        restorePiP.set(video, restore); video.addEventListener('leavepictureinpicture', restore, { once: true });
        try { video.disablePictureInPicture = false; await video.requestPictureInPicture(); }
        catch (error) { restore(); throw error; }
      } catch (error) { say(error instanceof Error ? error.message : 'This player does not support pop-out.'); }
    }
    function videos() {
      const found: HTMLVideoElement[] = [], roots: (Document | ShadowRoot)[] = [document];
      for (let i = 0; i < roots.length && i < 200; i++) {
        for (const video of roots[i]!.querySelectorAll('video')) found.push(video);
        for (const node of roots[i]!.querySelectorAll('*')) {
          if (!(node instanceof HTMLElement) || node === host) continue;
          const shadow = chrome.dom.openOrClosedShadowRoot(node) as ShadowRoot | null;
          if (shadow) roots.push(shadow);
        }
      }
      return found.slice(0, 100);
    }
    function discover() {
      if (ctx.isInvalid || !policy?.enabled || !policy.videoControls) return;
      let found: HTMLVideoElement[];
      try { found = videos(); }
      catch (error) {
        // Chrome can revoke DOM extension APIs before WXT receives the new
        // script's cleanup event. Retire this scanner; keep other errors visible.
        if (ctx.isInvalid) return;
        throw error;
      }
      for (const video of found) {
        if (!known.has(video)) {
          known.add(video);
          for (const type of ['timeupdate', 'durationchange', 'progress', 'play', 'pause', 'volumechange', 'ratechange', 'loadedmetadata']) {
            video.addEventListener(type, () => { if (current === video && !controls.hidden) player.sync(); }, { signal: abort.signal });
          }
        }
        if (policy.speed !== null && rates.get(video) !== policy.speed) { rates.set(video, policy.speed); video.playbackRate = policy.speed; }
      }
      for (const video of known) if (!video.isConnected) known.delete(video);
    }
    let hovered: HTMLVideoElement | undefined;
    const hoveredFrames = new Set<Window>();
    let pointer = { x: -1, y: -1 }, frame = 0, checkedAt = 0, existingControls = false;
    const inside = (box: DOMRect) => pointer.x >= box.left && pointer.x < box.right && pointer.y >= box.top && pointer.y < box.bottom;
    function leaveFrames() {
      for (const child of hoveredFrames) child.postMessage({ channel: 'abomination-video-hover-exit' }, '*');
      hoveredFrames.clear();
    }
    function hide() {
      if ((hovered || hoveredFrames.size) && window !== window.parent) window.parent.postMessage({ channel: 'abomination-video-hover', active: false }, '*');
      leaveFrames();
      controls.hidden = true; hovered = undefined;
      cancelAnimationFrame(frame); frame = 0;
      // Focus must not keep an invisible toolbar active after leaving the video.
      if (root.activeElement instanceof HTMLElement && controls.contains(root.activeElement)) root.activeElement.blur();
    }
    function renderHover() {
      frame = 0;
      const video = hovered;
      if (ctx.isInvalid || !policy?.enabled || !policy.videoControls || !video?.isConnected) { hide(); return; }
      const box = video.getBoundingClientRect();
      if (!inside(box) || box.width < 220 || box.height < 100 || box.bottom <= 0 || box.top >= innerHeight) { hide(); return; }
      if (performance.now() - checkedAt >= 200) {
        checkedAt = performance.now(); existingControls = hasPlayerControls(video);
      }
      const full = document.fullscreenElement;
      if (existingControls || full instanceof HTMLVideoElement || box.bottom > innerHeight || box.bottom < 58) {
        controls.hidden = true;
      } else {
        const mount = full ?? document.documentElement;
        if (host.parentElement !== mount) mount.append(host);
        const left = Math.max(0, box.left), right = Math.min(innerWidth, box.right);
        controls.style.left = `${left}px`; controls.style.bottom = `${innerHeight - box.bottom}px`;
        controls.style.width = `${right - left}px`;
        if (controls.hidden) player.sync();
        controls.hidden = false;
      }
      frame = requestAnimationFrame(renderHover);
    }
    ctx.addEventListener(document, 'pointermove', event => {
      // A move delivered to this document has left its child frames. Chromium
      // does not always deliver the matching exit event to a cross-origin child.
      if (event.isTrusted) leaveFrames();
      if (!event.isTrusted || !policy?.enabled || !policy.videoControls) return;
      pointer = { x: event.clientX, y: event.clientY };
      const match = event.composedPath().includes(host) && hovered && inside(hovered.getBoundingClientRect()) ? hovered : [...known]
        .filter(v => v.isConnected && inside(v.getBoundingClientRect()))
        .sort((a, b) => Number(a.paused) - Number(b.paused))[0];
      if (!match) { hide(); return; }
      if (match === hovered) return;
      hide(); current = match; hovered = match; checkedAt = -Infinity;
      if (window !== window.parent) window.parent.postMessage({ channel: 'abomination-video-hover', active: true }, '*');
      // Let the site's own hover handlers reveal/create controls before deciding
      // that the player needs ours. Leaving meanwhile cancels both frames.
      frame = requestAnimationFrame(() => { frame = requestAnimationFrame(renderHover); });
    }, { passive: true, capture: true });
    ctx.addEventListener(document, 'pointerout', event => {
      if (!event.relatedTarget || event.relatedTarget instanceof HTMLIFrameElement) hide();
    }, { passive: true, capture: true });
    ctx.addEventListener(document, 'pointerleave', hide, { passive: true });
    ctx.addEventListener(document.documentElement, 'pointerleave', hide, { passive: true });
    ctx.addEventListener(window, 'mouseout', event => { if (!event.relatedTarget) hide(); }, { passive: true });
    ctx.addEventListener(window, 'blur', () => { hide(); leaveFrames(); });
    ctx.addEventListener(window, 'resize', hide, { passive: true });
    ctx.addEventListener(document, 'scroll', hide, { passive: true, capture: true });
    ctx.addEventListener(document, 'visibilitychange', () => { if (document.hidden) hide(); });
    ctx.addEventListener(window, 'message', event => {
      if (event.data?.channel === 'abomination-video-hover-exit' && window !== window.parent && event.source === window.parent) {
        hide(); leaveFrames();
      } else if (event.data?.channel === 'abomination-video-hover' && typeof event.data.active === 'boolean') {
        // This channel can only dismiss UI; it never authorizes player actions.
        for (let i = 0; i < Math.min(window.frames.length, 200); i++) {
          const child = window.frames[i]!;
          if (event.source !== child) continue;
          if (event.data.active) {
            hoveredFrames.add(child);
            if (window !== window.parent) window.parent.postMessage({ channel: 'abomination-video-hover', active: true }, '*');
          } else hoveredFrames.delete(child);
          break;
        }
      }
    });
    ctx.addEventListener(document, 'keydown', event => {
      if (!policy?.enabled || !policy.videoControls || !event.isTrusted || isEditing(event.target) || !event.altKey || !event.shiftKey || event.ctrlKey || event.metaKey || !current?.isConnected) return;
      if (!['ArrowLeft', 'ArrowRight', 'KeyP'].includes(event.code)) return;
      event.preventDefault(); event.stopPropagation();
      if (event.code === 'KeyP') void popOut(); else seek(event.code === 'ArrowLeft' ? -10 : 10);
    }, { capture: true });
    ctx.addEventListener(document, 'fullscreenchange', () => { hide(); if (!document.fullscreenElement && host.parentElement !== document.documentElement) document.documentElement.append(host); });
    ctx.addEventListener(document, 'loadedmetadata', discover, { capture: true });
    ctx.addEventListener(document, 'play', discover, { capture: true });
    let discoveryTimer: ReturnType<typeof setTimeout>;
    const observer = new MutationObserver(() => { clearTimeout(discoveryTimer); discoveryTimer = setTimeout(discover, 500); });
    observer.observe(document.documentElement, { childList: true, subtree: true });
    let popupURL = '';
    const summary = document.createElement('p'); notice.append(summary);
    const openOnce = button('Open once', 'Open blocked window once', () => {
      const url = popupURL; notice.hidden = true;
      void request({ type: 'browsing-open-once', url }).catch(() => say('The window could not be opened. Try its link again.'));
    }, notice);
    button('Allow on this site', 'Allow popup windows on this site', () => {
      notice.hidden = true;
      void request({ type: 'browsing-allow-popups' }).then(() => say('Windows are allowed on this site. Try your original button again.')).catch(() => say('The exception could not be saved.'));
    }, notice);
    button('Dismiss', 'Dismiss blocked window notice', () => { notice.hidden = true; }, notice);
    ctx.addEventListener(window, 'message', event => {
      if (event.source !== window || event.data?.channel !== 'abomination-window-blocked' || !policy?.enabled || !policy.popupGuard || policy.allowPopups) return;
      const url = httpUrl.safeParse(event.data.url); if (!url.success && event.data.url !== '') return;
      popupURL = url.success ? url.data : ''; openOnce.disabled = !popupURL;
      summary.textContent = popupURL ? `Window blocked · ${new URL(popupURL).hostname}` : 'Window blocked · Allow on this site, then try the original button again.';
      notice.hidden = false;
    });
    const update = (value: unknown) => {
      const parsed = browsingPolicySchema.safeParse(value); if (!parsed.success) return;
      policy = parsed.data;
      if (!policy.enabled || !policy.videoControls) hide();
      if (!policy.enabled || !policy.popupGuard || policy.allowPopups) notice.hidden = true;
      discover();
    };
    const listener: Parameters<typeof chrome.runtime.onMessage.addListener>[0] = (message, sender) => {
      if (sender.id === chrome.runtime.id && !sender.tab && message?.type === 'browsing-policy') update(message.value);
    };
    chrome.runtime.onMessage.addListener(listener);
    void request({ type: 'browsing-policy' }).then(update).catch(() => {});
    ctx.onInvalidated(() => { abort.abort(); observer.disconnect(); clearTimeout(discoveryTimer); hide(); player.dispose(); clearTimeout(messageTimer); for (const restore of [...restorePiP.values()]) restore(); host.remove(); if (chrome.runtime?.id) chrome.runtime.onMessage.removeListener(listener); });
  },
});
