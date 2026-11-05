import {describe,it,expect} from 'vitest';
import {compileAdFilters} from '../scripts/lib/compile-ad-filters.mjs';
import {adHost,adPreferencesSchema,cosmeticCSS,pausedSite} from '../extension/lib/adblock-policy';
import {cleanPlutoSession,cleanPlutoText,plutoResponseKind} from '../extension/lib/pluto-filter';

describe('native advertising rules',()=>{
  it('packs domain rules without losing party, resource or site restrictions',()=>{
    const {rules,stats}=compileAdFilters('||ads.example^$script,third-party,domain=reader.example|~safe.reader.example\n||sponsor.example^$script,third-party,domain=reader.example|~safe.reader.example\n||ads.example/creative.js$image');
    expect(rules).toHaveLength(2);
    expect(rules[0]!.condition).toMatchObject({requestDomains:['ads.example','sponsor.example'],resourceTypes:['script'],domainType:'thirdParty',initiatorDomains:['reader.example'],excludedInitiatorDomains:['youtube.com','youtube-nocookie.com','safe.reader.example']});
    expect(rules[1]!.condition.urlFilter).toBe('||ads.example/creative.js');
    expect(stats.networkTruncated).toBe(0);
  });
  it('retains exceptions, badfilter removals and safe navigation boundaries',()=>{
    const {rules}=compileAdFilters('||ads.example^\n@@||ads.example/allowed.js$script\n||removed.example^$image\n||removed.example^$image,badfilter\n@@||reader.example^$document');
    expect(rules.some((rule:any)=>rule.condition.requestDomains?.includes('removed.example'))).toBe(false);
    expect(rules.find((rule:any)=>rule.action.type==='allow')?.priority).toBe(20);
    expect(rules.find((rule:any)=>rule.action.type==='allowAllRequests')?.condition.resourceTypes).toEqual(['main_frame','sub_frame']);
    const block=rules.find((rule:any)=>rule.action.type==='block');
    expect(block!.condition.resourceTypes).not.toContain('main_frame');
    expect(block!.condition.excludedRequestDomains).toContain('127.0.0.1');
  });
  it('does not broaden unsupported modifiers or ship injected scripts',()=>{
    const {rules,cosmetics}=compileAdFilters('||ads.example^$redirect=noop.js\n||ads.example^$removeparam=id\nreader.example##+js(set, example, true)\nreader.example##.advert\nreader.example#@#.safe');
    expect(rules).toHaveLength(0);
    expect(cosmetics.rules).toEqual([{selector:'.advert',include:['reader.example'],exclude:[],exception:false},{selector:'.safe',include:['reader.example'],exclude:[],exception:true}]);
  });
});

describe('site controls and cosmetics',()=>{
  it('validates hosts and applies pauses only within the selected domain',()=>{
    for(const value of ['evil.com/path','evil.com:80','EXAMPLE.com','example..com','https://example.com','*.example.com'])expect(adHost.safeParse(value).success).toBe(false);
    const prefs=adPreferencesSchema.parse({pausedSites:['example.com']});
    expect(pausedSite('player.example.com',prefs)).toBe(true);
    expect(pausedSite('notexample.com',prefs)).toBe(false);
  });
  it('honors unhide exceptions, generic exclusions and YouTube isolation',()=>{
    const model={genericExceptions:['reader.example'],rules:[
      {selector:'.generic',include:[],exclude:[],exception:false},
      {selector:'.specific',include:['reader.example'],exclude:[],exception:false},
      {selector:'.specific',include:['reader.example'],exclude:[],exception:true},
      {selector:'.ad',include:['reader.example'],exclude:['safe.reader.example'],exception:false},
    ]};
    expect(cosmeticCSS('reader.example',model)).toBe('.ad{display:none!important}');
    expect(cosmeticCSS('safe.reader.example',model)).toBe('');
    expect(cosmeticCSS('www.youtube.com',model)).toBe('');
  });
});

describe('Pluto protocol boundaries',()=>{
  it('recognizes only native Pluto metadata, excluding live and unrelated sources',()=>{
    expect(plutoResponseKind('https://service-stitcher.clusters.pluto.tv/v2/stitch/session.json?x=1')).toBe('session');
    expect(plutoResponseKind('https://silo.plutotv.net/episode/abc/master.mpd')).toBe('manifest');
    for(const url of ['https://pluto.tv.evil.test/episode/1/a.mpd','http://pluto.tv/session.json','https://pluto.tv:444/session.json','https://pluto.tv/channel/1/master.mpd','https://pluto.tv/episode/1/segment.m4s'])expect(plutoResponseKind(url)).toBeUndefined();
  });
  it('removes known ad timing while retaining media, authorization and unrelated data',()=>{
    const value={adBreaks:[{startingOffset:10,adBreakDuration:30,ads:[1],startTime:5,keep:'yes'}],adBreak:[1],adBreakLocations:[2],streams:[{url:'source',drm:'unchanged'}],token:'keep'};
    expect(cleanPlutoSession(value)).toBe(true);
    expect(value).toEqual({adBreaks:[{keep:'yes'}],streams:[{url:'source',drm:'unchanged'}],token:'keep'});
    expect(cleanPlutoText('{broken','session')).toBe('{broken');
    expect(cleanPlutoText('[1,2]','session')).toBe('[1,2]');
  });
  it('does not invoke getters or partly mutate frozen metadata',()=>{
    const value={adBreaks:[Object.freeze({ads:[1]})],adBreakLocations:[3]};
    expect(cleanPlutoSession(value)).toBe(false);
    expect(value.adBreakLocations).toEqual([3]);
    const getter=Object.defineProperty({},'adBreaks',{get(){throw new Error('must not run')}});
    expect(cleanPlutoSession(getter)).toBe(false);
  });
});
