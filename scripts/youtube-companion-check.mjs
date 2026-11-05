import assert from 'node:assert/strict';
import { mkdtemp, cp, readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright';

const root = resolve(import.meta.dirname, '..');
const json = async path => JSON.parse(await readFile(path, 'utf8'));
const main = await json(join(root, 'extension-identity.json'));
const child = await json(join(root, 'companion/youtube/identity.json'));
const audio = await json(join(root, 'companion/audio/identity.json'));
const version = (await json(join(root, 'package.json'))).version;
const temporary = await mkdtemp(join(tmpdir(), 'youtube-bundle-'));
const extension = join(temporary, 'extension');
await cp(join(root, '.output/chrome-mv3'), extension, { recursive: true });
const youtube = join(extension, 'youtube-companion');
const hostile = join(temporary, 'hostile');
await mkdir(hostile);
await writeFile(join(hostile, 'manifest.json'), JSON.stringify({ manifest_version: 3, name: 'Untrusted test extension', version: '1.0', background: { service_worker: 'background.js' } }));
await writeFile(join(hostile, 'background.js'), 'chrome.runtime.onInstalled.addListener(()=>{});');
const paths = [extension, youtube, join(extension, 'audio-companion'), hostile].join(',');
const context = await chromium.launchPersistentContext(join(temporary, 'profile'), {
  channel: 'chromium', headless: true,
  args: [`--load-extension=${paths}`, `--disable-extensions-except=${paths}`, '--no-first-run'],
  env: { ...process.env, VIDEO_DOWNLOADER_HOME: temporary },
});
const results = [];
const pass = name => { results.push(name); console.log('PASS', name); };
try {
  const worker = async id => context.serviceWorkers().find(w => new URL(w.url()).hostname === id) ?? await context.waitForEvent('serviceworker', { predicate: w => new URL(w.url()).hostname === id });
  let primary = await worker(main.id), protection = await worker(child.id);
  await worker(audio.id);
  const send = data => primary.evaluate(({ id, data }) => chrome.runtime.sendMessage(id, data), { id: child.id, data });
  for (let n = 0; n < 100; n++) {
    if ((await protection.evaluate(() => chrome.scripting.getRegisteredContentScripts())).length === 2) break;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  assert.deepEqual(await send({ type: 'youtube-companion-status' }), { version, engineVersion: '0.1.2', enabled: true });
  const own = await protection.evaluate(() => ({ cookies: !!chrome.cookies, native: !!chrome.runtime.connectNative, downloads: !!chrome.downloads, tabsQuery: !!chrome.tabs?.query }));
  assert.deepEqual(own, { cookies: false, native: false, downloads: false, tabsQuery: true }); // tabs API exists without the privileged tabs permission.
  assert.equal(await protection.evaluate(async id => { try { await chrome.runtime.sendMessage(id, { type: 'jobs' }); return false; } catch { return true; } }, main.id), true);
  pass('All three extensions coexist; parent reads only protection status; child has no native, cookie or download APIs and cannot call parent');

  const attacker = context.serviceWorkers().find(w => ![main.id, child.id, audio.id].includes(new URL(w.url()).hostname));
  assert.ok(attacker);
  assert.equal(await attacker.evaluate(async id => { try { await chrome.runtime.sendMessage(id, { type: 'youtube-companion-status' }); return false; } catch { return true; } }, child.id), true);
  const ui = await context.newPage();
  await ui.goto(`chrome-extension://${main.id}/options.html`);
  await ui.locator('#youtube-protection-status').filter({ hasText: 'Protection enabled' }).waitFor();
  const rejected = await ui.evaluate(async id => { try { return await chrome.runtime.sendMessage(id, { type: 'youtube-companion-status' }); } catch { return null; } }, child.id);
  assert.ok(rejected == null);
  for (const message of [{ type: 'set-enabled', enabled: false }, { type: 'jobs' }, { type: 'youtube-companion-status', url: 'https://evil.test' }]) {
    assert.ok(await send(message).catch(() => null) == null);
  }
  assert.equal((await send({ type: 'youtube-companion-status' })).enabled, true);
  pass('Foreign extension, parent tab and malformed parent commands cannot toggle or query through the external boundary');

  const fixture = `<!doctype html><title>YouTube bundle fixture</title><script>window.ytInitialPlayerResponse={videoDetails:{videoId:'fixture'},playabilityStatus:{status:'OK'},adSlots:[1],playerAds:[2]};window.bootstrapHadAds=!!ytInitialPlayerResponse.adSlots;</script><div id="movie_player" class="html5-video-player"><video class="html5-main-video" src="https://www.youtube.com/fixture.mp4" controls></video><button type="button" class="ytp-skip-ad-button">Skip ad</button></div><ytd-ad-slot-renderer>Sponsored</ytd-ad-slot-renderer><div id="normal">Content</div>`;
  await context.route('https://**/*', async route => {
    if (route.request().isNavigationRequest()) return route.fulfill({ contentType: 'text/html', body: fixture });
    if (route.request().url().includes('/youtubei/v1/')) return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ videoDetails: { videoId: 'fixture' }, adSlots: [1], entries: [{ command: { reelWatchEndpoint: { adClientParams: { isAd: true } } } }, { command: { reelWatchEndpoint: { videoId: 'keep' } } }] }) });
    return route.fulfill({ body: 'fixture', contentType: 'text/plain' });
  });
  const page = await context.newPage();
  await page.goto('https://www.youtube.com/watch?v=fixture');
  assert.equal(await page.evaluate(() => window.bootstrapHadAds), false);
  const tab = await primary.evaluate(async url => (await chrome.tabs.query({})).find(tab => tab.url === url).id, page.url());
  const found = await ui.evaluate(tabId => chrome.runtime.sendMessage({ type: 'find', tabId }), tab);
  assert.equal(found.ok, true); assert.ok(found.result.candidates.length > 0);
  assert.deepEqual(await page.evaluate(async () => {
    const value = await (await fetch('/youtubei/v1/reel/reel_watch_sequence')).json();
    let blocked = false; try { await fetch('/pagead/adview'); } catch { blocked = true; }
    return [value.entries.length, !!value.adSlots, blocked];
  }), [1, false, true]);
  pass('YouTube bootstrap ads, Shorts ad entries and network ads are filtered while downloader discovery works');
  const contentCall = await primary.evaluate(async ({ tab, id }) => (await chrome.scripting.executeScript({ target: { tabId: tab }, func: async id => { try { return await chrome.runtime.sendMessage(id, { type: 'youtube-companion-status' }); } catch { return null; } }, args: [id] }))[0].result, { tab, id: child.id });
  assert.ok(contentCall == null);
  assert.equal(await protection.evaluate(async () => { try { await fetch('https://example.com/leak'); return false; } catch { return true; } }), true);
  pass('Actual parent content-script sender rejected; companion CSP blocks external fetch');

  await page.evaluate(() => { const p = document.querySelector('#movie_player'), v = p.querySelector('video'); window.skips = 0; v.muted = false; v.playbackRate = 1.5; p.querySelector('button').onclick = () => { window.skips++; p.classList.remove('ad-showing'); }; p.classList.add('ad-showing'); });
  await page.waitForFunction(() => window.skips === 1);
  assert.deepEqual(await page.evaluate(() => { const v = document.querySelector('video'); return [v.muted, v.playbackRate]; }), [false, 1.5]);
  pass('Mid-roll fixture skip restores user mute/speed with the downloader running');
  const popup = await context.newPage(); await popup.goto(`chrome-extension://${child.id}/popup.html`);
  await popup.locator('#toggle').filter({ hasText: 'Pause protection' }).click();
  await popup.locator('#status').filter({ hasText: 'Protection paused' }).waitFor();
  assert.equal((await send({ type: 'youtube-companion-status' })).enabled, false);
  await page.reload(); assert.equal(await page.evaluate(() => window.bootstrapHadAds), true);
  assert.equal((await ui.evaluate(tabId => chrome.runtime.sendMessage({ type: 'find', tabId }), tab)).ok, true);
  pass('Own pause control disables filtering on reload; downloader remains usable');
  await popup.locator('#toggle').click();
  await popup.locator('#status').filter({ hasText: 'Protection enabled' }).waitFor();
  await page.goto('https://example.com/watch?v=fixture');
  assert.equal(await page.evaluate(() => window.bootstrapHadAds), true);
  assert.equal(await page.locator('ytd-ad-slot-renderer').isVisible(), true);
  await page.evaluate(() => fetch('https://www.youtube.com/pagead/adview'));
  pass('Unrelated websites retain data, ad elements and requests');
  await mkdir(join(root, 'output/playwright'), { recursive: true });
  await popup.screenshot({ path: join(root, 'output/playwright/youtube-companion-popup.png') });
  await ui.screenshot({ path: join(root, 'output/playwright/youtube-companion-settings.png'), fullPage: true });

  // Keep the saved preference off through a real version reload of both extensions.
  await popup.locator('#toggle').click(); await popup.locator('#status').filter({ hasText: 'Protection paused' }).waitFor();
  await ui.close(); await page.close();
  // Only this temporary Chromium profile is operated, never the user's Chrome profile.
  const setup = await context.newPage(); await setup.goto('chrome://extensions/');
  const toggle = setup.locator('#devMode'); if (await toggle.evaluate(t => t.checked)) await toggle.click(); await toggle.click(); await setup.close();
  const next = version.split('.').map((part, index) => index === 2 ? Number(part) + 1 : part).join('.');
  for (const path of [join(extension, 'manifest.json'), join(youtube, 'manifest.json')]) { const manifest = await json(path); manifest.version = next; await writeFile(path, JSON.stringify(manifest)); }
  await primary.evaluate(() => chrome.runtime.reload());
  let pending = false;
  for (let n = 0; n < 80; n++) {
    for (const current of context.serviceWorkers()) {
      try {
        if (new URL(current.url()).hostname === main.id && await current.evaluate(() => chrome.runtime.getManifest().version) === next) {
          primary = current;
          pending = !!await current.evaluate(() => chrome.alarms.get('youtube-companion-update'));
        }
      } catch { /* replacing worker */ }
    }
    if (pending) break;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.ok(pending, 'Parent did not schedule a deferred companion update');
  assert.equal(await protection.evaluate(() => chrome.runtime.getManifest().version), version);
  await popup.close();
  pass('Open companion UI defers version activation and parent schedules a persistent retry');
  let upgraded = false;
  for (let n = 0; n < 180; n++) {
    for (const current of context.serviceWorkers()) {
      try {
        if (new URL(current.url()).hostname === main.id && await current.evaluate(() => chrome.runtime.getManifest().version) === next) primary = current;
        if (new URL(current.url()).hostname === child.id && await current.evaluate(() => chrome.runtime.getManifest().version) === next) { protection = current; upgraded = true; }
      } catch { /* old worker closed */ }
    }
    if (upgraded) break;
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  assert.ok(upgraded, 'Companion did not activate after the parent version changed');
  assert.deepEqual(await send({ type: 'youtube-companion-status' }), { version: next, engineVersion: '0.1.2', enabled: false });
  assert.equal((await protection.evaluate(() => chrome.scripting.getRegisteredContentScripts())).length, 0);
  assert.deepEqual(await protection.evaluate(() => chrome.declarativeNetRequest.getEnabledRulesets()), []);
  pass('Real paired version upgrade activates automatically and preserves paused scripts/rules');
  await writeFile(join(root, 'output/playwright/youtube-companion-results.json'), JSON.stringify({ version, tests: results }, null, 2) + '\n');
} finally { await context.close(); await rm(temporary, { recursive: true, force: true }); }
