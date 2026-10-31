import { describe, expect, it } from 'vitest';
import { settingsSchema } from '../extension/lib/schema';

describe('output defaults', () => {
  it('upgrades old preferences to compatible output without resetting other choices', () => {
    const parsed = settingsSchema.parse({ restoreMenus: false, useCookies: false });
    expect(parsed.compatibleVideo).toBe(true);
    expect(parsed.restoreMenus).toBe(false);
    expect(parsed.useCookies).toBe(false);
  });
  it('preserves an explicit original-source preference', () => {
    expect(settingsSchema.parse({ compatibleVideo: false }).compatibleVideo).toBe(false);
  });
  it('enables automatic updates for old preferences and preserves opting out', () => {
    expect(settingsSchema.parse({}).autoUpdates).toBe(true);
    expect(settingsSchema.parse({ autoUpdates: false }).autoUpdates).toBe(false);
  });
});
