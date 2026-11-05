import { allowedURL, authorizedPreview, LIMITS, positions, validateMetrics } from './core.js';
import { pageOperation } from './page.js';

let current = null;
let lastCapture = 0; // Chrome's rate limit spans consecutive capture sessions.
const previewURL = chrome.runtime.getURL('preview.html');
const menuId = 'still-full-page-download';
chrome.runtime.onInstalled.addListener(() => {
  // Menu entries persist across worker restarts. Recreate only on install/update.
  chrome.contextMenus.removeAll(() => {
    if (chrome.runtime.lastError) return;
    chrome.contextMenus.create({ id: menuId, title: 'Take full page screenshot', contexts: ['all'], documentUrlPatterns: ['http://*/*', 'https://*/*'] });
  });
});
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const bounded = (promise, ms, message) => {
  let timer;
  return Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(message)), ms); })]).finally(() => clearTimeout(timer));
};

function abort(job, reason) {
  if (job.phase !== 'capturing' && job.phase !== 'starting') return;
  job.error ||= reason;
  for (const pending of job.pending.values()) pending.reject(new Error(job.error));
  job.pending.clear();
}

function check(job) {
  if (job.error) throw new Error(job.error);
  if (Date.now() - job.started > LIMITS.duration) throw new Error('Capture timed out. Try a shorter page.');
}

async function assertSource(job) {
  check(job);
  const [tab, active, win] = await Promise.all([
    chrome.tabs.get(job.tabId), chrome.tabs.query({ windowId: job.windowId, active: true }), chrome.windows.get(job.windowId),
  ]);
  check(job);
  if (active.length !== 1 || active[0].id !== job.tabId || !tab.active || tab.url !== job.url || tab.status !== 'complete' || !win.focused || tab.discarded || tab.windowId !== job.windowId) {
    throw new Error('Capture stopped because the page, tab, or window changed. Click Still again on the page you want.');
  }
}

async function page(job, op, input) {
  check(job);
  const result = await bounded(chrome.scripting.executeScript({
    target: job.documentId ? { tabId: job.tabId, documentIds: [job.documentId] } : { tabId: job.tabId, frameIds: [0] },
    world: 'ISOLATED', func: pageOperation, args: [op, job.token, input || {}],
  }), 5000, 'The page did not respond. Capture stopped.');
  check(job);
  if (result.length !== 1 || !result[0].documentId || !result[0].result) throw new Error('The page cannot be captured. Open a regular webpage and try again.');
  if (job.documentId && result[0].documentId !== job.documentId) throw new Error('The document changed during capture.');
  job.documentId = result[0].documentId;
  return result[0].result;
}

function rpc(job, type, payload = {}) {
  if (type !== 'error') check(job);
  const id = ++job.sequence;
  return bounded(new Promise((resolve, reject) => {
    if (!job.port) { reject(new Error('The private preview closed.')); return; }
    job.pending.set(id, { resolve, reject });
    job.port.postMessage({ type, id, ...payload });
  }), type === 'error' ? 2000 : 12000, 'The private preview did not respond.').finally(() => job.pending.delete(id));
}

chrome.runtime.onConnect.addListener(port => {
  const job = current;
  if (port.name !== 'still-preview-v1' || !authorizedPreview(port.sender, job, chrome.runtime.id, previewURL) || job.port) { port.disconnect(); return; }
  job.port = port;
  port.onMessage.addListener(message => {
    if (!message || typeof message !== 'object') return;
    if (message.type === 'ready' && !job.ready) { job.ready = true; job.readyResolve(); return; }
    if (message.type === 'cancel') { abort(job, 'Capture cancelled.'); return; }
    if (message.type === 'ping') return;
    if (message.type !== 'ack' || !Number.isSafeInteger(message.id) || typeof message.ok !== 'boolean') return;
    const pending = job.pending.get(message.id);
    if (!pending) return;
    job.pending.delete(message.id);
    if (message.ok) pending.resolve(); else pending.reject(new Error('The image could not be assembled within safe browser limits.'));
  });
  port.onDisconnect.addListener(() => { job.port = null; abort(job, 'The private preview closed.'); });
});

chrome.tabs.onActivated.addListener(info => { if (current && info.windowId === current.windowId && info.tabId !== current.tabId) abort(current, 'Capture stopped because you switched tabs.'); });
chrome.tabs.onUpdated.addListener((id, change) => { if (current?.tabId === id && (change.status === 'loading' || change.url)) abort(current, 'Capture stopped because the page navigated.'); });
chrome.tabs.onRemoved.addListener(id => { if (current && [current.tabId, current.previewId].includes(id)) abort(current, 'The capture tab closed.'); });
chrome.tabs.onDetached.addListener(id => { if (current?.tabId === id) abort(current, 'The capture tab moved to another window.'); });
chrome.windows.onFocusChanged.addListener(id => { if (current && id !== current.windowId) abort(current, 'Capture stopped because the browser window lost focus.'); });

