import { afterEach, expect, it, vi } from 'vitest';
import { discover, type Capture } from '../extension/lib/detection';
import { recoverSnapshots, within } from '../extension/lib/probe';
import type { Snapshot } from '../extension/lib/schema';

afterEach(() => vi.useRealTimers());
const frame = { frameId: 0, parentFrameId: -1, url: 'https://example.com/player' };
const page = { url: frame.url, title: 'Selected video' };
const capture: Capture = { url: 'https://cdn.example.com/master.m3u8?signature=keep', kind: 'manifest', frameId: 0, at: Date.now(), contentType: 'application/vnd.apple.mpegurl', headers: { Referer: page.url } };

it('bounds a frame that never responds, without waiting for the page to unblock', async () => {
  vi.useFakeTimers();
  const result = within(new Promise(() => undefined), 1500);
  const rejected = expect(result).rejects.toThrow('Frame did not respond');
  await vi.advanceTimersByTimeAsync(1500);
  await rejected;
});

it('keeps successful frame replies intact', async () => {
  expect(await within(Promise.resolve({ media: 'available' }), 1500)).toEqual({ media: 'available' });
});

it('recovers an observed master playlist when a dialog prevents all frame replies', () => {
  const snapshots = recoverSnapshots([], [frame], [capture], page);
  expect(discover(snapshots, [capture], page.url)[0]?.sources[0]).toMatchObject({ url: capture.url, kind: 'manifest', headers: capture.headers });
});

it('keeps a recently clicked disappearing video and its protected status', () => {
  const context: Snapshot = { ...frame, token: crypto.randomUUID(), title: page.title, viewport: { width: 800, height: 600 }, frames: [], point: { x: 200, y: 100, at: Date.now() }, media: [{ id: 'clicked', title: page.title, sources: ['https://cdn.example.com/video.mp4'], width: 1920, height: 1080, duration: 60, currentTime: 1, playing: true, visible: true, protected: true, rect: { x: 0, y: 0, width: 640, height: 360 } }] };
  const snapshots = recoverSnapshots([], [frame], [], page, context);
  expect(snapshots[0]?.media[0]?.id).toBe('clicked');
  expect(discover(snapshots, [], page.url)[0]?.protected).toBe(true);
  expect(recoverSnapshots([], [{ ...frame, url: 'https://example.com/redirected' }], [], page, context)).toEqual([]);
});
