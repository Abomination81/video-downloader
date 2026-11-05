import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,writeFile,cp,rm} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {execFileSync} from 'node:child_process';
import {chromium} from 'playwright';

const root=resolve(import.meta.dirname,'..');
const temporary=await mkdtemp(join(tmpdir(),'pluto-adapter-'));
const id=JSON.parse(await readFile(join(root,'extension-identity.json'),'utf8')).id;
let context;
try{
  const periods=[];
  for(const [name,color] of [['content-a','green'],['creative_ad','red'],['content-b','blue']]){
    const directory=join(temporary,name);await mkdir(directory);
    execFileSync('ffmpeg',['-v','error','-f','lavfi','-i',`color=c=${color}:size=320x180:rate=24`,'-f','lavfi','-i','sine=frequency=440:sample_rate=48000','-t','2','-c:v','libx264','-pix_fmt','yuv420p','-g','24','-c:a','aac','-b:a','96k','-f','dash','-seg_duration','1','-use_template','1','-use_timeline','1',join(directory,'stream.mpd')]);
    const mpd=await readFile(join(directory,'stream.mpd'),'utf8');
    const inside=/<Period[^>]*>([\s\S]*?)<\/Period>/.exec(mpd)[1];
    const index=periods.length;
    periods.push(`<Period id="${name}" start="PT${index*2}S" duration="PT2S"><BaseURL>https://fixture.plutotv.net/${name}/</BaseURL>${inside}</Period>`);
  }
  const mpd=`<?xml version="1.0"?><MPD xmlns="urn:mpeg:dash:schema:mpd:2011" type="static" mediaPresentationDuration="PT6S" minBufferTime="PT0.5S" profiles="urn:mpeg:dash:profile:isoff-on-demand:2011">${periods.join('')}</MPD>`;
  const cases={dynamic:mpd.replace('type="static"','type="dynamic"'),malformed:'<MPD><Period>',allAds:mpd.replace(periods[0],'').replace(periods[2],''),noAds:mpd.replace(periods[1],''),doctype:'<!DOCTYPE MPD [<!ENTITY x "test">]>'+mpd,protected:mpd.replace(/(<AdaptationSet[^>]*>)/,'$1<ContentProtection schemeIdUri="urn:uuid:fixture" value="keep"/>')};
  const extension=join(temporary,'extension');await cp(join(root,'.output/chrome-mv3'),extension,{recursive:true});
  const path=join(extension,'manifest.json'),manifest=JSON.parse(await readFile(path,'utf8'));
  manifest.optional_permissions=[];manifest.permissions.push('declarativeNetRequestWithHostAccess');await writeFile(path,JSON.stringify(manifest));
  context=await chromium.launchPersistentContext(join(temporary,'profile'),{channel:'chromium',headless:true,args:[`--load-extension=${extension}`,`--disable-extensions-except=${extension}`,'--autoplay-policy=no-user-gesture-required']});
  const errors=[];context.on('page',page=>page.on('pageerror',error=>errors.push(error.message)));
  const session={adBreaks:[{startingOffset:1,adBreakDuration:2,ads:[1],startTime:2,keep:3}],adBreak:[1],adBreakLocations:[2],streams:[{url:'keep',drm:'untouched'}]};
  await context.route('https://**/*',async route=>{
    const url=new URL(route.request().url());
    const headers={'access-control-allow-origin':'*'};
    if(url.pathname==='/fixture')return route.fulfill({contentType:'text/html',body:'<!doctype html><title>Pluto adapter playback</title><video controls muted></video><script src="/player.js"></script>'});
    if(url.pathname==='/player.js')return route.fulfill({contentType:'text/javascript',body:await readFile(join(root,'node_modules/shaka-player/dist/shaka-player.compiled.js'))});
    if(url.pathname.endsWith('/session.json'))return route.fulfill({headers,contentType:'application/json',body:JSON.stringify(session)});
    if(url.pathname.endsWith('.mpd'))return route.fulfill({headers,contentType:'application/dash+xml',body:cases[url.searchParams.get('case')]??mpd});
    const match=/^\/(content-a|creative_ad|content-b)\/([^/]+\.m4s)$/.exec(url.pathname);
    if(match)return route.fulfill({headers,contentType:'video/mp4',body:await readFile(join(temporary,match[1],match[2]))});
    return route.fulfill({headers,body:'unrelated response'});
  });
  const worker=context.serviceWorkers().find(w=>new URL(w.url()).hostname===id)??await context.waitForEvent('serviceworker',{predicate:w=>new URL(w.url()).hostname===id});
  const ui=await context.newPage();await ui.goto(`chrome-extension://${id}/options.html`);
  const status=await ui.evaluate(()=>chrome.runtime.sendMessage({type:'adblock-status'}));assert.equal(status.result.active,true,JSON.stringify(status));
  const page=await context.newPage();await page.goto('https://pluto.tv/fixture');
  const outcomes=await page.evaluate(async()=>{
    const source='https://service-stitcher.clusters.pluto.tv/v2/stitch/session.json';
    const results=[];
    results.push(await(await fetch(source)).json());
    results.push(JSON.parse(await(await fetch(source)).text()));
    results.push(JSON.parse(new TextDecoder().decode(await(await fetch(source)).arrayBuffer())));
    for(const type of ['', 'json','arraybuffer'])results.push(await new Promise((resolve,reject)=>{
      const xhr=new XMLHttpRequest();xhr.open('GET',source);xhr.responseType=type;xhr.onload=()=>resolve(type==='json'?xhr.response:JSON.parse(type==='arraybuffer'?new TextDecoder().decode(xhr.response):xhr.responseText));xhr.onerror=reject;xhr.send();
    }));
    const xhr=await new Promise(resolve=>{const x=new XMLHttpRequest();x.open('GET','https://fixture.plutotv.net/episode/fixture/master.mpd');x.responseType='document';x.onload=()=>resolve(new XMLSerializer().serializeToString(x.responseXML));x.send()});
    const manifest=await(await fetch('https://fixture.plutotv.net/episode/fixture/master.mpd')).text();
    const live=await(await fetch('https://fixture.plutotv.net/channel/fixture/master.mpd')).text();
    const outside=await(await fetch('https://example.com/session.json')).json();
    // Native Response behavior, including body consumption, must be retained.
    const response=await fetch(source),clone=response.clone();await response.text();let consumed=false;try{await response.json()}catch{consumed=true}
    return {results,xhr,manifest,live,outside,consumed,clone:await clone.json()};
  });
  const expected={adBreaks:[{keep:3}],streams:[{url:'keep',drm:'untouched'}]};
  for(const result of [...outcomes.results,outcomes.clone])assert.deepEqual(result,expected);
  assert.deepEqual(outcomes.outside,session);assert.equal(outcomes.consumed,true);
  for(const text of [outcomes.manifest,outcomes.xhr]){assert.ok(!text.includes('creative_ad'));assert.ok(text.includes('content-a')&&text.includes('content-b'));assert.ok(!text.includes('mediaPresentationDuration'));assert.ok(!text.includes('start="'));}
  assert.equal(outcomes.live,mpd);
  console.log('PASS Pluto fetch and XHR text/JSON/buffer/XML paths remove known on-demand ads; live and unrelated responses and native body semantics remain intact');
  const defensive=await page.evaluate(async names=>{
    const entries=await Promise.all(names.map(async name=>[name,await(await fetch('https://fixture.plutotv.net/episode/fixture/master.mpd?case='+name)).text()]));
    return Object.fromEntries(entries);
  },Object.keys(cases));
  for(const name of ['dynamic','malformed','allAds','noAds','doctype'])assert.equal(defensive[name],cases[name]);
  assert.ok(defensive.protected.includes('schemeIdUri="urn:uuid:fixture" value="keep"'));
  assert.ok(!defensive.protected.includes('creative_ad'));
  console.log('PASS Unknown, malformed, dynamic and all-ad manifests fail open; content protection descriptors survive ad-period removal');

  await page.evaluate(async()=>{
    shaka.polyfill.installAll();const video=document.querySelector('video');const player=window.player=new shaka.Player();await player.attach(video);player.configure({streaming:{bufferingGoal:1,rebufferingGoal:0.1}});window.playbackErrors=[];player.addEventListener('error',event=>window.playbackErrors.push(event.detail.code));await player.load('https://fixture.plutotv.net/episode/fixture/master.mpd');
    window.colors=[];video.addEventListener('timeupdate',()=>{if(video.readyState<2)return;const canvas=document.createElement('canvas');canvas.width=1;canvas.height=1;const ctx=canvas.getContext('2d');ctx.drawImage(video,0,0,1,1);colors.push({time:video.currentTime,rgb:[...ctx.getImageData(0,0,1,1).data].slice(0,3)})});await video.play();
  });
  await page.waitForFunction(()=>document.querySelector('video').ended,{timeout:20000});
  const playback=await page.evaluate(()=>{const video=document.querySelector('video');return {duration:video.duration,frames:video.getVideoPlaybackQuality().totalVideoFrames,audio:video.webkitAudioDecodedByteCount,colors,errors:playbackErrors}});
  assert.ok(Math.abs(playback.duration-4)<0.12,JSON.stringify(playback));
  assert.ok(playback.frames>60);assert.ok(playback.audio>1000);
  assert.ok(playback.colors.some(value=>value.rgb[1]>80&&value.rgb[0]<30));
  assert.ok(playback.colors.some(value=>value.rgb[2]>150&&value.rgb[0]<30));
  assert.ok(!playback.colors.some(value=>value.rgb[0]>150),'A red advertisement frame was played');
  assert.deepEqual(playback.errors,[]);
  await page.evaluate(()=>{document.querySelector('video').currentTime=3});
  await page.waitForFunction(()=>document.querySelector('video').readyState>=2&&Math.abs(document.querySelector('video').currentTime-3)<0.1);
  console.log('PASS Actual Shaka DASH playback decodes audio and both content periods, skips ad frames, recomputes the timeline and remains seekable');
  await writeFile(join(root,'output/pluto-playback-check.json'),JSON.stringify(playback,null,2));

  assert.deepEqual(errors,[]);
}finally{await context?.close();await rm(temporary,{recursive:true,force:true});}
