import { seekTime } from './browsing-policy';

// Presence matters more than opacity: real players often fade their own controls
// until hover. Never layer a second toolbar over those auto-hiding controls.
const controlBars = '.ytp-chrome-bottom,.vjs-control-bar,.plyr__controls,.jw-controlbar,.mejs__controls,.mejs-controls,.shaka-controls-button-panel,.shaka-bottom-controls,media-control-bar,media-time-range,[data-testid="video-controls"],[data-testid="player-controls"]';
const timelineControls = 'input[type="range"],[role="slider"],[class*="progress-bar"],[class*="seek-bar"],[id="seek"]';

function parentOf(element: Element): Element | null {
  const root = element.getRootNode();
  return element.parentElement ?? (root instanceof ShadowRoot ? root.host : null);
}

export function hasPlayerControls(video: HTMLVideoElement): boolean {
  if (video.controls) return true;
  const box = video.getBoundingClientRect();
  const nearPlayer = (node: Element) => {
    const r = node.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && r.right > box.left && r.left < box.right && r.bottom >= box.top && r.top <= box.bottom + 80;
  };
  let scope = parentOf(video);
  for (let depth = 0; scope && depth < 5; depth++, scope = parentOf(scope)) {
    if (scope === document.body || scope === document.documentElement) break;
    // Stop at feed/gallery containers, so a neighboring player's controls cannot
    // suppress the fallback for this video.
    if (scope.querySelectorAll('video').length > 1) break;
    const roots: (Element | ShadowRoot)[] = [scope];
    if (video.getRootNode() instanceof ShadowRoot) roots.push(video.getRootNode() as ShadowRoot);
    for (let i = 0; i < roots.length && i < 30; i++) {
      const root = roots[i]!;
      if ([...root.querySelectorAll(controlBars)].some(nearPlayer)) return true;
      for (const node of root.querySelectorAll(timelineControls)) {
        if (!nearPlayer(node)) continue;
        const name = `${node.getAttribute('aria-label') ?? ''} ${node.getAttribute('title') ?? ''} ${node.id} ${node.className}`;
        if (/volume|brightness/i.test(name)) continue;
        if (/seek|progress|timeline|scrub|time/i.test(name) || node.getBoundingClientRect().width >= box.width * 0.45) return true;
      }
      // Closed player roots are available through Chrome's extension DOM API.
      for (const node of root.querySelectorAll('*')) {
        if (!(node instanceof HTMLElement) || node.id === 'abomination-browsing-tools') continue;
        const shadow = chrome.dom.openOrClosedShadowRoot(node) as ShadowRoot | null;
        if (shadow && !roots.includes(shadow)) roots.push(shadow);
      }
    }
  }
  return false;
}

export const videoControlsStyle = `
.controls{position:fixed;pointer-events:auto;color:#fff;font:12px/1.2 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:linear-gradient(transparent,#0009);padding:8px 10px 5px;container-type:inline-size;overflow:hidden;border-radius:0 0 5px 5px}
.controls .row{display:flex;align-items:center;gap:5px;height:30px}
.controls button,.controls select{border:0;background:transparent;color:#fff;padding:4px;border-radius:4px;height:28px;min-width:28px;font:inherit;cursor:pointer}
.controls button{display:grid;place-items:center;flex-shrink:0}
.controls button:hover,.controls select:hover{background:#ffffff24}
.controls button:focus-visible,.controls select:focus-visible,.controls input:focus-visible{outline:2px solid #fff;outline-offset:1px}
.controls svg{width:18px;height:18px;fill:none;stroke:currentColor;stroke-width:1.7;stroke-linecap:round;stroke-linejoin:round}
.controls .time{flex:1;white-space:nowrap;font-variant-numeric:tabular-nums;text-shadow:0 1px 3px #000}
.controls select{width:48px;appearance:none;text-align:center}
.controls option{background:#252525;color:#fff}
.controls input{appearance:none;display:block;height:14px;margin:0;background:transparent;cursor:pointer;padding:0;border:0;min-width:0;accent-color:white}
.controls input::-webkit-slider-runnable-track{height:3px;border-radius:2px;background:linear-gradient(to right,#fff var(--played,0%),#ffffff55 var(--played,0%))}
.controls input::-webkit-slider-thumb{appearance:none;width:9px;height:9px;border-radius:50%;background:#fff;margin-top:-3px}
.controls input:disabled{opacity:.4;cursor:default}
.controls .timeline{width:100%}.controls .volume{width:54px;flex-shrink:0}
@container (max-width:360px){.controls .volume{display:none}.controls .row{gap:2px}}
`;

function timeLabel(seconds: number) {
  if (!Number.isFinite(seconds)) return 'LIVE';
  seconds = Math.max(0, Math.floor(seconds));
  const s = String(seconds % 60).padStart(2, '0'), m = Math.floor(seconds / 60) % 60, h = Math.floor(seconds / 3600);
  return h ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
}

const icons = {
  play: '<path d="m7 4 13 8-13 8z" fill="currentColor" stroke="none"/>',
  pause: '<path d="M8 5v14M16 5v14" stroke-width="4"/>',
  volume: '<path d="M11 5 6 9H3v6h3l5 4zM15 8a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14"/>',
  muted: '<path d="M11 5 6 9H3v6h3l5 4zM16 9l5 6m0-6-5 6"/>',
  pip: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M12 12h7v6h-7z" fill="currentColor" stroke="none"/>',
  fullscreen: '<path d="M9 3H3v6m12-6h6v6M3 15v6h6m12-6v6h-6"/>',
};

