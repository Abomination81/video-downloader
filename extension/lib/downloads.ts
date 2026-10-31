import { z } from 'zod';
import { HelperError, native } from './native';
import { jobSchema, type Job } from './schema';

const jobId = z.string().regex(/^[0-9a-f]{32}$/);
const transferUrl = z.string().max(1024).refine((value) => {
  try {
    const u = new URL(value);
    return u.protocol === 'http:' && u.hostname === '127.0.0.1' && !!u.port && !u.username && !u.password && !u.search && !u.hash && /^\/video\/[A-Za-z0-9_-]{43}\//.test(u.pathname);
  } catch { return false; }
});
const prepared = z.object({ url: transferUrl, filename: z.string().max(200).regex(/^(?:Video|Audio|Image) [\d -]+ [a-f0-9]{6}\.(?:mp4|mp3|jpg|png|webp|gif|tiff|avif|heic|heif|jxl|svg)$/) }).strict();
const record = z.object({ jobId, url: transferUrl.optional(), filename: z.string().max(200).optional(), downloadId: z.number().int().nonnegative().optional(), attempts: z.number().int().min(0).max(3).default(0), error: z.string().max(400).optional() }).strict();
type Record = z.infer<typeof record>;
const records = z.array(record).max(50);
const key = 'pendingChromeDownloads';
const alarm = 'finish-video-downloads';

/** IDs and local transfer capabilities only. Never persist site URLs or cookies. */
export class ChromeDownloads {
  private sequence: Promise<unknown> = Promise.resolve();
  private timer: ReturnType<typeof setTimeout> | undefined;
  constructor(private report: (error: unknown) => Promise<void>) {
    chrome.alarms.onAlarm.addListener((value) => { if (value.name === alarm) void this.wake(); });
    chrome.downloads.onChanged.addListener((change) => { if (change.state || change.error) void this.wake(); });
    chrome.runtime.onStartup.addListener(() => void this.wake());
    void this.wake();
  }
  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.sequence.then(fn);
    this.sequence = next.catch(() => undefined);
    return next;
  }
  private async read() {
    const data = await chrome.storage.local.get(key);
    return records.parse(data[key] ?? []);
  }
  private async write(values: Record[]) { await chrome.storage.local.set({ [key]: values }); }
  async track(id: string) {
    await this.serial(async () => {
      const values = await this.read();
      if (!values.some((r) => r.jobId === id)) values.push({ jobId: jobId.parse(id), attempts: 0 });
      await this.write(values);
      await chrome.alarms.create(alarm, { periodInMinutes: 0.5 });
    });
    void this.wake();
  }
  async retry(id: string) {
    await this.serial(async () => {
      const values = await this.read();
      const value = prepared.parse(await native('prepare', { jobId: jobId.parse(id) }));
      await this.write([...values.filter((r) => r.jobId !== id), { jobId: id, attempts: 0, ...value }]);
      await chrome.alarms.create(alarm, { periodInMinutes: 0.5 });
    });
    void this.wake();
    return {};
  }
  async cancel(id: string) {
    const result = await this.serial(async () => {
      const values = await this.read();
      const item = values.find((r) => r.jobId === id);
      if (item?.downloadId !== undefined) {
        const [download] = await chrome.downloads.search({ id: item.downloadId });
        if (download?.state === 'complete') return native('finish', { jobId: id, path: download.filename });
        if (download?.state === 'in_progress') await chrome.downloads.cancel(item.downloadId);
      }
      const result = await native('cancel', { jobId: id });
      await this.write(values.filter((r) => r.jobId !== id));
      return result;
    });
    void this.wake();
    return result;
  }
  async decorate(jobs: Job[]) {
    const values = await this.read();
    return jobs.map((job) => {
      const item = values.find((r) => r.jobId === job.id);
      return item?.error && ['ready', 'error'].includes(job.state) ? { ...job, state: 'save_error', error: item.error } : job;
    });
  }
  wake() {
    return this.serial(async () => {
      clearTimeout(this.timer);
      const values = await this.read();
      if (!values.length) { await chrome.alarms.clear(alarm); return; }
      await chrome.alarms.create(alarm, { periodInMinutes: 0.5 });
      try {
        const result = z.object({ jobs: z.array(jobSchema) }).parse(await native('jobs'));
        const remaining: Record[] = [];
        for (const item of values) {
          const job = result.jobs.find((j) => j.id === item.jobId);
          if (!job || ['done', 'cancelled', 'interrupted'].includes(job.state)) continue;
          if (job.state === 'error') {
            if (['unverified_transfer', 'transfer_failed'].includes(job.detail ?? '')) {
              item.error = job.error ?? 'Chrome’s saved file could not be verified. Choose Save file again.';
              remaining.push(item);
            }
            continue;
          }
          if (item.error) { remaining.push(item); continue; }
          if (job.state !== 'ready') { remaining.push(item); continue; }
          try {
            if (!item.url) {
              const value = prepared.parse(await native('prepare', { jobId: item.jobId }));
              item.url = value.url; item.filename = value.filename;
              // Persist before invoking Chrome. If the worker stops during the API
              // call, search by this unique URL instead of creating a duplicate.
              await this.write(values);
            }
            let download: chrome.downloads.DownloadItem | undefined;
            if (item.downloadId !== undefined) [download] = await chrome.downloads.search({ id: item.downloadId });
            else [download] = (await chrome.downloads.search({ url: item.url })).filter((d) => d.byExtensionId === chrome.runtime.id);
            if (!download) {
              item.downloadId = await chrome.downloads.download({ url: item.url, filename: item.filename, saveAs: false, conflictAction: 'uniquify' });
              item.attempts++;
              await this.write(values);
              [download] = await chrome.downloads.search({ id: item.downloadId });
            } else item.downloadId = download.id;
            if (download?.state === 'complete') await native('finish', { jobId: item.jobId, path: download.filename });
            else if (download?.state === 'interrupted') {
              if (download.error === 'USER_CANCELED') { await native('cancel', { jobId: item.jobId }); continue; }
              if (/^(NETWORK_|SERVER_)/.test(download.error ?? '') && item.attempts < 2) {
                delete item.url; delete item.downloadId; delete item.filename;
              } else throw new HelperError('chrome_save_failed', 'Chrome could not save this file. Check Chrome’s downloads for the reason, then choose Save file again.');
            }
          } catch (error) {
            item.error = error instanceof HelperError ? error.message : 'Chrome could not save the file. Check its download panel, then choose Save file again.';
            await this.report(new HelperError('chrome_save_failed', item.error));
          }
          remaining.push(item);
        }
        await this.write(remaining);
        await chrome.action.setBadgeText({ text: remaining.some((r) => r.error) ? '!' : remaining.length ? '↓' : '' });
        if (remaining.some((r) => !r.error)) this.timer = setTimeout(() => void this.wake(), 1500);
        else await chrome.alarms.clear(alarm);
      } catch (error) {
        await this.report(error);
        // The alarm retries after an interrupted native connection. Source
        // credentials remain exclusively in the independent download worker.
      }
    }).catch((error) => this.report(error));
  }
}
