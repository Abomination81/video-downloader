// Public-site compatibility sampling. Uses a disposable browser profile, never
// personal cookies. Records technical state, not media, response bodies or tokens.
import {chromium} from 'playwright';import {mkdtemp,readFile,writeFile,mkdir,rm} from 'node:fs/promises';import {join,resolve} from 'node:path';import {tmpdir} from 'node:os';
const root=resolve(import.meta.dirname,'..'),profile=await mkdtemp(join(tmpdir(),'vd-live-audit-'));
const extension=join(root,'.output/chrome-mv3'),full=join(extension,'protection-companion');
const mainId=JSON.parse(await readFile(join(root,'extension-identity.json'))).id;
const tests=[
 ['YouTube','https://www.youtube.com/watch?v=aqz-KE-bpKQ'],
 ['Vimeo','https://vimeo.com/76979871'],
 ['Dailymotion','https://www.dailymotion.com/us'],
 ['Twitch','https://www.twitch.tv/nasa'],
 ['Pluto','https://pluto.tv/us/shows/2140689/episode/5f0cab6169b09e000748375b/'],
 ['Tubi','https://tubitv.com/'],
 ['Reddit','https://www.reddit.com/r/gridfinity/comments/1xl68js/lots_of_improvements_to_gridfinity_layout_tools/'],
 ['Miruro','https://www.miruro.tv/watch/199588/gals-cant-be-kind-to-otaku?ep=1'],
 ['B98','https://www.b98.tv/video/greek-ow/'],
 ['Putlocker','https://putlockerfree2.com/movie/the-dark-knight-2008-Z155V/play/#video-player'],
 ['WatchLuna','https://watchluna.com/movies/watch-hope-online-free-1058424'],
 ['CNN','https://www.cnn.com/videos'],
 ['AccuWeather','https://www.accuweather.com/en/videos'],
];
const selected=process.env.AUDIT_SITES?.split(',');const results=[];let context;
const origin=value=>{try{return new URL(value).origin}catch{return ''}};
async function mediaState(page){const out=[];for(const frame of page.frames().slice(0,30)){try{out.push({host:new URL(frame.url()).hostname,...await frame.evaluate(()=>({videos:[...document.querySelectorAll('video')].slice(0,10).map(v=>({time:v.currentTime,duration:Number.isFinite(v.duration)?v.duration:null,ready:v.readyState,paused:v.paused,width:v.videoWidth,height:v.videoHeight,error:v.error?.code??null,protected:!!v.mediaKeys,seekable:Array.from({length:v.seekable.length},(_,i)=>[v.seekable.start(i),v.seekable.end(i)])})),tools:document.querySelectorAll('#abomination-browsing-tools').length,notices:document.querySelector('#abomination-browsing-tools')?.shadowRoot?.querySelector('.notice:not([hidden])')?.textContent?.slice(0,200)??null}))});}catch{}}return out;}
try{
 context=await chromium.launchPersistentContext(profile,{channel:'chromium',headless:process.env.HEADED!=='1',acceptDownloads:false,args:[`--load-extension=${extension},${full}`,`--disable-extensions-except=${extension},${full}`]});
 await mkdir(join(root,'output/live-audit'),{recursive:true});
 const worker=context.serviceWorkers().find(w=>w.url()===`chrome-extension://${mainId}/background.js`)??await context.waitForEvent('serviceworker');
 for(const [name,url] of tests){if(selected&&!selected.includes(name))continue;
  const page=await context.newPage();const report={name,url,at:new Date().toISOString(),navigation:null,errors:[],popups:[],blockedRequests:0,actions:[]};
  page.on('popup',popup=>{report.popups.push(origin(popup.url()));void popup.close().catch(()=>{})});page.on('pageerror',error=>{if(report.errors.length<15)report.errors.push(error.message.slice(0,220))});page.on('requestfailed',request=>{if(/ERR_BLOCKED_BY_CLIENT/.test(request.failure()?.errorText??''))report.blockedRequests++});
  try{
   const response=await page.goto(url,{waitUntil:'domcontentloaded',timeout:20000});report.navigation=response?.status()??null;
   await page.waitForTimeout(4000);report.title=await page.title();report.finalOrigin=origin(page.url());
   const body=(await page.locator('body').innerText({timeout:2000}).catch(()=>''));
   report.gate=/verify you are human|prove your humanity|performing security|just a moment|access denied|blocked by network security|captcha/i.test(body+' '+report.title)||page.frames().some(f=>f.url().startsWith('https://challenges.cloudflare.com/'));
   if(!report.gate){
    if(name==='Dailymotion'){const link=page.locator('a[href*="/video/"]').first();if(await link.count()){const href=await link.getAttribute('href');await page.goto(new URL(href,page.url()).href,{waitUntil:'domcontentloaded',timeout:15000});report.actions.push('Opened a listed video');await page.waitForTimeout(3000)}}
    for(const frame of page.frames().slice(0,15)){
     try{const play=frame.getByRole('button',{name:/^(Play|Play Video|Start watching|Watch now)$/i}).first();if(await play.count()&&await play.isVisible()){await play.click({timeout:2500});report.actions.push('Clicked visible play control');break}}catch{}
    }
    await page.waitForTimeout(4000);report.before=await mediaState(page);
    for(const frame of page.frames().slice(0,15)){
     try{const video=frame.locator('video').filter({visible:true}).first();if(!await video.count())continue;const box=await video.boundingBox();if(!box)continue;await page.mouse.move(box.x+box.width/2,box.y+box.height/2);const seek=frame.getByRole('slider',{name:'Seek video',exact:true});if(await seek.isVisible()){
       const previous=await video.evaluate(v=>({time:v.currentTime,paused:v.paused,ready:v.readyState,seekable:v.seekable.length}));
       if(previous.seekable&&previous.ready>=2){await page.keyboard.press('Alt+Shift+ArrowRight');await page.waitForTimeout(1500);const after=await video.evaluate(v=>({time:v.currentTime,ready:v.readyState,error:v.error?.code??null}));report.actions.push({seek:{before:previous.time,after:after.time,error:after.error}})}
       const speed=frame.getByRole('combobox',{name:'Playback speed',exact:true});await speed.focus();await speed.press('ArrowRight');report.actions.push({speed:await video.evaluate(v=>v.playbackRate)});
       const pip=frame.getByRole('button',{name:'Pop out video',exact:true});await pip.click({timeout:2000});await page.waitForTimeout(400);const active=await frame.evaluate(()=>!!document.pictureInPictureElement);report.actions.push({pictureInPicture:active,...(!active?{message:await frame.locator("#abomination-browsing-tools .message").innerText().catch(()=>"unavailable")}: {})});if(active)await frame.evaluate(()=>document.exitPictureInPicture());break;
      }
     }catch(error){report.actions.push({controlError:error.message.split('\n')[0].slice(0,150)})}
    }
    report.after=await mediaState(page);
   }
   report.controllerCount=await page.locator('#abomination-browsing-tools').count();
   // Screenshots are limited to non-adult named public pages in this matrix.
   if(['YouTube','Vimeo','Dailymotion','CNN','AccuWeather','Tubi'].includes(name))await page.screenshot({path:join(root,'output/live-audit',name+'.png')});
  }catch(error){report.failure=error.message.split('\n')[0].slice(0,200)}
  results.push(report);await writeFile(join(root,'output/live-audit/results.json'),JSON.stringify({browser:context.browser()?.version(),results},null,2));
  console.log(JSON.stringify(report));await page.close();
 }
}finally{await context?.close();await rm(profile,{recursive:true,force:true});}
