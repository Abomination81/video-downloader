import type { Capture } from './detection';
import type { Snapshot } from './schema';

/** A page dialog or stuck iframe must not hold the entire selection open. */
export function within<T>(pending: Promise<T>, milliseconds: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Frame did not respond')), milliseconds);
    pending.then((value) => { clearTimeout(timer); resolve(value); }, (error) => { clearTimeout(timer); reject(error); });
  });
}

type Frame = { frameId: number; parentFrameId: number; url: string };

/** Use observed streams even when a frame cannot run its content script. */
export function recoverSnapshots(responded: Snapshot[], frames: Frame[], captures: Capture[], page: { url: string; title: string }, context?: Snapshot): Snapshot[] {
  const result = [...responded];
  for (const frame of frames) {
    const index = result.findIndex((s) => s.frameId === frame.frameId);
    const recent = context?.point && Date.now() - context.point.at < 15000 && context.frameId === frame.frameId && context.url === frame.url;
    if (recent && context.media.length && (index < 0 || !result[index]!.media.length)) {
      const cached = { ...context, parentFrameId: frame.parentFrameId };
      if (index < 0) result.push(cached); else result[index] = cached;
    } else if (index < 0 && captures.some((c) => c.frameId === frame.frameId)) {
      result.push({ token: crypto.randomUUID(), frameId: frame.frameId, parentFrameId: frame.parentFrameId,
        url: frame.url || page.url, title: page.title, viewport: { width: 1, height: 1 }, media: [], frames: [] });
    }
  }
  return result;
}
