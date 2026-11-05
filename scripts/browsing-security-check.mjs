import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,mkdir,rm} from 'node:fs/promises';
import {join,resolve} from 'node:path';import {tmpdir} from 'node:os';import {createServer} from 'node:http';import {chromium} from 'playwright';
const root=resolve(import.meta.dirname,'..'),temp=await mkdtemp(join(tmpdir(),'vd-security-')),attacker=join(temp,'attacker');
const main=JSON.parse(await readFile(join(root,'extension-identity.json'),'utf8')).id;
const full=JSON.parse(await readFile(join(root,'companion/protection/identity.json'),'utf8')).id;
await mkdir(attacker);await writeFile(join(attacker,'manifest.json'),JSON.stringify({manifest_version:3,name:'Untrusted test sender',version:'1.0',permissions:['nativeMessaging'],background:{service_worker:'attacker.js'}}));await writeFile(join(attacker,'attacker.js'),'chrome.runtime.onInstalled.addListener(()=>{});');
// A deliberately inert registered host makes Chrome's origin rejection
// distinguishable from a missing-host error, without touching real installs.
await mkdir(join(temp,'profile/NativeMessagingHosts'),{recursive:true});
await writeFile(join(temp,'profile/NativeMessagingHosts/com.video_downloader.helper.json'),JSON.stringify({name:'com.video_downloader.helper',description:'Boundary fixture',path:'/usr/bin/false',type:'stdio',allowed_origins:[`chrome-extension://${main}/`]}));
const server=createServer((req,res)=>{res.writeHead(200,{'Content-Type':'text/html'});res.end('<!doctype html><title>Hostile page boundary fixture</title><h1 id="page">Ordinary page</h1><input id="secret" value="PRIVATE_FIXTURE_NOT_FOR_STORAGE">')});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const address=`http://127.0.0.1:${server.address().port}/`;
let context;
try{
 const paths=[join(root,'.output/chrome-mv3'),join(root,'.output/chrome-mv3/protection-companion'),attacker].join(',');
 context=await chromium.launchPersistentContext(join(temp,'profile'),{channel:'chromium',headless:true,args:[`--load-extension=${paths}`,`--disable-extensions-except=${paths}`]});
 const page=await context.newPage();await page.goto(address);await page.waitForFunction(()=>!!window.__abominationPopupGuard?.enabled);
 const workers=context.serviceWorkers(),worker=workers.find(w=>w.url()===`chrome-extension://${main}/background.js`),stranger=workers.find(w=>w.url().endsWith('/attacker.js'));
 assert.ok(worker&&stranger);
 const denied=await stranger.evaluate(async({main,full})=>{
  const values=[];for(const [id,data]of[[main,{type:'jobs'}],[main,{type:'browsing-status'}],[main,{type:'ocr-image',id:crypto.randomUUID()}],[full,{type:'protection-enabled',enabled:false}]]){
   try{values.push(await chrome.runtime.sendMessage(id,data)??null)}catch{values.push(null)}
  }return values;
 },{main,full});assert.deepEqual(denied,[null,null,null,null]);
 console.log('PASS unrelated extension cannot read jobs/settings/images or change protection');
 const native=await stranger.evaluate(()=>new Promise(resolve=>chrome.runtime.sendNativeMessage('com.video_downloader.helper',{id:'unauthorized',type:'ping'},result=>resolve({result:result??null,error:chrome.runtime.lastError?.message??''}))));
 assert.equal(native.result,null);assert.match(native.error,/forbidden|access/i);
 console.log('PASS Chrome rejects unrelated extension access to a registered main-only native host');
 const tabId=await worker.evaluate(async url=>(await chrome.tabs.query({})).find(t=>t.url===url).id,address);
 const commands=[{type:'jobs'},{type:'ping'},{type:'check-updates'},{type:'find',tabId},{type:'copy-link',url:'https://example.com/'},{type:'save-image',tabId},{type:'browsing-settings',settings:{rejectCookies:false,hideNags:false,popupGuard:false,videoControls:false,pausedSites:[],popupSites:[]}},{type:'browsing-status'},{type:'ocr-open',tabId},{type:'ocr-image',id:crypto.randomUUID()},{type:'browsing-consent-eval',snippetId:'EVAL_COOKIEBOT_1',code:'fetch("https://evil.test")'}];
 const replies=await worker.evaluate(async({tabId,commands})=>(await chrome.scripting.executeScript({target:{tabId},world:'ISOLATED',func:async commands=>{const results=[];for(const command of commands){try{results.push(await chrome.runtime.sendMessage(command)??null)}catch{results.push(null)}}return results},args:[commands]}))[0].result,{tabId,commands});
 assert.ok(replies.every(x=>x===null||x?.ok===false),JSON.stringify(replies));
 const prototype=await worker.evaluate(async tabId=>(await chrome.scripting.executeScript({target:{tabId},world:'ISOLATED',func:()=>chrome.runtime.sendMessage({type:'browsing-consent-eval',snippetId:'__proto__'})}))[0].result,tabId);assert.equal(prototype.result,false);
 console.log('PASS content scripts cannot invoke privileged UI/helper/OCR commands or arbitrary evaluation');
 const count=context.pages().length;
 await page.evaluate(()=>{
  for(let i=0;i<300;i++)window.postMessage({type:'browsing-settings',settings:{popupGuard:false},type2:'start',url:'file:///etc/passwd'},'*');
  for(const url of ['javascript:alert(1)','file:///etc/passwd','data:text/html,<script>alert(1)</script>','https://user:password@example.com/'])window.postMessage({channel:'abomination-window-blocked',url},'*');
 });
 await page.waitForTimeout(250);assert.equal(context.pages().length,count);assert.equal(await page.getByRole('button',{name:'Open blocked window once',exact:true}).isVisible(),false);
 await page.evaluate(()=>window.postMessage({channel:'abomination-window-blocked',url:'https://example.com/'},'*'));
 await page.getByRole('button',{name:'Open blocked window once',exact:true}).waitFor();
 await page.getByRole('button',{name:'Open blocked window once',exact:true}).evaluate(b=>b.click());
 await page.getByRole('button',{name:'Allow popup windows on this site'}).evaluate(b=>b.click());
 await page.waitForTimeout(250);assert.equal(context.pages().length,count);assert.equal(await page.evaluate(()=>window.__abominationPopupGuard.allowed),false);
 console.log('PASS forged page messages, unsafe links and synthetic clicks cannot open windows or grant exceptions');
 const storage=await worker.evaluate(async()=>({local:await chrome.storage.local.get(null),session:await chrome.storage.session.get(null)}));
 assert.ok(!JSON.stringify(storage).includes('PRIVATE_FIXTURE_NOT_FOR_STORAGE'));
 assert.equal(await page.locator('#secret').inputValue(),'PRIVATE_FIXTURE_NOT_FOR_STORAGE');
 for(const file of ['ocr.html','background.js','ocr/eng.traineddata.gz']){
  const readable=await page.evaluate(url=>fetch(url).then(r=>r.ok,()=>false),`chrome-extension://${main}/${file}`);assert.equal(readable,false);
 }
 console.log('PASS page input is not collected; extension pages/code/OCR resources are not web-accessible');
 for(let i=0;i<4;i++){await page.reload();await page.waitForFunction(()=>!!window.__abominationPopupGuard?.enabled);assert.equal(await page.locator('#abomination-browsing-tools').count(),1)}
 console.log('PASS repeated navigation creates one controller and preserves normal fields');
}finally{await context?.close();await new Promise(r=>server.close(r));await rm(temp,{recursive:true,force:true});}
