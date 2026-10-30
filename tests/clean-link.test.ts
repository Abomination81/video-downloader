import { expect, it } from 'vitest';
import { cleanLink } from '../extension/lib/clean-link';

it('removes known trackers while preserving search bytes, order and anchors', () => {
  expect(cleanLink('https://example.com/read?q=a%20b&x=%2f&utm_source=mail&fbclid=abc#section')).toBe('https://example.com/read?q=a%20b&x=%2f#section');
});
it('keeps playback timestamps and meaningful query values', () => {
  expect(cleanLink('https://youtu.be/abc?si=share&t=123&utm_medium=share')).toBe('https://youtu.be/abc?t=123');
  expect(cleanLink('https://example.com/?ref=item42&si=required')).toBe('https://example.com/?ref=item42&si=required');
});
it('leaves signed and login links untouched', () => {
  for (const key of ['X-Amz-Signature', 'sig', 'token', 'state', 'code']) {
    const link = `https://example.com/file?${key}=secret&utm_source=email`;
    expect(cleanLink(link)).toBe(link);
  }
});
it('preserves a link verbatim when there are no known trackers', () => {
  expect(cleanLink('https://example.com/?a=%2f&b=a%20b#hello')).toBe('https://example.com/?a=%2f&b=a%20b#hello');
});
