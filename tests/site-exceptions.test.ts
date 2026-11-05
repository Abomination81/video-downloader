import { describe, expect, it } from 'vitest';
import { isExemptHost, isExemptUrl, isExemptFrame } from '../extension/lib/site-exceptions';

describe('site compatibility exemptions', () => {
  it('covers Zillow/LoopNet and subdomains without matching lookalike hosts', () => {
    for (const host of ['zillow.com', 'www.zillow.com', 'photos.zillow.com', 'loopnet.com', 'www.loopnet.com', 'WWW.ZILLOW.COM.']) expect(isExemptHost(host)).toBe(true);
    for (const host of ['notzillow.com', 'zillow.com.evil.test', 'loopnet.com.example', 'example.com', undefined]) expect(isExemptHost(host)).toBe(false);
    expect(isExemptUrl('https://www.zillow.com/homes/')).toBe(true);
    expect(isExemptUrl('https://zillow.com@other.example/')).toBe(false);
    expect(isExemptUrl('not a URL')).toBe(false);
  });
  it('exempts nested third-party frames only when their ancestry is whitelisted', () => {
    const frames = [
      { frameId: 0, parentFrameId: -1, url: 'https://example.com' },
      { frameId: 1, parentFrameId: 0, url: 'https://www.zillow.com' },
      { frameId: 2, parentFrameId: 1, url: 'https://maps.example' },
      { frameId: 3, parentFrameId: 2, url: 'about:blank' },
      { frameId: 4, parentFrameId: 0, url: 'https://maps.example' },
    ];
    expect(isExemptFrame(3, frames, 'https://example.com')).toBe(true);
    expect(isExemptFrame(4, frames, 'https://example.com')).toBe(false);
    expect(isExemptFrame(4, frames, 'https://www.loopnet.com')).toBe(true);
    expect(isExemptFrame(9, [{ frameId: 9, parentFrameId: 9, url: 'about:blank' }], '')).toBe(false);
  });
});
