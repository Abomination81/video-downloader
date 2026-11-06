import { z } from 'zod';
import { defaults, settingsSchema } from '../../lib/schema';
import { el, notice, request } from '../../lib/ui';
import { updateSchema } from '../../lib/updates';
import {adblockControls} from '../../lib/adblock-ui';
import { browsingSchema } from '../../lib/browsing-policy';

async function browsing() {
  const read = async () => z.object({ settings: browsingSchema }).parse(await request({ type: 'browsing-status' })).settings;
  const fields = [['reject-cookies', 'rejectCookies'], ['hide-nags', 'hideNags'], ['popup-guard', 'popupGuard'], ['video-controls', 'videoControls']] as const;
  const settings = await read();
  const describe = (value: typeof settings) => { el('#browsing-exceptions').textContent = `${value.pausedSites.length} paused sites · ${value.popupSites.length} sites allowed to open windows.`; };
  describe(settings);
  for (const [id, key] of fields) {
    const input = el<HTMLInputElement>(`#${id}`); input.checked = settings[key];
    input.onchange = async () => {
      input.disabled = true;
      try { await request({ type: 'browsing-settings', settings: { [key]: input.checked } }); el('#browsing-save-status').textContent = 'Saved. Reload open pages to fully apply filter and cookie changes.'; }
      catch { input.checked = !input.checked; notice('The browsing preference could not be saved.'); }
      finally { input.disabled = false; }
    };
  }
  el<HTMLButtonElement>('#reset-browsing-exceptions').onclick = async () => {
    try { await request({ type: 'browsing-settings', settings: { pausedSites: [], popupSites: [] } }); describe(await read()); el('#browsing-save-status').textContent = 'Browsing exceptions reset.'; }
    catch { notice('The exceptions could not be reset.'); }
  };
}

async function protection() {
  try {
    const value = z.object({ installed: z.boolean(), enabled: z.boolean().optional(), version: z.string().optional(), engine:z.string().optional() }).parse(await request({ type: 'youtube-protection-status' }));
    el('#youtube-protection-status').textContent = value.installed ? `Built in · ${value.enabled ? 'enabled' : 'paused'}` : 'Protection could not start. Reload the extension.';
  } catch { el('#youtube-protection-status').textContent = 'Protection status unavailable. Reload the extension.'; }
}

async function screenshots() {
  try {
    const value = z.object({ installed: z.boolean(), version: z.string().optional() }).parse(await request({ type: 'screenshot-companion-status' }));
    el('#screenshot-companion-status').textContent = value.installed ? `Built in · Ready · v${value.version}` : 'Capture could not start. Reload the extension.';
  } catch { el('#screenshot-companion-status').textContent = 'Screenshot status unavailable. Check Chrome’s Extensions page.'; }
}

async function check() {
  const button = el<HTMLButtonElement>('#check'); button.disabled = true;
  try {
    const result = z.object({ ready: z.boolean(), version: z.string(), engine: z.string(), downloadDir: z.string(), extensionDir: z.string().optional() }).parse(await request({ type: 'ping' }));
    el('#connection').textContent = result.ready ? 'Ready when you are.' : 'Finish installing the helper.';
    el('#connection-detail').textContent = result.ready ? 'Downloads keep running when you leave the page. Finished files appear in Chrome’s download panel.' : 'Rerun the installer from your download bundle to install missing tools.';
    if (result.extensionDir) el('#installed-extension-folder').textContent = result.extensionDir;
  } catch (error) { el('#connection').textContent = 'Install your local helper.'; el('#connection-detail').textContent = (error as Error).message; }
  finally { button.disabled = false; }
  await protection();
  await screenshots();
}
el<HTMLButtonElement>('#check').onclick = () => void check();
let updateTimer: ReturnType<typeof setTimeout> | undefined;
async function updates(manual = false) {
  const button = el<HTMLButtonElement>('#check-updates'); button.disabled = true;
  clearTimeout(updateTimer);
  try {
    const value = updateSchema.parse(await request({ type: manual ? 'check-updates' : 'update-status' }));
    const running = chrome.runtime.getManifest().version;
    const pending = value.installedVersion !== running;
    el('#versions').textContent = `Running in Chrome: ${running} · Installed: ${value.installedVersion}`;
    el('#update-detail').textContent = value.enabled || manual ? value.message : 'Automatic updates are off. Check manually whenever you want.';
    el('#activate-update').hidden = !pending || value.state !== 'ready';
    if (['checking', 'downloading', 'preparing', 'waiting', 'applying'].includes(value.state) || pending && value.state !== 'manual') updateTimer = setTimeout(() => void updates(), 2500);
  } catch { el('#update-detail').textContent = 'Updates could not be checked. Check the helper connection and try again.'; }
  finally { button.disabled = false; }
  await protection();
  await screenshots();
}
el<HTMLButtonElement>('#check-updates').onclick = () => void updates(true);
el<HTMLButtonElement>('#activate-update').onclick = async () => {
  const tab = await chrome.tabs.getCurrent();
  if (tab?.id !== undefined) await chrome.tabs.remove(tab.id);
};
async function init() {
  adblockControls();
  void browsing().catch(() => notice('Browsing preferences could not be loaded.'));
  const saved = await chrome.storage.local.get('settings'); const settings = settingsSchema.parse({ ...defaults, ...(saved.settings as object ?? {}) });
  el<HTMLInputElement>('#restore-menus').checked = settings.restoreMenus;
  el<HTMLInputElement>('#restore-copy').checked = settings.restoreCopy;
  el<HTMLInputElement>('#clean-images').checked = settings.cleanImages;
  el<HTMLInputElement>('#use-cookies').checked = settings.useCookies;
  el<HTMLInputElement>('#compatible-video').checked = settings.compatibleVideo;
  el<HTMLInputElement>('#auto-updates').checked = settings.autoUpdates;
  for (const id of ['#restore-menus', '#restore-copy', '#clean-images', '#use-cookies', '#compatible-video', '#auto-updates']) el<HTMLInputElement>(id).onchange = async () => {
    try { await chrome.storage.local.set({ settings: { restoreMenus: el<HTMLInputElement>('#restore-menus').checked, restoreCopy: el<HTMLInputElement>('#restore-copy').checked, cleanImages: el<HTMLInputElement>('#clean-images').checked, useCookies: el<HTMLInputElement>('#use-cookies').checked, compatibleVideo: el<HTMLInputElement>('#compatible-video').checked, autoUpdates: el<HTMLInputElement>('#auto-updates').checked } }); }
    catch { notice('The preference could not be saved. Try again.'); }
  };
  await check();
  await updates();
}
void init().catch((error) => notice((error as Error).message));
