// Exercise production DNR/scriptlets with actual HTTPS requests (route mocks bypass DNR).
import assert from 'node:assert/strict';
import {mkdtemp,cp,readFile,writeFile,rm,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';import {join,resolve} from 'node:path';
import {chromium} from 'playwright';import {createServer} from 'node:https';import {execFileSync} from 'node:child_process';
const root=resolve(import.meta.dirname,'..'),main=JSON.parse(await readFile(join(root,'extension-identity.json'))).id,full=main;
const temp=await mkdtemp(join(tmpdir(),'full-protection-')),extension=join(temp,'extension');let context;
await cp(join(root,'.output/chrome-mv3'),extension,{recursive:true});
const manifest=JSON.parse(await readFile(join(extension,'manifest.json')));
execFileSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-keyout',join(temp,'key'),'--out',join(temp,'cert'),'-subj','/CN=reader.example','-days','1'],{stdio:'ignore'});
// The fixture uses a harmless generated clip. No third-party video is captured.
execFileSync('ffmpeg',['-v','error','-f','lavfi','-i','color=c=green:s=160x90:d=8:r=15','-c:v','libx264','-pix_fmt','yuv420p','-movflags','+faststart',join(temp,'clip.mp4')]);
const clip=await readFile(join(temp,'clip.mp4'));
let sdkHits=0;
const server=createServer({key:await readFile(join(temp,'key')),cert:await readFile(join(temp,'cert'))},(req,res)=>{
 res.setHeader('Access-Control-Allow-Origin','*');
 if(req.url.startsWith('/clip.mp4')){res.setHeader('Content-Type','video/mp4');res.end(clip);return;}
 if(req.url.includes('ima3.js')){sdkHits++;res.setHeader('Content-Type','text/javascript');res.end('window.originalAdSDK=true;');return;}
 if(req.url.endsWith('.js')){res.setHeader('Content-Type','text/javascript');res.end('window.adLoaded=true;');return;}
 if(req.url.startsWith('/compat')){res.setHeader('Content-Type','text/html; charset=utf-8');res.end(`<!doctype html><title>Listing hover fixture</title><style>#listing{width:300px;height:120px}#selection{user-select:none}#map-price{padding:16px}.expanded{font-size:24px}</style><article id="listing">Hover this listing</article><div id="map-price">$600k</div><p id="selection">Page-controlled selection</p><div id="AC_ad">Page content</div><aside id="SubscribePopUpBox">Page widget</aside><video controls muted src="/clip.mp4"></video><div id="CybotCookiebotDialog"><button id="CybotCookiebotDialogBodyButtonDecline">Reject optional</button></div>${req.url==='/compat'?`<iframe src="https://maps.example:${port}/compat-frame"></iframe>`:''}<script>window.rejected=0;document.querySelector('#CybotCookiebotDialogBodyButtonDecline').onclick=()=>{window.rejected++;document.querySelector('#CybotCookiebotDialog').hidden=true};window.addEventListener('contextmenu',e=>e.preventDefault(),true);document.querySelector('#listing').addEventListener('mouseenter',()=>{const price=document.querySelector('#map-price');price.textContent='$600,000 · 3 beds';price.classList.add('expanded')});</script>`);return;}
 res.setHeader('Content-Type','text/html; charset=utf-8');res.end('<!doctype html><title>Playback fixture</title><div id="AC_ad">Advertisement</div><p id="content">Ordinary content</p><aside id="SubscribePopUpBox">Join our newsletter</aside><video id="video" controls muted src="/clip.mp4"></video><input value="Editable text"><div id="ad-slot"></div>');
});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const port=server.address().port;
const url=(host,path)=>`https://${host}${host==='imasdk.googleapis.com'?'':':'+port}${path}`;
const paths=extension;
const args=[`--load-extension=${paths}`,`--disable-extensions-except=${paths}`,'--no-proxy-server','--autoplay-policy=no-user-gesture-required',`--host-resolver-rules=MAP reader.example 127.0.0.1, MAP paused.example 127.0.0.1, MAP ad.doubleclick.net 127.0.0.1, MAP imasdk.googleapis.com 127.0.0.1:${port}, MAP 10play.com.au 127.0.0.1, MAP zillow.com 127.0.0.1, MAP www.zillow.com 127.0.0.1, MAP loopnet.com 127.0.0.1, MAP www.loopnet.com 127.0.0.1, MAP maps.example 127.0.0.1`];
const pass=text=>console.log('PASS',text);
async function launch(){context=await chromium.launchPersistentContext(join(temp,'profile'),{channel:'chromium',headless:true,ignoreHTTPSErrors:true,args});const ui=await context.newPage();await ui.goto(`chrome-extension://${main}/options.html`);const worker=context.serviceWorkers().find(w=>w.url()===`chrome-extension://${main}/background.js`);const protector=worker;const request=async data=>{const reply=await ui.evaluate(data=>chrome.runtime.sendMessage(data),data);assert.equal(reply.ok,true,JSON.stringify(reply));return reply.result;};return{ui,worker,protector,request};}
try{
 let {ui,worker,protector,request}=await launch();
 let state=await request({type:'adblock-status'});assert.equal(state.engine,'complete');assert.equal(state.level,3);assert.equal((await protector.evaluate(()=>chrome.storage.local.get('rulesetConfig'))).rulesetConfig.version,state.engineVersion);assert.equal(state.active,true);assert.ok(state.networkRules>15000);assert.ok(state.cosmeticRules>25000);
 assert.equal(context.serviceWorkers().length,1);
 assert.ok((await protector.evaluate(()=>chrome.scripting.getRegisteredContentScripts())).some(s=>s.world==='MAIN'));
 pass('One extension starts Complete protection with real MAIN-world scriptlets');
 const external=data=>worker.evaluate(({full,data})=>globalThis.vdServices.protection(data).then(value=>value??null).catch(()=>null),{full,data});
 const nagIds=['annoyances-overlays','annoyances-notifications','annoyances-widgets'];
 await assertEventually(async()=>{const enabled=await protector.evaluate(()=>chrome.declarativeNetRequest.getEnabledRulesets());for(const id of nagIds)assert.ok(enabled.includes(id));assert.ok(!enabled.includes('annoyances-cookies'),'Cookie-hiding list must not replace actual rejection')});
 pass('Browsing nags preset enables overlay, notification and widget lists without hiding consent dialogs');
 // Recreate the first-handoff state to verify existing site exclusions transfer once.
 await protector.evaluate(()=>chrome.storage.local.remove('vdMigrated'));
 await external({type:'protection-migrate',pausedSites:['paused.example']});
 await external({type:'protection-migrate',pausedSites:['reader.example']});
 assert.equal((await request({type:'adblock-status',host:'paused.example'})).paused,true);
 assert.equal((await request({type:'adblock-status',host:'reader.example'})).paused,false);
 pass('Existing site exclusions migrate once without overwriting later preferences');
 const page=await context.newPage();await page.goto(url('reader.example','/article'));
 const fetched=()=>page.evaluate(url=>fetch(url).then(r=>r.text()).then(body=>body.includes('window.adLoaded=true'),()=>false),url('ad.doubleclick.net','/ad.js'));
 await page.waitForFunction(()=>getComputedStyle(document.querySelector('#AC_ad')).display==='none');assert.equal(await fetched(),false);
 await page.getByRole('textbox').fill('Selection and input still work');await page.getByRole('textbox').selectText();assert.equal(await page.getByRole('textbox').inputValue(),'Selection and input still work');
 await page.locator('video').evaluate(async v=>{await v.play();v.currentTime=4;});await page.waitForFunction(()=>document.querySelector('video').currentTime>4.2);assert.equal(await page.locator('#content').isVisible(),true);
 await page.waitForFunction(()=>getComputedStyle(document.querySelector('#SubscribePopUpBox')).display==='none');
 const before=await protector.evaluate(()=>chrome.declarativeNetRequest.getEnabledRulesets());
 const browsing=(await request({type:'browsing-status'})).settings;
 await request({type:'browsing-settings',settings:{...browsing,hideNags:false}});
 await assertEventually(async()=>assert.deepEqual((await protector.evaluate(()=>chrome.declarativeNetRequest.getEnabledRulesets())).sort(),before.filter(id=>!nagIds.includes(id)).sort()));
 await page.reload();assert.equal(await page.locator('#SubscribePopUpBox').isVisible(),true);assert.equal(await fetched(),false);
 await request({type:'browsing-settings',settings:browsing});
 await assertEventually(async()=>assert.deepEqual((await protector.evaluate(()=>chrome.declarativeNetRequest.getEnabledRulesets())).sort(),before.sort()));
 await page.reload();await page.waitForFunction(()=>getComputedStyle(document.querySelector('#SubscribePopUpBox')).display==='none');
 pass('Nags hide and restore independently while advertising protection remains enabled');
 pass('Real ad requests and ad cosmetics are blocked while playback, seeking and text input work');
 await page.goto(url('10play.com.au','/player'));
 const started=Date.now();
 await page.evaluate(src=>new Promise((resolve,reject)=>{const s=document.createElement('script');s.src=src;s.onload=resolve;s.onerror=()=>reject(new Error('SDK request failed'));document.head.append(s)}),url('imasdk.googleapis.com','/js/sdkloader/ima3.js'));
 assert.equal(sdkHits,0,'Ad SDK reached the origin instead of the packaged replacement');
 const result=await page.evaluate(()=>new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('Player stuck waiting for ad completion')),3000);const ima=window.google.ima,video=document.querySelector('video'),loader=new ima.AdsLoader(new ima.AdDisplayContainer(document.querySelector('#ad-slot'),video));loader.addEventListener(ima.AdsManagerLoadedEvent.Type.ADS_MANAGER_LOADED,event=>{const manager=event.getAdsManager(video);manager.addEventListener(ima.AdEvent.Type.CONTENT_RESUME_REQUESTED,()=>{clearTimeout(timer);video.play().then(()=>resolve({resumed:true,original:!!window.originalAdSDK}))});manager.init(160,90,ima.ViewMode.NORMAL);manager.start()});loader.requestAds(new ima.AdsRequest())}));
 assert.equal(result.resumed,true);assert.equal(result.original,false);assert.ok(Date.now()-started<4000);await page.waitForFunction(()=>document.querySelector('video').currentTime>0.2);
 pass('Production IMA redirect supplies the player’s ad-completion/resume events and starts content without an ad wait');
 await request({type:'adblock-site',host:'reader.example',paused:true});await page.goto(url('reader.example','/article'));assert.equal(await fetched(),true);assert.equal(await page.locator('#AC_ad').isVisible(),true);
 await request({type:'adblock-set',enabled:false});await request({type:'adblock-set',enabled:false});assert.equal((await request({type:'adblock-status'})).active,false);await page.goto(url('10play.com.au','/article'));assert.equal(await fetched(),true);
 await request({type:'adblock-set',enabled:true});await request({type:'adblock-set',enabled:true});assert.equal((await request({type:'adblock-status',host:'reader.example'})).paused,true);assert.equal((await request({type:'adblock-status',host:'paused.example'})).paused,true);
 await request({type:'adblock-site',host:'reader.example',paused:false});await page.reload();await page.waitForFunction(()=>getComputedStyle(document.querySelector('#AC_ad')).display==='none');assert.equal(await fetched(),false);
 pass('Global off/on and site pause/resume preserve exclusions and restore native requests after reload');
 for(const host of ['zillow.com','www.zillow.com','loopnet.com','www.loopnet.com']){
  assert.equal((await request({type:'adblock-status',host})).paused,true);
  await page.goto(url(host,'/compat'));await page.locator('iframe').waitFor();
  const tabId=await worker.evaluate(async href=>(await chrome.tabs.query({})).find(tab=>tab.url===href).id,page.url());
  assert.equal((await request({type:'browsing-status',tabId})).policy.enabled,false);
  assert.equal(await fetched(),true);assert.equal(await page.locator('#AC_ad').isVisible(),true);assert.equal(await page.locator('#SubscribePopUpBox').isVisible(),true);
  await page.locator('#listing').hover();assert.equal(await page.locator('#map-price').textContent(),'$600,000 · 3 beds');
  for(const frame of [page.mainFrame(),...page.frames().filter(f=>f!==page.mainFrame())]){
   await frame.locator('#selection').waitFor();
   assert.deepEqual(await frame.evaluate(()=>({guard:!!window.__abominationPopupGuard,controls:!!document.querySelector('#abomination-browsing-tools'),selection:getComputedStyle(document.querySelector('#selection')).userSelect,rejected:window.rejected,menu:!document.querySelector('#listing').dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true}))})),{guard:false,controls:false,selection:'none',rejected:0,menu:true});
  }
  const settings=await ui.evaluate(()=>chrome.storage.local.get('settings'));
  await ui.evaluate(value=>chrome.storage.local.set({settings:{...value,restoreMenus:true,restoreCopy:true}}),settings.settings??{});
  await request({type:'browsing-settings',settings:{videoControls:true,popupGuard:true,rejectCookies:true}});
  assert.equal(await page.locator('#selection').evaluate(e=>getComputedStyle(e).userSelect),'none');
 }
 await external({type:'protection-site',host:'www.zillow.com',paused:false});assert.equal((await request({type:'adblock-status',host:'www.zillow.com'})).paused,true);
 await request({type:'adblock-set',enabled:false});await request({type:'adblock-set',enabled:true});
 for(const host of ['www.zillow.com','www.loopnet.com'])assert.equal((await request({type:'adblock-status',host})).paused,true);
 pass('Zillow/LoopNet whitelist: native requests, visible content, listing-to-map hover, page menus/selection and untouched embedded frames; persists through settings and protection toggles');

 assert.equal((await ui.evaluate(full=>chrome.runtime.sendMessage(full,{type:'protection-enabled',enabled:false}),full)).ok,false);
 for(const data of [{type:'protection-enabled',enabled:false,url:'https://evil.test'},{type:'protection-site',host:'example.com/path',paused:true},{type:'protection-migrate',pausedSites:Array(201).fill('a.test')},{type:'download',url:'https://example.com'}])assert.equal(await external(data),null);
 assert.equal((await request({type:'adblock-status'})).active,true);
 pass('Non-background and malformed control messages cannot change protection or invoke downloads');
 await mkdir(join(root,'output/playwright'),{recursive:true});await ui.reload();await ui.locator('#protection-engine').filter({hasText:'Built-in full protection'}).waitFor();await ui.screenshot({path:join(root,'output/playwright/full-protection-settings.png'),fullPage:true});
 const dashboard=await context.newPage();await dashboard.goto(`chrome-extension://${full}/dashboard.html`);await dashboard.locator('.vd-brand').waitFor();assert.equal(await dashboard.evaluate(async()=>{const {i18n}=await import(chrome.runtime.getURL('js/i18n.js'));const fragment=i18n.patchUnicodeFlags('🇨🇦');const img=fragment.querySelector('img');document.body.append(fragment);await img.decode();const valid=img.naturalWidth>0;img.remove();return valid}),true);await dashboard.screenshot({path:join(root,'output/playwright/full-protection-dashboard.png'),fullPage:true});
 await Promise.all([
  dashboard.evaluate(()=>chrome.runtime.sendMessage({what:'setSandboxFilters',text:'||custom-ad.example^'})),
  request({type:'copy-link',url:'https://example.com/?utm_source=compile-test'})
 ]);
 assert.ok((await worker.evaluate(()=>chrome.declarativeNetRequest.getDynamicRules())).some(rule=>JSON.stringify(rule).includes('custom-ad.example')));
 assert.equal((await worker.evaluate(()=>chrome.runtime.getContexts({contextTypes:['OFFSCREEN_DOCUMENT']}))).length,0);
 await dashboard.evaluate(()=>chrome.runtime.sendMessage({what:'setSandboxFilters',text:''}));
 pass('Real custom-filter compilation and clipboard copying share one offscreen slot without races');
 await dashboard.close();
 await context.close();({ui,worker,protector,request}=await launch());assert.equal((await request({type:'adblock-status'})).level,3);assert.equal((await request({type:'adblock-status',host:'paused.example'})).paused,true);
 for(const host of ['www.zillow.com','www.loopnet.com'])assert.equal((await request({type:'adblock-status',host})).paused,true);
 pass('Complete mode and site exceptions survive a real Chrome restart');
}finally{await context?.close();await new Promise(resolve=>server.close(resolve));await rm(temp,{recursive:true,force:true});}
async function assertEventually(fn){let error;for(let i=0;i<100;i++){try{await fn();return}catch(e){error=e;await new Promise(r=>setTimeout(r,100));}}throw error;}
