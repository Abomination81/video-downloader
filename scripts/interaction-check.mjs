import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright';
import { execFileSync } from 'node:child_process';

// Real page input with the production extension. No native helper or user profile.
const root = resolve(import.meta.dirname, '..');
const profile = await mkdtemp(join(tmpdir(), 'video-downloader-interactions-'));
const source = join(profile, 'source.mp4');
execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=24', '-t', '2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', source]);
const bytes = await readFile(source);
let port;
const player = `<video src="/source.mp4" preload="auto" muted style="width:640px;height:360px"></video>
  <div id="seek" style="width:640px;height:40px;background:#ddd;touch-action:none;user-select:none"><span>Seek</span></div>
  <div role="slider" id="aria-seek" style="user-select:none"><span>Slider label</span></div>`;
const controller = `
  const root = window.playerRoot || document;
  const video = root.querySelector('video');
  const seek = root.querySelector('#seek');
  window.presses = { pointerdown: 0, mousedown: 0 };
  seek.addEventListener('mousedown', () => window.presses.mousedown++);
  const update = e => {
    const box = seek.getBoundingClientRect();
    video.currentTime = Math.max(0, Math.min(0.99, (e.clientX - box.left) / box.width)) * video.duration;
  };
  seek.addEventListener('pointerdown', e => {
    window.presses.pointerdown++;
    seek.setPointerCapture(e.pointerId);
    update(e);
  });
  seek.addEventListener('pointermove', e => { if (e.buttons === 1) update(e); });
  root.querySelector('#aria-seek').addEventListener('selectstart', e => e.preventDefault());
`;
const server = createServer((req, res) => {
  if (req.url === '/source.mp4') {
    const range = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range || '');
    const start = range ? Number(range[1]) : 0;
    const end = range?.[2] ? Math.min(Number(range[2]), bytes.length - 1) : bytes.length - 1;
    res.writeHead(range ? 206 : 200, { 'Content-Type': 'video/mp4', 'Content-Length': end - start + 1, 'Accept-Ranges': 'bytes', ...(range ? { 'Content-Range': `bytes ${start}-${end}/${bytes.length}` } : {}) });
    res.end(bytes.subarray(start, end + 1)); return;
  }
  let body = player, script = controller;
  if (req.url === '/shadow') {
    body = '<div id="host"></div>';
    script = `window.playerRoot = document.querySelector('#host').attachShadow({mode:'open'});window.playerRoot.innerHTML = ${JSON.stringify(player)};` + controller;
  }
  if (req.url === '/frames') { body = `<iframe src="http://localhost:${port}/player" style="width:700px;height:500px"></iframe>`; script = ''; }
  if (req.url === '/native') { body = player.replace('<video ', '<video controls '); script = ''; }
  if (req.url === '/text') {
    body = '<p id="text" style="user-select:none!important">Selectable fixture words for copying.</p><input id="range" type="range"><textarea>Editable words</textarea>';
    script = `for(const type of ['copy','selectstart']) window.addEventListener(type, e => e.preventDefault(), true);window.addEventListener('keydown',e=>{if((e.ctrlKey||e.metaKey)&&['a','c'].includes(e.key.toLowerCase()))e.preventDefault()},true);window.addEventListener('contextmenu',e=>e.preventDefault(),true);`;
  }
  res.writeHead(200, { 'Content-Type': 'text/html' });
  res.end(`<!doctype html><html><head><title>Input regression fixture</title><style>body{margin:20px;font:16px sans-serif}</style></head><body><p id="ready">Input regression</p>${body}<script>${script}</script></body></html>`);
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
port = server.address().port;
const extension = process.env.VD_EXTENSION_DIR || join(root, '.output/chrome-mv3');
let context;
try {
  context = await chromium.launchPersistentContext(profile, {
    channel: 'chromium', headless: true,
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
  });
  const errors = [];
  context.on('page', page => page.on('pageerror', error => errors.push(error.message)));
  const page = await context.newPage();
  for (const path of ['/player', '/shadow', '/frames']) {
    await page.goto(`http://127.0.0.1:${port}${path}`);
    const frame = path === '/frames' ? page.frameLocator('iframe') : page;
    const video = frame.locator('video');
    await video.evaluate(video => new Promise(resolve => video.readyState >= 4 ? resolve() : video.addEventListener('canplaythrough', resolve, { once: true })));
    // Wait for the extension's USER selection stylesheet, including nested frames.
    await frame.locator('#ready').evaluate(node => new Promise((resolve, reject) => {
      const deadline = performance.now() + 10000;
      const check = () => getComputedStyle(node).userSelect === 'text' ? resolve() : performance.now() > deadline ? reject(new Error('Extension selection stylesheet did not arrive')) : requestAnimationFrame(check); check();
    }));
    const seek = frame.locator('#seek');
    const box = await seek.boundingBox();
    await seek.click({ position: { x: box.width * 0.65, y: box.height / 2 } });
    const clicked = await video.evaluate(video => ({ time: video.currentTime, duration: video.duration, presses: video.ownerDocument.defaultView.presses }));
    assert.ok(clicked.time > clicked.duration * 0.6, `${path}: seek-bar click never reached the player: ${JSON.stringify(clicked)}`);
    await page.mouse.move(box.x + box.width * 0.2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.85, box.y + box.height / 2, { steps: 8 });
    await page.mouse.up();
    assert.ok(await video.evaluate(video => video.currentTime > video.duration * 0.8), `${path}: seek-bar drag never reached the player`);
    const presses = await seek.evaluate(node => node.ownerDocument.defaultView.presses);
    assert.deepEqual(presses, { pointerdown: 2, mousedown: 2 });
    assert.equal(await frame.locator('#aria-seek span').evaluate(node => getComputedStyle(node).userSelect), 'none', 'Selection restoration changed a slider control');
    assert.equal(await frame.locator('#aria-seek span').evaluate(node => {
      const event = new Event('selectstart', { bubbles: true, cancelable: true, composed: true });
      node.dispatchEvent(event); return event.defaultPrevented;
    }), true, 'Selection restoration swallowed a slider handler');
    console.log(`PASS ${path}: real seek-bar clicks, pointer-captured scrubbing and mouse handlers`);
  }
  await page.goto(`http://127.0.0.1:${port}/native`);
  await page.locator('video').evaluate(video => new Promise(resolve => video.readyState >= 4 ? resolve() : video.addEventListener('canplaythrough', resolve, { once: true })));
  // Chrome's native timeline sits above its bottom playback buttons.
  const box = await page.locator('video').boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.click(box.x + box.width * 0.7, box.y + box.height - 18);
  assert.ok(await page.locator('video').evaluate(video => video.currentTime > video.duration * 0.5), 'Native seek-bar click did not seek');
  await page.mouse.move(box.x + box.width * 0.2, box.y + box.height - 18);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.85, box.y + box.height - 18, { steps: 8 });
  await page.mouse.up();
  assert.ok(await page.locator('video').evaluate(video => video.currentTime > video.duration * 0.7), 'Native seek-bar dragging did not seek');
  console.log('PASS native video timeline clicking and dragging');
  await page.goto(`http://127.0.0.1:${port}/text`);
  await page.waitForFunction(() => getComputedStyle(document.querySelector('#text')).userSelect === 'text');
  await page.locator('#text').dblclick({ position: { x: 35, y: 8 } });
  assert.ok(await page.evaluate(() => !!getSelection().toString().trim()), 'Text selection restoration regressed');
  for (const type of ['copy', 'selectstart', 'keydown', 'contextmenu']) {
    assert.equal(await page.locator('#text').evaluate((node, type) => {
      const event = type === 'keydown' ? new KeyboardEvent(type, { key: 'c', ctrlKey: true, bubbles: true, cancelable: true }) : new Event(type, { bubbles: true, cancelable: true });
      node.dispatchEvent(event); return event.defaultPrevented;
    }, type), false, `${type} restoration regressed`);
  }
  await page.locator('#range').click();
  const before = Number(await page.locator('#range').inputValue());
  await page.keyboard.press('ArrowRight');
  assert.ok(Number(await page.locator('#range').inputValue()) > before, 'Ordinary range controls regressed');
  assert.deepEqual(errors, []);
  console.log('PASS right-click, copying, real text selection and ordinary range controls');
} finally {
  await context?.close();
  await new Promise(resolve => server.close(resolve));
  await rm(profile, { recursive: true, force: true });
}
