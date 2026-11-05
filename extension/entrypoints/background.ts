import { z } from 'zod';
import { automaticChoice, discover, isVideoPage, mediaKind, type Capture } from '../lib/detection';
import { candidateSchema, cookieSchema, defaults, settingsSchema, snapshotSchema, type Candidate, type Snapshot } from '../lib/schema';
import { HelperError, native } from '../lib/native';
import { ChromeDownloads } from '../lib/downloads';
import { jobSchema } from '../lib/schema';
import { recoverSnapshots, within } from '../lib/probe';
import { COPY_CSS } from '../lib/copy-policy';
import { setNativeMenuPolicy } from '../lib/menu-policy';
import {AdBlocking} from '../lib/adblocking';
import {adHost} from '../lib/adblock-policy';
import { cleanLink } from '../lib/clean-link';
import { copyLink } from '../lib/clipboard';
import { httpUrl } from '../lib/schema';
import { selectedImage } from '../lib/images';
import { SavedImages } from '../lib/saved-images';
import { Updates } from '../lib/updates';
import { downloadOptionsSchema, type DownloadIntent, type DownloadOptions } from '../lib/schema';
import { AUDIO_COMPANION_ID, companionRequestSchema, companionSender } from '../lib/companion';

import { initializeYouTubeCompanion, syncYouTubeCompanion, youtubeCompanionStatus } from '../lib/youtube-companion';

import { initializeScreenshotCompanion, syncScreenshotCompanion, screenshotCompanionStatus } from '../lib/screenshot-companion';

