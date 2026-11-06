import { z } from 'zod';
import { defaults, settingsSchema } from './schema';
import { HelperError, native } from './native';

export const updateSchema = z.object({ state: z.string(), message: z.string(), installedVersion: z.string(), enabled: z.boolean(), target: z.string().optional(), checked: z.number().optional(), updated: z.number().optional() });
const alarm = 'silent-updates';
const working = new Set(['checking', 'downloading', 'preparing', 'waiting', 'applying']);

export class Updates {
  private running = false;
  private activationPending = false;

  constructor(private readonly isBusy: () => boolean = () => false) {
    chrome.alarms.onAlarm.addListener((event) => { if (event.name === alarm) void this.tick(); });
    chrome.runtime.onStartup.addListener(() => { void this.tick(); });
    chrome.runtime.onInstalled.addListener(() => { void this.tick(); });
    chrome.tabs.onRemoved.addListener(() => { if (this.activationPending) void this.tick(true); });
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'local' && changes.settings) void this.tick();
    });
    // Alarms persist through service-worker suspension. Restore one if Chrome
    // discarded it during a browser restart, without continually resetting it.
    // The helper checks release servers at most every six hours. This local
    // poll notices releases installed independently by the background agent.
    void chrome.alarms.get(alarm).then(async value => {
      if (![0.5, 1].includes(value?.periodInMinutes ?? 0)) await chrome.alarms.create(alarm, { delayInMinutes: 1, periodInMinutes: 1 });
    });
  }

  async check(force = false) {
    const saved = await chrome.storage.local.get('settings');
    const settings = settingsSchema.parse({ ...defaults, ...(saved.settings as object ?? {}) });
    const chromeVersion = Math.max(127, Number(/(?:Chrome|Chromium)\/(\d+)/.exec(navigator.userAgent)?.[1] ?? 127));
    const value = updateSchema.parse(await native('updates', { enabled: settings.autoUpdates, force, chromeVersion }));
    return this.accept(value);
  }

  async status() {
    const value = updateSchema.parse(await native('update-status'));
    return this.accept(value);
  }

  private async accept(value: z.infer<typeof updateSchema>) {
    const save = async (status: typeof value) => { await chrome.storage.local.set({ updateStatus: status }); return status; };
    const waiting = (message: string) => save({ ...value, state: 'ready', message: `Version ${value.installedVersion} is installed. ${message}` });
    this.activationPending = value.installedVersion !== chrome.runtime.getManifest().version;
    const polling = working.has(value.state) || this.activationPending;
    const period = polling ? 0.5 : 1;
    const current = await chrome.alarms.get(alarm);
    if (current?.periodInMinutes !== period) await chrome.alarms.create(alarm, { delayInMinutes: period, periodInMinutes: period });
    if (!this.activationPending || value.state === 'applying') return save(value);
    if (this.isBusy()) return waiting('It will activate after the current download action or screenshot finishes.');
    const disk = z.object({ version: z.string() }).parse(await (await fetch(chrome.runtime.getURL('manifest.json'), { cache: 'no-store' })).json());
    if (disk.version !== value.installedVersion) {
      const manual = { ...value, state: 'manual', message: 'Chrome is using an older extension folder. Load the installed extension folder once to activate automatic updates. Settings shows the installed folder.' };
      return save(manual);
    }
    const pages = await chrome.tabs.query({});
    if (pages.some(tab => tab.url?.startsWith(chrome.runtime.getURL('')))) return waiting('Close Toolkit settings, previews and other Toolkit tabs to activate it. Your website tabs can stay open.');
    const views = await chrome.runtime.getContexts({ contextTypes: ['POPUP' as chrome.runtime.ContextType, 'SIDE_PANEL' as chrome.runtime.ContextType] });
    if (views.length) return waiting('Close the Toolkit menu or side panel to activate it.');
    // The helper only commits while its download/cleanup queues are idle.
    // Recheck here so a newly started job also keeps its Chrome handoff alive.
    const jobs = z.object({ jobs: z.array(z.object({ state: z.string() })) }).parse(await native('jobs'));
    if (jobs.jobs.some(job => ['queued', 'resolving', 'downloading', 'converting', 'cleaning', 'verifying', 'ready', 'finalizing'].includes(job.state))) return waiting('It will activate after current downloads finish.');
    if (this.isBusy()) return waiting('It will activate after the current download action or screenshot finishes.');
    await save(value);
    chrome.runtime.reload();
    return value;
  }

  private async tick(statusOnly = false) {
    if (this.running) return;
    this.running = true;
    try { if (statusOnly) await this.status(); else await this.check(); }
    catch (error) {
      // Updating is auxiliary. Keep downloads usable and show the failure in
      // Settings; the persistent alarm retries without an error badge/pop-up.
      await chrome.storage.local.set({ updateStatus: { state: 'error', message: 'Updates could not be checked. Downloads still work; another check will run later.', code: error instanceof HelperError ? error.code : error instanceof z.ZodError ? 'invalid_update_status' : 'update_failed' } });
    } finally { this.running = false; }
  }
}
