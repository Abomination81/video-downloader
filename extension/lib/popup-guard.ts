/** Runs in MAIN. Keep this function self-contained for chrome.scripting. */
export function setPopupGuardPolicy(enabled: boolean, allowed: boolean) {
  type State = { enabled: boolean; allowed: boolean; stop: () => void };
  const scope = window as unknown as { __abominationPopupGuard?: State };
  if (scope.__abominationPopupGuard) {
    scope.__abominationPopupGuard.enabled = enabled;
    scope.__abominationPopupGuard.allowed = allowed;
    return;
  }
  const original = window.open;
  let intent = { at: 0, explicit: false, href: '', media: false, used: false };
  const state: State = { enabled, allowed, stop: () => {} };
  scope.__abominationPopupGuard = state;
  const safe = (value: unknown) => {
    try { const text = String(value ?? ''); if (!text || text === 'about:blank' || text.length > 16384) return ''; const u = new URL(text, location.href); return /^https?:$/.test(u.protocol) && !u.username && !u.password && u.href.length <= 16384 ? u.href : ''; } catch { return ''; }
  };
  const report = (url: string) => {
    window.postMessage({ channel: 'abomination-window-blocked', url }, location.origin === 'null' ? '*' : location.origin);
  };
  const remember = (event: Event) => {
    if (!event.isTrusted) return;
    if (event instanceof KeyboardEvent && !['Enter', ' '].includes(event.key)) return;
    const path = event.composedPath();
    const anchor = path.find((n): n is HTMLAnchorElement => n instanceof HTMLAnchorElement && !!n.href);
    const control = path.find((n): n is HTMLElement => n instanceof HTMLElement && n.matches('button,input,select,textarea,[role="button"],[role="link"]'));
    const media = path.some(n => n instanceof Element && n !== document.body && n !== document.documentElement && (n.matches('video,audio') || /(?:^|\s)(?:player|video-player|video-js|html5-video-player|plyr|jwplayer|shaka-video-container|vjs-[\w-]+)(?:\s|$)/i.test(`${n.id} ${n.className}`)));
    intent = { at: performance.now(), explicit: !!anchor || !!control && !media, href: anchor ? safe(anchor.href) : '', media, used: false };
    if (!(event instanceof MouseEvent) || !anchor || anchor.target.toLowerCase() !== '_blank' || !state.enabled || state.allowed) return;
    const box = anchor.getBoundingClientRect(), style = getComputedStyle(anchor);
    const videoUnder = [...document.querySelectorAll('video')].some(v => { const r = v.getBoundingClientRect(); return event.clientX >= r.left && event.clientX <= r.right && event.clientY >= r.top && event.clientY <= r.bottom; });
    const invisible = Number(style.opacity) < 0.1 || !anchor.innerText.trim() && !anchor.querySelector('img,svg') && box.width * box.height > 24000;
    if (videoUnder && invisible && safe(anchor.href) && new URL(anchor.href).origin !== location.origin) {
      event.preventDefault(); event.stopImmediatePropagation(); report(anchor.href); intent.explicit = false;
    }
  };
  window.addEventListener('click', remember, true);
  window.addEventListener('keydown', remember, true);
  const wrapped: typeof window.open = function (url, target, features) {
    if (!state.enabled || state.allowed || target && ['_self', '_top', '_parent'].includes(target.toLowerCase())) return original.call(window, url, target, features);
    const resolved = safe(url);
    const recent = performance.now() - intent.at < 5000 && intent.at > 0;
    const intended = recent && !intent.used && intent.explicit && (!intent.href || !resolved || resolved === intent.href);
    // Explicit links and ordinary buttons preserve normal WindowProxy/opener
    // behavior (OAuth, payment and sharing flows). Media/background clicks do not.
    if (intended) { intent.used = true; return original.call(window, url, target, features); }
    report(resolved);
    return null;
  };
  window.open = wrapped;
  state.stop = () => { if (window.open === wrapped) window.open = original; window.removeEventListener('click', remember, true); window.removeEventListener('keydown', remember, true); delete scope.__abominationPopupGuard; };
}
