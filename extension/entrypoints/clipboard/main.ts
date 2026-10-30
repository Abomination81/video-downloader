import { z } from 'zod';
import { httpUrl } from '../../lib/schema';

const message = z.object({ target: z.literal('clipboard'), type: z.literal('copy-link'), text: httpUrl }).strict();
chrome.runtime.onMessage.addListener((raw, sender, respond) => {
  if (sender.id !== chrome.runtime.id || sender.tab) return;
  const parsed = message.safeParse(raw);
  if (!parsed.success) return;
  const field = document.querySelector<HTMLTextAreaElement>('#clipboard')!;
  try {
    field.value = parsed.data.text;
    field.select();
    // Chrome's documented offscreen pattern: the async Clipboard API requires
    // focus, which an offscreen document deliberately does not have.
    respond({ ok: document.execCommand('copy') });
  } finally { field.value = ''; }
});
