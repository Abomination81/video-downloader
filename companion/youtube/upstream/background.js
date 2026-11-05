/* Still — GPL-3.0-or-later. No network access, remote configuration, or page commands. */
'use strict';
const SCRIPT_IDS = ['still-main', 'still-player'];
const MATCHES = ['https://www.youtube.com/*', 'https://www.youtube-nocookie.com/embed/*'];
const SCRIPTS = [
  {id: SCRIPT_IDS[0], matches: MATCHES, js: ['main.js'], world: 'MAIN', runAt: 'document_start', allFrames: true, persistAcrossSessions: true},
  {id: SCRIPT_IDS[1], matches: MATCHES, js: ['player.js'], css: ['ads.css'], world: 'ISOLATED', runAt: 'document_start', allFrames: true, persistAcrossSessions: true}
];
let queue = Promise.resolve();

async function enabledState() {
  return (await chrome.storage.local.get('enabled')).enabled !== false;
}

async function applyState(enabled) {
  const existing = await chrome.scripting.getRegisteredContentScripts({ids: SCRIPT_IDS});
  if (enabled) {
    // Update registered files on extension upgrades, without a gap from unregistering.
    if (existing.length) await chrome.scripting.updateContentScripts(SCRIPTS.filter(s => existing.some(e => e.id === s.id)));
    const missing = SCRIPTS.filter(s => !existing.some(e => e.id === s.id));
    if (missing.length) await chrome.scripting.registerContentScripts(missing);
  } else if (existing.length) {
    await chrome.scripting.unregisterContentScripts({ids: existing.map(s => s.id)});
  }
  await chrome.declarativeNetRequest.updateEnabledRulesets({
    enableRulesetIds: enabled ? ['youtube_ads'] : [],
    disableRulesetIds: enabled ? [] : ['youtube_ads']
  });
  await chrome.action.setBadgeText({text: enabled ? '' : 'OFF'});
  await chrome.action.setBadgeBackgroundColor({color: '#46505a'});
  await chrome.action.setTitle({title: enabled ? 'Still · YouTube ad filtering' : 'Still · Protection paused'});
}

function serialize(task) {
  const next = queue.then(task);
  queue = next.catch(() => {}); // Keep later recovery requests usable after a rejected operation.
  return next;
}

async function initialize() {
  await chrome.storage.local.setAccessLevel({accessLevel: 'TRUSTED_CONTEXTS'});
  await applyState(await enabledState());
}

function reportFailure() {
  // Fixed status only; never log URLs, video IDs, response bodies, or account data.
  void chrome.action.setBadgeText({text: '!'});
  void chrome.action.setTitle({title: 'Still needs attention — open the extension popup'});
}

chrome.runtime.onInstalled.addListener(() => { void serialize(initialize).catch(reportFailure); });
chrome.runtime.onStartup.addListener(() => { void serialize(initialize).catch(reportFailure); });

chrome.runtime.onMessage.addListener((message, sender, reply) => {
  // Only our packaged popup can change state. Content scripts and arbitrary web pages cannot.
  if (sender.id !== chrome.runtime.id || sender.url !== chrome.runtime.getURL('popup.html')) return false;
  if (!message || typeof message !== 'object' || Array.isArray(message)) return false;
  const keys = Object.keys(message).sort().join(',');
  const isRead = keys === 'type' && message.type === 'status';
  const isWrite = keys === 'enabled,type' && message.type === 'set-enabled' && typeof message.enabled === 'boolean';
  if (!isRead && !isWrite) return false;
  serialize(async () => {
    await chrome.storage.local.setAccessLevel({accessLevel: 'TRUSTED_CONTEXTS'});
    const previous = await enabledState();
    if (isWrite) {
      try {
        await applyState(message.enabled);
        await chrome.storage.local.set({enabled: message.enabled});
      } catch (error) {
        await applyState(previous);
        throw error;
      }
    } else {
      await applyState(previous); // Repair partial initialization if the browser interrupted it.
    }
    reply({ok: true, enabled: isWrite ? message.enabled : previous});
  }).catch(() => { reportFailure(); reply({ok: false}); });
  return true;
});
