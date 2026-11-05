import { z } from 'zod';
import identity from '../../companion/screenshot/identity.json';

export const SCREENSHOT_COMPANION_ID = identity.id;
const status = z.object({ version: z.string().max(32), engineVersion: z.string().max(32) }).strict();
const syncAlarm = 'screenshot-companion-update';
let syncing = false;
export function initializeScreenshotCompanion() {
  chrome.alarms.onAlarm.addListener(event => { if (event.name === syncAlarm) void syncScreenshotCompanion(); });
}
export async function screenshotCompanionStatus() {
  try {
    const value = status.parse(await chrome.runtime.sendMessage(SCREENSHOT_COMPANION_ID, { type: 'screenshot-companion-status' }));
    return { installed: true as const, ...value };
  } catch { return { installed: false as const }; }
}
export async function syncScreenshotCompanion() {
  if (syncing) return;
  syncing = true;
  try {
    const current = await screenshotCompanionStatus(), version = chrome.runtime.getManifest().version;
    if (!current.installed || current.version === version) { await chrome.alarms.clear(syncAlarm); return; }
    if (!await chrome.alarms.get(syncAlarm)) await chrome.alarms.create(syncAlarm, { delayInMinutes: 0.5, periodInMinutes: 0.5 });
    await chrome.runtime.sendMessage(SCREENSHOT_COMPANION_ID, { type: 'screenshot-companion-sync', version });
  } catch { /* Optional companion is not connected. */ }
  finally { syncing = false; }
}
