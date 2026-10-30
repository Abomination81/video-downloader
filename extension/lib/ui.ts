import { z } from 'zod';
import { jobSchema, type Job } from './schema';

export async function request<T = unknown>(message: Record<string, unknown>): Promise<T> {
  const reply = await chrome.runtime.sendMessage(message);
  const parsed = z.object({ ok: z.boolean(), result: z.unknown().optional(), error: z.object({ code: z.string(), message: z.string() }).optional() }).parse(reply);
  if (!parsed.ok) throw new Error(parsed.error?.message ?? 'This action could not finish. Try again.');
  return parsed.result as T;
}
export const el = <T extends HTMLElement = HTMLElement>(selector: string) => document.querySelector<T>(selector)!;
export function notice(message: string) { const node = el('#notice'); node.textContent = message; node.hidden = false; }
export const node = (tag: string, text = '', className = '') => { const result = document.createElement(tag); result.textContent = text; result.className = className; return result; };
const labels: Record<string, string> = { queued: 'Queued', resolving: 'Finding the best quality…', downloading: 'Downloading…', converting: 'Preparing compatible H.264/AAC…', cleaning: 'Removing metadata…', verifying: 'Checking the file…', ready: 'Saving with Chrome…', finalizing: 'Checking Chrome’s saved file…', save_error: 'Chrome needs your attention', done: 'Saved with metadata removed', error: 'Couldn’t finish', cancelled: 'Cancelled', interrupted: 'Interrupted' };
export function renderJobs(jobs: Job[], target: HTMLElement) {
  target.replaceChildren();
  if (!jobs.length) { target.append(node('p', 'Your downloads will appear here.', 'empty')); return; }
  for (const job of jobs) {
    const row = node('article', '', 'job');
    row.append(node('h3', job.title));
    row.append(node('p', labels[job.state] ?? job.state));
    if (job.detail && job.state === 'done') row.append(node('p', job.detail));
    if (job.error) row.append(node('p', job.error, 'error'));
    if (['queued', 'resolving', 'downloading', 'converting', 'cleaning', 'verifying', 'ready', 'finalizing'].includes(job.state)) {
      const progress = document.createElement('progress');
      progress.max = 100; progress.setAttribute('aria-label', `Progress for ${job.title}`);
      if (job.state === 'downloading' && job.progress > 0) progress.value = job.progress;
      row.append(progress);
    }
    if (job.state === 'save_error') {
      const retry = document.createElement('button'); retry.type = 'button'; retry.className = 'link-button'; retry.textContent = 'Save file again';
      retry.onclick = async () => { retry.disabled = true; try { await request({ type: 'retry-save', jobId: job.id }); } catch (error) { notice((error as Error).message); } finally { retry.disabled = false; } };
      row.append(retry);
    }
    if (job.state === 'done' || ['queued', 'resolving', 'downloading', 'converting', 'cleaning', 'verifying', 'ready', 'save_error'].includes(job.state)) {
      const button = document.createElement('button');
      button.type = 'button'; button.className = 'link-button';
      button.textContent = job.state === 'done' ? 'Show file' : 'Cancel';
      button.onclick = async () => {
        button.disabled = true;
        try { await request({ type: job.state === 'done' ? 'reveal' : 'cancel', jobId: job.id }); }
        catch (error) { notice(error instanceof Error ? error.message : 'The action failed.'); }
        finally { button.disabled = false; }
      };
      row.append(button);
    }
    target.append(row);
  }
}
export async function loadJobs(target: HTMLElement) {
  const result = z.object({ jobs: z.array(jobSchema) }).parse(await request({ type: 'jobs' }));
  renderJobs(result.jobs, target);
}
