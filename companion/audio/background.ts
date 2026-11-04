import { z } from 'zod';
import { MAIN_EXTENSION_ID } from '../../extension/lib/companion';
import { httpUrl } from '../../extension/lib/schema';

const responseSchema = z.object({ ok: z.boolean(), result: z.unknown().optional(), error: z.object({ code: z.string().max(80), message: z.string().max(600) }).optional() });
const statusSchema = z.object({ version: z.string().regex(/^\d+\.\d+\.\d+$/), busy: z.boolean() });
let active = 0;
const alarm = 'audio-companion-update';

async function primary(message: Record<string, unknown>) {
  let raw: unknown;
  try { raw = await chrome.runtime.sendMessage(MAIN_EXTENSION_ID, message); }
  catch { throw new Error('Enable Video Downloader and load its installed extension folder. This audio companion uses the same local helper.'); }
  const response = responseSchema.parse(raw);
  if (!response.ok) throw new Error(response.error?.message ?? 'The audio download could not start. Open Video Downloader for details.');
  return response.result;
}
async function report(error: unknown) {
  const message = error instanceof Error && !(error instanceof z.ZodError) ? error.message.slice(0, 600) : 'Open Video Downloader to check setup and try again.';
  await chrome.storage.local.set({ lastError: message });
  await chrome.action.setBadgeText({ text: '!' });
}
async function synchronize() {
  if (active) return;
  try {
    const status = statusSchema.parse(await primary({ type: 'audio-companion-status' }));
    if (status.busy || status.version === chrome.runtime.getManifest().version || active) return;
    // The companion lives inside the atomically updated main folder. Check
    // its on-disk manifest so a copy loaded from an old ZIP never reloads in a loop.
    const disk = z.object({ version: z.string() }).parse(await (await fetch(chrome.runtime.getURL('manifest.json'), { cache: 'no-store' })).json());
    if (disk.version === status.version && !active) chrome.runtime.reload();
  } catch { /* Main installation/update may be in progress. Retry on the alarm. */ }
}
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => chrome.contextMenus.create({
    id: 'download-audio', title: 'Download audio', contexts: ['page', 'video', 'audio'],
    documentUrlPatterns: ['http://*/*', 'https://*/*'],
  }));
  void chrome.alarms.create(alarm, { periodInMinutes: .5 });
  void synchronize();
});
chrome.runtime.onStartup.addListener(() => { void chrome.alarms.create(alarm, { periodInMinutes: .5 }); void synchronize(); });
chrome.alarms.onAlarm.addListener(event => { if (event.name === alarm) void synchronize(); });
chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== 'download-audio' || tab?.id === undefined) return;
  const page = httpUrl.safeParse(info.pageUrl);
  if (!page.success) return;
  active++;
  void primary({
    type: 'audio-companion-download', requestId: crypto.randomUUID(), tabId: tab.id, frameId: info.frameId ?? 0,
    pageUrl: page.data, ...(httpUrl.safeParse(info.frameUrl).success ? { frameUrl: info.frameUrl } : {}),
    ...(['video', 'audio'].includes(info.mediaType ?? '') ? { mediaType: info.mediaType } : {}),
    ...(httpUrl.safeParse(info.srcUrl).success ? { srcUrl: info.srcUrl } : {}),
  }).then(async () => { await chrome.storage.local.remove('lastError'); await chrome.action.setBadgeText({ text: '' }); })
    .catch(report).finally(() => { active--; });
});
chrome.runtime.onMessageExternal.addListener((raw, sender) => {
  if (sender.id === MAIN_EXTENSION_ID && !sender.tab && raw?.type === 'audio-companion-sync') void synchronize();
});
chrome.runtime.onMessage.addListener((raw, sender, respond) => {
  if (sender.id !== chrome.runtime.id || sender.url !== chrome.runtime.getURL('popup.html') || raw?.type !== 'open-downloader') return;
  active++;
  void primary({ type: 'audio-companion-open' }).then(() => respond({ ok: true })).catch(error => {
    void report(error); respond({ ok: false, message: (error as Error).message });
  }).finally(() => { active--; });
  return true;
});
void chrome.alarms.get(alarm).then(value => { if (!value) return chrome.alarms.create(alarm, { periodInMinutes: .5 }); });
