import {z} from 'zod';
import {AD_PERMISSION,adHost} from './adblock-policy';
import {request,el,notice} from './ui';
const statusSchema=z.object({enabled:z.boolean(),permission:z.boolean(),active:z.boolean(),paused:z.boolean(),pausedSites:z.array(z.string()),networkRules:z.number(),cosmeticRules:z.number(),updated:z.string().nullable(),error:z.string().nullable()});
export function adblockControls(options:{compact?:boolean;tabId?:number;host?:string}={}) {
  const button=el<HTMLButtonElement>('#adblock-toggle'), detail=el('#adblock-detail');
  let state:z.infer<typeof statusSchema>|undefined;
  const render=(value:z.infer<typeof statusSchema>)=>{
    state=value;button.disabled=false;
    button.textContent=options.compact?(!value.permission?'Enable':value.enabled?'On':'Off'):!value.permission?'Enable ad blocking':value.enabled?'Turn off ad blocking':'Turn on ad blocking';
    button.setAttribute('aria-label',!value.permission?'Enable general ad blocking':value.enabled?'Turn off general ad blocking':'Turn on general ad blocking');
    button.dataset.ready=String(value.active);
    detail.textContent=value.error??(!value.permission?'Enable website filtering here.':value.active?(value.paused?'Paused on this site.':options.compact?'Website ads and banners.':`${value.networkRules.toLocaleString()} network filters · ${value.cosmeticRules.toLocaleString()} cosmetic filters. EasyList runs locally.`):'General ad blocking is off.');
    const pause=document.querySelector<HTMLButtonElement>('#adblock-pause');
    if(pause){pause.hidden=!value.active||!options.host;pause.textContent=value.paused?'Resume here':'Pause here';pause.title=options.host??'';}
    const actions=document.querySelector<HTMLElement>('#adblock-actions');
    if(actions)actions.hidden=(!pause||pause.hidden)&&(document.querySelector<HTMLButtonElement>('#adblock-reload')?.hidden??true);
  };
  const refresh=async()=>{
    try{render(statusSchema.parse(await request({type:'adblock-status',...(options.host?{host:options.host}:{})})));}
    catch{detail.textContent='Ad blocking is unavailable. Reload the extension and try again.';button.disabled=false;}
  };
  const showReload=()=>{const reload=document.querySelector<HTMLButtonElement>('#adblock-reload');if(reload&&options.tabId!==undefined){reload.hidden=false;const actions=document.querySelector<HTMLElement>('#adblock-actions');if(actions)actions.hidden=false;}};
  button.onclick=async()=>{
    const previous=state;button.disabled=true;
    try{
      if(!previous?.permission) {
        // Must be the first awaited API in this click handler: Chrome requires a user gesture.
        const granted=await chrome.permissions.request({permissions:[AD_PERMISSION]});
        if(!granted){detail.textContent='Permission was not granted. Downloads and YouTube protection are unchanged.';return;}
      }
      await request({type:'adblock-set',enabled:previous?.permission?!previous.enabled:true});
      await refresh();
      showReload();
    }catch{notice('Ad blocking could not be changed. Try again.');}
    finally{button.disabled=false;}
  };
  const pause=document.querySelector<HTMLButtonElement>('#adblock-pause');
  if(pause)pause.onclick=async()=>{
    if(!state||!options.host)return;pause.disabled=true;
    try{render(statusSchema.parse(await request({type:'adblock-site',host:adHost.parse(options.host),paused:!state.paused})));showReload();}
    catch{notice('The site preference could not be saved. Try again.');}
    finally{pause.disabled=false;}
  };
  const reload=document.querySelector<HTMLButtonElement>('#adblock-reload');
  if(reload)reload.onclick=async()=>{if(options.tabId!==undefined){await chrome.tabs.reload(options.tabId);reload.hidden=true;}};
  void refresh();return refresh;
}
