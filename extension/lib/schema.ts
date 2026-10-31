import { z } from 'zod';

export const httpUrl = z.string().max(16384).refine((s) => {
  try {
    const u = new URL(s);
    return ['http:', 'https:'].includes(u.protocol) && !u.username && !u.password && !/[\u0000-\u001f\u007f]/.test(s);
  } catch { return false; }
}, 'Expected an HTTP video address');
const finite = z.number().finite();
export const rectSchema = z.object({ x: finite, y: finite, width: finite.nonnegative(), height: finite.nonnegative() }).strict();
export type Rect = z.infer<typeof rectSchema>;
export const mediaSchema = z.object({
  id: z.string().max(80),
  sources: z.array(z.string().max(16384)).max(12),
  permalink: z.string().max(16384).optional(),
  rect: rectSchema,
  width: finite.nonnegative(), height: finite.nonnegative(),
  duration: finite.nonnegative(), currentTime: finite.nonnegative(),
  playing: z.boolean(), visible: z.boolean(), protected: z.boolean(),
  title: z.string().max(300),
}).strict();
export type Media = z.infer<typeof mediaSchema>;
export const imageMediaSchema = z.object({
  id: z.string().max(80), currentSrc: z.string().max(16384),
  sources: z.array(z.object({ url: httpUrl, score: finite.nonnegative() }).strict()).max(16),
  rect: rectSchema, width: finite.nonnegative(), height: finite.nonnegative(), inline: z.boolean(), title: z.string().max(300),
}).strict();
export type ImageMedia = z.infer<typeof imageMediaSchema>;
export const snapshotSchema = z.object({
  token: z.string().uuid(), url: z.string().max(16384), title: z.string().max(300),
  viewport: z.object({ width: finite, height: finite }).strict(),
  media: z.array(mediaSchema).max(100),
  images: z.array(imageMediaSchema).max(100).optional(),
  frames: z.array(z.object({ token: z.string().uuid().optional(), src: z.string().max(16384), rect: rectSchema }).strict()).max(100),
  point: z.object({ x: finite, y: finite, at: finite }).strict().optional(),
}).strict();
export type Snapshot = z.infer<typeof snapshotSchema> & { frameId: number; parentFrameId: number };
export const sourceSchema = z.object({
  url: httpUrl,
  kind: z.enum(['page', 'manifest', 'file']),
  entryIndex: z.number().int().min(1).max(100).optional(),
  headers: z.record(z.string().max(80), z.string().max(4096)).default({}),
}).strict();
export type Source = z.infer<typeof sourceSchema>;
export const candidateSchema = z.object({
  id: z.string().max(160), title: z.string().max(300),
  frameId: z.number().int(), score: finite,
  protected: z.boolean(), exact: z.boolean(),
  sources: z.array(sourceSchema).max(16),
  cookieUrls: z.array(httpUrl).max(16),
  width: finite.nonnegative(), height: finite.nonnegative(),
  cookiePartitionKey: z.object({ topLevelSite: httpUrl, hasCrossSiteAncestor: z.boolean().optional() }).strict().optional(),
}).strict();
export type Candidate = z.infer<typeof candidateSchema>;
export const intentSchema = z.enum(['video', 'audio', 'formats']);
export type DownloadIntent = z.infer<typeof intentSchema>;
export const selectionSchema = z.object({ probeId: z.string().regex(/^[0-9a-f]{32}$/), optionId: z.string().regex(/^[0-9a-f]{32}$/) }).strict();
export const downloadOptionsSchema = z.object({ assetType: z.enum(['video', 'audio']).optional(), outputProfile: z.enum(['compatible', 'original']).optional(), audioBitrate: z.union([z.literal(128), z.literal(192), z.literal(256), z.literal(320)]).optional(), formatSelection: selectionSchema.optional() }).strict();
export type DownloadOptions = z.infer<typeof downloadOptionsSchema>;
export const formatOptionSchema = z.object({
  id: z.string().regex(/^[0-9a-f]{32}$/), kind: z.enum(['video', 'audio']),
  codec: z.string().max(40), audioCodec: z.string().max(40), hdr: z.string().max(40), language: z.string().max(40),
  width: finite.positive().optional(), height: finite.positive().optional(), fps: finite.positive().optional(), bitrate: finite.positive().optional(), sampleRate: finite.positive().optional(), size: finite.positive().optional(), approximate: z.boolean().optional(),
}).strict();
export type FormatOption = z.infer<typeof formatOptionSchema>;
export const formatsSchema = z.object({ state: z.enum(['resolving', 'done']), options: z.array(formatOptionSchema).max(110) }).strict();
export const cookieSchema = z.object({
  name: z.string().max(1024), value: z.string().max(16384),
  domain: z.string().max(253), path: z.string().max(2048),
  secure: z.boolean(), httpOnly: z.boolean(), hostOnly: z.boolean(),
  expirationDate: finite.optional(),
}).strict();
export const jobSchema = z.object({
  id: z.string(), state: z.string(), title: z.string(), progress: z.number(),
  filename: z.string().nullable(), error: z.string().nullable(),
  detail: z.string().nullable(), created: z.number(),
}).passthrough();
export type Job = z.infer<typeof jobSchema>;
export const settingsSchema = z.object({ restoreMenus: z.boolean().default(true), restoreCopy: z.boolean().default(true), cleanImages: z.boolean().default(true), useCookies: z.boolean().default(true), compatibleVideo: z.boolean().default(true), autoUpdates: z.boolean().default(true) });
export type Settings = z.infer<typeof settingsSchema>;
export const defaults: Settings = { restoreMenus: true, restoreCopy: true, cleanImages: true, useCookies: true, compatibleVideo: true, autoUpdates: true };
