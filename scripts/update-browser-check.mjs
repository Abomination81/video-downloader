import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright';
import { execFileSync } from 'node:child_process';

// The Python integration test exercises signed staging + the actual venv switch.
// This check exercises Chrome activating committed files, with an open page.
const root = resolve(import.meta.dirname, '..');
const app = await mkdtemp(join(tmpdir(), 'video-downloader-update-browser-'));
const profile = join(app, 'profile');
const extension = join(app, 'extension');
const current = JSON.parse(await readFile(join(root, '.output/chrome-mv3/manifest.json'), 'utf8'));
const identity = JSON.parse(await readFile(join(root, 'extension-identity.json'), 'utf8'));
await cp(join(root, '.output/chrome-mv3'), extension, { recursive: true });
await writeFile(join(extension, 'manifest.json'), JSON.stringify({ ...current, version: '0.4.999' }));
await cp(join(root, 'helper/video_downloader/bootstrap.py'), join(app, 'bootstrap.py'));
const uv = execFileSync('/bin/sh', ['-c', 'command -v uv'], { encoding: 'utf8' }).trim();
await writeFile(join(app, 'config.json'), JSON.stringify({ updater_uv: uv, download_dir: join(app, 'Downloads'), auto_updates: true }));
await writeFile(join(app, 'active-runtime.json'), JSON.stringify({ version: '0.4.999' }));
await writeFile(join(app, 'update-state.json'), JSON.stringify({ state: 'current', message: 'Fixture is current.', checked: Date.now() / 1000, updated: Date.now() / 1000 }));
await mkdir(join(profile, 'NativeMessagingHosts'), { recursive: true });
await mkdir(join(profile, 'Default'), { recursive: true });
// Match the normal Load unpacked setup. Command-line loading alone can start
// an extension with Developer mode off, then Chrome rejects its later reload.
await writeFile(join(profile, 'Default/Preferences'), JSON.stringify({ extensions: { ui: { developer_mode: true } } }));
const launcher = join(app, 'native-host');
const quote = value => "'" + value.replaceAll("'", "'\\''") + "'";
const fixtureHost = join(app, 'fixture-host.py');
await writeFile(fixtureHost, `import sys,os,json,struct\nfrom pathlib import Path\napp=Path(__file__).parent\nlog=open(app/'native.log','a',buffering=1)\nlog.write('started '+str(os.getpid())+'\\n')\nwhile True:\n header=sys.stdin.buffer.read(4)\n if not header: break\n value=json.loads(sys.stdin.buffer.read(struct.unpack('=I',header)[0]))\n log.write(value['type']+'\\n')\n if value['type']=='jobs': result={'jobs':[]}\n else:\n  result=json.loads((app/'update-state.json').read_text())\n  result.update(installedVersion=json.loads((app/'active-runtime.json').read_text())['version'],enabled=True)\n body=json.dumps({'id':value['id'],'ok':True,'result':result}).encode()\n sys.stdout.buffer.write(struct.pack('=I',len(body))+body);sys.stdout.buffer.flush()\n`);
await writeFile(launcher, `#!/bin/sh\nexec /usr/bin/python3 ${quote(fixtureHost)} "$@" 2>>${quote(join(app, 'native-stderr.log'))}\n`);
await chmod(launcher, 0o700);
await writeFile(join(profile, 'NativeMessagingHosts/com.video_downloader.helper.json'), JSON.stringify({ name: 'com.video_downloader.helper', description: 'Update integration fixture', path: launcher, type: 'stdio', allowed_origins: [`chrome-extension://${identity.id}/`] }));
const source = join(app, 'source.mp4');
execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=24', '-t', '2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', source]);
const bytes = await readFile(source);
let documentLoads = 0;
const server = createServer((request, response) => {
  if (request.url === '/source.mp4') {
    const range = /^bytes=(\d+)-(\d*)$/.exec(request.headers.range || '');
    const start = range ? Number(range[1]) : 0;
    const end = range?.[2] ? Math.min(Number(range[2]), bytes.length - 1) : bytes.length - 1;
    response.writeHead(range ? 206 : 200, { 'Content-Type': 'video/mp4', 'Content-Length': end - start + 1, 'Accept-Ranges': 'bytes', ...(range ? { 'Content-Range': `bytes ${start}-${end}/${bytes.length}` } : {}) });
    response.end(bytes.subarray(start, end + 1)); return;
  }
  if (request.url === '/') documentLoads++;
  response.writeHead(200, { 'Content-Type': 'text/html' });
  response.end(`<!doctype html><html><head><title>Preserve this page</title><style>#text{user-select:none!important}#seek{width:640px;height:40px;background:#ddd}</style></head><body><input id="draft"><p id="text">Keep this selection working</p><video width="640" height="360" src="/source.mp4" muted preload="auto"></video><div id="seek">Seek</div><script>window.pageState='original';window.addEventListener('contextmenu',e=>e.preventDefault(),true);document.querySelector('#seek').addEventListener('pointerdown',e=>{const box=e.currentTarget.getBoundingClientRect(),v=document.querySelector('video');v.currentTime=(e.clientX-box.left)/box.width*v.duration;});</script></body></html>`);
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
let context;
try {
  context = await chromium.launchPersistentContext(profile, { channel: 'chromium', headless: true, ignoreDefaultArgs: ['--disable-extensions'], args: [`--load-extension=${extension}`], env: { ...process.env, VIDEO_DOWNLOADER_HOME: app } });
  const errors = [];
  context.on('page', page => page.on('pageerror', error => errors.push(error.message)));
  const setup = await context.newPage();
  await setup.goto('chrome://extensions/');
  const developerMode = setup.locator('#devMode');
  if (await developerMode.evaluate(toggle => toggle.checked)) await developerMode.click();
  await developerMode.click();
  assert.equal(await setup.evaluate(() => new Promise(resolve => chrome.developerPrivate.getProfileConfiguration(config => resolve(config.inDeveloperMode)))), true);
  await setup.close();
  let worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
  const page = await context.newPage();
  const url = `http://127.0.0.1:${server.address().port}/`;
  await page.goto(url);
  await page.locator('#draft').fill('Unsent form content');
  await page.waitForFunction(() => getComputedStyle(document.querySelector('#text')).userSelect === 'text');
  const tabId = await worker.evaluate(async url => (await chrome.tabs.query({})).find(tab => tab.url === url).id, url);
  const probe = () => worker.evaluate(tabId => chrome.tabs.sendMessage(tabId, { type: 'probe' }), tabId);
  const before = await probe();
  assert.ok(before.media[0]);
  console.log('CHECK initial content script connected');
  await worker.evaluate(() => chrome.storage.local.set({ settings: { restoreMenus: true, restoreCopy: true, cleanImages: false, useCookies: false, compatibleVideo: false, autoUpdates: true } }));
  await page.locator('video').evaluate(video => new Promise(resolve => video.readyState >= 4 ? resolve() : video.addEventListener('canplaythrough', resolve, { once: true })));
  const settingsPage = await context.newPage();
  await settingsPage.goto(`chrome-extension://${identity.id}/options.html`);
  // Mark the same stable path as committed by the helper. No page navigation.
  await writeFile(join(extension, 'manifest.json'), JSON.stringify(current));
  await writeFile(join(app, 'active-runtime.json'), JSON.stringify({ version: current.version }));
  await writeFile(join(app, 'update-state.json'), JSON.stringify({ state: 'ready', message: 'Fixture update committed.', target: current.version, checked: Date.now() / 1000, updated: Date.now() / 1000 }));
  const staged = await settingsPage.evaluate(() => chrome.runtime.sendMessage({ type: 'update-status' }));
  assert.equal(staged.result.installedVersion, current.version);
  assert.equal(await worker.evaluate(() => chrome.runtime.getManifest().version), '0.4.999', 'An open Settings page did not defer activation');
  await settingsPage.close();
  await worker.evaluate(() => chrome.alarms.create('silent-updates', { when: Date.now() + 100 }));
  console.log('CHECK committed update and scheduled Chrome alarm');
  const deadline = Date.now() + 30000;
  let activated = false;
  while (Date.now() < deadline) {
    for (const candidate of context.serviceWorkers()) {
      try {
        if (await candidate.evaluate(() => chrome.runtime.getManifest().version) === current.version) { worker = candidate; activated = true; break; }
      } catch { /* Chrome is replacing this worker. */ }
    }
    if (activated) break;
    await context.waitForEvent('serviceworker', { timeout: 1000 }).catch(() => undefined);
  }
  if (!activated) {
    console.error('Update activation diagnostics:', await worker.evaluate(async () => ({ saved: await chrome.storage.local.get('updateStatus'), tabs: (await chrome.tabs.query({})).map(tab => tab.url), contexts: await chrome.runtime.getContexts({}), alarms: await chrome.alarms.getAll() })).catch(error => error.message));
    const debug = await context.newPage();
    await debug.goto('chrome://extensions/');
    console.error('Chrome extension info:', await debug.evaluate(() => new Promise(resolve => chrome.developerPrivate.getExtensionsInfo({ includeDisabled: true }, entries => resolve(entries.map(entry => ({id: entry.id, version:entry.version, state:entry.state, disableReasons:entry.disableReasons, runtimeWarnings:entry.runtimeWarnings, runtimeErrors:entry.runtimeErrors, manifestErrors:entry.manifestErrors})))))));
    console.error('Direct native diagnostic:', await worker.evaluate(() => new Promise(resolve => {
      const timeout = setTimeout(() => resolve({ timeout: true }), 3000);
      chrome.runtime.sendNativeMessage('com.video_downloader.helper', { id: 'diagnostic', type: 'update-status' }, result => { clearTimeout(timeout); resolve({ result, error: chrome.runtime.lastError?.message }); });
    })).catch(error=>error.message));
    console.error('Native trace:', await readFile(join(app, 'native.log'), 'utf8').catch(() => 'No native trace'));
  }
  assert.equal(activated, true, 'Chrome did not activate the committed update automatically');
  let after;
  const reconnected = Date.now() + 10000;
  while (Date.now() < reconnected) {
    try { after = await probe(); if (after.media?.[0]) break; } catch { /* The new content script is being injected. */ }
    await page.waitForTimeout(100);
  }
  assert.ok(after?.media[0]);
  assert.notEqual(after.media[0].id, before.media[0].id, 'The page kept its old content script');
  assert.equal(documentLoads, 1, 'The update reloaded the website');
  assert.equal(await page.locator('#draft').inputValue(), 'Unsent form content');
  assert.equal(await page.evaluate(() => window.pageState), 'original');
  const saved = await worker.evaluate(() => chrome.storage.local.get('settings'));
  assert.equal(saved.settings.compatibleVideo, false);
  assert.equal(saved.settings.cleanImages, false);
  await worker.evaluate(async () => { const value = (await chrome.storage.local.get('settings')).settings; await chrome.storage.local.set({ settings: { ...value, restoreCopy: false, restoreMenus: false } }); });
  await page.waitForFunction(() => getComputedStyle(document.querySelector('#text')).userSelect === 'none');
  await page.waitForFunction(() => { const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true }); document.querySelector('#text').dispatchEvent(event); return event.defaultPrevented; });
  await page.locator('#seek').click({ position: { x: 450, y: 20 } });
  assert.ok(await page.locator('video').evaluate(video => video.currentTime > video.duration * 0.6));
  assert.deepEqual(errors, []);
  console.log('PASS automatic Chrome activation, fresh content scripts, retired old handlers, retained preferences/form/page state, working video seeking; no page refresh');
} finally {
  await context?.close();
  await new Promise(resolve => server.close(resolve));
  await rm(app, { recursive: true, force: true });
}
