import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, readFile, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { chromium } from 'playwright';

const root = resolve(import.meta.dirname, '..');
const profile = await mkdtemp(join(tmpdir(), 'toolkit-controls-'));
const out = join(root, '.output/chrome-mv3');
execFileSync('ffmpeg', ['-v','error','-f','lavfi','-i','testsrc2=size=640x360:rate=12','-t','35','-c:v','libx264','-pix_fmt','yuv420p','-movflags','+faststart',join(profile,'clip.mp4')]);
const bytes = await readFile(join(profile, 'clip.mp4'));
let port;
const video = '<video muted preload="auto" src="/clip.mp4"></video>';
const server = createServer((req, res) => {
  if (req.url === '/clip.mp4') {
    const range = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range || '');
    const start = Number(range?.[1] || 0), end = range?.[2] ? Math.min(Number(range[2]), bytes.length - 1) : bytes.length - 1;
    res.writeHead(range ? 206 : 200, { 'Content-Type':'video/mp4', 'Content-Length':end-start+1, 'Accept-Ranges':'bytes', ...(range ? {'Content-Range':`bytes ${start}-${end}/${bytes.length}`} : {}) });
    res.end(bytes.subarray(start, end+1)); return;
  }
  let body = `<div class="player">${video}</div>`, script = '';
  if (req.url === '/native') body = body.replace('<video ', '<video controls ');
  if (req.url === '/custom') body = `<div class="player">${video}<div class="plyr__controls" style="position:absolute;bottom:0;width:100%;height:45px;opacity:0"><button>Play</button></div></div>`;
  if (req.url === '/semantic') body = `<div class="player">${video}<input type="range" aria-label="Video timeline" style="position:absolute;bottom:0;width:100%"></div>`;
  if (req.url === '/overlay') body = `<div class="player">${video}<div class="overlay" style="position:absolute;inset:0"></div></div>`;
  if (req.url === '/hover-controls') script = `document.querySelector('.player').addEventListener('pointerover',()=>{if(document.querySelector('.jw-controlbar'))return;const bar=document.createElement('div');bar.className='jw-controlbar';bar.style='position:absolute;bottom:0;width:100%;height:40px';document.querySelector('.player').append(bar)})`;
  if (req.url === '/hidden-controls') body = `<div class="player">${video}<div class="vjs-control-bar" hidden><button>Play</button></div></div>`;
  if (req.url === '/neighbors') body = `<div class="feed"><div class="player">${video}</div><div class="player">${video}<div class="plyr__controls" style="height:40px">Play</div></div></div>`;
  if (req.url === '/frame') body = `<iframe src="http://localhost:${port}/plain" style="width:700px;height:460px"></iframe>`;
  if (req.url === '/shadow') { body = '<div id="shadow-player"></div>'; script = `const r=document.querySelector('#shadow-player').attachShadow({mode:'open'});r.innerHTML=${JSON.stringify(`<style>.player{position:relative;width:640px}video{width:640px;height:360px;display:block}</style><div class="player">${video}</div>`)};`; }
  if (req.url === '/closed-controls') { body = '<div class="player" id="closed-player"></div>'; script = `document.querySelector('#closed-player').attachShadow({mode:'closed'}).innerHTML=${JSON.stringify(`<style>video{width:640px;height:360px}.vjs-control-bar{height:40px}</style>${video}<div class="vjs-control-bar">Play</div>`)};`; }
  res.writeHead(200, {'Content-Type':'text/html'});
  res.end(`<!doctype html><title>Hover video controls</title><style>body{margin:24px;background:#202124;color:white;font:16px system-ui;min-height:1400px}.player{position:relative;width:640px}video{width:640px;height:360px;display:block}#outside{margin-top:40px;width:600px;height:60px}</style>${body}<div id="outside">Outside the video</div><script>${script}</script>`);
});
await new Promise(r => server.listen(0, '0.0.0.0', r)); port = server.address().port;
let context;
try {
  context = await chromium.launchPersistentContext(profile, {channel:'chromium',headless:process.env.HEADED !== '1', viewport:{width:1000,height:800}, args:[`--disable-extensions-except=${out}`,`--load-extension=${out}`]});
  const page = await context.newPage(), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const controls = scope => scope.getByRole('group', {name:'Video controls by Abomination81'});
  const hidden = scope => scope.locator('#abomination-browsing-tools .controls').evaluate(node => node.hidden);
  const open = async path => {
    await page.mouse.move(950, 750);
    await page.goto(`http://127.0.0.1:${port}/${path}`);
    await page.locator('#abomination-browsing-tools').waitFor({state:'attached'});
    await page.waitForFunction(() => [...document.querySelectorAll('video')].every(v => v.readyState >= 3));
  };
  await open('plain');
  assert.equal(await hidden(page), true, 'No controls before hover');
  await page.locator('video').hover(); await controls(page).waitFor();
  const rect = await controls(page).boundingBox(), vr = await page.locator('video').boundingBox();
  assert.ok(rect.height <= 60 && Math.abs(rect.y + rect.height - vr.y - vr.height) < 1 && rect.x === vr.x && rect.width === vr.width, 'Controls must sit inside the bottom of the video');
  const seek = page.getByRole('slider', {name:'Seek video'}), sr = await seek.boundingBox();
  await page.mouse.click(sr.x + sr.width * .55, sr.y + sr.height/2);
  assert.ok(await page.locator('video').evaluate(v => v.currentTime > 17 && v.currentTime < 22), 'Click seeks on the actual media timeline');
  await page.mouse.move(sr.x + sr.width*.55, sr.y+sr.height/2); await page.mouse.down();
  await page.mouse.move(sr.x+sr.width*.8, sr.y+sr.height/2, {steps:10}); await page.mouse.up();
  assert.ok(await page.locator('video').evaluate(v => v.currentTime > 26), 'Dragging scrubs without resetting');
  await page.getByRole('button', {name:'Play video',exact:true}).click();
  await page.waitForFunction(() => !document.querySelector('video').paused);
  await page.getByRole('button', {name:'Pause video',exact:true}).click();
  await page.waitForFunction(() => document.querySelector('video').paused);
  await page.getByRole('button', {name:'Unmute video',exact:true}).click();
  assert.equal(await page.locator('video').evaluate(v => v.muted), false);
  const speed = page.getByRole('combobox', {name:'Playback speed'}); await speed.focus();
  await speed.press('ArrowRight'); await speed.press('ArrowRight');
  await page.waitForFunction(() => document.querySelector('video').playbackRate === 1.5);
  await page.mouse.move(vr.x + 10, vr.y + 10);
  await mkdir(join(root,'output/playwright'), {recursive:true});
  await page.screenshot({path:join(root,'output/playwright/hover-video-controls.png'),clip:vr});
  // A focused control must not keep the UI open after the pointer leaves.
  await seek.focus(); await page.mouse.move(800, 500);
  assert.equal(await hidden(page), true, 'Leaving hides immediately, without a grace timer');
  assert.equal(await page.locator('video').evaluate(v => v.controls), false, 'The site video attributes stay untouched');
  await page.locator('video').hover(); await controls(page).waitFor();
  await page.mouse.wheel(0, 100);
  await controls(page).waitFor({state:'hidden'});
  console.log('PASS bottom geometry, real seek/scrub, playback, volume, immediate hover exit and scroll cleanup');

  for (const path of ['native','custom','semantic','hover-controls','closed-controls']) {
    await open(path);
    const flashes = await page.evaluate(() => {
      window.flashes = 0;
      const el = document.querySelector('#abomination-browsing-tools').shadowRoot.querySelector('.controls');
      new MutationObserver(() => { if (!el.hidden) window.flashes++; }).observe(el,{attributes:true,attributeFilter:['hidden']});
      return window.flashes;
    });
    await page.mouse.move(300, 200);
    await page.evaluate(() => new Promise(r => setTimeout(r, 450)));
    assert.equal(await hidden(page), true, `${path}: existing player must not get a second toolbar`);
    assert.equal(await page.evaluate(() => window.flashes), flashes, `${path}: duplicate controls flashed during hover`);
  }
  console.log('PASS native, auto-hidden custom, semantic, hover-created and closed-shadow controls get no duplicate UI');
  for (const path of ['overlay','hidden-controls','neighbors','shadow']) {
    await open(path); await page.mouse.move(300,200); await controls(page).waitFor();
    await page.getByRole('slider',{name:'Seek video'}).click();
    const v = page.locator('video').first();
    assert.ok(await v.evaluate(v => v.currentTime > 15), `${path}: fallback must stay usable`);
    await page.mouse.move(900,500); assert.equal(await hidden(page),true);
  }
  console.log('PASS transparent overlays, disabled controls, neighboring players and shadow-root playback');
  await open('plain'); await page.locator('video').hover(); await controls(page).waitFor();
  await page.locator('video').evaluate(v => v.controls = true);
  await controls(page).waitFor({state:'hidden'});
  await page.locator('video').evaluate(v => v.controls = false);
  await controls(page).waitFor();
  await page.locator('video').evaluate(v => v.remove());
  await controls(page).waitFor({state:'hidden'});
  console.log('PASS runtime native-controls changes and removed-video cleanup');
  await open('frame');
  const frame = page.frames().find(f => f.url().includes('localhost:'));
  await frame.locator('#abomination-browsing-tools').waitFor({state:'attached'});
  await frame.locator('video').hover(); await controls(frame).waitFor();
  await frame.getByRole('slider',{name:'Seek video'}).click();
  assert.ok(await frame.locator('video').evaluate(v => v.currentTime > 15));
  await page.mouse.move(950,700);
  await frame.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
  assert.equal(await hidden(frame),true);
  console.log('PASS cross-origin frame seeking and immediate frame exit');
  await open('plain'); await page.locator('video').hover(); await controls(page).waitFor();
  await page.getByRole('button',{name:'Full screen',exact:true}).click();
  await page.waitForFunction(() => document.fullscreenElement === document.querySelector('video'));
  assert.equal(await page.locator('video').evaluate(v=>v.controls),true,'Fullscreen must expose Chrome native controls');
  await page.evaluate(() => document.exitFullscreen());
  await page.waitForFunction(() => !document.querySelector('video').controls);
  await page.locator('video').hover(); await controls(page).waitFor();
  console.log('PASS fullscreen entry and return');
  assert.deepEqual(errors,[]);
} finally {
  await context?.close(); await new Promise(r => server.close(r)); await rm(profile,{recursive:true,force:true});
}
