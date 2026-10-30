import { describe, expect, it } from 'vitest';
import { automaticChoice, clickFrames, discover, mediaKind, type Capture } from '../extension/lib/detection';
import type { Snapshot } from '../extension/lib/schema';
import { candidateSchema } from '../extension/lib/schema';

const rect = { x: 50, y: 50, width: 640, height: 360 };
function frame(id: number, parent: number): Snapshot { return { frameId: id, parentFrameId: parent, token: `00000000-0000-4000-8000-${String(id).padStart(12, '0')}`, url: `https://example.com/${id}`, title: 'Video', viewport: { width: 800, height: 600 }, media: [], frames: [] }; }
function video(id: string, src: string) { return { id, sources: [src], rect, width: 1920, height: 1080, duration: 60, currentTime: 2, playing: true, visible: true, protected: false, title: id }; }

describe('video discovery', () => {
  it('finds the video beneath a transparent overlay by geometry', () => {
    const page = frame(0, -1); page.media.push(video('wanted', 'https://cdn.example.com/video.mp4'));
    const candidates = discover([page], [], page.url, { frameId: 0, point: { x: 200, y: 100 } });
    expect(automaticChoice(candidates)?.id).toBe('0:wanted');
    expect(candidates[0]?.exact).toBe(true);
  });
  it('maps a click out of an invisible iframe and into the video frame below it', () => {
    const page = frame(0, -1), overlay = frame(3, 0), player = frame(7, 0);
    page.frames = [{ token: overlay.token, src: overlay.url, rect }, { token: player.token, src: player.url, rect }];
    player.media.push({ ...video('wanted', 'https://cdn.example.com/video.mp4'), rect: { x: 0, y: 0, width: 800, height: 600 } });
    const points = clickFrames([page, overlay, player], 3, { x: 200, y: 100 });
    expect(points.has(7)).toBe(true);
    expect(automaticChoice(discover([page, overlay, player], [], page.url, { frameId: 3, point: { x: 200, y: 100 } }))?.id).toBe('7:wanted');
  });
  it('prefers an observed master playlist over the low quality rendition currently playing', () => {
    const page = frame(0, -1); page.media.push(video('wanted', 'blob:https://example.com/abc'));
    const make = (url: string): Capture => ({ url, kind: 'manifest', headers: {}, frameId: 0, at: Date.now(), contentType: 'application/vnd.apple.mpegurl' });
    const candidates = discover([page], [make('https://cdn.example.com/low/index.m3u8'), make('https://cdn.example.com/master.m3u8?sig=keep-me')], page.url);
    expect(candidates[0]?.sources[0]?.url).toBe('https://cdn.example.com/master.m3u8?sig=keep-me');
    expect(candidateSchema.safeParse(candidates[0]).success).toBe(true);
  });
  it('does not silently choose between equally plausible videos', () => {
    const page = frame(0, -1); page.media.push(video('first', 'https://cdn.example.com/first.mp4'), video('second', 'https://cdn.example.com/second.mp4'));
    expect(automaticChoice(discover([page], [], page.url))).toBeUndefined();
  });
  it('keeps the selected entry when a post contains multiple videos', () => {
    const page = frame(0, -1);
    const permalink = 'https://example.com/status/123';
    page.media.push({ ...video('first', 'blob:https://example.com/a'), permalink }, { ...video('second', 'blob:https://example.com/b'), permalink });
    const found = discover([page], [], page.url);
    expect(found.find((c) => c.id === '0:second')?.sources[0]?.entryIndex).toBe(2);
  });
  it('recognizes manifests without file extensions and excludes individual stream fragments', () => {
    expect(mediaKind('https://cdn.example.com/opaque?signature=a', 'application/dash+xml')).toBe('manifest');
    expect(mediaKind('https://cdn.example.com/segment.m4s', 'video/mp4')).toBeUndefined();
    expect(mediaKind('https://cdn.example.com/segment.ts', 'video/mp2t')).toBeUndefined();
    expect(mediaKind('blob:https://example.com/abc', 'video/mp4')).toBeUndefined();
  });
  it('retains the page as a final way to renew an expired signed video URL', () => {
    const page = frame(0, -1); page.media.push(video('wanted', 'https://cdn.example.com/clip.mp4?signature=expired'));
    const candidate = discover([page], [], page.url)[0]!;
    expect(candidate.sources[0]?.url).toBe('https://cdn.example.com/clip.mp4?signature=expired');
    expect(candidate.sources.at(-1)).toEqual({ url: page.url, kind: 'page', headers: {} });
  });
  it('does not attach a generic page fallback to an ambiguous multi-video player', () => {
    const page = frame(0, -1); page.media.push(video('one', 'https://cdn.example.com/one.mp4'), video('two', 'https://cdn.example.com/two.mp4'));
    expect(discover([page], [], page.url).every((c) => c.sources.every((s) => s.kind === 'file'))).toBe(true);
  });
});
