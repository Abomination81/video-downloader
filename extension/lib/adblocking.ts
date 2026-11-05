import {z} from 'zod';
import {protectionStatus,protectionSnapshot,setProtectionEnabled,setProtectionSite,syncProtection,migrateProtection} from './protection-companion';
import {YOUTUBE_COMPANION_ID} from './youtube-companion';
import {AD_PERMISSION,adPreferencesSchema,cosmeticSchema,cosmeticCSS,pausedSite,siteMatches,type AdPreferences,type Cosmetics} from './adblock-policy';

const manifestSchema=z.object({rulesSha256:z.string().regex(/^[a-f0-9]{64}$/),networkRules:z.number().int().min(1).max(27000),cosmeticRules:z.number().int().max(100000),lastModified:z.string().nullable(),source:z.string()});
const plutoScript='abomination81-pluto-ads';
const pauseStart=100000,pauseEnd=100399;
const owned=(id:number)=>id>=1&&id<=27000||id>=pauseStart&&id<=pauseEnd;
async function packaged(path:string) {
  const response=await fetch(chrome.runtime.getURL('adblock/'+path),{signal:AbortSignal.timeout(10000)});
  if(!response.ok)throw new Error('Packaged filters unavailable');
  return response.json() as Promise<unknown>;
}
async function deliverCSS(tabId:number,css:string,target:chrome.tabs.MessageSendOptions) {
  let timer:ReturnType<typeof setTimeout>|undefined;
  try {
    await Promise.race([
      chrome.tabs.sendMessage(tabId,{type:'ad-policy',css},target),
      new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('Frame unavailable')),2000);}),
    ]);
  } finally {clearTimeout(timer);}
}
export class AdBlocking {
  private queue:Promise<unknown>=Promise.resolve();
  private error:string|undefined;
  private active=false;
  private delegated=false;
  private info=packaged('manifest.json').then(value=>manifestSchema.parse(value));
  private cosmetics:Promise<Cosmetics>|undefined;
  private rules:Promise<chrome.declarativeNetRequest.Rule[]>|undefined;
  private acceptedRules:number|undefined;
  constructor() {
    void this.info.catch(()=>undefined); // Snapshot/apply surface unavailable packaged data.
    chrome.permissions.onAdded.addListener(value=>{if(value.permissions?.includes(AD_PERMISSION))void this.reconcile(true);});
    chrome.permissions.onRemoved.addListener(value=>{if(value.permissions?.includes(AD_PERMISSION))void this.reconcile();});
    chrome.alarms.onAlarm.addListener(event=>{if(event.name==='protection-companion'){void syncProtection();void this.reconcile();}});
    void chrome.alarms.create('protection-companion',{periodInMinutes:1});
    void this.reconcile();
  }
  private serial<T>(run:()=>Promise<T>):Promise<T> {
    const next=this.queue.then(run,run);this.queue=next.catch(()=>undefined);return next;
  }
  private async preferences() {
    const saved=await chrome.storage.local.get('adBlockPreferences');return adPreferencesSchema.parse(saved.adBlockPreferences??{});
  }
  private async granted(){return chrome.permissions.contains({permissions:[AD_PERMISSION]});}
  private async snapshot(host?:string) {
    const [prefs,permission,info]=await Promise.all([this.preferences(),this.granted(),this.info.catch(()=>({networkRules:0,cosmeticRules:0,lastModified:null}))]);
    return {enabled:prefs.enabled,permission,active:this.active&&permission&&prefs.enabled,paused:host?pausedSite(host,prefs):false,pausedSites:prefs.pausedSites,networkRules:this.acceptedRules??info.networkRules,cosmeticRules:info.cosmeticRules,updated:info.lastModified,error:this.error??null};
  }
  async status(host?:string){const full=await protectionStatus(host);if(full){if(!this.delegated)await this.reconcile();return protectionSnapshot(await protectionStatus(host)??full);}await this.queue;return {...await this.snapshot(host),engine:'basic'};}
  async setEnabled(enabled:boolean) {
    if(await protectionStatus()){const value=await setProtectionEnabled(enabled);await this.reconcile();return protectionSnapshot(value);}
    return this.serial(async()=>{
      const prefs=await this.preferences();await chrome.storage.local.set({adBlockPreferences:{...prefs,enabled}});
      await this.apply(enabled);return this.snapshot();
    });
  }
  async setSite(host:string,paused:boolean) {
    if(await protectionStatus())return protectionSnapshot(await setProtectionSite(host,paused));
    return this.serial(async()=>{
      const prefs=await this.preferences();
      const sites=prefs.pausedSites.filter(site=>!siteMatches(host,site));
      if(paused)sites.push(host);
      await chrome.storage.local.set({adBlockPreferences:adPreferencesSchema.parse({...prefs,pausedSites:[...new Set(sites)].sort()})});
      await this.apply();return this.snapshot(host);
    });
  }
  private reconcile(force=false){return this.serial(()=>this.apply(force));}
  private async apply(force=false) {
    try {
      const [saved,permission,full]=await Promise.all([this.preferences(),this.granted(),protectionStatus()]);
      const prefs=full?{...saved,enabled:false}:saved;
      if(full){
        if(!this.delegated){await migrateProtection(saved.pausedSites);await chrome.storage.local.set({adBlockPreferences:prefs});}
        this.delegated=true;
        // The mature engine now owns YouTube too. This command only pauses the
        // old companion; it cannot pass scripts, browsing data or helper jobs.
        void chrome.runtime.sendMessage(YOUTUBE_COMPANION_ID,{type:'youtube-companion-supersede'}).catch(()=>undefined);
      }else this.delegated=false;
      this.active=false;this.error=undefined;
      if(permission) {
        const info=prefs.enabled?await this.info:undefined;
        if(force)this.rules=undefined;
        const supported=prefs.enabled?await this.supportedRules():[];
        const existing=await chrome.declarativeNetRequest.getDynamicRules();
        const previous=await chrome.storage.local.get('adAppliedHash');
        const base=existing.filter(rule=>rule.id>=1&&rule.id<=27000);
        const refresh=force||previous.adAppliedHash!==info?.rulesSha256||base.length!==supported.length;
        const removeRuleIds=existing.filter(rule=>owned(rule.id)&&(!prefs.enabled||refresh||rule.id>=pauseStart)).map(rule=>rule.id);
        const addRules:chrome.declarativeNetRequest.Rule[]=[];
        if(prefs.enabled) {
          if(refresh)addRules.push(...supported);
          for(const [index,host] of prefs.pausedSites.entries()) {
            addRules.push({id:pauseStart+index*2,priority:100000,action:{type:'allowAllRequests' as chrome.declarativeNetRequest.RuleActionType},condition:{requestDomains:[host],resourceTypes:['main_frame','sub_frame'] as chrome.declarativeNetRequest.ResourceType[]}});
            addRules.push({id:pauseStart+index*2+1,priority:100000,action:{type:'allow' as chrome.declarativeNetRequest.RuleActionType},condition:{initiatorDomains:[host]}});
          }
        }
        if(removeRuleIds.length||addRules.length)await chrome.declarativeNetRequest.updateDynamicRules({removeRuleIds,addRules});
        await chrome.storage.local.set({adAppliedHash:info?.rulesSha256??null});
        this.active=prefs.enabled;
      }
      await this.pluto(prefs,permission&&prefs.enabled);
      await this.broadcast();
      await chrome.storage.local.remove('adBlockError');
    } catch {
      this.error='Ad filtering could not start. Downloads still work. Try turning ad blocking off and on again.';
      await chrome.storage.local.set({adBlockError:{code:'filter_activation_failed',at:Date.now()}});
    }
  }
  private supportedRules() {
    return this.rules??= (async()=>{
      const rules=await packaged('rules.json') as chrome.declarativeNetRequest.Rule[];
      const valid=await Promise.all(rules.map(async rule=>{
        if(!rule.condition.regexFilter)return true;
        const result=await chrome.declarativeNetRequest.isRegexSupported({regex:rule.condition.regexFilter,isCaseSensitive:rule.condition.isUrlFilterCaseSensitive??false,requireCapturing:false});
        // Never discard an unsupported allow rule while keeping its blocks.
        if(!result.isSupported&&rule.action.type!=='block')throw new Error('Unsupported filter exception');
        return result.isSupported;
      }));
      const accepted=rules.filter((_,index)=>valid[index]);this.acceptedRules=accepted.length;return accepted;
    })();
  }
  private async pluto(prefs:AdPreferences,enabled:boolean) {
    const hosts=['pluto.tv','www.pluto.tv'].filter(host=>!pausedSite(host,prefs));
    const existing=await chrome.scripting.getRegisteredContentScripts({ids:[plutoScript]});
    if(!enabled||!hosts.length) {
      if(existing.length)await chrome.scripting.unregisterContentScripts({ids:[plutoScript]});
      return;
    }
    const script:chrome.scripting.RegisteredContentScript={id:plutoScript,matches:hosts.map(host=>`https://${host}/*`),js:['adblock/pluto-main.js'],world:'MAIN',runAt:'document_start',allFrames:true,persistAcrossSessions:true};
    if(existing.length)await chrome.scripting.updateContentScripts([script]);
    else await chrome.scripting.registerContentScripts([script]);
  }
  async frame(sender:chrome.runtime.MessageSender) {
    if(sender.tab?.id===undefined||!sender.url||!/^https?:/.test(sender.url))return;
    await this.queue;
    const prefs=await this.preferences();
    let css='';
    const host=new URL(sender.url).hostname,top=sender.tab.url&&/^https?:/.test(sender.tab.url)?new URL(sender.tab.url).hostname:host;
    if(this.active&&prefs.enabled&&!pausedSite(host,prefs)&&!pausedSite(top,prefs)) {
      this.cosmetics??=packaged('cosmetics.json').then(value=>cosmeticSchema.parse(value));
      css=cosmeticCSS(host,await this.cosmetics);
    }
    await deliverCSS(sender.tab.id,css,sender.documentId?{documentId:sender.documentId}:{frameId:sender.frameId??0});
  }
  private async broadcast() {
    const tabs=await chrome.tabs.query({});
    // A frame that is temporarily unavailable receives the policy at frame-ready.
    for(let i=0;i<tabs.length;i+=8)await Promise.allSettled(tabs.slice(i,i+8).map(async tab=>{
      if(tab.id===undefined||!tab.url||!/^https?:/.test(tab.url))return;
      const frames=await chrome.webNavigation.getAllFrames({tabId:tab.id});
      await Promise.allSettled((frames??[]).slice(0,100).map(frame=>this.deliverFrame(tab,frame)));
    }));
  }
  private async deliverFrame(tab:chrome.tabs.Tab,frame:chrome.webNavigation.GetAllFrameResultDetails) {
    const prefs=await this.preferences();let css='';const host=new URL(frame.url).hostname;
    if(this.active&&prefs.enabled&&!pausedSite(host,prefs)&&!pausedSite(new URL(tab.url!).hostname,prefs)) {
      this.cosmetics??=packaged('cosmetics.json').then(value=>cosmeticSchema.parse(value));css=cosmeticCSS(host,await this.cosmetics);
    }
    await deliverCSS(tab.id!,css,frame.documentId?{documentId:frame.documentId}:{frameId:frame.frameId});
  }
}
