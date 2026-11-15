import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { native } from '../extension/lib/native';
import { ChromeDownloads } from '../extension/lib/downloads';

vi.mock('../extension/lib/native', () => ({
  native: vi.fn(),
  HelperError: class extends Error { constructor(public code: string, message: string) { super(message); } },
}));

const id = 'a'.repeat(32);
const message = 'Some frames were lost during processing. No incomplete file was saved.';
let local: Record<string, unknown>;
let session: Record<string, unknown>;
beforeEach(() => {
  vi.useFakeTimers();
  local = {}; session = {};
  const event = () => ({ addListener: vi.fn() });
  vi.stubGlobal('chrome', {
    alarms: { onAlarm: event(), create: vi.fn(), clear: vi.fn() },
    downloads: { onChanged: event(), download: vi.fn() },
    runtime: { onStartup: event() },
    action: { setBadgeText: vi.fn() },
    storage: {
      local: { get: async () => local, set: async (data: object) => { Object.assign(local, data); } },
      session: { get: async () => session },
    },
  });
  vi.mocked(native).mockResolvedValue({ jobs: [{ id, state: 'error', title: 'Video', progress: 100, filename: null, error: message, detail: 'frames_missing', created: 1 }] });
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.resetAllMocks(); });

it('surfaces processing failures once and retains the error badge after polling stops', async () => {
  const report = vi.fn(async (error: unknown) => { session.lastError = { message: (error as Error).message }; });
  const downloads = new ChromeDownloads(report);
  await downloads.track(id);
  await downloads.wake();
  expect(report).toHaveBeenCalledOnce();
  expect(report.mock.calls[0]![0]).toMatchObject({ message });
  expect(chrome.action.setBadgeText).toHaveBeenLastCalledWith({ text: '!' });
  expect(chrome.downloads.download).not.toHaveBeenCalled();
  expect(local.pendingChromeDownloads).toEqual([]);
  await downloads.wake();
  expect(report).toHaveBeenCalledOnce();
  expect(chrome.action.setBadgeText).toHaveBeenLastCalledWith({ text: '!' });
});

it('keeps an unread failure visible when another pending download finishes', async () => {
  session.lastError = { message };
  const downloads = new ChromeDownloads(async () => {});
  vi.mocked(native).mockResolvedValue({ jobs: [{ id, state: 'done', title: 'Video', progress: 100, filename: 'video.mp4', error: null, detail: null, created: 1 }] });
  await downloads.track(id);
  await downloads.wake();
  expect(chrome.action.setBadgeText).toHaveBeenLastCalledWith({ text: '!' });
});