export function createVideoControls(actions: {
  current: () => HTMLVideoElement | undefined;
  speed: (rate: number) => void;
  popOut: () => Promise<void>;
  say: (message: string) => void;
}) {
  const element = document.createElement('div'); element.className = 'controls'; element.hidden = true;
  element.setAttribute('role', 'group'); element.setAttribute('aria-label', 'Video controls by Abomination81');
  const timeline = document.createElement('input'); timeline.type = 'range'; timeline.className = 'timeline'; timeline.step = '0.01'; timeline.setAttribute('aria-label', 'Seek video');
  const row = document.createElement('div'); row.className = 'row'; element.append(timeline, row);
  const icon = (button: HTMLButtonElement, name: keyof typeof icons, label: string) => {
    button.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${icons[name]}</svg>`;
    button.setAttribute('aria-label', label); button.title = label;
  };
  const button = (name: keyof typeof icons, label: string, run: (video: HTMLVideoElement) => void | Promise<void>) => {
    const node = document.createElement('button'); node.type = 'button'; icon(node, name, label);
    node.addEventListener('click', event => {
      const video = actions.current(); if (!event.isTrusted || !video) return;
      event.stopPropagation();
      void Promise.resolve().then(() => run(video)).catch(() => actions.say('This player could not complete that action.'));
    }); row.append(node); return node;
  };
  const play = button('play', 'Play video', video => video.paused ? video.play() : video.pause());
  const time = document.createElement('span'); time.className = 'time'; row.append(time);
  const mute = button('volume', 'Mute video', video => { video.muted = !video.muted; });
  const volume = document.createElement('input'); volume.type = 'range'; volume.className = 'volume'; volume.min = '0'; volume.max = '1'; volume.step = '0.05'; volume.setAttribute('aria-label', 'Volume'); row.append(volume);
  const speed = document.createElement('select'); speed.setAttribute('aria-label', 'Playback speed'); speed.title = 'Playback speed';
  for (let rate = 0.25; rate <= 4; rate += 0.25) { const option = document.createElement('option'); option.value = String(rate); option.textContent = `${rate}×`; speed.append(option); } row.append(speed);
  button('pip', 'Pop out video', () => actions.popOut());
  const fullscreenRestorers = new Set<() => void>();
  button('fullscreen', 'Full screen', async video => {
    if (document.fullscreenElement) { await document.exitFullscreen(); return; }
    // Native fullscreen videos cannot contain HTML overlays. Hand playback to
    // Chrome's own controls for that mode, then restore the site's exact flag.
    const original = video.controls;
    const restore = () => {
      if (document.fullscreenElement === video) return;
      video.controls = original; document.removeEventListener('fullscreenchange', restore); fullscreenRestorers.delete(restore);
    };
    video.controls = true; fullscreenRestorers.add(restore); document.addEventListener('fullscreenchange', restore);
    try { await video.requestFullscreen(); } catch (error) { restore(); throw error; }
  });
  const sync = () => {
    const video = actions.current(); if (!video) return;
    const start = video.seekable.length ? video.seekable.start(0) : 0;
    const end = video.seekable.length ? video.seekable.end(video.seekable.length - 1) : 0;
    timeline.min = String(start); timeline.max = String(Math.max(start, end)); timeline.disabled = end <= start;
    timeline.value = String(video.currentTime);
    timeline.style.setProperty('--played', `${end > start ? Math.max(0, Math.min(100, (video.currentTime - start) / (end - start) * 100)) : 0}%`);
    timeline.setAttribute('aria-valuetext', `${timeLabel(video.currentTime)} of ${timeLabel(video.duration)}`);
    time.textContent = `${timeLabel(video.currentTime)} / ${timeLabel(video.duration)}`;
    icon(play, video.paused ? 'play' : 'pause', video.paused ? 'Play video' : 'Pause video');
    icon(mute, video.muted || !video.volume ? 'muted' : 'volume', video.muted ? 'Unmute video' : 'Mute video');
    volume.value = String(video.muted ? 0 : video.volume); volume.style.setProperty('--played', `${Number(volume.value) * 100}%`);
    speed.value = String(video.playbackRate);
  };
  timeline.addEventListener('input', event => {
    const video = actions.current(); if (!event.isTrusted || !video) return;
    const target = seekTime(video, Number(timeline.value) - video.currentTime);
    if (target !== undefined) video.currentTime = target;
    sync();
  });
  volume.addEventListener('input', event => {
    const video = actions.current(); if (!event.isTrusted || !video) return;
    video.volume = Number(volume.value); video.muted = !video.volume; sync();
  });
  speed.addEventListener('change', event => { if (event.isTrusted) actions.speed(Number(speed.value)); });
  speed.addEventListener('keydown', event => {
    if (!event.isTrusted || event.altKey || event.ctrlKey || event.metaKey || !['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
    event.preventDefault();
    actions.speed((actions.current()?.playbackRate ?? 1) + (event.key === 'ArrowRight' ? 0.25 : -0.25));
  });
  // An active fullscreen session retains its native controls across an update;
  // the small DOM-only listener restores the original flag when it exits.
  return { element, sync, dispose: () => { for (const restore of fullscreenRestorers) restore(); } };
}