async function capture(tab, autoSave = false) {
  if (current) { abort(current, 'Capture cancelled.'); return; }
  const job = { token: crypto.randomUUID(), tabId: tab.id, windowId: tab.windowId, url: tab.url, phase: 'starting', started: Date.now(), pending: new Map(), sequence: 0, previewId: null, port: null, error: '', documentId: null };
  current = job;
  const deadline = setTimeout(() => abort(job, 'Capture timed out.'), LIMITS.duration);
  let failure = '';
  try {
    const ready = new Promise(resolve => { job.readyResolve = resolve; });
    // Assign the destination tab before loading its script, eliminating a handshake race.
    const preview = await chrome.tabs.create({ windowId: tab.windowId, url: 'about:blank', active: false, openerTabId: tab.id });
    job.previewId = preview.id;
    await chrome.tabs.update(preview.id, { url: `${previewURL}#${job.token}` });
    await bounded(ready, 10000, 'The private preview could not open.');
    if (!allowedURL(tab.url) || tab.incognito) throw new Error('Chrome protects this page. Open an http or https webpage, then click Still.');
    await assertSource(job);
    job.phase = 'capturing';
    await chrome.action.setBadgeBackgroundColor({ color: '#B94F36' });
    await chrome.action.setBadgeText({ tabId: job.tabId, text: '…' });
    let m = validateMetrics(await page(job, 'start'));
    await rpc(job, 'status', { text: 'Preparing the page. Keep this tab selected.' });
    // Bounded warm-up for native lazy loading. Infinite growth never becomes a silent partial success.
    let warmY = 0, warmSteps = 0;
    while (true) {
      await assertSource(job);
      m = validateMetrics(await page(job, 'scroll', { x: 0, y: warmY, capture: false }));
      if (++warmSteps > LIMITS.frames) throw new Error('This page keeps growing. Capture a finite page instead.');
      if (m.y + m.vh >= m.height - 1) break;
      warmY = Math.min(m.y + Math.max(1, m.vh - 64), m.height - m.vh);
    }
    m = validateMetrics(await page(job, 'scroll', { x: 0, y: 0, capture: true, lastRow: m.height <= m.vh }));
    const xs = positions(m.width, m.vw), ys = positions(m.height, m.vh);
    await rpc(job, 'begin', { metrics: m, total: xs.length * ys.length });
    let index = 0;
    for (const y of ys) for (const x of xs) {
      await assertSource(job);
      const tile = await page(job, 'scroll', { x, y, capture: true, lastRow: y === ys.at(-1) });
      if (['width', 'height', 'vw', 'vh', 'dpr'].some(k => Math.abs(tile[k] - m[k]) > 0.01) || Math.abs(tile.x - x) > 1 || Math.abs(tile.y - y) > 1) throw new Error('The page layout changed during capture. Let it finish loading, then try again.');
      await sleep(Math.max(120, 550 - (Date.now() - lastCapture)));
      await assertSource(job);
      lastCapture = Date.now();
      const data = await chrome.tabs.captureVisibleTab(job.windowId, { format: 'png' });
      await assertSource(job);
      // Recheck the same document and scroll after the asynchronous capture call.
      const after = await page(job, 'measure');
      if (['width', 'height', 'vw', 'vh', 'dpr', 'x', 'y'].some(k => Math.abs(after[k] - tile[k]) > 0.01)) throw new Error('The page moved during capture. Try again without scrolling.');
      if (typeof data !== 'string' || !data.startsWith('data:image/png;base64,') || data.length > 64_000_000) throw new Error('Chrome returned an unsupported screenshot.');
      await rpc(job, 'tile', { data, x: tile.x, y: tile.y, index: index++ });
      await chrome.action.setBadgeText({ tabId: job.tabId, text: `${Math.round(index / (xs.length * ys.length) * 100)}%` });
    }
    await assertSource(job);
    job.phase = 'finishing';
    await rpc(job, 'finish', { autoSave });
  } catch (err) {
    // Never return browser error strings containing the source URL or page content to the preview.
    failure = job.error || (err instanceof Error && /^(Chrome protects|Capture |The (page|document|private|image|capture)|This page|Open a regular|Invalid page|Image exceeds)/.test(err.message) ? err.message.slice(0, 220) : 'Capture failed. Reload the page and click Still again.');
    job.phase = 'failed';
    try { await rpc(job, 'error', { text: failure }); } catch { /* Preview already closed; no screenshot is persisted. */ }
  } finally {
    clearTimeout(deadline);
    if (job.documentId) {
      try {
        await bounded(chrome.scripting.executeScript({ target: { tabId: job.tabId, documentIds: [job.documentId] }, world: 'ISOLATED', func: pageOperation, args: ['cleanup', job.token] }), 2500, 'Cleanup timeout');
      } catch { /* Navigation/revoked access: the isolated controller has its own cleanup lease. */ }
    }
    await chrome.action.setBadgeText({ tabId: job.tabId, text: '' }).catch(() => {});
    job.phase = 'done';
    // Do not steal focus following an interruption. Successful captures open their result.
    if (!failure && !autoSave) await chrome.tabs.update(job.previewId, { active: true }).catch(() => {});
    else if (failure && !job.error) await chrome.tabs.update(job.previewId, { active: true }).catch(() => {});
    job.port?.disconnect();
    if (current === job) current = null;
  }
}

chrome.action.onClicked.addListener(tab => { void capture(tab); });

function handleContextClick(info, tab) {
  // Ignore selected text, link targets, frame URLs, and other page-supplied fields.
  if (info.menuItemId !== menuId || !tab || !Number.isInteger(tab.id) || !allowedURL(tab.url) || tab.incognito) return;
  return capture(tab, true);
}
chrome.contextMenus.onClicked.addListener(handleContextClick);
