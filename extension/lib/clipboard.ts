let pending = Promise.resolve();

export function copyLink(text: string): Promise<void> {
  const task = pending.then(async () => {
    const url = chrome.runtime.getURL('/clipboard.html');
    const contexts = await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'], documentUrls: [url] });
    if (!contexts.length) await chrome.offscreen.createDocument({ url: 'clipboard.html', reasons: ['CLIPBOARD'], justification: 'Copy a web link explicitly requested from the context menu.' });
    try {
      const result = await chrome.runtime.sendMessage({ target: 'clipboard', type: 'copy-link', text });
      if (result?.ok !== true) throw new Error('The link could not be copied. Try again.');
    } finally {
      await chrome.offscreen.closeDocument();
    }
  });
  pending = task.catch(() => undefined);
  return task;
}
