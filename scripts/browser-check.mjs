import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { resolve, join, extname } from 'node:path';
import { execFileSync } from 'node:child_process';
import { chromium } from 'playwright';

// Standalone integration harness: persistent extension context, real native IPC,
// deterministic local origins and actual media processing. No test runner mocks.
const root = resolve(import.meta.dirname, '..');
const output = join(root, 'output/playwright');
await mkdir(output, { recursive: true });
execFileSync('uv', ['run', '--project', 'helper', '--extra', 'dev', 'python', 'scripts/create-fixtures.py'], { cwd: root, stdio: 'inherit' });
const fixtureDir = join(root, 'output/fixtures');
const identity = JSON.parse(await readFile(join(root, 'extension-identity.json'), 'utf8'));
const extensionDir = join(root, '.output/chrome-mv3');
const app = await mkdtemp(join(tmpdir(), 'video-downloader-browser-'));
const installed = join(homedir(), 'Library/Application Support/Video Downloader');
const config = JSON.parse(await readFile(join(installed, 'config.json'), 'utf8'));
config.download_dir = join(app, 'downloads');
await writeFile(join(app, 'config.json'), JSON.stringify(config));
// Chromium resolves per-user native hosts under a custom --user-data-dir too.
const profile = join(app, 'chrome-profile');
await mkdir(join(profile, 'NativeMessagingHosts'), { recursive: true });
await mkdir(join(profile, 'Default'), { recursive: true });
await mkdir(config.download_dir, { recursive: true });
await writeFile(join(profile, 'Default/Preferences'), JSON.stringify({ download: { default_directory: config.download_dir, prompt_for_download: false } }));
await writeFile(join(profile, 'NativeMessagingHosts/com.video_downloader.helper.json'), await readFile(join(installed, 'com.video_downloader.helper.json')));
let port;
let fragmentFailures = 0;
let authenticatedReads = 0;
let imageReads = 0;
const style = '<style>body{margin:0;background:#f5f5f0;font:16px sans-serif}h1{margin:16px}video,.player{width:640px;height:360px}.player{position:relative;margin:40px}.overlay{position:absolute;inset:0}iframe{position:absolute;left:40px;top:80px;width:640px;height:360px;border:0}</style>';
const video = '<video src="/source.mp4" controls muted autoplay playsinline></video>';
function page(body, script = '') { return `<!doctype html><html lang="en"><head><title>Video fixture</title>${style}</head><body>${body}<script>${script}</script></body></html>`; }
const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${port}`);
  let html;
  if (url.pathname === '/overlay') html = page('<h1>Overlay fixture</h1><div class="player">' + video + '<div class="overlay"></div></div>');
  if (url.pathname === '/blocked') html = page('<h1>Blocked menu fixture</h1><div class="player">' + video + '</div>', 'window.blockedCalls=0;window.addEventListener("contextmenu",e=>{window.blockedCalls++;e.preventDefault();e.stopPropagation()},true);document.oncontextmenu=()=>false;');
  if (url.pathname === '/blocked-empty') html = page('<h1>Right-click is blocked on this entire site</h1>', 'window.addEventListener("contextmenu",e=>e.preventDefault(),true);document.oncontextmenu=()=>false;');
  if (url.pathname === '/copy-blocked') html = page('<h1>Copy restriction fixture</h1><style>p{user-select:none!important;-webkit-user-select:none!important}</style><p id="text">Selectable fixture text</p><textarea id="editor">Editable fixture text</textarea><button id="control">Interactive control</button>', 'for(const type of ["copy","selectstart","keydown"])window.addEventListener(type,e=>e.preventDefault(),true);document.querySelector("#control").addEventListener("mousedown",e=>e.preventDefault());');
  if (url.pathname === '/images') html = page('<h1>Original image fixture</h1><img id="photo" src="/preview.jpg" srcset="/preview.jpg 160w, /original.jpg 1200w" sizes="160px" width="160" alt="Photo fixture"><a href="/original.jpg" download="Chosen photo.jpg">Save through Chrome</a>');
  if (url.pathname === '/inline-image') html = page(`<h1>Inline image fixture</h1><img id="photo" src="data:image/jpeg;base64,${(await readFile(join(fixtureDir, 'preview.jpg'))).toString('base64')}" width="160" alt="Inline fixture">`);
  if (url.pathname === '/shadow') html = page('<h1>Closed shadow fixture</h1><div id="host"></div>', 'const root=document.querySelector("#host").attachShadow({mode:"closed"});root.innerHTML=\'<video style="width:640px;height:360px" src="/source.mp4" controls muted autoplay></video>\';');
  if (url.pathname === '/frames') html = page(`<h1>Invisible iframe fixture</h1><iframe src="http://localhost:${port}/player"></iframe><iframe src="http://127.0.0.1:${port}/blocker" style="background:transparent"></iframe>`);
  if (url.pathname === '/player') html = page(video);
  if (url.pathname === '/nodownload') html = page('<h1>Download controls disabled</h1><div class="player">' + video.replace('controls ', 'controls controlslist="nodownload noremoteplayback" disablepictureinpicture ') + '<div class="overlay" style="pointer-events:none"></div></div>');
  if (url.pathname === '/canvas') html = page('<h1>Canvas player with hidden video</h1><div class="player"><video src="/source.mp4" style="display:none" muted autoplay></video><canvas width="640" height="360"></canvas></div>');
  if (url.pathname === '/modal') html = page('<h1>Modal obscures the player</h1><div class="player">' + video + '</div><dialog id="cover" style="position:fixed;inset:0;width:90vw;height:80vh">A site popup covers the video.</dialog>', 'document.querySelector("#cover").showModal();');
  if (url.pathname === '/popover') html = page('<h1>Popover obscures the player</h1><div class="player">' + video + '</div><div id="cover" popover="manual" style="position:fixed;inset:0;width:90vw;height:80vh">A popover covers the player.</div>', 'document.querySelector("#cover").showPopover();');
  if (url.pathname === '/script-dialog') html = page('<h1>A script dialog can block frame replies</h1><div class="player">' + video + '</div>');
  if (url.pathname === '/popup-ad') html = page('<h1>Popup page stealing focus</h1>');
  if (url.pathname === '/sandbox') html = page('<h1>Sandboxed player</h1><iframe sandbox="allow-scripts" src="/player"></iframe>');
  if (url.pathname === '/csp') html = page('<h1>Restrictive page policy</h1><div class="player">' + video + '</div>');
  if (url.pathname === '/auth') html = page('<h1>Session and hotlink restrictions</h1><div class="player"><video src="/authenticated.mp4" controls muted autoplay></video></div>');
  if (url.pathname === '/blocker') html = page('', 'document.body.style.background="transparent";window.addEventListener("contextmenu",e=>e.preventDefault(),true);');
  if (url.pathname === '/mse' || url.pathname === '/mse-revoked') html = page('<h1>Blob player fixture</h1><div class="player"><video id="video" controls muted autoplay></video><div class="overlay"></div></div>', `
    const video=document.querySelector('video');const source=new MediaSource();video.src=URL.createObjectURL(source);
    source.addEventListener('sourceopen',async()=>{
      await fetch('/opaque-manifest?signature=keep');
      const buffer=source.addSourceBuffer('video/mp4; codecs="avc1.42c01e,mp4a.40.2"');
      const playlist=await (await fetch('/low/index.m3u8')).text();
      const paths=['/low/init.mp4',...playlist.split('\\n').filter(x=>x.endsWith('.m4s')).map(x=>'/low/'+x)];
      for(const path of paths){const data=await(await fetch(path)).arrayBuffer();buffer.appendBuffer(data);await new Promise(resolve=>buffer.addEventListener('updateend',resolve,{once:true}));}
      source.endOfStream();await video.play();${url.pathname === '/mse-revoked' ? 'URL.revokeObjectURL(video.src);' : ''}window.mseReady=true;
    });`);
  if (html) {
    res.writeHead(200, { 'Content-Type': 'text/html', ...(['/auth', '/images'].includes(url.pathname) ? { 'Set-Cookie': 'fixture_session=ok; SameSite=Lax; Path=/' } : {}), ...(url.pathname === '/csp' ? { 'Content-Security-Policy': "default-src 'none'; media-src 'self'; style-src 'unsafe-inline'; script-src 'none'" } : {}) });
    res.end(html); return;
  }
  try {
    if (url.pathname === '/original.jpg') {
      if (!req.headers.cookie?.includes('fixture_session=ok') || !req.headers.referer?.includes('/images')) { res.writeHead(403); res.end(); return; }
      imageReads++;
    }
    if (url.pathname === '/authenticated.mp4') {
      if (!req.headers.cookie?.includes('fixture_session=ok') || !req.headers.referer?.includes('/auth')) { res.writeHead(403); res.end(); return; }
      authenticatedReads++;
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    if (url.pathname === '/high/index1.m4s' && fragmentFailures++ === 0) { res.writeHead(503, { 'Retry-After': '1' }); res.end(); return; }
    const name = url.pathname === '/opaque-manifest' ? 'master.m3u8' : url.pathname === '/authenticated.mp4' ? 'source.mp4' : decodeURIComponent(url.pathname).slice(1);
    const file = resolve(fixtureDir, name);
    if (!file.startsWith(fixtureDir + '/')) { res.writeHead(404); res.end(); return; }
    const bytes = await readFile(file);
    const type = { '.m3u8': 'application/vnd.apple.mpegurl', '.mp4': 'video/mp4', '.m4s': 'video/iso.segment', '.jpg': 'image/jpeg' }[extname(file)] ?? 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': type, 'Content-Length': bytes.length, 'Access-Control-Allow-Origin': '*' }); res.end(bytes);
  } catch { res.writeHead(404); res.end(); }
});
await new Promise((resolve) => server.listen(0, resolve));
port = server.address().port;
const context = await chromium.launchPersistentContext(profile, {
  channel: 'chromium', headless: process.env.VD_HEADED !== '1',
  args: [`--disable-extensions-except=${extensionDir}`, `--load-extension=${extensionDir}`, '--autoplay-policy=no-user-gesture-required', '--host-resolver-rules=MAP video.fixture.test 127.0.0.1', '--no-proxy-server'],
  env: { ...process.env, VIDEO_DOWNLOADER_HOME: app },
});
const failures = [];
context.setDefaultTimeout(20000);
context.setDefaultNavigationTimeout(20000);
context.on('page', (p) => p.on('pageerror', (error) => failures.push(error.message)));
try {
  let worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
  assert.equal(new URL(worker.url()).hostname, identity.id);
  const browserCDP = await context.browser().newBrowserCDPSession();
  // Exercise Chrome's actual download manager, not Playwright's temporary-file interception.
  await browserCDP.send('Browser.setDownloadBehavior', { behavior: 'default' });
  let ui = await context.newPage();
  await ui.goto(`chrome-extension://${identity.id}/options.html`);
  try { await ui.getByText('Ready when you are.', { exact: true }).waitFor({ timeout: 20000 }); }
  catch (error) {
    console.error('Setup page:', await ui.locator('body').innerText());
    console.error('Page errors:', failures);
    console.error('Native ping:', await ui.evaluate(() => chrome.runtime.sendMessage({type:'ping'})));
    await ui.screenshot({ path: join(output, 'setup-error.png'), fullPage: true });
    throw error;
  }
  await ui.screenshot({ path: join(output, 'settings.png'), fullPage: true });
  const rpc = (message) => ui.evaluate((data) => chrome.runtime.sendMessage(data), message);
  const ping = await rpc({ type: 'ping' }); assert.equal(ping.result.ready, true);
  const checkBrand = async (page) => {
    await page.evaluate(() => document.fonts.ready);
    const brand = await page.evaluate(() => ({
      background: getComputedStyle(document.body).backgroundColor,
      green: getComputedStyle(document.querySelector('h1')).color,
      fontLoaded: document.fonts.check('24px Anton'),
      artLoaded: document.querySelector('.intro-art').naturalWidth > 0,
      overflowing: document.documentElement.scrollWidth > innerWidth,
      clippedText: [...document.querySelectorAll('.intro p')].some((p) => p.scrollWidth > p.clientWidth + 1),
    }));
    assert.deepEqual(brand, { background: 'rgb(0, 0, 0)', green: 'rgb(57, 255, 20)', fontLoaded: true, artLoaded: true, overflowing: false, clippedText: false });
    assert.equal(await page.locator('.brand-footer').getByRole('link', { name: 'Built by abomination81' }).getAttribute('href'), 'https://abomination81.com');
    assert.equal(await page.locator('.brand-socials a').first().getAttribute('href'), 'https://x.com/Abomination81');
  };
  await checkBrand(ui);
  await ui.setViewportSize({ width: 360, height: 800 });
  await checkBrand(ui);
  await ui.screenshot({ path: join(output, 'settings-narrow.png'), fullPage: true });
  await ui.locator('.settings').screenshot({ path: join(output, 'settings-controls.png') });
  assert.equal(await ui.locator('#compatible-video').isChecked(), true);
  await ui.locator('#compatible-video').uncheck();
  await ui.waitForFunction(async () => (await chrome.storage.local.get('settings')).settings.compatibleVideo === false);
  assert.equal((await worker.evaluate(() => chrome.storage.local.get('settings'))).settings.compatibleVideo, false);
  await ui.locator('#restore-copy').uncheck();
  await ui.waitForFunction(async () => (await chrome.storage.local.get('settings')).settings.restoreCopy === false);
  assert.equal((await worker.evaluate(() => chrome.storage.local.get('settings'))).settings.compatibleVideo, false, 'Saving another preference reset the explicit original-source mode');
  await ui.locator('#restore-copy').check();
  await ui.locator('#compatible-video').check();
  await ui.setViewportSize({ width: 1000, height: 900 });
  await worker.evaluate(() => chrome.contextMenus.update('download-video', { title: 'Download video' }));
  const cases = [];
  const blockedEmpty = await context.newPage();
  await blockedEmpty.goto(`http://127.0.0.1:${port}/blocked-empty`);
  assert.equal(await blockedEmpty.evaluate(() => { const e = new MouseEvent('contextmenu', { bubbles: true, cancelable: true }); window.dispatchEvent(e); return e.defaultPrevented; }), false);
  await blockedEmpty.close();
  console.log('PASS restoring right-click on a site without any video');
  for (const name of ['http', 'overlay', 'blocked', 'shadow', 'frames', 'mse', 'mse-revoked', 'nodownload', 'canvas', 'sandbox', 'csp', 'auth', 'modal', 'popover', 'script-dialog']) {
    const target = await context.newPage();
    const url = name === 'http' ? `http://video.fixture.test:${port}/blocked` : `http://127.0.0.1:${port}/${name}`;
    await target.goto(url);
    if (name === 'http') assert.equal(await target.evaluate(() => isSecureContext), false, 'Expected an ordinary non-HTTPS site');
    if (name.startsWith('mse')) await target.waitForFunction(() => window.mseReady === true);
    else if (!['frames', 'shadow', 'sandbox'].includes(name)) await target.locator('video').evaluate((v) => new Promise((resolve) => v.readyState ? resolve() : v.addEventListener('loadedmetadata', resolve, { once: true })));
    const tabId = await worker.evaluate(async (url) => (await chrome.tabs.query({})).find((t) => t.url === url)?.id, url);
    assert.equal(typeof tabId, 'number');
    if (name === 'script-dialog') {
      // Holding the dialog open deliberately suspends page-script responses.
      const dialogReady = target.waitForEvent('dialog');
      target.on('dialog', () => undefined);
      await target.evaluate(() => { setTimeout(() => alert('Site dialog fixture'), 0); });
      const dialog = await dialogReady;
      const began = Date.now();
      const response = await rpc({ type: 'find', tabId });
      assert.ok(Date.now() - began < 6000, 'A modal script dialog stalled all video discovery');
      assert.equal(response.ok, true, JSON.stringify(response));
      assert.ok(response.result.candidates.some((c) => c.sources.some((s) => s.url.includes('/source.mp4'))));
      await dialog.dismiss();
      cases.push({ name, first: response.result.candidates[0], target });
      console.log('PASS script dialog: recovered observed video while the page could not answer');
      continue;
    }
    // Ask once to ensure every nested frame has completed its handshake.
    await rpc({ type: 'find', tabId });
    const frameCount = name === 'frames' ? 3 : 1;
    await target.waitForFunction((count) => document.readyState === 'complete' && (count === 1 || document.querySelectorAll('iframe').length === 2), frameCount);
    await target.mouse.click(name === 'shadow' ? 200 : 240, name === 'frames' ? 180 : name === 'shadow' ? 150 : 170, { button: 'right' });
    await target.keyboard.press('Escape');
    const response = await rpc({ type: 'find', tabId });
    assert.equal(response.ok, true, JSON.stringify(response));
    const first = response.result.candidates[0];
    assert.ok(first?.sources.length, `${name} has no source`);
    if (name !== 'canvas') assert.ok(first.exact, `${name} did not identify the clicked video`);
    if (name.startsWith('mse')) assert.ok(first.sources[0].url.includes('/opaque-manifest?signature=keep'));
    if (name === 'frames') assert.ok(first.sources.some((s) => s.url.includes('/source.mp4')));
    if (name === 'blocked') {
      const before = await target.evaluate(() => { const e = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 240, clientY: 170 }); window.dispatchEvent(e); return e.defaultPrevented; });
      assert.equal(before, false, 'Site still cancels the restored native menu');
      await ui.locator('#restore-menus').uncheck();
      await worker.evaluate(() => chrome.storage.local.get('settings'));
      await target.waitForFunction(() => { const e = new MouseEvent('contextmenu', { bubbles: true, cancelable: true }); window.dispatchEvent(e); return e.defaultPrevented; });
      await ui.locator('#restore-menus').check();
      await target.waitForFunction(() => { const e = new MouseEvent('contextmenu', { bubbles: true, cancelable: true }); window.dispatchEvent(e); return !e.defaultPrevented; });
    }
    cases.push({ name, first, target });
    console.log(`PASS ${name}: selected the video, native menu available`);
  }
  const mse = cases.find((c) => c.name === 'mse');
  const mseTab = await worker.evaluate(async (url) => (await chrome.tabs.query({})).find((t) => t.url === url)?.id, mse.target.url());
  await worker.evaluate((value) => chrome.storage.session.set({ choices: value }), { tabId: mseTab, at: Date.now(), candidates: [{ ...mse.first, title: 'Original streaming video' }, { ...cases.find((c) => c.name === 'auth').first, title: 'Other video option' }] });
  const adReady = context.waitForEvent('page');
  await mse.target.evaluate(() => { window.open('/popup-ad', '_blank'); });
  const ad = await adReady;
  await ad.waitForLoadState();
  const choicePopup = await context.newPage();
  await choicePopup.goto(`chrome-extension://${identity.id}/popup.html`);
  await choicePopup.getByText('Your video selection is from another tab. Choose the original video below, even if the site opened a popup.', { exact: true }).waitFor();
  assert.equal(await choicePopup.locator('#candidates .candidate').count(), 2);
  await choicePopup.locator('#download').click();
  assert.equal(await choicePopup.locator('#candidates .candidate').count(), 2, 'The main action replaced the original choices with the popup page');
  await choicePopup.locator('#candidates .candidate').first().getByRole('button', { name: 'Download this video', exact: true }).click();
  await choicePopup.locator('#jobs .job').first().waitFor();
  const selectedJobs = await rpc({ type: 'jobs' });
  assert.equal(selectedJobs.ok, true, JSON.stringify(selectedJobs));
  assert.equal(selectedJobs.result.jobs.length, 1);
  const started = { result: { jobId: selectedJobs.result.jobs[0].id } };
  await choicePopup.close();
  await ad.close();
  console.log('PASS popup focus: original ambiguous video selection stayed available after a new tab opened');
  let unloadPrompts = 0;
  mse.target.on('dialog', (dialog) => { unloadPrompts++; void dialog.accept(); });
  await mse.target.evaluate(() => { window.addEventListener('beforeunload', (event) => { event.preventDefault(); event.returnValue = ''; }); });
  await mse.target.goto(`http://127.0.0.1:${port}/blocked-empty`);
  assert.ok(unloadPrompts > 0, 'Expected the site beforeunload prompt to appear');
  const jobId = started.result.jobId;
  await mse.target.close(); // A tab closure must not cancel the independent worker.
  await ui.close(); // No popup or settings page is allowed to drive the handoff.
  const readJob = (id) => JSON.parse(execFileSync(join(installed, '.venv/bin/python'), ['-c', 'import json,sqlite3,sys; c=sqlite3.connect(sys.argv[1]); c.row_factory=sqlite3.Row; r=c.execute("select * from jobs where id=?",(sys.argv[2],)).fetchone(); print(json.dumps(dict(r)))', join(app, 'state/jobs.sqlite3'), id], { encoding: 'utf8' }));
  const waitDone = async (id) => {
    let job;
    for (let attempt = 0; attempt < 180; attempt++) {
      job = readJob(id);
      if (['done', 'error', 'cancelled'].includes(job?.state)) break;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    return job;
  };
  let job = await waitDone(jobId);
  assert.equal(job.state, 'done', JSON.stringify(job));
  const finished = join(config.download_dir, job.filename);
  assert.ok(existsSync(finished));
  const info = JSON.parse(execFileSync(config.binaries.ffprobe, ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', finished], { encoding: 'utf8' }));
  assert.equal(info.streams[0].width, 320, 'The player used 160px but download must use 320px master rendition');
  assert.equal(info.streams[0].height, 180);
  assert.deepEqual(Object.keys(info.format.tags).sort(), ['compatible_brands', 'major_brand', 'minor_version']);
  const chromeItems = await worker.evaluate((filename) => chrome.downloads.search({ query: [filename] }), job.filename);
  assert.equal(chromeItems.length, 1, 'Expected exactly one native Chrome download entry');
  assert.equal(chromeItems[0].state, 'complete');
  assert.equal(chromeItems[0].filename, finished);
  assert.equal(chromeItems[0].byExtensionId, identity.id);
  assert.ok(chromeItems[0].url.startsWith('http://127.0.0.1:'));
  assert.ok(fragmentFailures >= 2, 'Transient fragment failure was not retried');
  assert.ok(!existsSync(join(app, 'ready', jobId, 'clean.mp4')), 'Private transfer copy was not cleaned up');
  if (process.platform === 'darwin') {
    const attrs = execFileSync('/usr/bin/xattr', [finished], { encoding: 'utf8' });
    assert.ok(!attrs.includes('com.apple.metadata:kMDItemWhereFroms'));
  }
  console.log('PASS native Chrome entry: highest HLS rendition, transient fragment retry, clean MP4, navigated and closed video/UI tabs');
  ui = await context.newPage();
  await ui.goto(`chrome-extension://${identity.id}/options.html`);
  await ui.screenshot({ path: join(output, 'settings-tested.png'), fullPage: true });
  const observer = await context.newPage();
  const lifecycle = await context.newCDPSession(observer);
  const versions = new Map();
  let sawStopped = false, sawRestarted = false;
  lifecycle.on('ServiceWorker.workerVersionUpdated', ({ versions: updates }) => {
    for (const value of updates) {
      versions.set(value.versionId, value);
      if (value.scriptURL === worker.url()) {
        if (value.runningStatus === 'stopped') sawStopped = true;
        if (sawStopped && value.runningStatus === 'running') sawRestarted = true;
      }
    }
  });
  await lifecycle.send('ServiceWorker.enable');
  const authenticated = cases.find((c) => c.name === 'auth');
  const readsBefore = authenticatedReads;
  const authStarting = rpc({ type: 'start', requestId: crypto.randomUUID(), candidate: authenticated.first });
  await authenticated.target.goto(`http://127.0.0.1:${port}/blocked-empty`);
  const authStarted = await authStarting;
  assert.equal(authStarted.ok, true, JSON.stringify(authStarted));
  await authenticated.target.close();
  await ui.close();
  const version = [...versions.values()].find((v) => v.scriptURL === worker.url() && v.runningStatus === 'running');
  assert.ok(version, 'Could not find the running extension service worker');
  await lifecycle.send('ServiceWorker.stopWorker', { versionId: version.versionId });
  console.log('CHECK worker recovery: video/UI tabs closed; extension worker stopped; waiting for the persistent alarm');
  // Chrome reuses this target and Playwright preserves its Worker object; a
  // second `serviceworker` event is not expected for an ordinary restart.
  const authJob = await waitDone(authStarted.result.jobId);
  assert.equal(authJob.state, 'done', JSON.stringify(authJob));
  assert.ok(sawStopped && sawRestarted, 'Expected an actual worker stop/restart');
  assert.ok(authenticatedReads > readsBefore, 'Native download did not use the signed-in hotlink source');
  const authItems = await worker.evaluate((filename) => chrome.downloads.search({ query: [filename] }), authJob.filename);
  assert.equal(authItems.length, 1);
  assert.equal(authItems[0].state, 'complete');
  assert.ok(existsSync(authItems[0].filename));
  await observer.close();
  console.log('PASS worker recovery: partition-aware session, required Referer/cookie, persistent alarm, one Chrome entry without a video or popup tab');
  const videoPreview = await context.newPage();
  await videoPreview.setViewportSize({ width: 380, height: 780 });
  await videoPreview.goto(`chrome-extension://${identity.id}/popup.html`);
  await videoPreview.getByText('Saved with metadata removed', { exact: true }).first().waitFor();
  await videoPreview.screenshot({ path: join(output, 'video-downloads.png'), fullPage: true });
  await videoPreview.locator('#jobs .job').first().screenshot({ path: join(output, 'video-entry.png') });
  await videoPreview.close();
  ui = await context.newPage();
  await ui.goto(`chrome-extension://${identity.id}/options.html`);
  const copyPage = await context.newPage();
  await copyPage.goto(`http://127.0.0.1:${port}/copy-blocked`);
  await copyPage.waitForFunction(() => getComputedStyle(document.querySelector('#text')).userSelect === 'text');
  const cancelledEvent = (selector, type) => copyPage.locator(selector).evaluate((node, name) => {
    const event = name === 'keydown' ? new KeyboardEvent(name, { key: 'c', ctrlKey: true, bubbles: true, cancelable: true }) : ['pointerdown', 'mousedown'].includes(name) ? new MouseEvent(name, { button: 0, bubbles: true, cancelable: true }) : new Event(name, { bubbles: true, cancelable: true });
    node.dispatchEvent(event); return event.defaultPrevented;
  }, type);
  for (const type of ['copy', 'selectstart', 'keydown']) assert.equal(await cancelledEvent('#text', type), false);
  assert.equal(await cancelledEvent('#editor', 'copy'), true, 'Editable controls must retain their own copy handling');
  assert.equal(await cancelledEvent('#control', 'mousedown'), true, 'Interactive controls must retain their own mouse handling');
  await copyPage.locator('#text').dblclick({ position: { x: 30, y: 8 } });
  assert.ok(await copyPage.evaluate(() => !!window.getSelection()?.toString().trim()), 'Real mouse selection remained blocked');
  await ui.locator('#restore-copy').uncheck();
  await copyPage.waitForFunction(() => getComputedStyle(document.querySelector('#text')).userSelect === 'none');
  assert.equal(await cancelledEvent('#text', 'copy'), true);
  await ui.locator('#restore-copy').check();
  await copyPage.waitForFunction(() => getComputedStyle(document.querySelector('#text')).userSelect === 'text');
  const cleanUrl = `http://127.0.0.1:${port}/images?t=12#photo`;
  const copied = await rpc({ type: 'copy-link', url: `http://127.0.0.1:${port}/images?utm_source=fixture&t=12&fbclid=fixture#photo` });
  assert.equal(copied.ok, true, JSON.stringify(copied));
  await context.grantPermissions(['clipboard-read'], { origin: `http://127.0.0.1:${port}` });
  await copyPage.bringToFront();
  // Return only a comparison, never the pre-existing contents of the clipboard.
  assert.equal(await copyPage.evaluate(async (expected) => (await navigator.clipboard.readText()) === expected, cleanUrl), true);
  await copyPage.close();
  console.log('PASS copy tools: forced selection, copy/keyboard restoration, editable exclusion, settings toggle, clean link through offscreen clipboard');

  const imageCheck = (path, width) => {
    const check = JSON.parse(execFileSync(join(installed, '.venv/bin/python'), ['-c', 'import json,sys; from video_downloader.images import tags,value,exif; d=tags(sys.argv[1]); print(json.dumps({"width":value(d,"ImageWidth"),"orientation":value(d,"Orientation"),"private":b"PRIVATE_" in open(sys.argv[1],"rb").read(),"metadata":any(any(n in k.lower() for n in ["gps","artist","comment"]) for k in d)}))', path], { encoding: 'utf8' }));
    assert.deepEqual(check, { width, orientation: 6, private: false, metadata: false });
  };
  const imagePage = await context.newPage();
  const imagesUrl = `http://127.0.0.1:${port}/images`;
  await imagePage.goto(imagesUrl);
  await imagePage.locator('#photo').evaluate((image) => image.decode());
  const imageTab = await worker.evaluate(async (url) => (await chrome.tabs.query({})).find((t) => t.url === url)?.id, imagesUrl);
  const nativeSrc = await imagePage.locator('#photo').evaluate((image) => image.currentSrc);
  assert.ok(nativeSrc.endsWith('/preview.jpg'), 'The page must display the small preview for this quality check');
  const readsBeforeImage = imageReads;
  const originalStarted = await rpc({ type: 'save-image', tabId: imageTab, srcUrl: nativeSrc });
  assert.equal(originalStarted.ok, true, JSON.stringify(originalStarted));
  await imagePage.goto(`http://127.0.0.1:${port}/blocked-empty`);
  const imageJob = await waitDone(originalStarted.result.jobId);
  assert.equal(imageJob.state, 'done', JSON.stringify(imageJob));
  assert.ok(imageReads > readsBeforeImage, 'Native image fetch did not send the required cookie and Referer');
  const imageItems = await worker.evaluate((filename) => chrome.downloads.search({ query: [filename] }), imageJob.filename);
  assert.equal(imageItems.length, 1);
  assert.equal(imageItems[0].byExtensionId, identity.id);
  assert.equal(imageItems[0].filename, join(config.download_dir, imageJob.filename));
  imageCheck(imageItems[0].filename, 1200);
  console.log('PASS original image: largest srcset source, authenticated fetch, metadata removal, rotation/color retained, Chrome download after navigation');

  await imagePage.goto(`http://127.0.0.1:${port}/inline-image`);
  const inlineTab = await worker.evaluate(async (url) => (await chrome.tabs.query({})).find((t) => t.url === url)?.id, imagePage.url());
  const inlineSource = await imagePage.locator('#photo').evaluate((image) => image.currentSrc);
  const inlineStarted = await rpc({ type: 'save-image', tabId: inlineTab, srcUrl: inlineSource });
  assert.equal(inlineStarted.ok, true, JSON.stringify(inlineStarted));
  const inlineJob = await waitDone(inlineStarted.result.jobId);
  assert.equal(inlineJob.state, 'done', JSON.stringify(inlineJob));
  imageCheck(join(config.download_dir, inlineJob.filename), 160);
  console.log('PASS inline image: exact image bytes cleaned without canvas conversion');

  await imagePage.goto(imagesUrl);
  await imagePage.getByRole('link', { name: 'Save through Chrome', exact: true }).click();
  await imagePage.close();
  let savedJob;
  for (let attempt = 0; attempt < 100; attempt++) {
    const jobs = await rpc({ type: 'jobs' });
    savedJob = jobs.result.jobs.find((entry) => entry.filename === 'Chosen photo.jpg');
    if (savedJob && ['done', 'error', 'cancelled'].includes(savedJob.state)) break;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  assert.equal(savedJob?.state, 'done', JSON.stringify(savedJob));
  const normalItems = await worker.evaluate(() => chrome.downloads.search({ query: ['Chosen photo.jpg'] }));
  assert.equal(normalItems.length, 1);
  assert.ok(!normalItems[0].byExtensionId, 'Expected Chrome to create this download itself');
  assert.equal(normalItems[0].filename, join(config.download_dir, 'Chosen photo.jpg'));
  imageCheck(normalItems[0].filename, 1200);
  if (process.platform === 'darwin') {
    const attrs = execFileSync('/usr/bin/xattr', [normalItems[0].filename], { encoding: 'utf8' });
    assert.ok(!attrs.includes('com.apple.metadata:kMDItemWhereFroms'));
    assert.ok(attrs.includes('com.apple.quarantine'), 'Chrome quarantine must survive metadata cleanup');
  }
  await worker.evaluate(async (id) => {
    for (let attempt = 0; attempt < 30; attempt++) {
      const data = await chrome.storage.local.get('savedImagesToClean');
      if ((data.savedImagesToClean ?? []).every((item) => item.id !== id)) return;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    throw new Error('Completed image cleanup remained in the pending queue');
  }, normalItems[0].id);
  console.log('PASS automatic image cleanup: ordinary Chrome download cleaned atomically in place, chosen name and quarantine preserved');
  // Popup can also be inspected as an extension page; its normal use remains an action popup.
  const popup = await context.newPage();
  await popup.setViewportSize({ width: 380, height: 780 });
  await popup.goto(`chrome-extension://${identity.id}/popup.html`);
  await popup.getByText('Saved with metadata removed', { exact: true }).first().waitFor();
  await checkBrand(popup);
  await popup.screenshot({ path: join(output, 'downloads.png'), fullPage: true });
  await popup.getByRole('button', { name: 'Clear history', exact: true }).click();
  await popup.locator('#jobs .empty').waitFor();
  await popup.screenshot({ path: join(output, 'downloads-empty.png'), fullPage: true });
  console.log('PASS branding: local ghoul and Anton font, exact black/green palette, creator links, narrow settings and popup');
  assert.deepEqual(failures, [], 'Browser page errors');
  await writeFile(join(output, 'browser-results.json'), JSON.stringify({ cases: cases.map((c) => c.name), nativeDownload: { state: job.state, width: 320, height: 180, metadataVerified: true, chromeEntries: chromeItems.length, pageNavigation: true, popupClosed: true, transientFragmentRetried: true }, workerRestart: { state: authJob.state, chromeEntries: authItems.length, sessionAndRefererVerified: true }, copyTools: true, images: { original: imageJob.state, inline: inlineJob.state, ordinaryChromeSave: savedJob.state, metadataVerified: true, highestExposedSource: true }, pageErrors: failures }, null, 2));
} finally {
  await context.close();
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
}
