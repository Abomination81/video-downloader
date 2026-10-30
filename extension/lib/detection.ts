import type { Candidate, Rect, Snapshot, Source } from './schema';

export type Capture = Source & { frameId: number; at: number; contentType: string };
export const contains = (r: Rect, p: { x: number; y: number }) => r.width > 0 && r.height > 0 && p.x >= r.x && p.x <= r.x + r.width && p.y >= r.y && p.y <= r.y + r.height;
export function isHttp(value: string): boolean {
  try { const u = new URL(value); return ['http:', 'https:'].includes(u.protocol) && !u.username && !u.password; } catch { return false; }
}
export function mediaKind(url: string, contentType = ''): Source['kind'] | undefined {
  if (!isHttp(url)) return;
  const path = new URL(url).pathname.toLowerCase();
  if (/\.(m4s|ts|cmfv|cmfa)$/.test(path) || /\/(init|initialization)[^/]*\.mp4$/i.test(path)) return;
  if (/mpegurl|dash\+xml/i.test(contentType) || /\.(m3u8|mpd)$/.test(path)) return 'manifest';
  if (/^(video\/|application\/mp4)/i.test(contentType) || /\.(mp4|webm|mkv|mov|m4v|avi)$/.test(path)) return 'file';
}
export function manifestRank(url: string) {
  const path = new URL(url).pathname;
  return /master|manifest|playlist\.m3u8|\.mpd/i.test(path) ? 50 : 0;
}
export function isVideoPage(url: string) {
  try {
    const u = new URL(url);
    return (/(^|\.)(youtube\.com|youtu\.be)$/.test(u.hostname) && (/watch|shorts|live|embed/.test(u.pathname) || u.hostname === 'youtu.be'))
      || /\/(status|reels?|videos?|shorts?|clips?|watch)\//i.test(u.pathname)
      || /(^|\.)(vimeo\.com|loom\.com|streamable\.com|dailymotion\.com)$/.test(u.hostname);
  } catch { return false; }
}
function uniqueSources(sources: Source[]): Source[] {
  const seen = new Set<string>();
  return sources.filter((s) => { if (!isHttp(s.url) || seen.has(s.url)) return false; seen.add(s.url); return true; }).slice(0, 16).map((s) => ({ url: s.url, kind: s.kind, headers: s.headers, ...(s.entryIndex ? { entryIndex: s.entryIndex } : {}) }));
}

/** Map a click through nested frame geometry, even when an overlay receives it. */
export function clickFrames(snapshots: Snapshot[], clickedFrame: number, point?: { x: number; y: number }): Map<number, { x: number; y: number }> {
  const result = new Map<number, { x: number; y: number }>();
  if (!point) return result;
  const byToken = new Map(snapshots.map((s) => [s.token, s]));
  const visit = (frameId: number, p: { x: number; y: number }, depth: number) => {
    if (depth > 12 || result.has(frameId)) return;
    result.set(frameId, p);
    const snapshot = snapshots.find((s) => s.frameId === frameId);
    if (!snapshot) return;
    for (const frame of snapshot.frames) {
      if (!contains(frame.rect, p)) continue;
      const child = frame.token ? byToken.get(frame.token) : snapshots.find((s) => s.parentFrameId === frameId && s.url === frame.src);
      if (!child) continue;
      visit(child.frameId, {
        x: (p.x - frame.rect.x) * child.viewport.width / Math.max(1, frame.rect.width),
        y: (p.y - frame.rect.y) * child.viewport.height / Math.max(1, frame.rect.height),
      }, depth + 1);
    }
  };
  let originFrame = clickedFrame;
  let originPoint = point;
  for (let depth = 0; depth < 12; depth++) {
    const child = snapshots.find((s) => s.frameId === originFrame);
    const parent = snapshots.find((s) => s.frameId === child?.parentFrameId);
    if (!child || !parent) break;
    const frame = parent.frames.find((f) => f.token === child.token) ?? parent.frames.find((f) => f.src === child.url);
    if (!frame) break;
    originPoint = { x: frame.rect.x + originPoint.x * frame.rect.width / Math.max(1, child.viewport.width), y: frame.rect.y + originPoint.y * frame.rect.height / Math.max(1, child.viewport.height) };
    originFrame = parent.frameId;
  }
  visit(originFrame, originPoint, 0);
  return result;
}

