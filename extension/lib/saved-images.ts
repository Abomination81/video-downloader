import { z } from 'zod';
import { HelperError, native } from './native';
import { defaults, jobSchema, settingsSchema } from './schema';

const pendingSchema = z.array(z.object({ id: z.number().int().nonnegative(), requestId: z.string().uuid(), jobId: z.string().regex(/^[a-f0-9]{32}$/).optional() }).strict()).max(500);
const KEY = 'savedImagesToClean', SEEN = 'cleanedImageDownloads', ALARM = 'clean-saved-images';

export class SavedImages {
  private queue: Promise<unknown> = Promise.resolve();
  private timer: ReturnType<typeof setTimeout> | undefined;
  constructor(private report: (error: unknown) => Promise<void>) {
    chrome.downloads.onChanged.addListener((change) => { if (change.state?.current === 'complete') void this.observe(change.id); });
    chrome.downloads.onCreated.addListener((item) => { if (item.state === 'complete') void this.observe(item.id); });
    chrome.alarms.onAlarm.addListener((alarm) => { if (alarm.name === ALARM) void this.wake(); });
    chrome.runtime.onStartup.addListener(() => void this.wake());
    void this.wake();
  }
  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.queue.then(fn);
    this.queue = next.catch(() => undefined);
    return next;
  }
  private async observe(id: number) {
    await this.serial(async () => {
      const data = await chrome.storage.local.get(['settings', KEY, SEEN]);
      if (!settingsSchema.parse({ ...defaults, ...(data.settings as object ?? {}) }).cleanImages) return;
      const [item] = await chrome.downloads.search({ id });
      if (!item || item.state !== 'complete' || item.byExtensionId === chrome.runtime.id || !(/^image\//i.test(item.mime) || /\.(?:jpe?g|png|webp|gif|tiff?|avif|heic|heif|jxl|svg)$/i.test(item.filename))) return;
      const pending = pendingSchema.parse(data[KEY] ?? []);
      const seen = z.array(z.number().int()).parse(data[SEEN] ?? []);
      if (pending.some((r) => r.id === id) || seen.includes(id)) return;
      pending.push({ id, requestId: crypto.randomUUID() });
      await chrome.storage.local.set({ [KEY]: pending });
    }).catch((error) => this.report(error));
    void this.wake();
  }
  wake() {
    return this.serial(async () => {
      clearTimeout(this.timer);
      const data = await chrome.storage.local.get([KEY, SEEN]);
      const pending = pendingSchema.parse(data[KEY] ?? []);
      if (!pending.length) { await chrome.alarms.clear(ALARM); return; }
      await chrome.alarms.create(ALARM, { periodInMinutes: 0.5 });
      const seen = z.array(z.number().int()).parse(data[SEEN] ?? []);
      const jobs = z.object({ jobs: z.array(jobSchema) }).parse(await native('jobs')).jobs;
      const remaining: typeof pending = [];
      for (const item of pending) {
        if (!item.jobId) {
          const [download] = await chrome.downloads.search({ id: item.id });
          if (!download || download.state !== 'complete') { seen.push(item.id); continue; }
          try {
            const result = z.object({ jobId: z.string() }).parse(await native('clean-image', { requestId: item.requestId, path: download.filename }));
            item.jobId = result.jobId;
            await chrome.storage.local.set({ [KEY]: pending });
          } catch (error) {
            if (error instanceof HelperError && error.code === 'queue_full') { remaining.push(item); continue; }
            throw error;
          }
          remaining.push(item);
        } else {
          const job = jobs.find((j) => j.id === item.jobId);
          if (job && !['done', 'error', 'cancelled', 'interrupted'].includes(job.state)) remaining.push(item);
          else {
            seen.push(item.id);
            if (job?.state === 'error' || job?.state === 'interrupted') await this.report(new HelperError('image_cleanup_failed', job.error ?? 'The image was saved, but its metadata could not be cleaned.'));
          }
        }
      }
      await chrome.storage.local.set({ [KEY]: remaining, [SEEN]: seen.slice(-500) });
      if (remaining.length) this.timer = setTimeout(() => void this.wake(), 1500); else await chrome.alarms.clear(ALARM);
    }).catch((error) => this.report(error));
  }
}
