/* GPL-3.0-or-later. Local bundle coordination; no web or downloader commands. */
(() => {
  'use strict';
  const MAIN_ID = 'bhglpjejpddnmfgkaakboniplnoemoak';
  let syncing = false;
  let lastAttempt = 0;
  async function synchronize(version) {
    if (syncing || version === chrome.runtime.getManifest().version || Date.now() - lastAttempt < 30000) return;
    syncing = true;
    lastAttempt = Date.now();
    try {
      // Fixed, packaged resource. No supplied URLs or remote configuration.
      const manifest = await (await fetch(chrome.runtime.getURL('manifest.json'), { cache: 'no-store' })).json();
      if (manifest.version !== version) return;
      const views = await chrome.runtime.getContexts({ contextTypes: ['POPUP', 'TAB'] });
      if (views.length) return;
      chrome.runtime.reload();
    } catch { /* The downloader's next update check retries. No browsing data logged. */ }
    finally { syncing = false; }
  }
  chrome.runtime.onMessageExternal.addListener((message, sender, reply) => {
    if (sender.id !== MAIN_ID || sender.tab || sender.url !== `chrome-extension://${MAIN_ID}/background.js`) return false;
    if (!message || typeof message !== 'object' || Array.isArray(message)) return false;
    const keys = Object.keys(message).sort().join(',');
    if (keys === 'type' && message.type === 'youtube-companion-supersede') {
      serialize(async()=>{if((await chrome.storage.local.get('enabled')).enabled!==false){await applyState(false);await chrome.storage.local.set({enabled:false});}return {paused:true};}).then(reply,()=>reply(null));
      return true;
    }
    if (keys === 'type' && message.type === 'youtube-companion-status') {
      chrome.storage.local.get('enabled').then(value => reply({ version: chrome.runtime.getManifest().version, engineVersion: '0.1.2', enabled: value.enabled !== false })).catch(() => reply(null));
      return true;
    }
    if (keys === 'type,version' && message.type === 'youtube-companion-sync' && typeof message.version === 'string' && /^\d{1,5}\.\d{1,5}\.\d{1,5}$/.test(message.version)) {
      reply({ accepted: true });
      void synchronize(message.version);
    }
    return false;
  });
})();
