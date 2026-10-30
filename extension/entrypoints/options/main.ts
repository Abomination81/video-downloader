import { z } from 'zod';
import { defaults, settingsSchema } from '../../lib/schema';
import { el, notice, request } from '../../lib/ui';

async function check() {
  const button = el<HTMLButtonElement>('#check'); button.disabled = true;
  try {
    const result = z.object({ ready: z.boolean(), version: z.string(), engine: z.string(), downloadDir: z.string() }).parse(await request({ type: 'ping' }));
    el('#connection').textContent = result.ready ? 'Ready when you are.' : 'Finish installing the helper.';
    el('#connection-detail').textContent = result.ready ? 'Downloads keep running when you leave the page. Finished files appear in Chrome’s download panel.' : 'Rerun the installer from your download bundle to install missing tools.';
  } catch (error) { el('#connection').textContent = 'Install your local helper.'; el('#connection-detail').textContent = (error as Error).message; }
  finally { button.disabled = false; }
}
el<HTMLButtonElement>('#check').onclick = () => void check();
async function init() {
  const saved = await chrome.storage.local.get('settings'); const settings = settingsSchema.parse({ ...defaults, ...(saved.settings as object ?? {}) });
  el<HTMLInputElement>('#restore-menus').checked = settings.restoreMenus;
  el<HTMLInputElement>('#restore-copy').checked = settings.restoreCopy;
  el<HTMLInputElement>('#clean-images').checked = settings.cleanImages;
  el<HTMLInputElement>('#use-cookies').checked = settings.useCookies;
  el<HTMLInputElement>('#compatible-video').checked = settings.compatibleVideo;
  for (const id of ['#restore-menus', '#restore-copy', '#clean-images', '#use-cookies', '#compatible-video']) el<HTMLInputElement>(id).onchange = async () => {
    try { await chrome.storage.local.set({ settings: { restoreMenus: el<HTMLInputElement>('#restore-menus').checked, restoreCopy: el<HTMLInputElement>('#restore-copy').checked, cleanImages: el<HTMLInputElement>('#clean-images').checked, useCookies: el<HTMLInputElement>('#use-cookies').checked, compatibleVideo: el<HTMLInputElement>('#compatible-video').checked } }); }
    catch { notice('The preference could not be saved. Try again.'); }
  };
  await check();
}
void init().catch((error) => notice((error as Error).message));
