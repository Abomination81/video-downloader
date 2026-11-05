// Chrome permits one offscreen document per extension. Keep the whole task
// under a lease, including teardown, so filter compilation and copying cannot
// close one another's document. No pages can acquire this worker-only lease.
let tail = Promise.resolve();
export async function acquireOffscreen(path, reasons, justification) {
  const previous = tail;
  let release;
  tail = new Promise(resolve => { release = resolve; });
  await previous;
  try {
    // Clean up an orphan left by a terminated worker before taking ownership.
    const contexts = await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] });
    if (contexts.length) await chrome.offscreen.closeDocument();
    await chrome.offscreen.createDocument({ url: path, reasons, justification });
  } catch (error) { release(); throw error; }
  let closed = false;
  return async () => {
    if (closed) return;
    closed = true;
    try { await chrome.offscreen.closeDocument(); }
    finally { release(); }
  };
}
