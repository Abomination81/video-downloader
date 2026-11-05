import { NetworkFilter, CosmeticFilter } from '@ghostery/adblocker';

// Chrome 127 supports 30,000 safe dynamic rules. Reserve room for site pauses.
export const MAX_FILTER_RULES = 27000;
const types = [['script','fromScript'],['image','fromImage'],['stylesheet','fromStylesheet'],['font','fromFont'],['media','fromMedia'],['xmlhttprequest','fromXmlHttpRequest'],['sub_frame','fromSubdocument'],['ping','fromPing'],['websocket','fromWebsocket'],['object','fromObject'],['other','fromOther']];
const domain = value => typeof value === 'string' && value.length <= 253 && /^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/.test(value) && !value.includes('..');
function domains(parts, separator) {
  const include=[], exclude=[];
  for (const item of parts?.split(separator) ?? []) {
    if (!item) continue;
    const negative=item.startsWith('~'), host=negative?item.slice(1):item;
    if (!domain(host)) return null;
    (negative?exclude:include).push(host);
  }
  return {include,exclude};
}
function pattern(raw) {
  const text=raw.startsWith('@@')?raw.slice(2):raw;
  const index=text.lastIndexOf('$');
  if(index<0 || (text.startsWith('/') && index<text.lastIndexOf('/'))) return {url:text,options:[]};
  return {url:text.slice(0,index),options:text.slice(index+1).split(',')};
}
export function compileNetworkFilter(filter) {
  if (filter.isBadFilter() || filter.isUnicode() || filter.isRedirect() || filter.isRedirectRule() || filter.isCSP() || filter.isReplace() || filter.isRemoveParam() || filter.isHtmlFilteringRule() || filter.isElemHide() || filter.isGenericHide() || filter.isSpecificHide()) return null;
  const parsed=pattern(filter.rawLine);
  // An unrecognised modifier must never become a broader blocking rule.
  const supported=/^(?:~?(?:script|image|stylesheet|css|font|media|xmlhttprequest|xhr|subdocument|frame|document|doc|ping|websocket|object|other|third-party|3p|first-party|1p)|domain=.+|denyallow=.+|important|match-case|all)$/;
  if(parsed.options.some(option=>!supported.test(option))) return null;
  const origin=domains(filter.domains?.parts,'|'), denied=domains(filter.denyallow?.parts,'|');
  if(!origin||!denied||denied.exclude.length) return null;
  const resourceTypes=types.filter(([,method])=>filter[method]()).map(([type])=>type);
  const documentException=filter.isException() && parsed.options.some(option=>['document','doc'].includes(option));
  if(!resourceTypes.length&&!documentException) return null;
  const condition={ resourceTypes:documentException?['main_frame','sub_frame']:resourceTypes, excludedRequestDomains:['localhost','127.0.0.1'], excludedInitiatorDomains:['youtube.com','youtube-nocookie.com'] };
  if(filter.isFullRegex()) {
    const regex=filter.getRegex().source;
    if(regex.length>1800 || /\(\?[=!<]|\\[1-9]/.test(regex)) return null;
    condition.regexFilter=regex;
  } else {
    if(!parsed.url || parsed.url.length>1800 || /[^\x20-\x7e]/.test(parsed.url)) return null;
    condition.urlFilter=parsed.url;
  }
  if(filter.isCaseSensitive) condition.isUrlFilterCaseSensitive=true;
  if(filter.thirdParty()&&!filter.firstParty()) condition.domainType='thirdParty';
  if(filter.firstParty()&&!filter.thirdParty()) condition.domainType='firstParty';
  if(origin.include.length) condition.initiatorDomains=origin.include;
  condition.excludedInitiatorDomains=[...new Set([...condition.excludedInitiatorDomains,...origin.exclude])];
  condition.excludedRequestDomains=[...new Set([...condition.excludedRequestDomains,...denied.include])];
  return {priority:filter.isImportant()?30:filter.isException()?20:1,action:{type:documentException?'allowAllRequests':filter.isException()?'allow':'block'},condition};
}
export function compileAdFilters(text) {
  const network=[], cosmetics=[], genericExceptions=[];
  const bad=new Set(); const stats={sourceLines:0,networkParsed:0,networkUnsupported:0,networkTruncated:0,regexTruncated:0,cosmetics:0};
  for(const raw of text.split(/\r?\n/)) {
    const line=raw.trim();stats.sourceLines++;
    if(!line||line.startsWith('!')||line.startsWith('['))continue;
    if(line.includes('##')||line.includes('#@#')||line.includes('#?#')||line.includes('#$#')) {
      const f=CosmeticFilter.parse(line,true);
      if(!f || !f.isCSS() || f.isExtended() || f.isScriptInject() || f.hasCustomStyle() || f.hasSubframeConstraint())continue;
      const scope=domains(f.domains?.parts,',');const selector=f.getSelector();
      if(!scope||selector.length>4000||/[{}@;]/.test(selector))continue;
      cosmetics.push({selector,include:scope.include,exclude:scope.exclude,exception:f.isUnhide()});continue;
    }
    const f=NetworkFilter.parse(line,true);if(!f)continue;
    if(f.isBadFilter()){bad.add(f.getIdWithoutBadFilter());continue;}
    if(f.isException()&&(f.isGenericHide()||f.isElemHide())&&f.isHostnameAnchor()&&f.hasHostname()&&!f.hasFilter())genericExceptions.push(f.getHostname());
    stats.networkParsed++;network.push(f);
  }
  const seen=new Set(), candidates=[], groups=new Map();let regexCount=0;
  // Retain exceptions before blocks when fitting within Chrome's guaranteed quota.
  network.sort((a,b)=>Number(b.isException())-Number(a.isException()));
  for(const f of network) {
    if(bad.has(f.getId())||seen.has(f.getId()))continue;seen.add(f.getId());
    const rule=compileNetworkFilter(f);if(!rule){stats.networkUnsupported++;continue;}
    // Domain-only filters can share one native rule without changing their
    // action, party/type restrictions or domain exceptions. This retains the
    // entire supported list instead of selecting an alphabetical subset.
    const host=/^\|\|([a-z0-9.-]+)\^$/.exec(rule.condition.urlFilter??'')?.[1];
    if(host&&domain(host)) {
      const {urlFilter,...condition}=rule.condition;
      const key=JSON.stringify({...rule,condition});
      let group=groups.get(key);
      if(!group||group.condition.requestDomains.length>=500){group={...rule,condition:{...condition,requestDomains:[]}};groups.set(key,group);candidates.push(group);}
      group.condition.requestDomains.push(host);
    } else candidates.push(rule);
  }
  const compiled=[];
  for(const rule of candidates) {
    if(rule.condition.regexFilter&&regexCount>=900){stats.regexTruncated++;continue;}
    if(compiled.length>=MAX_FILTER_RULES){stats.networkTruncated++;continue;}
    if(rule.condition.regexFilter)regexCount++;
    compiled.push({id:compiled.length+1,...rule});
  }
  stats.networkCompacted=network.length-stats.networkUnsupported-candidates.length;
  stats.cosmetics=cosmetics.length;
  return {rules:compiled,cosmetics:{rules:cosmetics,genericExceptions:[...new Set(genericExceptions)]},stats};
}
