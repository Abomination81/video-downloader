import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join, extname } from 'node:path';
import { execFileSync } from 'node:child_process';
import { chromium } from 'playwright';

const root = resolve(import.meta.dirname, '..');
execFileSync('uv', ['run', '--project', 'helper', '--extra', 'dev', 'python', 'scripts/create-fixtures.py'], { cwd: root, stdio: 'inherit' });
const fixtures = join(root, 'output/fixtures');
const identity = JSON.parse(await readFile(join(root, 'extension-identity.json'), 'utf8'));
const app = await mkdtemp(join(tmpdir(), 'video-downloader-formats-'));
const output = join(root, 'output/playwright');
const downloads = join(app, 'downloads');
const profile = join(app, 'profile');
await mkdir(downloads, { recursive: true });
await mkdir(output, { recursive: true });
await mkdir(join(profile, 'Default'), { recursive: true });
await mkdir(join(profile, 'NativeMessagingHosts'), { recursive: true });
const binaries = Object.fromEntries(['ffmpeg', 'ffprobe', 'deno', 'exiftool'].map(name => [name, execFileSync('which', [name], { encoding: 'utf8' }).trim()]));
await writeFile(join(app, 'config.json'), JSON.stringify({ download_dir: downloads, binaries }));
await writeFile(join(profile, 'Default/Preferences'), JSON.stringify({ download: { default_directory: downloads, prompt_for_download: false } }));
const python = join(root, 'helper/.venv/bin/python');
const host = join(app, 'native-host');
await writeFile(host, `#!/bin/sh\nexec '${python.replaceAll("'", "'\\''")}' -m video_downloader.native "$@"\n`, { mode: 0o700 });
await writeFile(join(profile, 'NativeMessagingHosts/com.video_downloader.helper.json'), JSON.stringify({ name: 'com.video_downloader.helper', description: 'Isolated source helper', path: host, type: 'stdio', allowed_origins: [`chrome-extension://${identity.id}/`] }));
const server = createServer(async (req, res) => {
  if (req.url === '/') { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end('<video src="/source.mp4" controls muted autoplay></video>'); return; }
  try {
    const file = resolve(fixtures, decodeURIComponent(new URL(req.url, 'http://fixture').pathname).slice(1));
    if (!file.startsWith(fixtures + '/')) throw new Error();
    const bytes = await readFile(file);
    res.writeHead(200, { 'Content-Type': { '.m3u8': 'application/vnd.apple.mpegurl', '.mpd': 'application/dash+xml', '.mp4': 'video/mp4' }[extname(file)] ?? 'application/octet-stream', 'Content-Length': bytes.length }); res.end(bytes);
  } catch { res.writeHead(404); res.end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const extension = join(root, '.output/chrome-mv3');
const context = await chromium.launchPersistentContext(profile, { channel: 'chromium', headless: true, args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`, '--autoplay-policy=no-user-gesture-required'], env: { ...process.env, VIDEO_DOWNLOADER_HOME: app } });
const errors = []; context.on('page', page => page.on('pageerror', error => errors.push(error.message)));
try {
  const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
  const cdp = await context.browser().newBrowserCDPSession();
  await cdp.send('Browser.setDownloadBehavior', { behavior: 'default' });
  await worker.evaluate(() => chrome.contextMenus.update('download-audio', { title: 'Download audio as MP3' }));
  await worker.evaluate(() => chrome.contextMenus.update('choose-format', { title: 'Choose video format…' }));
  const ui = await context.newPage(); await ui.goto(`chrome-extension://${identity.id}/options.html`);
  const rpc = message => ui.evaluate(data => chrome.runtime.sendMessage(data), message);
  assert.equal((await rpc({ type: 'ping' })).result.ready, true);
  const sourcePage = await context.newPage(); await sourcePage.goto(base);
  const candidate = { id: 'format-fixture', title: 'Source fixture', frameId: 0, score: 1, protected: false, exact: true, sources: [{ url: base + '/master.m3u8', kind: 'manifest', headers: {} }], cookieUrls: [], width: 320, height: 180 };
  const seed = async (value, intent) => worker.evaluate(data => chrome.storage.session.set({ choices: data }), { tabId: 99999, at: Date.now(), candidates: [value], intent });
  const popup = async () => { const page = await context.newPage(); await page.setViewportSize({ width: 380, height: 780 }); await page.goto(`chrome-extension://${identity.id}/popup.html`); return page; };
  const jobIds = async () => (await rpc({ type: 'jobs' })).result.jobs.map(j => j.id);
  const newJob = async before => { const jobs = (await rpc({ type: 'jobs' })).result.jobs; const job = jobs.find(j => !before.includes(j.id)); assert.ok(job); return job; };
  const waitDone = async id => {
    for (let attempt = 0; attempt < 180; attempt++) {
      const job = (await rpc({ type: 'jobs' })).result.jobs.find(j => j.id === id);
      if (['done', 'error', 'cancelled'].includes(job?.state)) { assert.equal(job.state, 'done', JSON.stringify(job)); return job; }
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    throw new Error('Job did not finish');
  };
  const info = file => JSON.parse(execFileSync(binaries.ffprobe, ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', file], { encoding: 'utf8' }));
  const chromeFile = async job => {
    const items = await worker.evaluate(filename => chrome.downloads.search({ query: [filename] }), job.filename);
    assert.equal(items.length, 1); assert.equal(items[0].state, 'complete'); assert.equal(items[0].byExtensionId, identity.id); assert.equal(items[0].filename, join(downloads, job.filename));
    if (process.platform === 'darwin') {
      const attrs = execFileSync('/usr/bin/xattr', [items[0].filename], { encoding: 'utf8' });
      assert.ok(!attrs.includes('com.apple.metadata:kMDItemWhereFroms')); assert.ok(attrs.includes('com.apple.quarantine'));
    }
    return items[0];
  };
  await seed(candidate, 'formats');
  let page = await popup(); await page.locator('#format-picker').waitFor({ state: 'visible' }); await page.close();
  page = await popup(); await page.waitForFunction(() => !document.querySelector('#format-download').disabled);
  assert.equal(await page.locator('#output-format').inputValue(), 'compatible'); assert.equal(await page.locator('#source-format').inputValue(), '');
  const low = await page.locator('#source-format option').evaluateAll(options => options.find(o => o.textContent.includes('160 × 90'))?.value);
  assert.ok(low); await page.locator('#source-format').selectOption(low);
  await page.screenshot({ path: join(output, 'format-picker.png'), fullPage: true });
  let before = await jobIds(); await page.locator('#format-download').click(); let started = await newJob(before);
  await page.close(); await sourcePage.close();
  const lowJob = await waitDone(started.id); assert.equal(info((await chromeFile(lowJob)).filename).streams[0].height, 90);
  console.log('PASS picker: retained after close/reopen; exact lower rendition; compatible default; download continues after source and popup close');
  const audio = { ...candidate, sources: [{ url: base + '/dash/manifest.mpd', kind: 'manifest', headers: {} }] };
  await seed(audio, 'audio'); page = await popup(); await page.locator('#candidates button').waitFor();
  before = await jobIds(); await page.locator('#download-mp3').click(); started = await newJob(before); await page.close();
  const bestJob = await waitDone(started.id); const bestFile = await chromeFile(bestJob); const best = info(bestFile.filename);
  assert.equal(bestFile.mime, 'audio/mpeg'); assert.equal(best.streams.length, 1); assert.equal(best.streams[0].codec_name, 'mp3'); assert.equal(best.streams[0].bit_rate, '320000'); assert.ok(!best.format.tags && !best.streams[0].tags); assert.ok(!(await readFile(bestFile.filename)).includes(Buffer.from('PRIVATE_')));
  await seed(audio, 'formats'); page = await popup(); await page.setViewportSize({ width: 360, height: 780 }); await page.waitForFunction(() => !document.querySelector('#format-download').disabled);
  await page.locator('#output-format').selectOption('mp3'); await page.locator('#audio-bitrate').selectOption('128');
  await page.locator('#source-format').selectOption(await page.locator('#source-format option').nth(1).getAttribute('value'));
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await page.screenshot({ path: join(output, 'mp3-picker.png'), fullPage: true });
  before = await jobIds(); await page.locator('#format-download').click(); started = await newJob(before); await page.close();
  const smallJob = await waitDone(started.id); assert.equal(info((await chromeFile(smallJob)).filename).streams[0].bit_rate, '128000');
  const defaultStarted = await rpc({ type: 'start', requestId: crypto.randomUUID(), candidate }); assert.equal(defaultStarted.ok, true, JSON.stringify(defaultStarted));
  const defaultJob = await waitDone(defaultStarted.result.jobId); assert.equal(info((await chromeFile(defaultJob)).filename).streams[0].height, 180);
  console.log('PASS audio: default 320 and chosen 128 kbps; one MP3 audio track; no tags/artwork; Chrome download entries; source attributes removed/quarantine retained');
  console.log('PASS default unchanged: highest-resolution compatible MP4');
  assert.deepEqual(errors, []);
  await writeFile(join(output, 'formats-results.json'), JSON.stringify({ defaultMp4: 180, selectedMp4: 90, mp3: [320, 128], nativeChromeEntries: true, closedSourceAndPopup: true, popupResume: true, metadataVerified: true, pageErrors: errors }, null, 2));
} finally { await context.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
