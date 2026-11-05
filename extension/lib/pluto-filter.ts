// Independent protocol adapter. Only Pluto's on-demand metadata is changed.
// ContentProtection, media segments, keys and license requests remain untouched.
const limit=8*1024*1024;
export function plutoResponseKind(raw: string): 'session'|'manifest'|undefined {
  try {
    const url=new URL(raw);
    if(url.protocol!=='https:'||url.username||url.password||url.port||!['pluto.tv','plutotv.net'].some(host=>url.hostname===host||url.hostname.endsWith('.'+host)))return;
    if(url.pathname.endsWith('/session.json'))return 'session';
    if(url.pathname.includes('/episode/')&&url.pathname.endsWith('.mpd'))return 'manifest';
  } catch { /* Unrelated or malformed source: unchanged. */ }
}
export function cleanPlutoSession(value: unknown): boolean {
  if(!value||typeof value!=='object'||Array.isArray(value))return false;
  const pending: [object,string][]=[];
  const data=(o:object,key:string)=>Object.getOwnPropertyDescriptor(o,key);
  const breaks=data(value,'adBreaks')?.value;
  if(Array.isArray(breaks)&&breaks.length<=5000)for(const item of breaks) {
    if(!item||typeof item!=='object'||Array.isArray(item))continue;
    for(const key of ['startingOffset','adBreakDuration','ads','startTime'])if(data(item,key))pending.push([item,key]);
  }
  for(const key of ['adBreak','adBreakLocations'])if(data(value,key))pending.push([value,key]);
  if(pending.some(([object,key])=>!data(object,key)?.configurable))return false;
  for(const [object,key] of pending)Reflect.deleteProperty(object,key);
  return pending.length>0;
}
export function cleanPlutoManifest(text:string):string {
  if(text.length>limit||text.includes('<!DOCTYPE'))return text;
  const xml=new DOMParser().parseFromString(text,'application/xml');
  const root=xml.documentElement;
  if(root.localName!=='MPD'||root.getAttribute('type')==='dynamic'||xml.getElementsByTagName('parsererror').length)return text;
  const periods=[...root.children].filter(element=>element.localName==='Period');
  if(periods.length>500)return text;
  const ads=periods.filter(period=>[...period.getElementsByTagNameNS('*','BaseURL')].some(base=>{
    const path=(base.textContent??'').toLowerCase();return path.includes('_ad')&&path.includes('creative');
  }));
  if(!ads.length||ads.length===periods.length)return text;
  for(const period of ads)period.remove();
  root.removeAttribute('mediaPresentationDuration');
  for(const period of periods)if(period.parentElement===root)period.removeAttribute('start');
  return new XMLSerializer().serializeToString(xml);
}
export function cleanPlutoText(text:string,kind:'session'|'manifest'):string {
  if(text.length>limit)return text;
  if(kind==='manifest')return cleanPlutoManifest(text);
  try {const value:unknown=JSON.parse(text);return cleanPlutoSession(value)?JSON.stringify(value):text;}
  catch {return text;}
}
export function installPlutoFilters() {
  if(location.protocol!=='https:'||!['pluto.tv','www.pluto.tv'].includes(location.hostname))return;
  const marker=Symbol.for('abomination81.pluto-adapter.v1');
  const scope=window as unknown as {[key:symbol]:boolean};
  if(scope[marker])return;
  Object.defineProperty(scope,marker,{value:true});
  const descriptor=Object.getOwnPropertyDescriptor;
  const decode=new TextDecoder('utf-8',{fatal:true}), encode=new TextEncoder();
  const buffer=(value:ArrayBuffer,kind:'session'|'manifest')=>{
    if(value.byteLength>limit)return value;
    try {const text=decode.decode(value),cleaned=cleanPlutoText(text,kind);return cleaned===text?value:encode.encode(cleaned).buffer;}
    catch {return value;}
  };
  for(const method of ['text','json','arrayBuffer'] as const) {
    const original=descriptor(Response.prototype,method)!;
    Object.defineProperty(Response.prototype,method,{...original,value:new Proxy(original.value,{
      apply(target,thisArg:Response,args) {
        const promise=Reflect.apply(target,thisArg,args) as Promise<unknown>;
        const kind=plutoResponseKind(thisArg.url);if(!kind)return promise;
        return promise.then((value:unknown)=>{
          try {
            if(method==='text'&&typeof value==='string')return cleanPlutoText(value,kind);
            if(method==='json'&&kind==='session')cleanPlutoSession(value);
            if(method==='arrayBuffer'&&value instanceof ArrayBuffer)return buffer(value,kind);
          } catch { /* Malformed metadata must not prevent playback. */ }
          return value;
        });
      },
    })});
  }
  const cache=new WeakMap<XMLHttpRequest,{input:unknown;kind:string;output:unknown}>();
  for(const name of ['response','responseText','responseXML'] as const) {
    const original=descriptor(XMLHttpRequest.prototype,name);
    if(!original?.get)continue;
    Object.defineProperty(XMLHttpRequest.prototype,name,{...original,get:function(this:XMLHttpRequest){
      // Preserve native InvalidStateError and incomplete-response behavior.
      const value=Reflect.apply(original.get!,this,[]);
      if(this.readyState!==4)return value;
      const kind=plutoResponseKind(this.responseURL);if(!kind)return value;
      const prior=cache.get(this);if(prior&&prior.input===value&&prior.kind===kind)return prior.output;
      let output=value;
      try {
        if(typeof value==='string')output=cleanPlutoText(value,kind);
        else if(value instanceof ArrayBuffer)output=buffer(value,kind);
        else if(kind==='session'&&this.responseType==='json')cleanPlutoSession(value);
        else if(kind==='manifest'&&value instanceof Document){
          const text=new XMLSerializer().serializeToString(value),cleaned=cleanPlutoManifest(text);
          if(cleaned!==text)output=new DOMParser().parseFromString(cleaned,'application/xml');
        }
      } catch { /* Keep the original response on any parser failure. */ }
      cache.set(this,{input:value,kind,output});return output;
    }});
  }
}
