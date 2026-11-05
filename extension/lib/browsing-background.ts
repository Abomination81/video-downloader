import { z } from 'zod';
import { evalSnippets } from '@duckduckgo/autoconsent';
import { browsingSchema, browsingChangesSchema, siteHost, speedSchema } from './browsing-policy';
import { setPopupGuardPolicy } from './popup-guard';
import { setProtectionAnnoyances } from './protection-companion';
import { httpUrl } from './schema';
import { within } from './probe';

export function initializeBrowsing() {
  const evaluations = new Map<string, { at: number; count: number; active: number }>();
  let pending = Promise.resolve();
  const serial = <T>(work: () => Promise<T>) => { const next = pending.then(work, work); pending = next.then(() => {}, () => {}); return next; };
  async function settings() { return browsingSchema.parse((await chrome.storage.local.get('browsing')).browsing ?? {}); }
  async function policy(tabId: number) {
    const tab = await chrome.tabs.get(tabId), host = siteHost(tab.url), prefs = await settings();
    const values = z.record(z.string().max(253), speedSchema).catch({}).parse((await chrome.storage.local.get('videoSpeeds')).videoSpeeds);
    return { host, enabled: !!host && !prefs.pausedSites.includes(host), rejectCookies: prefs.rejectCookies, popupGuard: prefs.popupGuard, videoControls: prefs.videoControls, allowPopups: prefs.popupSites.includes(host), speed: values[host] ?? null };
  }
  async function apply(sender: chrome.runtime.MessageSender) {
    const value = await policy(sender.tab!.id!);
    await chrome.scripting.executeScript({ target: { tabId: sender.tab!.id!, ...(sender.documentId ? { documentIds: [sender.documentId] } : { frameIds: [sender.frameId ?? 0] }) }, world: 'MAIN', func: setPopupGuardPolicy, args: [value.enabled && value.popupGuard, value.allowPopups], injectImmediately: true });
    return value;
  }
  async function sync() { const prefs = await settings(); await setProtectionAnnoyances(prefs.hideNags); }
  void sync().catch(() => {});
  void chrome.alarms.get('browsing-sync').then(value => { if (!value) return chrome.alarms.create('browsing-sync', { periodInMinutes: 1 }); });
  chrome.alarms.onAlarm.addListener(alarm => { if (alarm.name === 'browsing-sync') void sync().catch(() => {}); });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !changes.browsing && !changes.videoSpeeds) return;
    if (changes.browsing) void sync().catch(() => {});
    void chrome.tabs.query({}).then(tabs => Promise.allSettled(tabs.filter(t => t.id !== undefined && siteHost(t.url)).map(async tab => {
      const value = await policy(tab.id!);
      await chrome.scripting.executeScript({ target: { tabId: tab.id!, allFrames: true }, world: 'MAIN', func: setPopupGuardPolicy, args: [value.enabled && value.popupGuard, value.allowPopups] });
      await chrome.tabs.sendMessage(tab.id!, { type: 'browsing-policy', value });
    })));
  });
  chrome.runtime.onMessage.addListener((raw, sender, respond) => {
    if (sender.id !== chrome.runtime.id || typeof raw?.type !== 'string' || !raw.type.startsWith('browsing-')) return;
    const extensionPage = sender.url?.startsWith(chrome.runtime.getURL('')) === true;
    const ownPage = ['popup.html', 'options.html'].some(path => sender.url?.split(/[?#]/)[0] === chrome.runtime.getURL(path));
    const content = !extensionPage && sender.tab?.id !== undefined;
    let work: (() => Promise<unknown>) | undefined;
    if (content) {
      const message = z.discriminatedUnion('type', [
        z.object({ type: z.literal('browsing-policy') }).strict(),
        z.object({ type: z.literal('browsing-speed'), speed: speedSchema }).strict(),
        z.object({ type: z.literal('browsing-allow-popups') }).strict(),
        z.object({ type: z.literal('browsing-open-once'), url: httpUrl }).strict(),
        z.object({ type: z.literal('browsing-consent-eval'), snippetId: z.string().max(120) }).strict(),
      ]).safeParse(raw);
      if (!message.success) return;
      const messageData = message.data;
      work = async () => {
        const value = await policy(sender.tab!.id!);
        if (messageData.type === 'browsing-policy') return apply(sender);
        if (messageData.type === 'browsing-consent-eval') {
          if (!value.enabled || !value.rejectCookies || !Object.hasOwn(evalSnippets, messageData.snippetId)) return false;
          const key = `${sender.tab!.id}:${sender.documentId ?? sender.frameId}`;
          let budget = evaluations.get(key);
          if (!budget || Date.now() - budget.at > 60000) {
            budget = { at: Date.now(), count: 0, active: 0 }; evaluations.set(key, budget);
            if (evaluations.size > 200) evaluations.delete(evaluations.keys().next().value!);
          }
          if (++budget.count > 1000 || budget.active >= 64) return false;
          // Only pinned, compiled functions; page-supplied code is never evaluated.
          const func = evalSnippets[messageData.snippetId as keyof typeof evalSnippets];
          budget.active++;
          try {
            const result = await within(chrome.scripting.executeScript({ target: { tabId: sender.tab!.id!, ...(sender.documentId ? { documentIds: [sender.documentId] } : { frameIds: [sender.frameId ?? 0] }) }, world: 'MAIN', func }), 2000);
            return Boolean(result[0]?.result);
          } finally { budget.active--; }
        }
        if (messageData.type === 'browsing-open-once') { await chrome.tabs.create({ url: messageData.url, openerTabId: sender.tab!.id }); return {}; }
        return serial(async () => {
          if (messageData.type === 'browsing-allow-popups') {
            const prefs = await settings();
            if (value.host && !prefs.popupSites.includes(value.host)) await chrome.storage.local.set({ browsing: { ...prefs, popupSites: [...prefs.popupSites.slice(-199), value.host] } });
          } else {
            const values = z.record(z.string().max(253), speedSchema).catch({}).parse((await chrome.storage.local.get('videoSpeeds')).videoSpeeds);
            delete values[value.host];
            await chrome.storage.local.set({ videoSpeeds: { ...Object.fromEntries(Object.entries(values).slice(-199)), [value.host]: messageData.speed } });
          }
          return {};
        });
      };
    } else if (ownPage) {
      const message = z.discriminatedUnion('type', [
        z.object({ type: z.literal('browsing-status'), tabId: z.number().int().nonnegative().optional() }).strict(),
        z.object({ type: z.literal('browsing-settings'), settings: browsingChangesSchema }).strict(),
        z.object({ type: z.literal('browsing-pause'), tabId: z.number().int().nonnegative(), paused: z.boolean() }).strict(),
      ]).safeParse(raw);
      if (!message.success) return;
      const messageData = message.data;
      work = async () => {
        if (messageData.type === 'browsing-status') return { settings: await settings(), policy: messageData.tabId === undefined ? null : await policy(messageData.tabId) };
        return serial(async () => {
          if (messageData.type === 'browsing-settings') {
            await chrome.storage.local.set({ browsing: { ...await settings(), ...messageData.settings } });
            // Apply the built-in nuisance lists before offering a reload.
            await sync().catch(() => {});
          }
          else {
            const host = siteHost((await chrome.tabs.get(messageData.tabId)).url), prefs = await settings();
            const sites = prefs.pausedSites.filter(h => h !== host);
            if (messageData.paused && host) sites.push(host);
            await chrome.storage.local.set({ browsing: { ...prefs, pausedSites: sites.slice(-200) } });
          }
          return {};
        });
      };
    }
    if (!work) return;
    void work().then(result => respond({ ok: true, result }), () => respond({ ok: false, error: { code: 'browsing_failed', message: 'This browsing tool could not finish. Reload the page and try again.' } }));
    return true;
  });
}
