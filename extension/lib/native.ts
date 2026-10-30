import { z } from 'zod';

const envelope = z.object({ id: z.string(), ok: z.boolean(), result: z.unknown().optional(), error: z.object({ code: z.string(), message: z.string() }).optional() });
export class HelperError extends Error {
  constructor(public code: string, message: string) { super(message); }
}
let port: chrome.runtime.Port | undefined;
let idleTimer: ReturnType<typeof setTimeout> | undefined;
const pending = new Map<string, { resolve: (x: unknown) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }>();

function connect() {
  if (port) return port;
  port = chrome.runtime.connectNative('com.video_downloader.helper');
  port.onMessage.addListener((value: unknown) => {
    const parsed = envelope.safeParse(value);
    if (!parsed.success) return;
    const msg = parsed.data;
    const item = pending.get(msg.id);
    if (!item) return;
    clearTimeout(item.timer); pending.delete(msg.id);
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => { if (!pending.size) { port?.disconnect(); port = undefined; } }, 30000);
    if (msg.ok) item.resolve(msg.result);
    else item.reject(new HelperError(msg.error?.code ?? 'helper_error', msg.error?.message ?? 'The helper could not complete that action.'));
  });
  port.onDisconnect.addListener(() => {
    const reason = chrome.runtime.lastError?.message;
    port = undefined;
    for (const item of pending.values()) {
      clearTimeout(item.timer);
      item.reject(new HelperError('helper_missing', reason?.includes('not found') ? 'Install the local helper to start downloading.' : 'The helper disconnected. Reopen the extension to reconnect.'));
    }
    pending.clear();
  });
  return port;
}
export function native<T = unknown>(type: string, fields: Record<string, unknown> = {}): Promise<T> {
  clearTimeout(idleTimer);
  const id = crypto.randomUUID();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(id); reject(new HelperError('helper_timeout', 'The helper did not respond. Check setup and try again.')); }, 15000);
    pending.set(id, { resolve: (x) => resolve(x as T), reject, timer });
    try { connect().postMessage({ id, type, ...fields }); }
    catch { clearTimeout(timer); pending.delete(id); reject(new HelperError('helper_missing', 'Install the local helper to start downloading.')); }
  });
}
