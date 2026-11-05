import { isCaptureActive } from './capture-background.js';

// Local bundle coordination only. No command can capture or retrieve pixels.
const MAIN_ID = 'bhglpjejpddnmfgkaakboniplnoemoak';
let syncing = false, lastAttempt = 0;
async function synchronize(version) {
  if (syncing || isCaptureActive() || version === chrome.runtime.getManifest().version || Date.now() - lastAttempt < 30000) return;
  syncing = true; lastAttempt = Date.now();
  try {
    const manifest = await (await fetch(chrome.runtime.getURL('manifest.json'), { cache: 'no-store' })).json();
    if (manifest.version !== version) return;
    const views = await chrome.runtime.getContexts({ contextTypes: ['POPUP', 'TAB'] });
    if (views.length || isCaptureActive()) return;
    chrome.runtime.reload();
  } catch { /* Parent retries later. Never log screenshot or source information. */ }
  finally { syncing = false; }
}
chrome.runtime.onMessageExternal.addListener((message, sender, reply) => {
  if (sender.id !== MAIN_ID || sender.tab || sender.url !== `chrome-extension://${MAIN_ID}/background.js`) return false;
  if (!message || typeof message !== 'object' || Array.isArray(message)) return false;
  const keys = Object.keys(message).sort().join(',');
  if (keys === 'type' && message.type === 'screenshot-companion-status') {
    reply({ version: chrome.runtime.getManifest().version, engineVersion: '1.1.0' });
  } else if (keys === 'type,version' && message.type === 'screenshot-companion-sync' && typeof message.version === 'string' && /^\d{1,5}\.\d{1,5}\.\d{1,5}$/.test(message.version)) {
    reply({ accepted: true }); void synchronize(message.version);
  }
  return false;
});
