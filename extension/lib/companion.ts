import { z } from 'zod';
import identity from '../../companion/audio/identity.json';
import mainIdentity from '../../extension-identity.json';
import { httpUrl } from './schema';

export const AUDIO_COMPANION_ID = identity.id;
export const MAIN_EXTENSION_ID = mainIdentity.id;
export const companionRequestSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('audio-companion-status') }).strict(),
  z.object({ type: z.literal('audio-companion-open') }).strict(),
  z.object({
    type: z.literal('audio-companion-download'), requestId: z.string().uuid(),
    tabId: z.number().int().nonnegative(), frameId: z.number().int().nonnegative(),
    mediaType: z.enum(['video', 'audio']).optional(), srcUrl: httpUrl.optional(),
    pageUrl: httpUrl, frameUrl: httpUrl.optional(),
  }).strict(),
]);
export function companionSender(sender: chrome.runtime.MessageSender) {
  return sender.id === AUDIO_COMPANION_ID && !sender.tab && sender.url === `chrome-extension://${AUDIO_COMPANION_ID}/background.js`;
}
