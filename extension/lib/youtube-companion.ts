import { z } from 'zod';
import identity from '../../companion/youtube/identity.json';

export const YOUTUBE_COMPANION_ID = identity.id;
const status = z.object({ version: z.string().max(32), engineVersion: z.string().max(32), enabled: z.boolean() }).strict();
const syncAlarm = 'youtube-companion-update';
let syncing = false;

export function initializeYouTubeCompanion() {
  chrome.alarms.onAlarm.addListener(event => {
    if (event.name === syncAlarm) void syncYouTubeCompanion();
  });
}

export async function youtubeCompanionStatus() {
  try {
    const value = status.parse(await chrome.runtime.sendMessage(YOUTUBE_COMPANION_ID, { type: 'youtube-companion-status' }));
    return { installed: true as const, ...value };
  } catch { return { installed: false as const }; }
}

export async function syncYouTubeCompanion() {
  if (syncing) return;
  syncing = true;
  try {
    const current = await youtubeCompanionStatus();
    const version = chrome.runtime.getManifest().version;
    if (!current.installed || current.version === version) {
      await chrome.alarms.clear(syncAlarm);
      return;
    }
    // Retry a deferred activation after its popup closes, even if the native
    // helper is unavailable. No alarm permission is added to the companion.
    if (!await chrome.alarms.get(syncAlarm)) await chrome.alarms.create(syncAlarm, { delayInMinutes: 0.5, periodInMinutes: 0.5 });
    await chrome.runtime.sendMessage(YOUTUBE_COMPANION_ID, { type: 'youtube-companion-sync', version });
  }
  catch { /* Optional companion not installed or disabled in Chrome. */ }
  finally { syncing = false; }
}
