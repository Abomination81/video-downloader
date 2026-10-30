import { expect, it } from 'vitest';
import { srcset } from '../extension/lib/images';

it('ranks exposed widths and keeps signed query values intact', () => {
  expect(srcset('/small.jpg?sig=keep 400w, /large.jpg?sig=keep 2000w', 'https://example.com/page', 400)).toEqual([{ url: 'https://example.com/small.jpg?sig=keep', score: 400 }, { url: 'https://example.com/large.jpg?sig=keep', score: 2000 }]);
});
it('does not split an embedded comma inside a source URL', () => {
  expect(srcset('https://cdn.example.com/a,b.jpg 2x, /other.jpg 1x', 'https://example.com/', 800)[0]).toEqual({ url: 'https://cdn.example.com/a,b.jpg', score: 1600 });
});
