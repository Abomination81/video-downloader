import assert from 'node:assert/strict';
import {mkdtemp,cp,readFile,writeFile,rm,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {chromium} from 'playwright';
import {createServer} from 'node:https';
import {execFileSync} from 'node:child_process';
import {compileAdFilters} from './lib/compile-ad-filters.mjs';

const root=resolve(import.meta.dirname,'..');
const id=JSON.parse(await readFile(join(root,'extension-identity.json'),'utf8')).id;
const temporary=await mkdtemp(join(tmpdir(),'website-adblock-'));
const production=join(root,'.output/chrome-mv3');
const permission='declarativeNetRequestWithHostAccess';
const html=`<!doctype html><title>Ad filtering fixture</title><div id="AC_ad">Advertisement</div><p id="content">Ordinary page content</p><video controls></video>`;
const sessions=[];
const key=join(temporary,'key.pem'),cert=join(temporary,'cert.pem');
execFileSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-keyout',key,'-out',cert,'-subj','/CN=reader.example','-days','1'],{stdio:'ignore'});
const server=createServer({key:await readFile(key),cert:await readFile(cert)},(req,res)=>{
  const navigation=!req.url.includes('.js')&&!req.url.includes('.m4s');
  res.writeHead(200,{'Content-Type':navigation?'text/html':'text/javascript','Access-Control-Allow-Origin':'*','Content-Security-Policy':"style-src 'none'; script-src 'unsafe-inline' *"});
  res.end(navigation?html:'window.fixtureLoaded=true;');
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const port=server.address().port;
const url=(host,path)=>`https://${host}:${port}${path}`;
const pass=name=>console.log('PASS',name);
async function launch(extension,label){
  const context=await chromium.launchPersistentContext(join(temporary,label),{channel:'chromium',headless:true,ignoreHTTPSErrors:true,args:[`--load-extension=${extension}`,`--disable-extensions-except=${extension}`,'--no-first-run','--no-proxy-server','--host-resolver-rules=MAP reader.example 127.0.0.1, MAP ad.doubleclick.net 127.0.0.1, MAP media.example 127.0.0.1, MAP sponsor.fixture 127.0.0.1, MAP www.youtube.com 127.0.0.1']});
  sessions.push(context);
  const worker=context.serviceWorkers().find(w=>new URL(w.url()).hostname===id)??await context.waitForEvent('serviceworker',{predicate:w=>new URL(w.url()).hostname===id,timeout:15000});
  const ui=await context.newPage();await ui.goto(`chrome-extension://${id}/options.html`);
  const request=async data=>{
    const reply=await ui.evaluate(data=>chrome.runtime.sendMessage(data),data);
    assert.equal(reply.ok,true,JSON.stringify(reply));return reply.result;
  };
  return {context,worker,ui,request};
}
try{
  const original=await launch(production,'optional');
  const status=await original.request({type:'adblock-status'});
  assert.equal(status.permission,false);assert.equal(status.active,false);
  assert.equal(await original.worker.evaluate(()=>typeof chrome.declarativeNetRequest),'undefined');
  assert.deepEqual(await original.worker.evaluate(()=>chrome.scripting.getRegisteredContentScripts()),[]);
  const before=await original.context.newPage();await before.goto(url('reader.example','/article'));
  const fetched=(page,host,path)=>page.evaluate(url=>fetch(url).then(()=>true,()=>false),url(host,path));
  assert.equal(await fetched(before,'ad.doubleclick.net','/ad.js'),true);
  assert.equal(await before.locator('#AC_ad').isVisible(),true);
  await original.ui.locator('#adblock-toggle').filter({hasText:'Enable ad blocking'}).waitFor();
  pass('Production extension starts without a permission grant; downloads UI remains available and filtering stays off');
  await original.context.close();sessions.splice(sessions.indexOf(original.context),1);

  // A separate disposable extension copy represents the permission already
  // granted. The production manifest keeps this permission optional.
  const granted=join(temporary,'granted-extension');await cp(production,granted,{recursive:true});
  const manifestPath=join(granted,'manifest.json');const manifest=JSON.parse(await readFile(manifestPath,'utf8'));
  manifest.optional_permissions=manifest.optional_permissions.filter(value=>value!==permission);manifest.permissions.push(permission);
  await writeFile(manifestPath,JSON.stringify(manifest));
  const {context,worker,ui,request}=await launch(granted,'granted');
  const active=await request({type:'adblock-status'});
  if(!active.active)console.log('Chrome activation diagnostic',await worker.evaluate(async()=>{try{const rules=await(await fetch(chrome.runtime.getURL('adblock/rules.json'))).json();await chrome.declarativeNetRequest.updateDynamicRules({removeRuleIds:(await chrome.declarativeNetRequest.getDynamicRules()).map(rule=>rule.id),addRules:rules});return 'Native rules accepted; inspect script registration';}catch(error){return String(error)}}));
  assert.equal(active.active,true,JSON.stringify(active));assert.equal(active.error,null);
  const rules=await worker.evaluate(()=>chrome.declarativeNetRequest.getDynamicRules());
  assert.equal(rules.length,active.networkRules);assert.ok(rules.length>3000);
  assert.ok((await worker.evaluate(()=>chrome.scripting.getRegisteredContentScripts())).some(script=>script.world==='MAIN'&&script.matches.includes('https://pluto.tv/*')));
  pass('Chrome accepts every compiled production rule and registers the narrow Pluto adapter');

  const page=await context.newPage();await page.goto(url('reader.example','/article'));
  await page.waitForFunction(()=>getComputedStyle(document.querySelector('#AC_ad')).display==='none');
  assert.equal(await fetched(page,'ad.doubleclick.net','/ad.js'),false);
  assert.equal(await fetched(page,'media.example','/content.m4s'),true);
  assert.equal(await page.locator('#content').isVisible(),true);
  pass('Real ad requests are blocked and generic ad elements hidden under restrictive CSP; normal media requests stay available');

  const fixture=compileAdFilters('||sponsor.fixture^$script,third-party,domain=reader.example\n@@||sponsor.fixture^*allowed.js$script,domain=reader.example').rules.map(rule=>({...rule,id:rule.id+50000}));
  await worker.evaluate(rules=>chrome.declarativeNetRequest.updateDynamicRules({addRules:rules}),fixture);
  const loadScript=url=>page.evaluate(url=>new Promise(resolve=>{const script=document.createElement('script');script.src=url;script.onload=()=>resolve(true);script.onerror=()=>resolve(false);document.head.append(script)}),url);
  assert.equal(await loadScript(url('sponsor.fixture','/blocked.js')),false);
  assert.equal(await loadScript(url('sponsor.fixture','/allowed.js')),true);
  assert.equal(await fetched(page,'sponsor.fixture','/blocked.js'),true,'script-only filter broadened to XHR');
  await worker.evaluate(ids=>chrome.declarativeNetRequest.updateDynamicRules({removeRuleIds:ids}),fixture.map(rule=>rule.id));
  pass('Native Chrome matching honors compiler exceptions, resource types and initiator restrictions');

  await request({type:'adblock-site',host:'reader.example',paused:true});
  await page.waitForFunction(()=>getComputedStyle(document.querySelector('#AC_ad')).display!=='none');
  assert.equal(await fetched(page,'ad.doubleclick.net','/ad.js'),true);
  await page.reload();
  assert.equal((await request({type:'adblock-status',host:'reader.example'})).paused,true);
  assert.equal(await fetched(page,'ad.doubleclick.net','/ad.js'),true);
  await request({type:'adblock-site',host:'reader.example',paused:false});
  // An allowAllRequests decision lasts for the loaded document; controls ask
  // for an explicit reload when resuming, rather than changing the page secretly.
  await page.reload();
  await page.waitForFunction(()=>getComputedStyle(document.querySelector('#AC_ad')).display==='none');
  assert.equal(await fetched(page,'ad.doubleclick.net','/ad.js'),false);
  pass('Site pause restores requests and cosmetics, survives navigation, and resumes after the requested reload');

  const tab=await worker.evaluate(async url=>(await chrome.tabs.query({})).find(tab=>tab.url===url).id,page.url());
  const rejected=await worker.evaluate(async tab=>(await chrome.scripting.executeScript({target:{tabId:tab},func:async()=>chrome.runtime.sendMessage({type:'adblock-set',enabled:false})}))[0].result,tab);
  assert.ok(rejected==null);
  assert.equal((await request({type:'adblock-status'})).active,true);
  await ui.locator('#adblock-toggle').filter({hasText:'Turn off ad blocking'}).click();
  await ui.locator('#adblock-toggle').filter({hasText:'Turn on ad blocking'}).waitFor();
  assert.equal((await worker.evaluate(()=>chrome.declarativeNetRequest.getDynamicRules())).length,0);
  assert.equal((await worker.evaluate(()=>chrome.scripting.getRegisteredContentScripts())).length,0);
  await page.waitForFunction(()=>getComputedStyle(document.querySelector('#AC_ad')).display!=='none');
  assert.equal(await fetched(page,'ad.doubleclick.net','/ad.js'),true);
  pass('Page content cannot change settings; the actual global-off UI removes filters, styles and future Pluto injections');

  await ui.locator('#adblock-toggle').click();
  await ui.locator('#adblock-toggle').filter({hasText:'Turn off ad blocking'}).waitFor();
  await page.goto(url('www.youtube.com','/watch?v=fixture'));
  assert.equal(await page.locator('#AC_ad').isVisible(),true);
  assert.equal(await fetched(page,'ad.doubleclick.net','/ad.js'),true);
  pass('General rules and cosmetics leave the separate YouTube companion in control');
  await request({type:'adblock-site',host:'pluto.tv',paused:true});
  assert.equal((await worker.evaluate(()=>chrome.scripting.getRegisteredContentScripts())).length,0);
  await mkdir(join(root,'output/playwright'),{recursive:true});
  await ui.screenshot({path:join(root,'output/playwright/adblock-settings.png'),fullPage:true});
  const popup=await context.newPage();await popup.setViewportSize({width:380,height:600});await popup.goto(`chrome-extension://${id}/popup.html`);
  await popup.locator('#adblock-toggle').filter({hasText:'On'}).waitFor();
  await popup.screenshot({path:join(root,'output/playwright/adblock-popup.png'),fullPage:true});
  await page.goto(url('reader.example','/article'));
  await worker.evaluate(tab=>chrome.tabs.update(tab,{active:true}),tab);
  await popup.reload();
  await popup.locator('#adblock-pause').filter({hasText:'Pause here'}).click();
  await popup.locator('#adblock-detail').filter({hasText:'Paused on this site'}).waitFor();
  assert.equal((await request({type:'adblock-status',host:'reader.example'})).paused,true);
  await popup.locator('#adblock-pause').filter({hasText:'Resume here'}).click();
  await popup.locator('#adblock-pause').filter({hasText:'Pause here'}).waitFor();
  await Promise.all([page.waitForEvent('domcontentloaded'),popup.locator('#adblock-reload').click()]);
  await page.waitForFunction(()=>getComputedStyle(document.querySelector('#AC_ad')).display==='none');
  pass('Actual toolbar pause/resume and reload controls affect the selected website');
  const pendingDialog=page.waitForEvent('dialog');
  await page.evaluate(()=>{setTimeout(()=>alert('Held filtering fixture'),0)});
  const dialog=await pendingDialog;
  let dialogDeadline;
  try{
    const disabled=await Promise.race([request({type:'adblock-set',enabled:false}),new Promise((_,reject)=>{dialogDeadline=setTimeout(()=>reject(new Error('A held page dialog blocked the filtering controls')),8000)})]);
    assert.equal(disabled.active,false);
  }finally{clearTimeout(dialogDeadline);await dialog.dismiss();}
  await request({type:'adblock-set',enabled:true});
  await page.waitForFunction(()=>getComputedStyle(document.querySelector('#AC_ad')).display==='none');
  pass('A held website JavaScript dialog cannot indefinitely block the filtering controls');
  await context.close();sessions.splice(sessions.indexOf(context),1);
  const restarted=await chromium.launchPersistentContext(join(temporary,'granted'),{channel:'chromium',headless:true,args:[`--load-extension=${granted}`,`--disable-extensions-except=${granted}`]});sessions.push(restarted);
  const reui=await restarted.newPage();await reui.goto(`chrome-extension://${id}/options.html`);
  const persisted=await reui.evaluate(()=>chrome.runtime.sendMessage({type:'adblock-status',host:'pluto.tv'}));
  assert.equal(persisted.result.active,true);assert.equal(persisted.result.paused,true);
  pass('Filter activation and per-site preferences survive a real browser restart');
  await restarted.close();sessions.splice(sessions.indexOf(restarted),1);
  await writeFile(join(granted,'adblock/manifest.json'),'{broken');
  const damaged=await launch(granted,'granted');
  const failure=await damaged.request({type:'adblock-status'});
  assert.equal(failure.enabled,true);assert.equal(failure.active,false);assert.ok(failure.error);
  await damaged.ui.locator('#adblock-toggle').filter({hasText:'Turn off ad blocking'}).click();
  await damaged.ui.locator('#adblock-toggle').filter({hasText:'Turn on ad blocking'}).waitFor();
  assert.equal((await damaged.worker.evaluate(()=>chrome.declarativeNetRequest.getDynamicRules())).length,0);
  assert.equal((await damaged.request({type:'adblock-status'})).error,null);
  pass('The real Off control clears previously installed filters even when packaged filter data is damaged');
}finally{
  await Promise.allSettled(sessions.map(context=>context.close()));
  await new Promise(resolve=>server.close(resolve));
  await rm(temporary,{recursive:true,force:true});
}
