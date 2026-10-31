import { z } from 'zod';
import { defaults, settingsSchema } from '../../lib/schema';
import { el, notice, request } from '../../lib/ui';
import { updateSchema } from '../../lib/updates';

async function check() {
  const button = el<HTMLButtonElement>('#check'); button.disabled = true;
  try {
    const result = z.object({ ready: z.boolean(), version: z.string(), engine: z.string(), downloadDir: z.string() }).parse(await request({ type: 'ping' }));
    el('#connection').textContent = result.ready ? 'Ready when you are.' : 'Finish installing the helper.';
    el('#connection-detail').textContent = result.ready ? 'Downloads keep running when you leave the page. Finished files appear in Chrome’s download panel.' : 'Rerun the installer from your download bundle to install missing tools.';
    el('#versions').textContent = `Extension ${chrome.runtime.getManifest().version} · Helper ${result.version}`;
  } catch (error) { el('#connection').textContent = 'Install your local helper.'; el('#connection-detail').textContent = (error as Error).message; }
  finally { button.disabled = false; }
}
el<HTMLButtonElement>('#check').onclick = () => void check();
let updateTimer: ReturnType<typeof setTimeout> | undefined;
async function updates(manual = false) {
  const button = el<HTMLButtonElement>('#check-updates'); button.disabled = true;
  clearTimeout(updateTimer);
  try {
    const value = updateSchema.parse(await request({ type: manual ? 'check-updates' : 'update-status' }));
    el('#update-detail').textContent = value.enabled || manual ? value.message : 'Automatic updates are off. Check manually whenever you want.';
    if (value.installedVersion !== chrome.runtime.getManifest().version) el('#update-detail').textContent = `Version ${value.installedVersion} is installed. Close this settings tab to activate it automatically.`;
    if (['checking', 'downloading', 'preparing', 'waiting', 'applying'].includes(value.state)) updateTimer = setTimeout(() => void updates(), 2500);
  } catch { el('#update-detail').textContent = 'Updates could not be checked. Check the helper connection and try again.'; }
  finally { button.disabled = false; }
}
el<HTMLButtonElement>('#check-updates').onclick = () => void updates(true);
async function init() {
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