export default defineBackground(() => {
  const ads=new AdBlocking();
  initializeScreenshotCompanion();
  initializeYouTubeCompanion();
  const captures = new Map<number, Capture[]>();
  const contexts = new Map<number, Snapshot>();
  type Selection = { at: number; pageUrl: string; promise: Promise<Candidate[]> };
  const selections = new Map<number, Selection>();
  const departedSelections = new Map<number, Selection>();
  function rememberSelection(tabId: number) {
    const selected = selections.get(tabId);
    if (selected && Date.now() - selected.at < 15000) {
      departedSelections.set(tabId, selected);
      setTimeout(() => { if (departedSelections.get(tabId) === selected) departedSelections.delete(tabId); }, 15000);
    }
  }
  const mediaTabs = new Set<number>();
  const requestHeaders = new Map<string, Record<string, string>>();
  const imageHeaders = new Map<string, Record<string, string>>();
  const audioHeaders = new Map<string, Record<string, string>>();
  const copyStyles = new Map<string, boolean>();
  const menuPolicies = new Map<string, boolean>();
  const copyTasks = new Map<string, Promise<unknown>>();
  const copyCssHistory = chrome.storage.local.get('copyCssHistory').then(async saved => {
    const previous = Array.isArray(saved.copyCssHistory) ? saved.copyCssHistory.filter((css): css is string => typeof css === 'string' && css.length <= 16384).slice(-63) : [];
    const values = [...new Set([...previous, COPY_CSS])];
    await chrome.storage.local.set({ copyCssHistory: values });
    return values;
  });
  const ready = chrome.storage.session.get('captures').then((saved) => {
    for (const [key, values] of Object.entries(saved.captures ?? {})) {
      if (Array.isArray(values)) captures.set(Number(key), values.filter((v): v is Capture => !!v && typeof v.url === 'string' && typeof v.at === 'number' && Date.now() - v.at < 20 * 60 * 1000).slice(-200));
    }
  });
  let flushTimer: ReturnType<typeof setTimeout> | undefined;
  function saveCaptures() {
    clearTimeout(flushTimer);
    flushTimer = setTimeout(() => {
      void chrome.storage.session.set({ captures: Object.fromEntries([...captures].slice(-30)) });
    }, 300);
  }
  async function settings() {
    const data = await chrome.storage.local.get('settings');
    return settingsSchema.parse({ ...defaults, ...(data.settings as object ?? {}) });
  }
  async function menuPolicy(tabId: number) {
    // A newly created overlay frame gets this again when it probes or reports media.
    const frames = await chrome.webNavigation.getAllFrames({ tabId });
    await Promise.allSettled((frames ?? []).slice(0, 100).map(async (f) => {
      const key = `${tabId}:${f.frameId}:${f.documentId ?? ''}`;
      const apply = async () => {
        const value = await settings();
        const history = await copyCssHistory;
        const target = { tabId, ...(f.documentId ? { documentIds: [f.documentId] } : { frameIds: [f.frameId] }) };
        if (menuPolicies.get(key) !== value.restoreMenus) {
          await chrome.scripting.executeScript({ target, world: 'MAIN', func: setNativeMenuPolicy, args: [value.restoreMenus], injectImmediately: true });
          menuPolicies.set(key, value.restoreMenus);
        }
        if (copyStyles.get(key) !== value.restoreCopy) {
          // USER styles can survive an extension reload. Remove prior rules
          // before inserting once; serialize frame work to prevent duplicates.
          for (const css of history) await chrome.scripting.removeCSS({ target, css, origin: 'USER' });
          if (value.restoreCopy) await chrome.scripting.insertCSS({ target, css: COPY_CSS, origin: 'USER' });
          copyStyles.set(key, value.restoreCopy);
        }
        return chrome.tabs.sendMessage(tabId, { type: 'menu-policy', hasMedia: mediaTabs.has(tabId) || !!captures.get(tabId)?.length, restoreMenus: value.restoreMenus, restoreCopy: value.restoreCopy }, f.documentId ? { documentId: f.documentId } : { frameId: f.frameId });
      };
      const previous = copyTasks.get(key) ?? Promise.resolve();
      const task = previous.then(apply, apply);
      copyTasks.set(key, task);
      try { return await task; }
      finally { if (copyTasks.get(key) === task) copyTasks.delete(key); }
    }));
  }
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.settings) void chrome.tabs.query({}).then((tabs) => Promise.allSettled(tabs.filter((t) => t.id !== undefined && /^https?:/.test(t.url ?? '')).map((t) => menuPolicy(t.id!))));
  });
  function errorResult(error: unknown) {
    return { code: error instanceof HelperError ? error.code : 'action_failed', message: error instanceof HelperError ? error.message : 'The action could not finish. Try again or open the extension for details.' };
  }
  async function report(error: unknown) {
    const value = errorResult(error);
    await chrome.storage.session.set({ lastError: value });
    await chrome.action.setBadgeText({ text: '!' });
  }
  const downloads = new ChromeDownloads(report);
  const savedImages = new SavedImages(report);
  let activeActions = 0;
  async function action<T>(run: () => Promise<T>): Promise<T> {
    activeActions++;
    try { return await run(); }
    finally { activeActions--; }
  }
  const updates = new Updates(() => activeActions > 0);
  chrome.runtime.onInstalled.addListener(() => {
    chrome.contextMenus.removeAll(() => {
      // PAGE applies only when no more-specific target applies. These two
      // entries are mutually exclusive, so Chrome never creates a parent tree.
      chrome.contextMenus.create({ id: 'download-video', title: 'Download video', contexts: ['page', 'video'], documentUrlPatterns: ['http://*/*', 'https://*/*'] });
      chrome.contextMenus.create({ id: 'save-original-image', title: 'Download photo', contexts: ['image'], documentUrlPatterns: ['http://*/*', 'https://*/*'] });
    });
    void syncYouTubeCompanion();
    void syncScreenshotCompanion();
    void chrome.runtime.sendMessage(AUDIO_COMPANION_ID, { type: 'audio-companion-sync' }).catch(() => undefined);
    // Connect pages already open during first installation as well as updates.
    // WXT disposes any prior copy without reloading pages or losing forms.
    const files = chrome.runtime.getManifest().content_scripts?.flatMap(script => script.js ?? []) ?? [];
    if (files.length) void chrome.tabs.query({}).then(tabs => Promise.allSettled(tabs.filter(tab => tab.id !== undefined && /^https?:/.test(tab.url ?? '')).map(tab => chrome.scripting.executeScript({ target: { tabId: tab.id!, allFrames: true }, files, injectImmediately: true }))));
  });
  chrome.webRequest.onBeforeSendHeaders.addListener((details) => {
    if (details.tabId < 0) return;
    const headers: Record<string, string> = {};
    for (const header of details.requestHeaders ?? []) {
      if (/^(referer|origin|user-agent|accept)$/i.test(header.name) && header.value && header.value.length <= 4096 && !/[\r\n]/.test(header.value)) headers[header.name] = header.value;
    }
    requestHeaders.set(details.requestId, headers);
    if (requestHeaders.size > 1000) requestHeaders.delete(requestHeaders.keys().next().value!);
  }, { urls: ['http://*/*', 'https://*/*'] }, ['requestHeaders', 'extraHeaders']);
  chrome.webRequest.onHeadersReceived.addListener((details) => {
    if (details.tabId < 0 || details.statusCode >= 400) return;
    const contentType = details.responseHeaders?.find((h) => h.name.toLowerCase() === 'content-type')?.value ?? '';
    if (/^image\//i.test(contentType)) {
      imageHeaders.set(details.url, requestHeaders.get(details.requestId) ?? {});
      if (imageHeaders.size > 500) imageHeaders.delete(imageHeaders.keys().next().value!);
      return;
    }
    if (/^audio\//i.test(contentType) && !/mpegurl/i.test(contentType)) {
      audioHeaders.set(details.url, requestHeaders.get(details.requestId) ?? {});
      if (audioHeaders.size > 200) audioHeaders.delete(audioHeaders.keys().next().value!);
      return;
    }
    const kind = mediaKind(details.url, contentType);
    if (!kind) return;
    const value: Capture = { url: details.url, kind, headers: requestHeaders.get(details.requestId) ?? {}, frameId: details.frameId, at: Date.now(), contentType };
    void ready.then(() => {
      const current = captures.get(details.tabId) ?? [];
      captures.set(details.tabId, [...current.filter((c) => c.url !== value.url && Date.now() - c.at < 20 * 60 * 1000), value].slice(-200));
      saveCaptures();
      void menuPolicy(details.tabId);
    });
  }, { urls: ['http://*/*', 'https://*/*'] }, ['responseHeaders']);
  const forgetRequest = (d: { requestId: string }) => requestHeaders.delete(d.requestId);
  chrome.webRequest.onCompleted.addListener(forgetRequest, { urls: ['http://*/*', 'https://*/*'] });
  chrome.webRequest.onErrorOccurred.addListener(forgetRequest, { urls: ['http://*/*', 'https://*/*'] });
  chrome.webNavigation.onCommitted.addListener((details) => {
    for (const key of menuPolicies.keys()) if (key.startsWith(`${details.tabId}:`) && (details.frameId === 0 || key.startsWith(`${details.tabId}:${details.frameId}:`))) menuPolicies.delete(key);
    for (const key of copyStyles.keys()) if (key.startsWith(`${details.tabId}:`) && (details.frameId === 0 || key.startsWith(`${details.tabId}:${details.frameId}:`))) copyStyles.delete(key);
    if (details.frameId === 0) { rememberSelection(details.tabId); captures.delete(details.tabId); contexts.delete(details.tabId); selections.delete(details.tabId); mediaTabs.delete(details.tabId); saveCaptures(); }
    else captures.set(details.tabId, (captures.get(details.tabId) ?? []).filter((c) => c.frameId !== details.frameId));
  });
  chrome.tabs.onRemoved.addListener((tabId) => {
    rememberSelection(tabId);
    captures.delete(tabId); contexts.delete(tabId); selections.delete(tabId); mediaTabs.delete(tabId);
    for (const key of copyStyles.keys()) if (key.startsWith(`${tabId}:`)) copyStyles.delete(key);
    for (const key of menuPolicies.keys()) if (key.startsWith(`${tabId}:`)) menuPolicies.delete(key);
    saveCaptures();
  });

  async function find(tabId: number, clicked?: chrome.contextMenus.OnClickData) {
    const context = contexts.get(tabId);
    const captured = [...(captures.get(tabId) ?? [])];
    await ready;
    const tab = await chrome.tabs.get(tabId);
    if (!tab.url || !/^https?:\/\//.test(tab.url)) throw new HelperError('restricted_page', 'Open a website with a video first. Chrome blocks extensions on this page.');
    if (clicked?.pageUrl && clicked.pageUrl !== tab.url) throw new HelperError('source_page_changed', 'The source page changed after selection.');
    const frames = await chrome.webNavigation.getAllFrames({ tabId });
    if (clicked?.frameUrl && frames?.find(frame => frame.frameId === (clicked.frameId ?? 0))?.url !== clicked.frameUrl) throw new HelperError('source_page_changed', 'The source frame changed after selection.');
    const collected = await Promise.allSettled((frames ?? []).slice(0, 100).map(async (frame) => {
      const raw = await within(chrome.tabs.sendMessage(tabId, { type: 'probe' }, { frameId: frame.frameId }), 1500);
      return { ...snapshotSchema.parse(raw), frameId: frame.frameId, parentFrameId: frame.parentFrameId };
    }));
    const observed = captured.length ? captured : captures.get(tabId) ?? [];
    const snapshots = recoverSnapshots(collected.flatMap((r) => r.status === 'fulfilled' ? [r.value] : []), (frames ?? []).slice(0, 100), observed, { url: tab.url, title: tab.title ?? 'Video' }, context);
    const recent = context?.point && Date.now() - context.point.at < 15000;
    const click = clicked || recent ? {
      frameId: clicked?.frameId ?? context?.frameId ?? 0,
      ...(recent && context?.frameId === (clicked?.frameId ?? context?.frameId) ? { point: context.point } : {}),
      ...(clicked?.srcUrl ? { srcUrl: clicked.srcUrl } : {}),
    } : undefined;
    const found = discover(snapshots, observed, tab.url, click);
    if (typeof chrome.cookies.getPartitionKey !== 'function') return found;
    const keys = new Map<number, Promise<chrome.cookies.CookiePartitionKey | undefined>>();
    return Promise.all(found.map(async (candidate) => {
      let key = keys.get(candidate.frameId);
      if (!key) {
        key = within(chrome.cookies.getPartitionKey({ tabId, frameId: candidate.frameId }), 1500).then((r) => r.partitionKey, () => undefined);
        keys.set(candidate.frameId, key);
      }
      const value = await key;
      return value?.topLevelSite && /^https?:\/\//.test(value.topLevelSite) ? { ...candidate, cookiePartitionKey: { topLevelSite: value.topLevelSite, ...(value.hasCrossSiteAncestor === undefined ? {} : { hasCrossSiteAncestor: value.hasCrossSiteAncestor }) } } : candidate;
    }));
  }
  async function sessionCookies(candidate: Candidate, imageData?: string) {
    const value = await settings();
    const cookies = new Map<string, z.infer<typeof cookieSchema>>();
    if (value.useCookies && !imageData) {
      const results = await Promise.allSettled(candidate.cookieUrls.flatMap((url) => [chrome.cookies.getAll({ url }), ...(candidate.cookiePartitionKey ? [chrome.cookies.getAll({ url, partitionKey: candidate.cookiePartitionKey })] : [])]));
      for (const result of results) if (result.status === 'fulfilled') for (const c of result.value) {
        const parsed = cookieSchema.safeParse({ name: c.name, value: c.value, domain: c.domain, path: c.path, secure: c.secure, httpOnly: c.httpOnly, hostOnly: c.hostOnly, ...(c.expirationDate ? { expirationDate: c.expirationDate } : {}) });
        if (parsed.success) cookies.set(`${c.domain}\t${c.path}\t${c.name}`, parsed.data);
      }
    }
    return [...cookies.values()].slice(0, 500);
  }
  async function start(candidate: Candidate, requestId: string = crypto.randomUUID(), assetType: 'video' | 'image' | 'audio' = 'video', imageData?: string, options: DownloadOptions = {}) {
    if (candidate.protected) throw new HelperError('drm', 'This video is protected by DRM and cannot be downloaded by this extension.');
    const value = await settings();
    const result = z.object({ jobId: z.string().regex(/^[0-9a-f]{32}$/) }).parse(await native('start', { requestId, title: candidate.title, sources: candidate.sources, cookies: await sessionCookies(candidate, imageData), browserDownload: true, assetType, outputProfile: value.compatibleVideo ? 'compatible' : 'original', ...options, ...(imageData ? { imageData } : {}) }));
    await downloads.track(result.jobId);
    await chrome.storage.session.remove(['lastError', 'choices', 'formatPicker']);
    await chrome.action.setBadgeText({ text: '↓' });
    return result;
  }
  async function inspect(candidate: Candidate, requestId: string) {
    if (candidate.protected) throw new HelperError('drm', 'This video is protected by DRM and cannot be downloaded by this extension.');
    const value = await settings();
    const result = z.object({ jobId: z.string().regex(/^[0-9a-f]{32}$/) }).parse(await native('inspect', { requestId, title: candidate.title, sources: candidate.sources, cookies: await sessionCookies(candidate), outputProfile: value.compatibleVideo ? 'compatible' : 'original' }));
    await chrome.storage.session.set({ formatPicker: { candidate, probeId: result.jobId, at: Date.now(), profile: 'compatible', choice: '', bitrate: 320 } });
    return result;
  }
  async function saveImage(tabId: number, frameId: number, srcUrl?: string) {
    const tab = await chrome.tabs.get(tabId);
    let frame: Snapshot | undefined;
    try { frame = { ...snapshotSchema.parse(await within(chrome.tabs.sendMessage(tabId, { type: 'probe' }, { frameId }), 1500)), frameId, parentFrameId: -1 }; }
    catch { frame = contexts.get(tabId); }
    const selection = frame ? selectedImage([frame], frameId, srcUrl) : undefined;
    const page = frame?.url && /^https?:/.test(frame.url) ? frame.url : tab.url;
    if (!page || !/^https?:/.test(page)) throw new HelperError('image_missing', 'Open the image on a website first.');
    let data: string | undefined;
    if (selection?.image.inline && !selection.image.sources.length) {
      const result = z.object({ ok: z.boolean(), data: z.string().max(700000).optional() }).parse(await within(chrome.tabs.sendMessage(tabId, { type: 'image-data', id: selection.image.id }, { frameId }), 12000));
      if (!result.ok || !result.data) throw new HelperError('image_missing', 'This inline image is no longer available or is too large. Use Chrome’s normal Save image as command instead.');
      data = result.data;
    }
    const alternatives = selection?.image.sources.map((s) => s.url) ?? (srcUrl && /^https?:/.test(srcUrl) ? [srcUrl] : []);
    if (!alternatives.length && !data) throw new HelperError('image_missing', 'Right-click directly on an image and choose Download photo.');
    const sources = (data ? [page] : alternatives).slice(0, 16).map((url) => ({ url, kind: 'file' as const, headers: imageHeaders.get(url) ?? { Referer: page, 'User-Agent': navigator.userAgent } }));
    let cookiePartitionKey: Candidate['cookiePartitionKey'];
    try { const result = await within(chrome.cookies.getPartitionKey({ tabId, frameId }), 1500); if (result.partitionKey.topLevelSite) cookiePartitionKey = { topLevelSite: result.partitionKey.topLevelSite, hasCrossSiteAncestor: result.partitionKey.hasCrossSiteAncestor }; } catch { /* Older Chrome or a closed frame can still use ordinary relevant cookies. */ }
    return start({ id: selection?.image.id ?? 'selected-image', title: selection?.image.title ?? 'Image', frameId, score: 1, exact: true, protected: false, sources, cookieUrls: [...new Set([page, ...alternatives])].slice(0, 16), width: selection?.image.width ?? 0, height: selection?.image.height ?? 0, ...(cookiePartitionKey ? { cookiePartitionKey } : {}) }, crypto.randomUUID(), 'image', data);
  }
  async function downloadFrom(tabId: number, clicked?: chrome.contextMenus.OnClickData, intent: DownloadIntent = 'video', requestId: string = crypto.randomUUID()) {
    // Capture this promise before any await. Navigation may remove the tab's
    // discovery cache, but cannot invalidate an already selected source.
    const expectedPage = clicked?.frameUrl ?? clicked?.pageUrl;
    const selection = [selections.get(tabId), expectedPage ? departedSelections.get(tabId) : undefined].find(value => value && (!expectedPage || value.pageUrl === expectedPage));
    if (intent === 'audio' && clicked?.mediaType === 'audio' && httpUrl.safeParse(clicked.srcUrl).success) {
      // Native audio targets have an exact file URL. Capture it before awaiting
      // any tab API so navigating/closing the player cannot invalidate it.
      const url = clicked.srcUrl!;
      const page = clicked.frameUrl ?? clicked.pageUrl ?? contexts.get(tabId)?.url;
      if (!httpUrl.safeParse(page).success) throw new HelperError('audio_missing', 'Open the audio player on a website first.');
      const candidate: Candidate = { id: 'native-audio', title: 'Audio', frameId: clicked.frameId ?? 0, score: 1, protected: false, exact: true, width: 0, height: 0,
        sources: [{ url, kind: 'file', headers: audioHeaders.get(url) ?? { Referer: page! } }], cookieUrls: [...new Set([page!, clicked.pageUrl ?? page!, url])] };
      try { const value = await within(chrome.cookies.getPartitionKey({ tabId, frameId: candidate.frameId }), 1000); if (value.partitionKey.topLevelSite) candidate.cookiePartitionKey = { topLevelSite: value.partitionKey.topLevelSite, ...(value.partitionKey.hasCrossSiteAncestor === undefined ? {} : { hasCrossSiteAncestor: value.partitionKey.hasCrossSiteAncestor }) }; } catch { /* Closed players can still use the captured address and relevant ordinary cookies. */ }
      return start(candidate, requestId, 'audio');
    }
    let found: Candidate[];
    try { found = selection && Date.now() - selection.at < 15000 ? await selection.promise : await find(tabId, clicked); }
    catch (error) {
      if (!clicked || !httpUrl.safeParse(clicked.pageUrl).success) throw error;
      const page = clicked.frameUrl ?? clicked.pageUrl!;
      const file = httpUrl.safeParse(clicked.srcUrl);
      const sources: Candidate['sources'] = [];
      if (isVideoPage(page)) sources.push({ url: page, kind: 'page', headers: {} });
      if (file.success) sources.push({ url: file.data, kind: mediaKind(file.data) ?? 'file', headers: { Referer: page } });
      if (!sources.some(s => s.url === page)) sources.push({ url: page, kind: 'page', headers: {} });
      found = [{ id: 'closed-player', title: 'Selected media', frameId: clicked.frameId ?? 0, score: 1, protected: false, exact: true, width: 0, height: 0, sources, cookieUrls: [...new Set([page, clicked.pageUrl!, ...sources.map(s => s.url)])].slice(0, 16) }];
    }
    const chosen = automaticChoice(found);
    if (chosen && intent !== 'formats') {
      return start(chosen, requestId, intent);
    } else {
      await chrome.storage.session.set({ choices: { tabId, at: Date.now(), candidates: chosen ? [chosen] : found, intent } });
      await chrome.storage.session.remove('formatPicker');
      await chrome.action.openPopup();
      return { opened: true };
    }
  }
  chrome.contextMenus.onClicked.addListener((info, tab) => {
    if (info.menuItemId === 'save-original-image' && tab?.id !== undefined) { void action(() => saveImage(tab.id!, info.frameId ?? 0, info.srcUrl)).catch(report); return; }
    if (info.menuItemId === 'download-video' && tab?.id !== undefined) void action(() => downloadFrom(tab.id!, info)).catch(async (error) => {
      await report(error);
      try { await chrome.action.openPopup(); } catch { /* The badge retains the error if Chrome cannot open the popup. */ }
    });
  });
  chrome.commands.onCommand.addListener((command, tab) => {
    if (command === 'download-video' && tab?.id !== undefined) void action(() => downloadFrom(tab.id!)).catch(report);
  });
  const audioRequests = new Map<string, { at: number; promise: Promise<unknown> }>();
  chrome.runtime.onMessageExternal.addListener((raw: unknown, sender, respond) => {
    if (!companionSender(sender)) return;
    const parsed = companionRequestSchema.safeParse(raw);
    if (!parsed.success) { respond({ ok: false, error: { code: 'invalid_request', message: 'Update both extensions and try again.' } }); return; }
    const request = parsed.data;
    if (request.type === 'audio-companion-status') {
      respond({ ok: true, result: { version: chrome.runtime.getManifest().version, busy: activeActions > 0 } }); return;
    }
    let pending: Promise<unknown>;
    if (request.type === 'audio-companion-open') pending = action(() => chrome.action.openPopup());
    else {
      const previous = audioRequests.get(request.requestId);
      if (previous) pending = previous.promise;
      else {
        for (const [id, value] of audioRequests) if (Date.now() - value.at > 15 * 60 * 1000) audioRequests.delete(id);
        if (audioRequests.size >= 50) audioRequests.delete(audioRequests.keys().next().value!);
        pending = action(() => downloadFrom(request.tabId, { menuItemId: 'download-audio', editable: false, frameId: request.frameId, pageUrl: request.pageUrl, ...(request.frameUrl ? { frameUrl: request.frameUrl } : {}), ...(request.mediaType ? { mediaType: request.mediaType } : {}), ...(request.srcUrl ? { srcUrl: request.srcUrl } : {}) }, 'audio', request.requestId));
        audioRequests.set(request.requestId, { at: Date.now(), promise: pending });
      }
    }
    void pending.then(result => respond({ ok: true, result })).catch(async error => {
      await report(error); respond({ ok: false, error: errorResult(error) });
    });
    return true;
  });
  chrome.runtime.onMessage.addListener((raw: unknown, sender, respond) => {
    if (raw && typeof raw === 'object' && 'target' in raw && raw.target === 'clipboard') return;
    const contentType = z.object({ type: z.enum(['context', 'media-present', 'frame-ready']) }).passthrough().safeParse(raw);
    if (sender.tab?.id !== undefined && contentType.success) {
      const tabId = sender.tab.id;
      if (contentType.data.type === 'context') {
        const parsed = z.object({ type: z.literal('context'), snapshot: snapshotSchema, linkUrl: httpUrl.optional() }).strict().safeParse(raw);
        if (parsed.success) {
          contexts.set(tabId, { ...parsed.data.snapshot, frameId: sender.frameId ?? 0, parentFrameId: -1 });
          void chrome.storage.session.set({ cleanLinkContext: { tabId, at: Date.now(), url: parsed.data.linkUrl ?? parsed.data.snapshot.url } });
          if (parsed.data.snapshot.media.length) mediaTabs.add(tabId);
          const previous = selections.get(tabId);
          if (!previous || Date.now() - previous.at > 100) {
            const promise = find(tabId);
            // Keep a failed probe observable to the click handler, without an
            // unhandled rejection if the user dismisses the menu.
            void promise.catch(() => undefined);
            selections.set(tabId, { at: Date.now(), pageUrl: parsed.data.snapshot.url, promise });
          }
        }
      }
      if (contentType.data.type === 'media-present') mediaTabs.add(tabId);
      void menuPolicy(tabId);
      if(contentType.data.type==='frame-ready')void ads.frame(sender).catch(()=>undefined);
      respond({ ok: true });
      return;
    }
    // Only our extension pages can start jobs or control the native helper.
    if (sender.id !== chrome.runtime.id || !sender.url?.startsWith(chrome.runtime.getURL(''))) return;
    const parsed = z.discriminatedUnion('type', [
      z.object({ type: z.literal('find'), tabId: z.number().int().nonnegative() }).strict(),
      z.object({ type: z.literal('start'), candidate: candidateSchema, requestId: z.string().uuid(), options: downloadOptionsSchema.optional() }).strict(),
      z.object({ type: z.literal('inspect'), candidate: candidateSchema, requestId: z.string().uuid() }).strict(),
      z.object({ type: z.literal('formats'), probeId: z.string().regex(/^[0-9a-f]{32}$/) }).strict(),
      z.object({ type: z.literal('copy-link'), url: httpUrl }).strict(),
      z.object({ type: z.literal('copy-context-link'), tabId: z.number().int().nonnegative() }).strict(),
      z.object({ type: z.literal('save-image'), tabId: z.number().int().nonnegative(), frameId: z.number().int().nonnegative().default(0), srcUrl: z.string().max(16384).optional() }).strict(),
      z.object({type:z.literal('adblock-status'),host:adHost.optional()}).strict(),
      z.object({type:z.literal('adblock-set'),enabled:z.boolean()}).strict(),
      z.object({type:z.literal('adblock-site'),host:adHost,paused:z.boolean()}).strict(),
      z.object({ type: z.enum(['ping', 'jobs', 'clear', 'youtube-protection-status', 'screenshot-companion-status']) }).strict(),
      z.object({ type: z.enum(['check-updates', 'update-status']) }).strict(),
      z.object({ type: z.enum(['cancel', 'reveal', 'retry-save']), jobId: z.string().regex(/^[0-9a-f]{32}$/) }).strict(),
    ]).safeParse(raw);
    if (!parsed.success) { respond({ ok: false, error: { code: 'invalid_request', message: 'Reload the extension and try again.' } }); return; }
    const request = parsed.data;
    void action(async () => {
      if(request.type==='adblock-status')return ads.status(request.host);
      if(request.type==='adblock-set')return ads.setEnabled(request.enabled);
      if(request.type==='adblock-site')return ads.setSite(request.host,request.paused);
      if (request.type === 'screenshot-companion-status') return screenshotCompanionStatus();
      if (request.type === 'youtube-protection-status') return youtubeCompanionStatus();
      if (request.type === 'find') return { candidates: await find(request.tabId) };
      if (request.type === 'start') return start(request.candidate, request.requestId, request.options?.assetType ?? 'video', undefined, request.options);
      if (request.type === 'inspect') return inspect(request.candidate, request.requestId);
      if (request.type === 'formats') return native('formats', { probeId: request.probeId });
      if (request.type === 'copy-link') { await copyLink(cleanLink(request.url)); return {}; }
      if (request.type === 'copy-context-link') {
        const saved = z.object({ tabId: z.number(), at: z.number(), url: httpUrl }).safeParse((await chrome.storage.session.get('cleanLinkContext')).cleanLinkContext);
        const tab = await chrome.tabs.get(request.tabId);
        const url = saved.success && saved.data.tabId === request.tabId && Date.now() - saved.data.at < 15000 ? saved.data.url : httpUrl.parse(tab.url);
        await copyLink(cleanLink(url)); return {};
      }
      if (request.type === 'save-image') return saveImage(request.tabId, request.frameId, request.srcUrl);
      if (request.type === 'check-updates') return updates.check(true);
      if (request.type === 'update-status') return updates.status();
      if (request.type === 'cancel') return downloads.cancel(request.jobId);
      if (request.type === 'retry-save') return downloads.retry(request.jobId);
      if (request.type === 'jobs') {
        const value = z.object({ jobs: z.array(jobSchema) }).parse(await native('jobs'));
        return { jobs: await downloads.decorate(value.jobs) };
      }
      return native(request.type, 'jobId' in request ? { jobId: request.jobId } : {});
    }).then((result) => respond({ ok: true, result })).catch((error) => respond({ ok: false, error: errorResult(error) }));
    return true;
  });
});
