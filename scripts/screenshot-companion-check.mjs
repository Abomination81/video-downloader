import assert from 'node:assert/strict';
import { mkdtemp, cp, readFile, writeFile, appendFile, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright';
import { startFixtures } from '../tests/fixtures/screenshot-server.mjs';

const root = resolve(import.meta.dirname, '..'), json = async p => JSON.parse(await readFile(p, 'utf8'));
const main = await json(join(root, 'extension-identity.json'));
const child = await json(join(root, 'companion/screenshot/identity.json'));
const audio = await json(join(root, 'companion/audio/identity.json'));
const youtube = await json(join(root, 'companion/youtube/identity.json'));
const version = (await json(join(root, 'package.json'))).version;
const temporary = await mkdtemp(join(tmpdir(), 'screenshot-bundle-')), extension = join(temporary, 'extension');
await cp(join(root, '.output/chrome-mv3'), extension, { recursive: true });
const screenshot = join(extension, 'screenshot-companion');
// Only the disposable copy gets a handler bridge. The installed package has no test hook.
assert.ok(!(await readFile(join(screenshot, 'capture-background.js'), 'utf8')).includes('__stillTest'));
await appendFile(join(screenshot, 'capture-background.js'), '\nglobalThis.__stillTestMenu = handleContextClick;\n');
const hostile = join(temporary, 'hostile'); await mkdir(hostile);
await writeFile(join(hostile, 'manifest.json'), JSON.stringify({ manifest_version: 3, name: 'Untrusted test extension', version: '1.0', background: { service_worker: 'background.js' } }));
await writeFile(join(hostile, 'background.js'), 'chrome.runtime.onInstalled.addListener(()=>{});');
const paths = [extension, screenshot, join(extension, 'audio-companion'), join(extension, 'youtube-companion'), hostile].join(',');
const fixtures = await startFixtures();
const context = await chromium.launchPersistentContext(join(temporary, 'profile'), {
  // Use real window dimensions. A forced Playwright viewport can report 700px
  // while captureVisibleTab returns 613px after an active preview tab closes.
  channel: 'chromium', headless: true, viewport: null,
  ignoreDefaultArgs: ['--disable-extensions', '--disable-background-timer-throttling', '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding'],
  args: [`--load-extension=${paths}`, `--disable-extensions-except=${paths}`, '--enable-unsafe-extension-debugging', '--no-first-run', '--window-size=1000,787'],
  env: { ...process.env, VIDEO_DOWNLOADER_HOME: temporary },
});
const results = [], pass = name => { results.push(name); console.log('PASS', name); };
const output = join(root, 'output/playwright'); await mkdir(output, { recursive: true });
try {
  const worker = async id => context.serviceWorkers().find(w => new URL(w.url()).hostname === id) ?? await context.waitForEvent('serviceworker', { predicate: w => new URL(w.url()).hostname === id });
  let primary = await worker(main.id), capture = await worker(child.id);
  await worker(audio.id); await worker(youtube.id);
  const send = data => primary.evaluate(({ id, data }) => chrome.runtime.sendMessage(id, data), { id: child.id, data });
  for (let n = 0; n < 100 && !await capture.evaluate(() => chrome.runtime.onMessageExternal.hasListeners()); n++) await new Promise(r => setTimeout(r, 50));
  assert.deepEqual(await send({ type: 'screenshot-companion-status' }), { version, engineVersion: '1.1.0' });
  assert.deepEqual(await capture.evaluate(() => ({ cookies: !!chrome.cookies, native: !!chrome.runtime.connectNative, downloads: !!chrome.downloads, storage: !!chrome.storage })), { cookies: false, native: false, downloads: false, storage: false });
  assert.equal(await capture.evaluate(async id => { try { await chrome.runtime.sendMessage(id, { type: 'jobs' }); return false; } catch { return true; } }, main.id), true);
  pass('Four companions coexist; screenshot has no cookie, native, download-history or storage APIs and cannot call parent jobs');
  const attacker = context.serviceWorkers().find(w => ![main.id, child.id, audio.id, youtube.id].includes(new URL(w.url()).hostname));
  assert.ok(attacker);
  assert.equal(await attacker.evaluate(async id => { try { await chrome.runtime.sendMessage(id, { type: 'screenshot-companion-status' }); return false; } catch { return true; } }, child.id), true);
  const ui = await context.newPage(); await ui.goto(`chrome-extension://${main.id}/options.html`);
  await ui.locator('#screenshot-companion-status').filter({ hasText: `Ready · v${version}` }).waitFor();
  const rejected = await ui.evaluate(async id => { try { return await chrome.runtime.sendMessage(id, { type: 'screenshot-companion-status' }); } catch { return null; } }, child.id);
  assert.ok(rejected == null);
  const pageCount = context.pages().length;
  for (const message of [{ type: 'capture', tabId: 1 }, { type: 'pixels' }, { type: 'screenshot-companion-status', url: 'https://evil.test' }]) assert.ok(await send(message).catch(() => null) == null);
  assert.equal(context.pages().length, pageCount);
  pass('Foreign extensions, parent UI, capture requests and surplus fields cannot cross the version-only boundary');

  const source = await context.newPage(); await source.goto(fixtures.origin + '/?height=3100'); await source.bringToFront();
  const tabId = await primary.evaluate(async url => (await chrome.tabs.query({})).find(t => t.url === url).id, source.url());
  const contentCall = await primary.evaluate(async ({ tabId, id }) => (await chrome.scripting.executeScript({ target: { tabId }, func: async id => { try { return await chrome.runtime.sendMessage(id, { type: 'screenshot-companion-status' }); } catch { return null; } }, args: [id] }))[0].result, { tabId, id: child.id });
  assert.ok(contentCall == null);
  const count = fixtures.requests.length;
  assert.equal(await capture.evaluate(async url => { try { await fetch(url); return false; } catch { return true; } }, fixtures.origin + '/leak'), true);
  assert.equal(fixtures.requests.length, count);
  pass('Parent content scripts rejected; screenshot CSP blocks outbound HTTP');

  const b = await context.browser().newBrowserCDPSession();
  const action = async () => {
    const { targetInfos } = await b.send('Target.getTargets', { filter: [{ type: 'tab' }, { exclude: true }] });
    await b.send('Extensions.triggerAction', { id: child.id, targetId: targetInfos.find(t => t.url === source.url()).targetId });
  };
  let opened = context.waitForEvent('page'); await action(); let preview = await opened;
  await preview.waitForURL(`chrome-extension://${child.id}/preview.html*`);
  await preview.waitForFunction(() => document.querySelector('h1')?.textContent === 'Your page, captured');
  let downloaded = preview.waitForEvent('download'); await preview.locator('#save').click(); let file = await downloaded;
  const png = join(output, 'screenshot-companion-preview.png'); await file.saveAs(png);
  let bytes = await readFile(png); assert.deepEqual([bytes.readUInt32BE(16), bytes.readUInt32BE(20)], [1000, 3100]);
  assert.equal(await source.evaluate(() => scrollY), 0);
  await preview.close(); pass('Real toolbar invocation captures a complete page with downloader content scripts active');

  await source.bringToFront(); opened = context.waitForEvent('page');
  await capture.evaluate(async tabId => { void globalThis.__stillTestMenu({ menuItemId: 'still-full-page-download' }, await chrome.tabs.get(tabId)); }, tabId);
  preview = await opened; downloaded = preview.waitForEvent('download'); file = await downloaded;
  const automatic = join(output, 'screenshot-companion-automatic.png'); await file.saveAs(automatic);
  bytes = await readFile(automatic); assert.deepEqual([bytes.readUInt32BE(16), bytes.readUInt32BE(20)], [1000, 3100]);
  assert.equal(await primary.evaluate(async () => (await chrome.tabs.query({ active: true, lastFocusedWindow: true }))[0].id), tabId);
  await preview.waitForEvent('close', { timeout: 45000 });
  pass('Context-menu handler downloads directly, keeps source selected and closes temporary preview');

  await ui.screenshot({ path: join(output, 'screenshot-companion-settings.png'), fullPage: true }); await ui.close();
  // Enable developer reload in this disposable profile, matching Chrome's unpacked workflow.
  const setup = await context.newPage(); await setup.goto('chrome://extensions/');
  const toggle = setup.locator('#devMode'); if (await toggle.evaluate(t => t.checked)) await toggle.click(); await toggle.click(); await setup.close();
  await source.goto(fixtures.origin + '/?height=6000'); await source.bringToFront();
  opened = context.waitForEvent('page'); await action(); preview = await opened;
  await preview.waitForURL(`chrome-extension://${child.id}/preview.html*`);
  await preview.waitForFunction(() => document.querySelector('progress')?.value > 0);
  const next = version.split('.').map((p, i) => i === 2 ? Number(p) + 1 : p).join('.');
  for (const path of [join(extension, 'manifest.json'), join(screenshot, 'manifest.json')]) { const m = await json(path); m.version = next; await writeFile(path, JSON.stringify(m)); }
  await send({ type: 'screenshot-companion-sync', version: next });
  assert.equal(await capture.evaluate(() => chrome.runtime.getManifest().version), version);
  await preview.waitForFunction(() => document.querySelector('h1')?.textContent === 'Your page, captured');
  downloaded = preview.waitForEvent('download'); await preview.locator('#save').click(); file = await downloaded;
  const pending = join(output, 'screenshot-companion-during-update.png'); await file.saveAs(pending); bytes = await readFile(pending);
  assert.deepEqual([bytes.readUInt32BE(16), bytes.readUInt32BE(20)], [1000, 6000]);
  await primary.evaluate(() => chrome.runtime.reload());
  for (let n = 0; n < 100; n++) {
    for (const w of context.serviceWorkers()) { try { if (new URL(w.url()).hostname === main.id && await w.evaluate(() => chrome.runtime.getManifest().version) === next) primary = w; } catch {} }
    if (await primary.evaluate(() => chrome.runtime.getManifest().version).catch(() => '') === next) break;
    await new Promise(r => setTimeout(r, 100));
  }
  assert.ok(await primary.evaluate(() => chrome.alarms.get('screenshot-companion-update')));
  assert.equal(await capture.evaluate(() => chrome.runtime.getManifest().version), version);
  pass('Update request during capture preserves all pixels; open preview defers reload with parent retry scheduled');
  await preview.close();
  let upgraded = false;
  for (let n = 0; n < 200; n++) {
    for (const w of context.serviceWorkers()) { try { if (new URL(w.url()).hostname === child.id && await w.evaluate(() => chrome.runtime.getManifest().version) === next) { capture = w; upgraded = true; } } catch {} }
    if (upgraded) break;
    await new Promise(r => setTimeout(r, 250));
  }
  assert.ok(upgraded, 'Companion failed to activate after preview closed');
  assert.deepEqual(await send({ type: 'screenshot-companion-status' }), { version: next, engineVersion: '1.1.0' });
  pass('Installed matching version activates automatically after preview closes');
  await writeFile(join(output, 'screenshot-companion-results.json'), JSON.stringify({ version, tests: results }, null, 2) + '\n');
} catch (error) {
  const pages = await Promise.all(context.pages().map(async page => ({
    url: page.url(),
    state: await page.locator('body').innerText().catch(() => 'closed'),
  })));
  await writeFile(join(output, 'screenshot-companion-failure.json'), JSON.stringify({ error: String(error), results, pages }, null, 2));
  console.error(JSON.stringify(pages));
  throw error;
} finally { await context.close(); await new Promise(r => fixtures.server.close(r)); await rm(temporary, { recursive: true, force: true }); }
