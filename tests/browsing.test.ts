import {describe,it,expect} from 'vitest';
import {browsingSchema,browsingPolicySchema,seekTime,siteHost} from '../extension/lib/browsing-policy';
import {rasterDimensions} from '../extension/lib/ocr-policy';
const video=(time:number,ranges:number[][])=>({currentTime:time,duration:Infinity,seekable:{length:ranges.length,start:(i:number)=>ranges[i]![0]!,end:(i:number)=>ranges[i]![1]!}});
describe('browsing controls',()=>{
 it('uses actual seekable ranges, including live windows and discontinuities',()=>{
  expect(seekTime(video(110,[[100,200]]),-30)).toBe(100);
  expect(seekTime(video(195,[[100,200]]),10)).toBe(199.95);
  expect(seekTime(video(5,[[0,10],[20,30]]),17)).toBe(22);
  expect(seekTime(video(5,[[0,10],[20,30]]),7)).toBe(9.95);
  expect(seekTime(video(0,[]),10)).toBeUndefined();
 });
 it('defaults upgrades to reject-only browsing tools without changing download preferences',()=>{
  expect(browsingSchema.parse({})).toEqual({rejectCookies:true,hideNags:true,popupGuard:true,videoControls:true,pausedSites:[],popupSites:[]});
  expect(browsingSchema.safeParse({optIn:true}).success).toBe(false);
  expect(browsingSchema.safeParse({popupSites:['bad/path']}).success).toBe(false);
  expect(browsingSchema.safeParse({pausedSites:Array(201).fill('example.com')}).success).toBe(false);
 });
 it('rejects unsafe policy data and excludes browser-internal pages',()=>{
  expect(siteHost('chrome://settings')).toBe('');expect(siteHost('https://Example.com/video')).toBe('example.com');
  expect(browsingPolicySchema.safeParse({host:'example.com',enabled:true,rejectCookies:true,popupGuard:true,videoControls:true,allowPopups:false,speed:100}).success).toBe(false);
 });
});

describe('image decoding boundary',()=>{
 it('reads raster dimensions before allocation and rejects truncated JPEG segments',()=>{
  const png=new Uint8Array([137,80,78,71,13,10,26,10,...Array(16).fill(0)]);
  const view=new DataView(png.buffer);view.setUint32(16,900);view.setUint32(20,220);
  expect(rasterDimensions(png)).toEqual({width:900,height:220});
  view.setUint32(16,100000);view.setUint32(20,100000);
  expect(rasterDimensions(png)).toEqual({width:100000,height:100000});
  const jpeg=new Uint8Array([255,216,255,224,0,4,0,0,255,192,0,11,8,0,220,3,132,1,1,17,0]);
  expect(rasterDimensions(jpeg)).toEqual({width:900,height:220});
  expect(rasterDimensions(jpeg.slice(0,15))).toBeUndefined();
  expect(rasterDimensions(new Uint8Array([255,216,255,224,0,0]))).toBeUndefined();
  const gif=new Uint8Array([71,73,70,56,57,97,132,3,220,0]);
  expect(rasterDimensions(gif)).toEqual({width:900,height:220});
  const webp=new Uint8Array(30);webp.set(new TextEncoder().encode('RIFF'));webp.set(new TextEncoder().encode('WEBPVP8X'),8);webp[24]=131;webp[25]=3;webp[27]=219;
  expect(rasterDimensions(webp)).toEqual({width:900,height:220});
  for(let size=0;size<32;size++) expect(()=>rasterDimensions(new Uint8Array(size))).not.toThrow();
 });
 it('rejects active markup even when a server labels it as an image',async()=>{
  const {rasterType}=await import('../extension/lib/ocr-policy');
  expect(rasterType(new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'))).toBeUndefined();
  expect(rasterType(new TextEncoder().encode('<html><script>fetch("https://evil.test")</script>'))).toBeUndefined();
  expect(rasterType(new Uint8Array([137,80,78,71,13,10,26,10,...Array(16).fill(0)]))).toBe('image/png');
  expect(rasterType(new Uint8Array([255,216,255,224]))).toBe('image/jpeg');
  expect(rasterType(new Uint8Array())).toBeUndefined();
 });
});