export function discover(snapshots: Snapshot[], captures: Capture[], pageUrl: string, click?: { frameId: number; point?: { x: number; y: number }; srcUrl?: string }): Candidate[] {
  const points = clickFrames(snapshots, click?.frameId ?? 0, click?.point);
  const results: Candidate[] = [];
  for (const snapshot of snapshots) {
    const local = captures.filter((c) => c.frameId === snapshot.frameId).sort((a, b) => manifestRank(b.url) - manifestRank(a.url) || b.at - a.at);
    for (const media of snapshot.media) {
      const point = points.get(snapshot.frameId);
      const exact = !!point && contains(media.rect, point);
      const srcMatch = !!click?.srcUrl && media.sources.includes(click.srcUrl);
      const sources: Source[] = [];
      const permalink = media.permalink || (isVideoPage(snapshot.url) ? snapshot.url : undefined);
      if (permalink && isHttp(permalink)) {
        const siblings = snapshot.media.filter((m) => (m.permalink || (isVideoPage(snapshot.url) ? snapshot.url : undefined)) === permalink);
        sources.push({ url: permalink, kind: 'page', headers: {}, ...(siblings.length > 1 ? { entryIndex: siblings.findIndex((m) => m.id === media.id) + 1 } : {}) });
      }
      // Master playlists take precedence over whichever rendition the player loaded.
      if (snapshot.media.length === 1) sources.push(...local.filter((c) => c.kind === 'manifest'));
      for (const url of media.sources.filter(isHttp)) {
        const captured = captures.find((c) => c.url === url);
        sources.push(captured ?? { url, kind: mediaKind(url) ?? 'file', headers: { Referer: snapshot.url } });
      }
      if (snapshot.media.length === 1 && !sources.length) sources.push(...local);
      // A freshly extracted page can renew an expired signed media address.
      // Keep this last, and avoid guessing an entry on multi-video pages.
      if (snapshot.media.length === 1 && isHttp(snapshot.url)) sources.push({ url: snapshot.url, kind: 'page', headers: {} });
      if (!sources.length) continue;
      results.push({
        id: `${snapshot.frameId}:${media.id}`, title: media.title || snapshot.title || 'Video', frameId: snapshot.frameId,
        score: (exact || srcMatch ? 10000 : 0) + (media.playing ? 600 : 0) + (media.visible ? 200 : 0) + (points.has(snapshot.frameId) ? 100 : 0) + Math.min(100, media.rect.width * media.rect.height / 10000),
        exact: exact || srcMatch, protected: media.protected, sources: uniqueSources(sources),
        cookieUrls: [...new Set([snapshot.url, pageUrl, ...sources.map((s) => s.url)].filter(isHttp))].slice(0, 16),
        width: media.width, height: media.height,
      });
    }
    if (!snapshot.media.length && local.length) {
      const manifests = local.filter((c) => c.kind === 'manifest');
      const choices = manifests.length ? manifests : local;
      const groups = new Map<string, Capture[]>();
      for (const source of choices) {
        const u = new URL(source.url);
        // Retain signed query parameters. Only exact URLs are deduplicated.
        const key = `${u.origin}${u.pathname}`;
        groups.set(key, [...(groups.get(key) ?? []), source]);
      }
      const master = choices.find((c) => c.kind === 'manifest' && manifestRank(c.url) > 0);
      const lists = master ? [[master, ...choices.filter((s) => s.url !== master.url)]] : [...groups.values()];
      lists.slice(0, 12).forEach((sources, i) => results.push({
        id: `${snapshot.frameId}:network:${i}`, title: snapshot.title || `Video stream ${i + 1}`, frameId: snapshot.frameId,
        score: (points.has(snapshot.frameId) ? 9000 : 0) + 100, exact: points.has(snapshot.frameId) && lists.length === 1,
        protected: false, sources: uniqueSources(sources), cookieUrls: [snapshot.url, pageUrl, ...sources.map((s) => s.url)].filter(isHttp).slice(0, 16), width: 0, height: 0,
      }));
    }
  }
  if (click?.srcUrl && isHttp(click.srcUrl) && !results.some((c) => c.sources.some((s) => s.url === click.srcUrl))) {
    results.push({ id: 'native-target', title: 'Selected video', frameId: click.frameId, score: 11000, exact: true, protected: false,
      sources: [{ url: click.srcUrl, kind: mediaKind(click.srcUrl) ?? 'file', headers: { Referer: pageUrl } }], cookieUrls: [pageUrl, click.srcUrl], width: 0, height: 0 });
  }
  if (!results.length && isHttp(pageUrl)) {
    results.push({ id: 'page', title: snapshots.find((s) => s.frameId === 0)?.title || 'Video on this page', frameId: 0, score: 0, exact: false, protected: false,
      sources: [{ url: pageUrl, kind: 'page', headers: {} }], cookieUrls: [pageUrl], width: 0, height: 0 });
  }
  return results.sort((a, b) => b.score - a.score).slice(0, 40);
}

export function automaticChoice(candidates: Candidate[]): Candidate | undefined {
  if (candidates.length === 1) return candidates[0];
  const [first, second] = candidates;
  if (first && second && first.score - second.score > 300 && (first.exact || first.score >= 600)) return first;
}
