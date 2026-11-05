import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdtemp,readFile,rm,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
import {chromium} from 'playwright';
const root=resolve(import.meta.dirname,'..'), profile=await mkdtemp(join(tmpdir(),'vd-browsing-'));
const main=JSON.parse(await readFile(join(root,'extension-identity.json'),'utf8')).id;
const out=join(root,'.output/chrome-mv3');
execFileSync('ffmpeg',['-v','error','-f','lavfi','-i','testsrc2=size=640x360:rate=12','-t','35','-c:v','libx264','-pix_fmt','yuv420p','-movflags','+faststart',join(profile,'source.mp4')]);
const bytes=await readFile(join(profile,'source.mp4'));
let port, imageBytes; const imageHeaders=[];
const server=createServer((req,res)=>{
 if(req.url==='/ocr.png'&&imageBytes){imageHeaders.push({cookie:req.headers.cookie??'',referer:req.headers.referer??''});res.writeHead(200,{'Content-Type':'image/png','Cache-Control':'no-store'});res.end(imageBytes);return;}
 if(req.url==='/source.mp4'){
  const r=/^bytes=(\d+)-(\d*)$/.exec(req.headers.range||'');const start=r?Number(r[1]):0,end=r?.[2]?Math.min(Number(r[2]),bytes.length-1):bytes.length-1;
  res.writeHead(r?206:200,{'Content-Type':'video/mp4','Content-Length':end-start+1,'Accept-Ranges':'bytes',...(r?{'Content-Range':`bytes ${start}-${end}/${bytes.length}`}:{})});res.end(bytes.subarray(start,end+1));return;
 }
 let body='',script='';
 if(req.url==='/consent'){
  body='<div id="CybotCookiebotDialog" style="position:fixed;bottom:0;background:white;padding:30px">We use cookies <button id="accept">Accept all</button></div><input id="form" value="keep my work">';
  script=`window.choices={reject:0,accept:0};window.Cookiebot={hasResponse:false,dialog:{visible:true},declined:false,withdraw(){choices.reject++;this.hasResponse=true;this.declined=true},hide(){this.dialog.visible=false;document.querySelector('#CybotCookiebotDialog').hidden=true}};document.querySelector('#accept').onclick=()=>choices.accept++;`;
 } else if(req.url==='/cookieyes'||req.url==='/cookieyes-unsupported'){
  body=`<div class="cky-consent-container" role="dialog" style="position:fixed;bottom:0;background:white;padding:30px">We use cookies <button data-cky-tag="accept-button">Accept all</button>${req.url==='/cookieyes'?'<button data-cky-tag="reject-button">Reject all</button>':''}</div>`;
  script=`window.accepted=0;window.rejected=0;document.querySelector('[data-cky-tag=accept-button]').onclick=()=>accepted++;const reject=document.querySelector('[data-cky-tag=reject-button]');if(reject)reject.onclick=()=>{rejected++;document.cookie='cookieyes-consent=advertisement:no';document.querySelector('.cky-consent-container').hidden=true};`;
 } else if(req.url==='/quantcast'){
  body='<div id="qc-cmp2-container"><div id="qc-cmp2-ui" style="position:fixed;bottom:0;background:white;padding:30px">Cookie choices <button id="disagree-btn" disabled>Reject all</button><button id="accept">Accept all</button></div></div>';
  script=`window.accepted=0;window.rejected=0;document.querySelector('#accept').onclick=()=>accepted++;document.querySelector('#disagree-btn').onclick=()=>{rejected++;document.querySelector('#qc-cmp2-ui').hidden=true};setTimeout(()=>document.querySelector('#disagree-btn').disabled=false,1200);`;
 } else if(req.url==='/unknown'){
  body='<div id="unknown" role="dialog" style="position:fixed;bottom:0;padding:30px;background:white">We use cookies to personalize ads and analyze traffic. <button id="only-accept">Accept all</button></div>';
  script='window.accepted=0;document.querySelector("#only-accept").onclick=()=>window.accepted++;';
 } else if(req.url==='/player'||req.url==='/popups'){
  body=`<div class="video-player"><video controls muted preload="auto" src="/source.mp4" style="width:640px;height:360px"></video><button id="play-ad">Play</button></div><a id="legit" href="http://localhost:${port}/destination" target="_blank">Open information</a><button id="login">Sign in</button><input id="typing"><div id="click-area" style="height:60px;width:400px">Blank space</div>`;
  script=`window.loginOpener=false;document.querySelector('#play-ad').onclick=()=>window.open('http://localhost:${port}/ad');document.querySelector('#click-area').onclick=()=>window.open('http://localhost:${port}/ad');document.querySelector('#login').onclick=()=>{const child=window.open('about:blank','login','width=400,height=400');window.loginOpener=!!child;if(child)child.location='http://localhost:${port}/destination'};`;
 } else if(req.url==='/image'){
  body='<img id="text-image" alt="Fixture text" style="width:900px;height:220px">';
  script=`const c=document.createElement('canvas');c.width=900;c.height=220;const x=c.getContext('2d');x.fillStyle='white';x.fillRect(0,0,900,220);x.fillStyle='black';x.font='bold 54px sans-serif';x.fillText('COPY TEXT 12345',35,115);document.querySelector('img').src=c.toDataURL('image/png');`;
 }else if(req.url==='/remote-image')body=`<img id="text-image" src="http://localhost:${port}/ocr.png" style="width:900px;height:220px">`;
 else body='<h1>Destination</h1>';
 res.writeHead(200,{'Content-Type':'text/html'});res.end(`<!doctype html><html><head><title>Browsing tools fixture</title><style>body{font:18px sans-serif;margin:24px}button,a{margin:10px;padding:10px}video{display:block}</style></head><body>${body}<script>${script}</script></body></html>`);
});
await new Promise(r=>server.listen(0,'0.0.0.0',r));port=server.address().port;
let context;
try{
 context=await chromium.launchPersistentContext(profile,{channel:'chromium',headless:true,args:[`--disable-extensions-except=${out}`,`--load-extension=${out}`]});
 const worker=context.serviceWorkers()[0]??await context.waitForEvent('serviceworker');
 const errors=[];context.on('page',p=>{p.on('pageerror',e=>errors.push(e.message));p.on('console',m=>{if(m.type()==='error')console.log('PAGE',m.text())})});worker.on('console',m=>console.log('WORKER',m.text()));
 const page=await context.newPage();
 await page.goto(`http://127.0.0.1:${port}/consent`);
 await page.waitForFunction(()=>window.choices?.reject>=1&&document.querySelector('#CybotCookiebotDialog').hidden,{},{timeout:20000}).catch(async error=>{console.log('CONSENT DEBUG',await page.evaluate(()=>({choices:window.choices,guard:!!window.__abominationPopupGuard,tool:!!document.querySelector('#abomination-browsing-tools'),prehide:document.querySelector('#autoconsent-prehide')?.textContent,cookiebot:window.Cookiebot})),errors);throw error});
 assert.equal(await page.evaluate(()=>choices.accept),0);assert.equal(await page.locator('#form').inputValue(),'keep my work');
 console.log('PASS consent: actual opt-out, dialog dismissed, no opt-in, form preserved');
 for(const route of ['cookieyes','quantcast']){await page.goto(`http://127.0.0.1:${port}/${route}`);await page.waitForFunction(()=>window.rejected>=1,{},{timeout:20000});assert.equal(await page.evaluate(()=>accepted),0);}
 await page.goto(`http://127.0.0.1:${port}/cookieyes-unsupported`);await page.waitForTimeout(4500);assert.equal(await page.evaluate(()=>accepted),0);assert.ok(await page.locator('.cky-consent-container').isVisible());assert.notEqual(await page.locator('.cky-consent-container').evaluate(e=>getComputedStyle(e).opacity),'0');
 console.log('PASS cookie vendors: CookieYes rejection, delayed Quantcast rejection, cosmetic-only fallback refused');
 await page.goto(`http://127.0.0.1:${port}/unknown`);
 await page.waitForFunction(()=>!!document.querySelector('#abomination-browsing-tools'));
 await page.waitForTimeout(3500);
 assert.equal(await page.evaluate(()=>accepted),0);assert.ok(await page.locator('#unknown').isVisible());
 console.log('PASS unsupported consent: never clicks Accept all or falsely hides consent');
 await page.goto(`http://127.0.0.1:${port}/popups`);
 await page.waitForFunction(()=>!!window.__abominationPopupGuard?.enabled);
 const count=context.pages().length;await page.locator('#play-ad').click();
 await page.getByRole('button',{name:'Open blocked window once',exact:true}).waitFor();assert.equal(context.pages().length,count);
 const opened=context.waitForEvent('page');await page.getByRole('button',{name:'Open blocked window once',exact:true}).click();const ad=await opened;await ad.waitForURL(`http://localhost:${port}/ad`);await ad.close();
 await page.locator('#click-area').click();await page.getByRole('button',{name:'Allow popup windows on this site'}).click();
 await page.waitForFunction(()=>window.__abominationPopupGuard.allowed);
 const allowed=context.waitForEvent('page');await page.locator('#play-ad').click();await (await allowed).close();
 await worker.evaluate(()=>chrome.storage.local.set({browsing:{rejectCookies:true,hideNags:true,popupGuard:true,videoControls:true,pausedSites:[],popupSites:[]}}));
 await page.waitForFunction(()=>!window.__abominationPopupGuard.allowed);
 const legitimate=context.waitForEvent('page');await page.locator('#legit').click();await (await legitimate).close();
 const login=context.waitForEvent('page');await page.locator('#login').click();const loginPage=await login;await loginPage.waitForURL(`http://localhost:${port}/destination`);assert.equal(await page.evaluate(()=>loginOpener),true);await loginPage.close();
 await page.evaluate(()=>window.open('about:blank'));await page.getByRole('button',{name:'Open blocked window once',exact:true}).waitFor();assert.equal(await page.getByRole('button',{name:'Open blocked window once',exact:true}).isEnabled(),false);await page.getByRole('button',{name:'Dismiss blocked window notice'}).click();
 await page.evaluate(()=>{document.querySelector('#click-area').onclick=()=>window.open('/destination')});await page.locator('#click-area').click();await page.getByRole('button',{name:'Open blocked window once',exact:true}).waitFor();assert.equal(context.pages().length,count);await page.getByRole('button',{name:'Dismiss blocked window notice'}).click();
 console.log('PASS popup guard: block, Open once, site exception, explicit link/login, blank-window recovery and same-origin bounce');
 await page.goto(`http://127.0.0.1:${port}/player`);
 await page.locator('video').evaluate(v=>new Promise(r=>v.readyState>=4?r():v.addEventListener('canplaythrough',r,{once:true})));
 await page.waitForFunction(()=>!!document.querySelector('#abomination-browsing-tools'));
 await page.evaluate(()=>{const overlay=document.createElement('div');overlay.id='transparent-player-overlay';overlay.style='position:absolute;left:24px;top:24px;width:640px;height:360px;background:transparent';overlay.addEventListener('pointermove',e=>e.stopPropagation());document.body.append(overlay);});
 await page.mouse.move(300,200);await page.getByRole('button',{name:'Forward 10 seconds',exact:true}).waitFor();
 await page.evaluate(()=>document.querySelector('#transparent-player-overlay').remove());
 await page.locator('video').hover();await page.getByRole('button',{name:'Forward 10 seconds',exact:true}).click();
 assert.ok(await page.locator('video').evaluate(v=>v.currentTime>9.5));
 await page.getByRole('button',{name:'Increase playback speed',exact:true}).click();await page.getByRole('button',{name:'Increase playback speed',exact:true}).click();
 await page.waitForFunction(()=>document.querySelector('video').playbackRate===1.5);
 await page.reload();await page.waitForFunction(()=>document.querySelector('video').playbackRate===1.5);
 await page.locator('video').evaluate(v=>{v.disablePictureInPicture=true});
 await page.locator('video').hover();await page.getByRole('button',{name:'Pop out video',exact:true}).click();
 await page.waitForFunction(()=>document.pictureInPictureElement===document.querySelector('video'));
 await page.waitForTimeout(400);assert.equal(await page.evaluate(()=>!!document.pictureInPictureElement),true);
 await page.evaluate(()=>document.exitPictureInPicture());
 await page.waitForFunction(()=>document.querySelector('video').disablePictureInPicture===true);
 await page.locator('#typing').fill('Normal input');await page.locator('#typing').press('ArrowLeft');
 assert.equal(await page.locator('#typing').inputValue(),'Normal input');
 console.log('PASS controls: seek, remembered speed, actual native picture-in-picture and ordinary typing');
 await page.goto(`http://127.0.0.1:${port}/image`);await page.waitForFunction(()=>document.querySelector('img').complete&&document.querySelector('img').naturalWidth>0);
 imageBytes=Buffer.from(await page.locator('img').evaluate(i=>i.src.split(',')[1]),'base64');
 await page.locator('#text-image').click({button:'right'});
 const tool=await context.newPage();await tool.goto(`chrome-extension://${main}/popup.html`);
 const tabId=await worker.evaluate(async url=>(await chrome.tabs.query({})).find(t=>t.url===url)?.id,`http://127.0.0.1:${port}/image`);
 const result=await tool.evaluate(tabId=>chrome.runtime.sendMessage({type:'ocr-open',tabId}),tabId);assert.equal(result.ok,true,JSON.stringify(result));
 const ocr=await new Promise((resolve,reject)=>{const current=context.pages().find(p=>p.url().startsWith(`chrome-extension://${main}/ocr.html`));if(current)return resolve(current);const timeout=setTimeout(()=>reject(new Error('OCR tab missing')),10000);context.on('page',p=>{p.waitForURL(`chrome-extension://${main}/ocr.html*`).then(()=>{clearTimeout(timeout);resolve(p)},()=>{})})});
 const remote=[];ocr.on('request',r=>{if(/^https?:/.test(r.url()))remote.push(r.url())});
 await ocr.waitForFunction(()=>document.querySelector('#ocr-text').value.includes('COPY TEXT 12345'),{},{timeout:30000}).catch(async error=>{console.log('OCR DEBUG',await ocr.locator('body').innerText(),await ocr.locator('#ocr-text').inputValue(),errors);throw error});
 assert.deepEqual(remote,[]);await ocr.getByRole('button',{name:'Copy text',exact:true}).click();
 await mkdir(join(root,'output'),{recursive:true});await ocr.screenshot({path:join(root,'output/browsing-ocr.png'),fullPage:true});
 console.log('PASS OCR: selected inline image → local WASM recognition, exact fixture text, zero network requests');
 const giant=Buffer.from(imageBytes);giant.writeUInt32BE(100000,16);giant.writeUInt32BE(100000,20);
 await ocr.locator('#image-file').setInputFiles({name:'oversized.png',mimeType:'image/png',buffer:giant});await ocr.getByText('This image is too large. Crop it or choose a smaller image.').waitFor();
 await ocr.locator('#image-file').setInputFiles({name:'active.svg',mimeType:'image/png',buffer:Buffer.from('<svg><script>alert(1)</script></svg>')});await ocr.getByText('Choose a valid PNG, JPEG, WebP, GIF or BMP image.').waitFor();
 console.log('PASS OCR rejects giant dimensions and disguised active markup before decoding');
 await ocr.close();await tool.close();
 await context.addCookies([{name:'private_image_session',value:'DO_NOT_SEND_TO_OCR',url:`http://localhost:${port}/`}]);
 await page.goto(`http://127.0.0.1:${port}/remote-image`);await page.waitForFunction(()=>document.querySelector('img').complete&&document.querySelector('img').naturalWidth>0);await page.locator('img').click({button:'right'});
 const remoteTool=await context.newPage();await remoteTool.goto(`chrome-extension://${main}/popup.html`);
 const remoteOpened=context.waitForEvent('page');const remoteResult=await remoteTool.evaluate(tabId=>chrome.runtime.sendMessage({type:'ocr-open',tabId}),tabId);assert.equal(remoteResult.ok,true,JSON.stringify(remoteResult));
 const remoteOCR=await remoteOpened;await remoteOCR.waitForURL(`chrome-extension://${main}/ocr.html*`);await remoteOCR.waitForFunction(()=>document.querySelector('#ocr-text').value.includes('COPY TEXT 12345'),{},{timeout:30000});
 assert.ok(imageHeaders.length>=2);assert.deepEqual(imageHeaders.at(-1),{cookie:'',referer:''});await remoteOCR.close();await remoteTool.close();
 console.log('PASS cross-origin OCR fallback sends neither image-host cookies nor page referrer');
 const settings=await context.newPage();await settings.goto(`chrome-extension://${main}/options.html`);
 await settings.locator('#popup-guard').uncheck();await page.waitForFunction(()=>window.__abominationPopupGuard.enabled===false);
 await settings.evaluate(()=>Promise.all([chrome.runtime.sendMessage({type:'browsing-settings',settings:{rejectCookies:false}}),chrome.runtime.sendMessage({type:'browsing-settings',settings:{videoControls:false}})]));
 const preferences=await settings.evaluate(async()=>(await chrome.runtime.sendMessage({type:'browsing-status'})).result.settings);assert.equal(preferences.rejectCookies,false);assert.equal(preferences.videoControls,false);assert.equal(preferences.popupGuard,false);
 await settings.close();
 assert.deepEqual(errors,[]);console.log('PASS live settings and no page errors');
}finally{await context?.close();await new Promise(r=>server.close(r));await rm(profile,{recursive:true,force:true});}
