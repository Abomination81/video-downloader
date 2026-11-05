// Worker-only services supplied by the reproducible unified build. Nothing is
// exposed through window, external messages, or web-accessible resources.
export interface IntegratedServices {
  protection(message: Record<string, unknown>): Promise<unknown>;
  capture(tab: chrome.tabs.Tab, autoSave?: boolean): Promise<void>;
  captureBusy(): boolean;
  acquireOffscreen(path: string, reasons: Array<'CLIPBOARD' | 'WORKERS'>, justification: string): Promise<() => Promise<void>>;
}
export function integrated(): IntegratedServices {
  const value = (globalThis as typeof globalThis & { vdServices?: IntegratedServices }).vdServices;
  if (!value) throw new Error('The complete extension could not start. Reload it and try again.');
  return value;
}
