import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { describe, it, expect, vi } from 'vitest';

const source = readFileSync(new URL('../companion/youtube/bundle-sync.js', import.meta.url), 'utf8');
const main = 'bhglpjejpddnmfgkaakboniplnoemoak';
const trusted = { id: main, url: `chrome-extension://${main}/background.js` };
function harness() {
  let listener: (message: unknown, sender: unknown, reply: (value: unknown) => void) => unknown;
  const reload = vi.fn();
  const fetch = vi.fn(async () => ({ json: async () => ({ version: '0.8.1' }) }));
  const getContexts = vi.fn(async () => [] as object[]);
  runInNewContext(source, {
    fetch, Date, chrome: {
      storage: { local: { get: async () => ({ enabled: false, privateData: 'never share' }) } },
      runtime: { getManifest: () => ({ version: '0.8.0' }), getURL: (path: string) => `chrome-extension://self/${path}`, getContexts, reload, onMessageExternal: { addListener: (fn: typeof listener) => { listener = fn; } } },
    },
  });
  const send = async (message: unknown, sender: unknown = trusted) => {
    const reply = vi.fn(); listener!(message, sender, reply);
    await new Promise(resolve => setImmediate(resolve)); return reply;
  };
  return { send, fetch, reload, getContexts };
}
describe('YouTube companion external boundary', () => {
  it('rejects foreign IDs, content scripts, missing origins and extension tabs', async () => {
    const h = harness();
    for (const sender of [{ ...trusted, id: 'foreign' }, { ...trusted, tab: { id: 1 } }, { id: main }, { ...trusted, url: `chrome-extension://${main}/options.html` }, { ...trusted, url: 'https://www.youtube.com/' }]) {
      expect(await h.send({ type: 'youtube-companion-status' }, sender)).not.toHaveBeenCalled();
      expect(await h.send({ type: 'youtube-companion-sync', version: '0.8.1' }, sender)).not.toHaveBeenCalled();
    }
    expect(h.fetch).not.toHaveBeenCalled(); expect(h.reload).not.toHaveBeenCalled();
  });
  it('exposes only version and the saved preference', async () => {
    const h = harness(); expect(await h.send({ type: 'youtube-companion-status' })).toHaveBeenCalledWith({ version: '0.8.0', engineVersion: '0.1.2', enabled: false });
    expect(h.fetch).not.toHaveBeenCalled();
  });
  it('rejects toggles, URLs, jobs, malformed and surplus fields even from the parent', async () => {
    const h = harness();
    for (const message of [null, [], 'status', { type: 'set-enabled', enabled: true }, { type: 'jobs' }, { type: 'youtube-companion-status', url: 'https://evil.test' }, { type: 'youtube-companion-sync', version: '../../remote' }, { type: 'youtube-companion-sync', version: '0.8.1', url: 'https://evil.test' }, { type: 'youtube-companion-sync', version: 123 }]) expect(await h.send(message)).not.toHaveBeenCalled();
    expect(h.fetch).not.toHaveBeenCalled(); expect(h.reload).not.toHaveBeenCalled();
  });
  it('activates only matching packaged files and bounds repeated requests', async () => {
    const h = harness();
    await h.send({ type: 'youtube-companion-sync', version: '0.8.0' }); expect(h.fetch).not.toHaveBeenCalled();
    for (let n = 0; n < 50; n++) await h.send({ type: 'youtube-companion-sync', version: '0.8.1' });
    expect(h.fetch).toHaveBeenCalledExactlyOnceWith('chrome-extension://self/manifest.json', { cache: 'no-store' });
    expect(h.reload).toHaveBeenCalledOnce();
  });
  it('does not reload when the expected version is absent', async () => {
    const h = harness(); await h.send({ type: 'youtube-companion-sync', version: '9.9.9' }); expect(h.reload).not.toHaveBeenCalled();
  });
  it('waits for the companion popup or tab to close', async () => {
    const h = harness(); h.getContexts.mockResolvedValue([{ contextType: 'POPUP' }]);
    await h.send({ type: 'youtube-companion-sync', version: '0.8.1' }); expect(h.reload).not.toHaveBeenCalled();
  });
  it('handles unavailable packaged resources without reloading or leaking errors', async () => {
    const h = harness(); h.fetch.mockRejectedValue(new Error('private path'));
    expect(await h.send({ type: 'youtube-companion-sync', version: '0.8.1' })).toHaveBeenCalledWith({ accepted: true });
    expect(h.reload).not.toHaveBeenCalled();
  });
});
