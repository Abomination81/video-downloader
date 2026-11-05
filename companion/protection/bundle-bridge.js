/* GPL-3.0-or-later. Integration by Abomination81; engine by Raymond Hill. */
import { isFullyInitialized } from './js/background.js';
import {getDefaultFilteringMode,getFilteringMode,setFilteringMode,getFilteringModeDetails,setFilteringModeDetails} from './js/mode-manager.js';
import {registerContentScripts} from './js/scripting-manager.js';
import {registerUserScripts} from './js/compiled-filters.js';
const MAIN='bhglpjejpddnmfgkaakboniplnoemoak';
let pending=Promise.resolve();
const serial=fn=>{const next=pending.then(fn,fn);pending=next.catch(()=>{});return next};
const host=value=>typeof value==='string'&&value.length<=253&&/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/.test(value)&&!value.includes('..');
async function status(hostname){
 await isFullyInitialized;
 const [level,mode,enabled,details]=await Promise.all([getDefaultFilteringMode(),hostname?getFilteringMode(hostname):getDefaultFilteringMode(),chrome.declarativeNetRequest.getEnabledRulesets(),fetch(chrome.runtime.getURL('rulesets/ruleset-details.json')).then(r=>r.json())]);
 const lists=details.filter(item=>enabled.includes(item.id));
 return {version:chrome.runtime.getManifest().version,engineVersion:'2026.1103.1743',enabled:level>0,level,paused:mode===0,networkRules:lists.reduce((sum,item)=>sum+item.rules.total,0),cosmeticRules:lists.reduce((sum,item)=>sum+(item.css?.generic??0)+(item.css?.specific??0),0),lists:lists.map(item=>item.name)};
}
async function apply(){await Promise.all([registerContentScripts(),registerUserScripts()]);}
chrome.runtime.onMessageExternal.addListener((message,sender,reply)=>{
 if(sender.id!==MAIN||sender.tab||sender.url!==`chrome-extension://${MAIN}/background.js`||!message||typeof message!=='object'||Array.isArray(message))return false;
 const keys=Object.keys(message).sort().join(',');
 let task;
 if(message.type==='protection-status'&&(keys==='type'||keys==='host,type'&&host(message.host)))task=()=>status(message.host);
 if(message.type==='protection-enabled'&&keys==='enabled,type'&&typeof message.enabled==='boolean')task=async()=>{
  await isFullyInitialized;
  if(message.enabled){if(await getDefaultFilteringMode()>0)return status();const saved=await chrome.storage.local.get('vdResumeModes');await setFilteringModeDetails(saved.vdResumeModes??{none:['localhost','127.0.0.1'],basic:[],optimal:[],complete:['all-urls']});}
  else{if(await getDefaultFilteringMode()>0)await chrome.storage.local.set({vdResumeModes:await getFilteringModeDetails(true)});await setFilteringModeDetails({none:['all-urls'],basic:[],optimal:[],complete:[]});}
  await apply();return status();
 };
 if(message.type==='protection-migrate'&&keys==='pausedSites,type'&&Array.isArray(message.pausedSites)&&message.pausedSites.length<=200&&message.pausedSites.every(host))task=async()=>{
  await isFullyInitialized;
  if(!(await chrome.storage.local.get('vdMigrated')).vdMigrated){
   for(const hostname of message.pausedSites)await setFilteringMode(hostname,0);
   await apply();await chrome.storage.local.set({vdMigrated:true});
  }
  return status();
 };
 if(message.type==='protection-site'&&keys==='host,paused,type'&&host(message.host)&&typeof message.paused==='boolean')task=async()=>{await isFullyInitialized;if(await getDefaultFilteringMode()===0)return status(message.host);await setFilteringMode(message.host,message.paused?0:3);await apply();return status(message.host)};
 if(message.type==='protection-sync'&&keys==='type,version'&&/^\d+\.\d+\.\d+$/.test(message.version))task=async()=>{
  const disk=await(await fetch(chrome.runtime.getURL('manifest.json'),{cache:'no-store'})).json();
  if(disk.version===message.version&&disk.version!==chrome.runtime.getManifest().version&&!(await chrome.runtime.getContexts({contextTypes:['TAB','POPUP']})).length)setTimeout(()=>chrome.runtime.reload(),250);
  return {accepted:true};
 };
 if(!task)return false;
 void serial(task).then(reply,()=>reply(null));return true;
});
