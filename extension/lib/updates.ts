import { z } from 'zod';
import { defaults, settingsSchema } from './schema';
import { HelperError, native } from './native';

export const updateSchema = z.object({ state: z.string(), message: z.string(), installedVersion: z.string(), enabled: z.boolean(), target: z.string().optional(), checked: z.number().optional(), updated: z.number().optional() });
const alarm = 'silent-updates';
const working = new Set(['checking', 'downloading', 'preparing', 'waiting', 'applying']);

export class Updates {
  private running = false;

  constructor(private readonly isBusy: () => boolean = () => false) {
    chrome.alarms.onAlarm.addListener((event) => { if (event.name === alarm) void this.tick(); });
    chrome.runtime.onStartup.addListener(() => { void this.tick(); });
    chrome.runtime.onInstalled.addListener(() => { void this.tick(); });
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'local' && changes.settings) void this.tick();
    });
    // Alarms persist through service-worker suspension. Restore one if Chrome
    // discarded it during a browser restart, without continually resetting it.
    void chrome.alarms.get(alarm).then(async value => { if (!value) await chrome.alarms.create(alarm, { delayInMinutes: 1, periodInMinutes: 60 }); });
  }

  async check(force = false) {
    const saved = await chrome.storage.local.get('settings');
    const settings = settingsSchema.parse({ ...defaults, ...(saved.settings as object ?? {}) });
    const chromeVersion = Math.max(127, Number(/(?:Chrome|Chromium)\/(\d+)/.exec(navigator.userAgent)?.[1] ?? 127));
    const value = updateSchema.parse(await native('updates', { enabled: settings.autoUpdates, force, chromeVersion }));
    await this.accept(value);
    return value;
  }

  async status() {
    const value = updateSchema.parse(await native('update-status'));
    await this.accept(value);
    return value;
  }

  private async accept(value: z.infer<typeof updateSchema>) {
    await chrome.storage.local.set({ updateStatus: value });
    const polling = working.has(value.state) || value.installedVersion !== chrome.runtime.getManifest().version;
    const period = polling ? 0.5 : 60;
    const current = await chrome.alarms.get(alarm);
    if (current?.periodInMinutes !== period) await chrome.alarms.create(alarm, { delayInMinutes: period, periodInMinutes: period });
    if (value.installedVersion === chrome.runtime.getManifest().version || value.state === 'applying' || this.isBusy()) return;
    const pages = await chrome.tabs.query({});
    if (pages.some(tab => tab.url?.startsWith(chrome.runtime.getURL('')))) return;
    const views = await chrome.runtime.getContexts({ contextTypes: ['POPUP' as chrome.runtime.ContextType, 'SIDE_PANEL' as chrome.runtime.ContextType] });
    if (views.length) return;
    // The helper only commits while its download/cleanup queues are idle.
    // Recheck here so a newly started job also keeps its Chrome handoff alive.
    const jobs = z.object({ jobs: z.array(z.object({ state: z.string() })) }).parse(await native('jobs'));
    if (jobs.jobs.some(job => ['queued', 'resolving', 'downloading', 'converting', 'cleaning', 'verifying', 'ready', 'finalizing'].includes(job.state))) return;
    if (this.isBusy()) return;
    chrome.runtime.reload();
  }

  private async tick() {
    if (this.running) return;
    this.running = true;
    try { await this.check(); }
    catch (error) {
      // Updating is auxiliary. Keep downloads usable and show the failure in
      // Settings; the persistent alarm retries without an error badge/pop-up.
      await chrome.storage.local.set({ updateStatus: { state: 'error', message: 'Updates could not be checked. Downloads still work; another check will run later.', code: error instanceof HelperError ? error.code : error instanceof z.ZodError ? 'invalid_update_status' : 'update_failed' } });
    } finally { this.running = false; }
  }
}
