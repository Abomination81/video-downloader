import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdir,mkdtemp,readFile,writeFile,cp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
import {chromium} from 'playwright';
const root=resolve(import.meta.dirname,'..');
execFileSync('uv',['run','--project','helper','--extra','dev','python','scripts/create-fixtures.py'],{cwd:root,stdio:'pipe'});
const app=await mkdtemp(join(tmpdir(),'video-downloader-companion-'));
const extension=join(app,'extension'),profile=join(app,'profile'),downloads=join(app,'Downloads');
await cp(join(root,'.output/chrome-mv3'),extension,{recursive:true});
await writeFile(join(extension,'integration/test-hooks.js'),"globalThis.menuHandlers=[];const add=chrome.contextMenus.onClicked.addListener.bind(chrome.contextMenus.onClicked);chrome.contextMenus.onClicked.addListener=fn=>{menuHandlers.push(fn);add(fn)};");
await writeFile(join(extension,'background.js'),"import './integration/test-hooks.js';\n"+await readFile(join(extension,'background.js'),'utf8'));

const main=JSON.parse(await readFile(join(root,'extension-identity.json'))),audio=JSON.parse(await readFile(join(root,'companion/audio/identity.json')));
const child=join(extension,'audio-companion');
const youtube=JSON.parse(await readFile(join(root,'companion/youtube/identity.json'))),youtubePath=join(extension,'youtube-companion');
const binaries=Object.fromEntries(['ffmpeg','ffprobe','deno','exiftool'].map(name=>[name,execFileSync('which',[name],{encoding:'utf8'}).trim()]));
await mkdir(downloads);await mkdir(join(profile,'NativeMessagingHosts'),{recursive:true});await mkdir(join(profile,'Default'));
await writeFile(join(profile,'Default/Preferences'),JSON.stringify({download:{default_directory:downloads,prompt_for_download:false}}));
await writeFile(join(app,'config.json'),JSON.stringify({binaries,download_dir:downloads}));
const host=join(app,'native-host');
await writeFile(host,`#!/bin/sh\nexec '${join(root,'helper/.venv/bin/python').replaceAll("'","'\\''")}' -m video_downloader.native "$@"\n`,{mode:0o700});
await writeFile(join(profile,'NativeMessagingHosts/com.video_downloader.helper.json'),JSON.stringify({name:'com.video_downloader.helper',description:'Isolated companion test',path:host,type:'stdio',allowed_origins:[`chrome-extension://${main.id}/`]}));
const source=join(root,'output/fixtures/source.mp4'),audioFile=join(app,'source.m4a');
execFileSync(binaries.ffmpeg,['-v','error','-y','-i',source,'-map','0:a:0','-c','copy','-metadata','title=PRIVATE_AUDIO_TITLE',audioFile]);
let base;
const server=createServer(async(req,res)=>{
 if(req.url==='/video'||req.url==='/audio'||req.url==='/link'){
  res.writeHead(200,{'Content-Type':'text/html','Set-Cookie':'audio_session=ok; SameSite=Lax; Path=/'});
  res.end(`<title>Companion source</title>${req.url==='/video'?'<video src="/source.mp4" width="320" height="180" controls muted></video>':req.url==='/audio'?'<audio src="/source.m4a" controls></audio>':'<a id="link" href="https://example.com/watch?utm_source=fixture&t=12#clip">Clean link fixture</a>'}`);return;
 }
 if((req.url==='/source.m4a'&&(!req.headers.cookie?.includes('audio_session=ok')||req.headers.referer!==base+'/audio'))||(req.url==='/source.mp4'&&req.headers.referer!==base+'/video')){res.writeHead(403);res.end();return;}
 try{const data=await readFile(req.url==='/source.mp4'?source:audioFile);res.writeHead(200,{'Content-Type':req.url==='/source.mp4'?'video/mp4':'audio/mp4','Content-Length':data.length});res.end(data);}catch{res.writeHead(404);res.end();}
});await new Promise(r=>server.listen(0,'127.0.0.1',r));base=`http://127.0.0.1:${server.address().port}`;
const hostile=join(app,'untrusted');await mkdir(hostile);await writeFile(join(hostile,'manifest.json'),JSON.stringify({manifest_version:3,name:'Untrusted test caller',version:'1.0',background:{service_worker:'background.js'}}));await writeFile(join(hostile,'background.js'),'chrome.runtime.onInstalled.addListener(()=>{});');
const context=await chromium.launchPersistentContext(profile,{channel:'chromium',headless:true,args:[`--load-extension=${extension},${hostile}`,`--disable-extensions-except=${extension},${hostile}`],env:{...process.env,VIDEO_DOWNLOADER_HOME:app}});
try{
 const get=async id=>context.serviceWorkers().find(w=>new URL(w.url()).hostname===id)??await context.waitForEvent('serviceworker',{predicate:w=>new URL(w.url()).hostname===id});
 let primary=await get(main.id);
 const cdp=await context.browser().newBrowserCDPSession();await cdp.send('Browser.setDownloadBehavior',{behavior:'default'});
 const ui=await context.newPage();await ui.goto(`chrome-extension://${main.id}/options.html`);
 const rpc=message=>ui.evaluate(data=>chrome.runtime.sendMessage(data),message);
 assert.equal((await rpc({type:'ping'})).result.ready,true);
 const attacker=context.serviceWorkers().find(w=>![main.id].includes(new URL(w.url()).hostname))??await context.waitForEvent('serviceworker',{predicate:w=>![main.id].includes(new URL(w.url()).hostname)});
 assert.equal(await attacker.evaluate(async id=>{try{return (await chrome.runtime.sendMessage(id,{type:'jobs'})) == null}catch{return true}},main.id),true);
 const wait=async id=>{for(let i=0;i<180;i++){const response=await rpc({type:'jobs'});const job=response.result.jobs.find(j=>j.id===id);if(['done','error','save_error','interrupted','cancelled'].includes(job?.state)){assert.equal(job.state,'done',JSON.stringify(job));return job;}await new Promise(r=>setTimeout(r,500));}throw new Error('Companion download timed out');};
 const check=async job=>{const items=await primary.evaluate(filename=>chrome.downloads.search({query:[filename]}),job.filename);assert.equal(items.length,1);assert.equal(items[0].state,'complete');assert.equal(items[0].byExtensionId,main.id);const info=JSON.parse(execFileSync(binaries.ffprobe,['-v','error','-show_streams','-show_format','-of','json',items[0].filename],{encoding:'utf8'}));assert.equal(info.streams.length,1);assert.equal(info.streams[0].codec_name,'mp3');assert.ok(!info.format.tags&&!info.streams[0].tags);assert.ok(!(await readFile(items[0].filename)).includes(Buffer.from('PRIVATE_')));};
 const seen=new Set();
 for(const scenario of ['video','audio','navigate']){
  const media=scenario==='navigate'?'video':scenario;
  const page=await context.newPage();await page.goto(base+'/'+media);await page.locator(media).evaluate(m=>new Promise(r=>m.readyState?r():m.addEventListener('loadedmetadata',r,{once:true})));
  const tabId=await primary.evaluate(async url=>(await chrome.tabs.query({})).find(t=>t.url===url).id,page.url());
  await page.locator(media).click({button:'right'});await page.keyboard.press('Escape');
  const info={menuItemId:'download-audio',editable:false,frameId:0,pageUrl:page.url(),mediaType:media,srcUrl:base+(media==='audio'?'/source.m4a':'/source.mp4')};
  await primary.evaluate(async ({tabId,info})=>{for(const fn of menuHandlers) fn(info,await chrome.tabs.get(tabId))},{tabId,info});
  if(scenario==='navigate')await page.goto(base+'/link');else await page.close();
  let job;
  for(let i=0;i<60;i++){const result=await rpc({type:'jobs'});job=result.result.jobs.find(j=>!seen.has(j.id));if(job)break;await new Promise(r=>setTimeout(r,100));}
  assert.ok(job,'Audio menu did not create a job');seen.add(job.id);
  await check(await wait(job.id));if(scenario==='navigate')await page.close();
 }
 console.log('PASS unified audio menu: blocked foreign callers, video and authenticated native audio, closed source tabs, clean MP3s and one Chrome entry each');
 const link=await context.newPage();await link.goto(base+'/link');const linkTab=await primary.evaluate(async url=>(await chrome.tabs.query({})).find(t=>t.url===url).id,link.url());await link.locator('#link').click({button:'right'});await link.keyboard.press('Escape');
 assert.equal((await rpc({type:'copy-context-link',tabId:linkTab})).ok,true);
 await context.grantPermissions(['clipboard-read'],{origin:base});assert.equal(await link.evaluate(async()=>await navigator.clipboard.readText()==='https://example.com/watch?t=12#clip'),true);
 console.log('PASS toolbar clean-link action uses the last right-clicked link');
 await ui.close();await link.close();
}finally{await context.close();server.closeAllConnections();await new Promise(r=>server.close(r));await rm(app,{recursive:true,force:true});}
