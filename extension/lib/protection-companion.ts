import {z} from 'zod';
import identity from '../../companion/protection/identity.json';
export const PROTECTION_COMPANION_ID=identity.id;
const schema=z.object({version:z.string().max(32),engineVersion:z.string().max(32),enabled:z.boolean(),level:z.number().int().min(0).max(3),paused:z.boolean(),networkRules:z.number().int().nonnegative(),cosmeticRules:z.number().int().nonnegative(),lists:z.array(z.string()).max(100)}).strict();
export type ProtectionStatus=z.infer<typeof schema>;
async function send(message:Record<string,unknown>){
 let timer:ReturnType<typeof setTimeout>|undefined;
 try{return await Promise.race([chrome.runtime.sendMessage(identity.id,message),new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('Protection unavailable')),10000)})]);}finally{clearTimeout(timer)}
}
export async function protectionStatus(host?:string):Promise<ProtectionStatus|undefined>{try{return schema.parse(await send({type:'protection-status',...(host?{host}:{})}));}catch{return;}}
export async function setProtectionEnabled(enabled:boolean){return schema.parse(await send({type:'protection-enabled',enabled}));}
export async function setProtectionSite(host:string,paused:boolean){return schema.parse(await send({type:'protection-site',host,paused}));}
export async function syncProtection(){
 const current=await protectionStatus();if(!current||current.version===chrome.runtime.getManifest().version)return;
 await send({type:'protection-sync',version:chrome.runtime.getManifest().version}).catch(()=>undefined);
}
export function protectionSnapshot(value:ProtectionStatus){return {...value,engine:'complete' as const,permission:true,active:value.enabled,pausedSites:[],updated:null,error:null};}

export async function migrateProtection(pausedSites:string[]){return schema.parse(await send({type:'protection-migrate',pausedSites}));}
