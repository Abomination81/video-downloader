import { z } from 'zod';
import { adHost } from './adblock-policy';

export const browsingSchema = z.object({
  rejectCookies: z.boolean().default(true), hideNags: z.boolean().default(true),
  popupGuard: z.boolean().default(true), videoControls: z.boolean().default(true),
  pausedSites: z.array(adHost).max(200).default([]),
  popupSites: z.array(adHost).max(200).default([]),
}).strict();
export type BrowsingSettings = z.infer<typeof browsingSchema>;
export const browsingChangesSchema = z.object({
  rejectCookies: z.boolean().optional(), hideNags: z.boolean().optional(),
  popupGuard: z.boolean().optional(), videoControls: z.boolean().optional(),
  pausedSites: z.array(adHost).max(200).optional(), popupSites: z.array(adHost).max(200).optional(),
}).strict();
export const browsingDefaults = browsingSchema.parse({});
export const speedSchema = z.number().finite().min(0.25).max(4);
export const browsingPolicySchema = z.object({
  host: z.string().max(253), enabled: z.boolean(), rejectCookies: z.boolean(),
  popupGuard: z.boolean(), videoControls: z.boolean(), allowPopups: z.boolean(),
  speed: speedSchema.nullable(),
}).strict();
export type BrowsingPolicy = z.infer<typeof browsingPolicySchema>;
export function siteHost(url: string | undefined) {
  try { const u = new URL(url ?? ''); return /^https?:$/.test(u.protocol) ? u.hostname : ''; } catch { return ''; }
}
export function seekTime(video: Pick<HTMLVideoElement, 'currentTime' | 'duration' | 'seekable'>, delta: number) {
  // Stay inside an actual seekable range, including live/DVR windows and gaps.
  const target = video.currentTime + delta;
  const ranges = Array.from({ length: video.seekable.length }, (_, i) => [video.seekable.start(i), video.seekable.end(i)] as const);
  if (!ranges.length) return undefined;
  return ranges.map(([start, end]) => Math.max(start, Math.min(target, Math.max(start, end - 0.05))))
    .sort((a, b) => Math.abs(a - target) - Math.abs(b - target))[0];
}
