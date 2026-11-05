import assert from 'node:assert/strict';
import { mkdtemp, cp, readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright';
import { startFixtures } from '../tests/fixtures/screenshot-server.mjs';
const root = resolve(import.meta.dirname, '..'), id = JSON.parse(await readFile(join(root, 'extension-identity.json'))).id;
const temporary = await mkdtemp(join(tmpdir(), 'unified-tools-')), extension = join(temporary, 'extension');
await cp(join(root, '.output/chrome-mv3'), extension, { recursive: true });
// Observe real registered handlers in this disposable build only. Never shipped.
await writeFile(join(extension, 'integration/test-hooks.js'), `globalThis.menuHandlers=[];
const add=chrome.contextMenus.onClicked.addListener.bind(chrome.contextMenus.onClicked);
chrome.contextMenus.onClicked.addListener=fn=>{menuHandlers.push(fn);add(fn)};
`);
await writeFile(join(extension, 'background.js'), "import './integration/test-hooks.js';\n" + await readFile(join(extension, 'background.js'), 'utf8'));
const fixtures = await startFixtures();
const context = await chromium.launchPersistentContext(join(temporary, 'profile'), {
  channel: 'chromium', headless: true, viewport: null,
  args: [`--load-extension=${extension}`, `--disable-extensions-except=${extension}`, '--enable-unsafe-extension-debugging', '--window-size=1000,787'],
  env: { ...process.env, VIDEO_DOWNLOADER_HOME: temporary },
});
const output = join(root, 'output/playwright'); await mkdir(output, { recursive: true });
try {
  const ui = await context.newPage(); await ui.goto(`chrome-extension://${id}/options.html`);
  const worker = context.serviceWorkers().find(w => new URL(w.url()).hostname === id);
  const rpc = data => ui.evaluate(data => chrome.runtime.sendMessage(data), data);
  assert.equal(context.serviceWorkers().length, 1);
  assert.equal((await rpc({type:'adblock-status'})).result.level, 3);
  assert.equal((await rpc({type:'screenshot-companion-status'})).result.installed, true);
  const manifest = await worker.evaluate(() => chrome.runtime.getManifest());
  assert.equal(manifest.externally_connectable, undefined);
  for (const menu of ['download-video','download-audio','save-original-image','save-screenshot','copy-clean-link']) {
    await worker.evaluate(id => chrome.contextMenus.update(id, {enabled:true}), menu);
  }
  assert.equal(await worker.evaluate(() => menuHandlers.length), 1);
  console.log('PASS one extension, one menu owner, full protection and every command registered');
  // Acquiring two offscreen uses concurrently must queue, and cleanup must not
  // close the other task's document. The real compiler is exercised separately.
  assert.deepEqual(await worker.evaluate(async () => {
    const seen=[];
    const a=await vdServices.acquireOffscreen('clipboard.html',['CLIPBOARD'],'Test clipboard lease');
    const b=vdServices.acquireOffscreen('clipboard.html',['CLIPBOARD'],'Test queued lease').then(close=>{seen.push('second');return close});
    await new Promise(r=>setTimeout(r,100)); seen.push('first'); await a(); await (await b)();
    return {seen,remaining:(await chrome.runtime.getContexts({contextTypes:['OFFSCREEN_DOCUMENT']})).length};
  }), {seen:['first','second'],remaining:0});
  console.log('PASS offscreen tasks serialize and clean up without closing each other');
  const source = await context.newPage(); await source.goto(fixtures.origin + '/?height=3100'); await source.bringToFront();
  const tabId = await worker.evaluate(async url => (await chrome.tabs.query({})).find(t => t.url === url).id, source.url());
  const cdp = await context.browser().newBrowserCDPSession();
  // Genuine toolbar gesture grants activeTab in the disposable test profile.
  const targets = await cdp.send('Target.getTargets', {filter:[{type:'tab'},{exclude:true}]});
  await cdp.send('Extensions.triggerAction', {id,targetId:targets.targetInfos.find(t=>t.url===source.url()).targetId});
  // This extension has an action popup. Dismiss it through normal tab focus
  // before invoking the capture handler; the real capture button closes it.
  await ui.bringToFront(); await source.bringToFront();
  let opened = context.waitForEvent('page');
  await worker.evaluate(async tabId => { void vdServices.capture(await chrome.tabs.get(tabId)); }, tabId);
  let preview = await opened; await preview.waitForURL(`chrome-extension://${id}/screenshot/preview.html*`);
  await preview.waitForFunction(() => /captured|stopped/i.test(document.querySelector('h1')?.textContent ?? ''));
  assert.equal(await preview.locator('h1').textContent(), 'Your page, captured', await preview.locator('body').innerText());
  assert.equal(await worker.evaluate(()=>vdServices.captureBusy()), false);
  const saved = preview.waitForEvent('download'); await preview.locator('#save').click();
  const png = join(output,'unified-screenshot.png'); await (await saved).saveAs(png);
  const bytes = await readFile(png); assert.deepEqual([bytes.readUInt32BE(16),bytes.readUInt32BE(20)],[1000,3100]);
  assert.equal(await source.evaluate(()=>scrollY),0);
  assert.equal(await preview.evaluate(async()=>{try{return (await chrome.runtime.sendMessage({type:'jobs'})) == null}catch{return true}}),true);
  assert.equal(await preview.evaluate(async url=>{try{await fetch(url);return false}catch{return true}},fixtures.origin+'/leak'),true);
  await preview.close();
  console.log('PASS full-page PNG dimensions, restored scroll, private preview, no preview-to-helper messages');
  await source.bringToFront(); opened = context.waitForEvent('page');
  await worker.evaluate(async tabId => { const tab=await chrome.tabs.get(tabId); for(const fn of menuHandlers)fn({menuItemId:'save-screenshot'},tab); },tabId);
  preview = await opened; const automatic = await preview.waitForEvent('download');
  await automatic.saveAs(join(output,'unified-screenshot-menu.png'));
  await preview.waitForEvent('close',{timeout:45000});
  assert.equal(await worker.evaluate(async()=> (await chrome.tabs.query({active:true,lastFocusedWindow:true}))[0].id),tabId);
  console.log('PASS unified context menu saves screenshot and closes temporary preview');
  await source.goto(fixtures.origin+'/?height=12000');await source.bringToFront();
  opened=context.waitForEvent('page');await worker.evaluate(async tabId=>{void vdServices.capture(await chrome.tabs.get(tabId))},tabId);preview=await opened;
  await preview.waitForFunction(()=>document.querySelector('progress')?.value>0);
  await source.goto(fixtures.origin+'/?height=1200');
  await preview.waitForFunction(()=>document.querySelector('h1')?.textContent?.includes('stopped'));
  assert.equal(await worker.evaluate(()=>vdServices.captureBusy()),false);
  console.log('PASS navigation cancels capture safely without stitching another page');
} catch (error) {
  console.error('Capture test state', JSON.stringify(await Promise.all(context.pages().map(async page => ({url:page.url(),body:await page.locator('body').innerText().catch(()=> 'closed')})))));
  throw error;
} finally {await context.close();await new Promise(r=>fixtures.server.close(r));await rm(temporary,{recursive:true,force:true});}
