import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { native } from '../extension/lib/native';
import { Updates } from '../extension/lib/updates';

vi.mock('../extension/lib/native', () => ({ native: vi.fn(), HelperError: class extends Error {} }));
const status = { state: 'ready', message: 'Installed', installedVersion: '0.5.2', enabled: true };

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

describe('safe update activation', () => {
  let reload: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    const event = () => ({ addListener: vi.fn() });
    reload = vi.fn();
    vi.stubGlobal('fetch', vi.fn(async () => ({ json: async () => ({ version: status.installedVersion }) })));
    vi.stubGlobal('chrome', {
      alarms: { onAlarm: event(), get: vi.fn(async () => ({ periodInMinutes: 0.5 })), create: vi.fn(async () => {}) },
      runtime: { onStartup: event(), onInstalled: event(), getManifest: () => ({ version: '0.5.1' }), getURL: () => 'chrome-extension://fixture/', getContexts: vi.fn(async () => []), reload },
      storage: { onChanged: event(), local: { set: vi.fn(async () => {}) } },
      tabs: { query: vi.fn(async () => []) },
    });
    vi.mocked(native).mockImplementation(async type => type === 'jobs' ? { jobs: [] } : status);
  });
  afterEach(() => { vi.unstubAllGlobals(); vi.resetAllMocks(); });

  it('activates a committed update when idle', async () => {
    await new Updates(() => false).status();
    expect(reload).toHaveBeenCalledOnce();
  });

  it('preserves an action that is selecting or starting a download', async () => {
    await new Updates(() => true).status();
    expect(reload).not.toHaveBeenCalled();
  });

  it('explains an old unpacked folder instead of reloading it repeatedly', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ json: async () => ({ version: '0.5.1' }) })));
    const value = await new Updates(() => false).status();
    expect(reload).not.toHaveBeenCalled();
    expect(value.state).toBe('manual');
    expect(value.message).toContain('older extension folder');
  });

  it('rechecks actions that start while the helper idle query is pending', async () => {
    const queried = deferred<void>(), jobs = deferred<{ jobs: [] }>();
    let busy = false;
    vi.mocked(native).mockImplementation(async type => {
      if (type !== 'jobs') return status;
      queried.resolve();
      return jobs.promise;
    });
    const checking = new Updates(() => busy).status();
    await queried.promise;
    busy = true;
    jobs.resolve({ jobs: [] });
    await checking;
    expect(reload).not.toHaveBeenCalled();
  });
});
