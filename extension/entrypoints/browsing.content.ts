import { browsingPolicySchema, seekTime, type BrowsingPolicy } from '../lib/browsing-policy';
import { httpUrl } from '../lib/schema';
import { isEditing } from '../lib/copy-policy';
import { request } from '../lib/ui';

export default defineContentScript({
  matches: ['http://*/*', 'https://*/*'], allFrames: true, matchOriginAsFallback: true, runAt: 'document_idle',
  main(ctx) {
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
    style.textContent = `:host{all:initial!important;position:fixed!important;inset:0!important;pointer-events:none!important;z-index:2147483647!important;color-scheme:dark}*{box-sizing:border-box}button,select{font:13px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#eef5ef;background:#262c29;border:1px solid #59625c;border-radius:6px;padding:6px 9px;cursor:pointer}button:hover,select:hover{border-color:#76df8b}button:focus-visible,select:focus-visible{outline:2px solid #76df8b;outline-offset:2px}[hidden]{display:none!important}.controls{position:fixed;display:flex;gap:5px;padding:6px;border-radius:10px;background:#151a17ec;box-shadow:0 2px 12px #0005;pointer-events:auto;max-width:calc(100vw - 12px);flex-wrap:wrap}.notice{position:fixed;bottom:16px;right:16px;max-width:min(520px,calc(100vw - 32px));background:#19201c;color:#eef5ef;border:1px solid #45694d;border-radius:10px;padding:12px;box-shadow:0 3px 18px #0005;pointer-events:auto;font:13px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}.notice p{margin:0 0 9px;overflow-wrap:anywhere}.notice button{margin:0 6px 3px 0}.message{position:fixed;bottom:18px;left:18px;max-width:420px;background:#19201c;color:#eef5ef;padding:10px;border-radius:8px;font:13px/1.5 sans-serif;pointer-events:auto}`;
    root.append(style);
    const controls = document.createElement('div'); controls.className = 'controls'; controls.hidden = true;
    controls.setAttribute('role', 'group'); controls.setAttribute('aria-label', 'Video controls by Abomination81');
    const notice = document.createElement('div'); notice.className = 'notice'; notice.hidden = true; notice.setAttribute('role', 'status');
    const message = document.createElement('div'); message.className = 'message'; message.hidden = true; message.setAttribute('role', 'status');
    root.append(controls, notice, message); document.documentElement.append(host);
    let hideTimer: ReturnType<typeof setTimeout>, messageTimer: ReturnType<typeof setTimeout>;
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
    button('−10s', 'Rewind 10 seconds', () => seek(-10));
    button('+10s', 'Forward 10 seconds', () => seek(10));
    const speed = document.createElement('select'); speed.setAttribute('aria-label', 'Playback speed');
    for (let rate = 0.25; rate <= 4; rate += 0.25) { const option = document.createElement('option'); option.value = String(rate); option.textContent = `${rate}×`; speed.append(option); }
    controls.append(speed);
    const changeSpeed = (rate: number) => {
      if (!current) return;
      rate = Math.max(0.25, Math.min(4, rate));
      rates.set(current, rate); current.playbackRate = rate; speed.value = String(rate);
      void request({ type: 'browsing-speed', speed: rate }).catch(() => say('The speed changed, but could not be remembered.'));
    };
    button('−', 'Decrease playback speed', () => changeSpeed((current?.playbackRate ?? 1) - 0.25));
    button('+', 'Increase playback speed', () => changeSpeed((current?.playbackRate ?? 1) + 0.25));
    speed.addEventListener('change', event => {
      if (!event.isTrusted || !current) return;
      changeSpeed(Number(speed.value));
    });
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
    button('Pop out', 'Pop out video', () => { void popOut(); });
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
          video.addEventListener('ratechange', () => { if (current === video) speed.value = String(video.playbackRate); }, { signal: abort.signal });
        }
        if (policy.speed !== null && rates.get(video) !== policy.speed) { rates.set(video, policy.speed); video.playbackRate = policy.speed; }
      }
      for (const video of known) if (!video.isConnected) known.delete(video);
    }
    function show(video: HTMLVideoElement) {
      if (!policy?.enabled || !policy.videoControls || !video.isConnected) { controls.hidden = true; return; }
      const box = video.getBoundingClientRect();
      if (box.width < 180 || box.height < 100 || box.bottom < 0 || box.top > innerHeight) return;
      current = video; speed.value = String(video.playbackRate);
      const full = document.fullscreenElement;
      const mount = full && !(full instanceof HTMLVideoElement) ? full : document.documentElement;
      if (host.parentElement !== mount) mount.append(host);
      controls.style.left = `${Math.max(6, Math.min(box.right - 360, innerWidth - 366))}px`;
      controls.style.top = `${Math.max(6, box.top + 10)}px`;
      controls.hidden = false; clearTimeout(hideTimer);
      hideTimer = setTimeout(() => { if (!controls.matches(':hover') && !root.activeElement) controls.hidden = true; }, 2500);
    }
    ctx.addEventListener(document, 'pointermove', event => {
      if (!policy?.enabled || !policy.videoControls || event.composedPath().includes(host)) return;
      const match = [...known].filter(v => { const r = v.getBoundingClientRect(); return v.isConnected && event.clientX >= r.left && event.clientX <= r.right && event.clientY >= r.top && event.clientY <= r.bottom; })
        .sort((a, b) => Number(a.paused) - Number(b.paused))[0];
      if (match) show(match);
    }, { passive: true, capture: true });
    ctx.addEventListener(document, 'keydown', event => {
      if (!policy?.enabled || !policy.videoControls || !event.isTrusted || isEditing(event.target) || !event.altKey || !event.shiftKey || event.ctrlKey || event.metaKey || !current) return;
      if (!['ArrowLeft', 'ArrowRight', 'KeyP'].includes(event.code)) return;
      event.preventDefault(); event.stopPropagation();
      if (event.code === 'KeyP') void popOut(); else seek(event.code === 'ArrowLeft' ? -10 : 10);
    }, { capture: true });
    ctx.addEventListener(document, 'fullscreenchange', () => { if (current) show(current); });
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
      if (!policy.enabled || !policy.videoControls) controls.hidden = true;
      if (!policy.enabled || !policy.popupGuard || policy.allowPopups) notice.hidden = true;
      discover();
    };
    const listener: Parameters<typeof chrome.runtime.onMessage.addListener>[0] = (message, sender) => {
      if (sender.id === chrome.runtime.id && !sender.tab && message?.type === 'browsing-policy') update(message.value);
    };
    chrome.runtime.onMessage.addListener(listener);
    void request({ type: 'browsing-policy' }).then(update).catch(() => {});
    ctx.onInvalidated(() => { abort.abort(); observer.disconnect(); clearTimeout(discoveryTimer); clearTimeout(hideTimer); clearTimeout(messageTimer); for (const restore of [...restorePiP.values()]) restore(); host.remove(); if (chrome.runtime?.id) chrome.runtime.onMessage.removeListener(listener); });
  },
});
