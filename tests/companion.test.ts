import { describe, expect, it } from 'vitest';
import { AUDIO_COMPANION_ID, companionRequestSchema, companionSender } from '../extension/lib/companion';

describe('audio companion trust boundary', () => {
  it('accepts only the pinned companion worker', () => {
    const sender = { id: AUDIO_COMPANION_ID, url: `chrome-extension://${AUDIO_COMPANION_ID}/background.js` };
    expect(companionSender(sender)).toBe(true);
    expect(companionSender({ ...sender, id: 'other-extension' })).toBe(false);
    expect(companionSender({ ...sender, url: `chrome-extension://${AUDIO_COMPANION_ID}/popup.html` })).toBe(false);
    expect(companionSender({ ...sender, tab: { id: 1 } as chrome.tabs.Tab })).toBe(false);
  });
  it('rejects arbitrary operations, headers and non-web sources', () => {
    const request = { type: 'audio-companion-download', requestId: '50774456-a78b-4456-a78b-dc5849580aef', tabId: 3, frameId: 0, pageUrl: 'https://example.com/player', mediaType: 'audio', srcUrl: 'https://example.com/source.m4a' };
    expect(companionRequestSchema.safeParse(request).success).toBe(true);
    for (const extra of [{ type: 'jobs' }, { headers: { Cookie: 'private' } }, { srcUrl: 'file:///etc/passwd' }, { tabId: -1 }, { pageUrl: 'https://user:password@example.com' }]) expect(companionRequestSchema.safeParse({ ...request, ...extra }).success).toBe(false);
  });
});
