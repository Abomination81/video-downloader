import { afterEach, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { uuid } from '../extension/lib/uuid';

afterEach(() => vi.unstubAllGlobals());

it('creates distinct UUIDs on an insecure page without randomUUID', () => {
  const randomValues = crypto.getRandomValues.bind(crypto);
  vi.stubGlobal('crypto', { getRandomValues: randomValues });
  const first = uuid(), second = uuid();
  expect(z.string().uuid().parse(first)).toBe(first);
  expect(first[14]).toBe('4');
  expect('89ab').toContain(first[19]);
  expect(first).not.toBe(second);
});

it('keeps standard UUID generation available in secure contexts', () => {
  expect(z.string().uuid().parse(uuid())).toHaveLength(36);
});
