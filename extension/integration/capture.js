import { capture as captureNow, isCaptureActive } from '../screenshot/capture-background.js';

let starting;
export const captureBusy = () => !!starting || isCaptureActive();

async function ready(tab) {
  if (!Number.isInteger(tab?.id) || !/^https?:\/\//.test(tab.url ?? '') || tab.incognito) {
    throw new Error('Open a regular webpage before capturing.');
  }
  // Closing an action popup can briefly emit WINDOW_ID_NONE on Linux/Windows.
  // Start only after the popup has closed and the source focus has settled.
  // Once capture starts, the engine retains all strict focus/document guards.
  let focusedSince = 0;
  const deadline = Date.now() + 3000;
  while (Date.now() < deadline) {
    const [current, win, popups] = await Promise.all([
      chrome.tabs.get(tab.id), chrome.windows.get(tab.windowId),
      chrome.runtime.getContexts({ contextTypes: ['POPUP'] }),
    ]);
    if (!current.active || current.url !== tab.url || current.windowId !== tab.windowId || current.discarded) {
      throw new Error('Capture stopped because the source tab changed.');
    }
    if (win.focused && popups.length === 0) {
      focusedSince ||= Date.now();
      if (Date.now() - focusedSince >= 200) return;
    } else focusedSince = 0;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error('Keep the source window active and try capturing again.');
}

export async function capture(tab, autoSave = false) {
  if (isCaptureActive()) return captureNow(tab, autoSave); // Repeat click cancels.
  if (starting) throw new Error('A screenshot is already starting.');
  starting = ready(tab).then(() => captureNow(tab, autoSave));
  try { return await starting; }
  finally { starting = undefined; }
}
