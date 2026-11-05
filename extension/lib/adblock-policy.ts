import {z} from 'zod';
export const AD_PERMISSION='declarativeNetRequestWithHostAccess' as const;
export const adHost=z.string().min(1).max(253).refine(value=>{
  try{return /^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/.test(value)&&!value.includes('..')&&new URL('https://'+value).hostname===value;}catch{return false;}
});
export const adPreferencesSchema=z.object({enabled:z.boolean().default(true),pausedSites:z.array(adHost).max(200).default([])});
export type AdPreferences=z.infer<typeof adPreferencesSchema>;
export const siteMatches=(host:string,site:string)=>host===site||host.endsWith('.'+site);
export function pausedSite(host:string,prefs:AdPreferences){return prefs.pausedSites.some(site=>siteMatches(host,site));}
const scope=z.object({selector:z.string().max(4000),include:z.array(z.string()).max(10000),exclude:z.array(z.string()).max(10000),exception:z.boolean()});
export const cosmeticSchema=z.object({rules:z.array(scope).max(100000),genericExceptions:z.array(z.string()).max(10000)});
export type Cosmetics=z.infer<typeof cosmeticSchema>;
export function cosmeticCSS(host:string,model:Cosmetics):string {
  // Preserve the separately installed YouTube engine and its player handling.
  if(['youtube.com','youtube-nocookie.com','localhost','127.0.0.1'].some(site=>siteMatches(host,site)))return '';
  const genericOff=model.genericExceptions.some(site=>siteMatches(host,site));
  const applicable=model.rules.filter(rule=>(!rule.include.length||rule.include.some(site=>siteMatches(host,site)))&&!rule.exclude.some(site=>siteMatches(host,site)));
  const exceptions=new Set(applicable.filter(rule=>rule.exception).map(rule=>rule.selector));
  const selectors=[...new Set(applicable.filter(rule=>!rule.exception&&!exceptions.has(rule.selector)&&(!genericOff||rule.include.length)).map(rule=>rule.selector))];
  const css:string[]=[];let size=0;
  for(const selector of selectors){const rule=`${selector}{display:none!important}`;if(size+rule.length+1>750000)break;css.push(rule);size+=rule.length+1;}
  return css.join('\n');
}
