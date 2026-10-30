import { z } from 'zod';
import { automaticChoice } from '../../lib/detection';
import { candidateSchema, type Candidate } from '../../lib/schema';
import { el, loadJobs, node, notice, request } from '../../lib/ui';

let tabId: number | undefined;
let poll: ReturnType<typeof setTimeout>;
let pendingCandidates: Candidate[] | undefined;
async function start(candidate: Candidate) {
  await request({ type: 'start', requestId: crypto.randomUUID(), candidate });
  pendingCandidates = undefined;
  el('#choices').hidden = true;
  await refresh();
}
function choices(candidates: Candidate[]) {
  el('#choices').hidden = false;
  const target = el('#candidates'); target.replaceChildren();
  for (const candidate of candidates) {
    const row = node('article', '', 'candidate');
    row.append(node('h3', candidate.title));
    if (candidate.width && candidate.height) row.append(node('p', `${candidate.width} × ${candidate.height} in the current player`));
    const button = document.createElement('button'); button.type = 'button'; button.className = 'btn quiet';
    button.textContent = candidate.protected ? 'Protected video' : 'Download this video'; button.disabled = candidate.protected;
    button.onclick = async () => { button.disabled = true; try { await start(candidate); } catch (error) { notice((error as Error).message); } finally { button.disabled = false; } };
    row.append(button); target.append(row);
  }
}
async function refresh() {
  clearTimeout(poll);
  try { await loadJobs(el('#jobs')); }
  catch (error) { el('#jobs').replaceChildren(node('p', (error as Error).message, 'empty')); }
  poll = setTimeout(refresh, 1500);
}
el<HTMLButtonElement>('#download').onclick = async () => {
  const button = el<HTMLButtonElement>('#download'); button.disabled = true; button.setAttribute('aria-busy', 'true');
  try {
    if (pendingCandidates) { choices(pendingCandidates); el('#choices').scrollIntoView({ block: 'nearest' }); return; }
    if (tabId === undefined) throw new Error('Open a website with a video first.');
    el('#notice').hidden = true;
    const result = z.object({ candidates: z.array(candidateSchema) }).parse(await request({ type: 'find', tabId }));
    const candidate = automaticChoice(result.candidates);
    if (candidate) await start(candidate); else choices(result.candidates);
  } catch (error) { notice((error as Error).message); }
  finally { button.disabled = false; button.removeAttribute('aria-busy'); }
};
el<HTMLButtonElement>('#clear').onclick = async () => { try { await request({ type: 'clear' }); await refresh(); } catch (error) { notice((error as Error).message); } };
async function init() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true }); tabId = tab?.id;
  const state = await chrome.storage.session.get(['lastError', 'choices']);
  if (state.lastError && typeof (state.lastError as { message?: unknown }).message === 'string') notice((state.lastError as { message: string }).message);
  const pending = z.object({ tabId: z.number(), at: z.number(), candidates: z.array(candidateSchema) }).safeParse(state.choices);
  if (pending.success && Date.now() - pending.data.at < 5 * 60 * 1000) {
    pendingCandidates = pending.data.candidates;
    choices(pendingCandidates);
    if (pending.data.tabId !== tabId) notice('Your video selection is from another tab. Choose the original video below, even if the site opened a popup.');
  }
  try {
    const status = z.object({ ready: z.boolean() }).parse(await request({ type: 'ping' }));
    el('#helper-status').textContent = status.ready ? 'Ready. You can leave the video page.' : 'Run the installer to finish setup.';
    el<HTMLButtonElement>('#download').disabled = !status.ready;
  } catch (error) { el('#helper-status').textContent = (error as Error).message; el<HTMLButtonElement>('#download').disabled = true; }
  await refresh();
}
void init().catch((error) => notice((error as Error).message));
