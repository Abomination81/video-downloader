import { integrated } from './integrated';
let pending = Promise.resolve();

export function copyLink(text: string): Promise<void> {
  const task = pending.then(async () => {
    const close = await integrated().acquireOffscreen('clipboard.html', ['CLIPBOARD'], 'Copy a web link explicitly requested from the context menu.');
    try {
      const result = await chrome.runtime.sendMessage({ target: 'clipboard', type: 'copy-link', text });
      if (result?.ok !== true) throw new Error('The link could not be copied. Try again.');
    } finally {
      await close();
    }
  });
  pending = task.catch(() => undefined);
  return task;
}
