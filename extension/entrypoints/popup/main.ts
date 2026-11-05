import { z } from 'zod';
import { automaticChoice } from '../../lib/detection';
import { candidateSchema, formatsSchema, intentSchema, type Candidate, type DownloadIntent, type DownloadOptions, type FormatOption } from '../../lib/schema';
import { el, loadJobs, node, notice, request } from '../../lib/ui';

let tabId: number | undefined;
let poll: ReturnType<typeof setTimeout>;
let formatPoll: ReturnType<typeof setTimeout>;
let pendingCandidates: Candidate[] | undefined;
let pendingIntent: DownloadIntent = 'video';
const pickerSchema = z.object({ candidate: candidateSchema, probeId: z.string().regex(/^[0-9a-f]{32}$/), at: z.number(), profile: z.enum(['compatible', 'original', 'mp3']), choice: z.string(), bitrate: z.union([z.literal(128), z.literal(192), z.literal(256), z.literal(320)]) });
let picker: z.infer<typeof pickerSchema> | undefined;
let formats: FormatOption[] = [];
let checking = false;

async function start(candidate: Candidate, options: DownloadOptions = {}) {
  await request({ type: 'start', requestId: crypto.randomUUID(), candidate, options });
  pendingCandidates = undefined; picker = undefined;
  clearTimeout(formatPoll);
  el('#choices').hidden = true; el('#format-picker').hidden = true;
  await refresh();
}
async function choose(candidate: Candidate, intent: DownloadIntent) {
  if (intent === 'formats') return openPicker(candidate);
  return start(candidate, { assetType: intent });
}
function choices(candidates: Candidate[], intent: DownloadIntent) {
  pendingCandidates = candidates;
  pendingIntent = intent;
  el('#choices').hidden = false;
  const target = el('#candidates'); target.replaceChildren();
  for (const candidate of candidates) {
    const row = node('article', '', 'candidate');
    row.append(node('h3', candidate.title));
    if (candidate.width && candidate.height) row.append(node('p', `${candidate.width} × ${candidate.height} in the current player`));
    const button = document.createElement('button'); button.type = 'button'; button.className = 'btn quiet';
    button.textContent = candidate.protected ? 'Protected video' : intent === 'formats' ? 'Choose formats' : intent === 'audio' ? 'Download this audio' : 'Download this video'; button.disabled = candidate.protected;
    button.onclick = async () => { button.disabled = true; try { await choose(candidate, pendingIntent); } catch (error) { notice((error as Error).message); } finally { button.disabled = false; } };
    row.append(button); target.append(row);
  }
}
async function refresh() {
  clearTimeout(poll);
  try { await loadJobs(el('#jobs')); }
  catch (error) { el('#jobs').replaceChildren(node('p', (error as Error).message, 'empty')); }
  poll = setTimeout(refresh, 1500);
}
function formatLabel(option: FormatOption) {
  const parts = option.kind === 'video' ? [option.height ? `${option.width ?? '?'} × ${option.height}` : 'Source resolution', option.fps ? `${option.fps} fps` : '', option.codec.toUpperCase(), option.hdr && option.hdr !== 'SDR' ? option.hdr : '', option.audioCodec === 'none' ? 'no audio' : option.audioCodec.toUpperCase()] : [option.codec.toUpperCase() || 'Source audio', option.bitrate ? `${Math.round(option.bitrate)} kbps` : '', option.language];
  if (option.size) parts.push(`${option.approximate ? '~' : ''}${(option.size / 1024 / 1024).toFixed(1)} MB source`);
  return parts.filter(Boolean).join(' · ');
}
function renderFormats() {
  if (!picker) return;
  const audio = picker.profile === 'mp3';
  const select = el<HTMLSelectElement>('#source-format'); select.replaceChildren(new Option(audio ? 'Best available audio (default)' : 'Highest quality available (default)', ''));
  for (const option of formats.filter(f => f.kind === (audio ? 'audio' : 'video'))) select.add(new Option(formatLabel(option), option.id));
  select.value = picker.choice;
  if (select.selectedIndex < 0) { select.value = ''; picker.choice = ''; }
  select.disabled = checking;
  el('#mp3-quality').hidden = !audio;
  el('#format-note').textContent = audio ? 'MP3 conversion is lossy. Existing MP3 audio is preserved when possible. Tags, artwork, and chapters are removed; playback headers remain.' : picker.profile === 'compatible' ? 'H.264/AAC MP4. Selected resolution and frame rate are preserved; conversion happens only when needed. Source size may differ from the final file.' : 'MP4 with the source codecs preserved. Some source codecs cannot be stored in MP4 or uploaded to every service.';
  el<HTMLButtonElement>('#format-download').textContent = audio ? 'Download MP3' : 'Download MP4';
  el<HTMLButtonElement>('#format-download').disabled = checking;
}
async function savePicker() { if (picker) await chrome.storage.session.set({ formatPicker: picker }); }
async function checkFormats() {
  clearTimeout(formatPoll);
  const current = picker;
  if (!current) return;
  try {
    const result = formatsSchema.parse(await request({ type: 'formats', probeId: current.probeId }));
    if (picker !== current) return;
    formats = result.options; checking = result.state !== 'done';
    el('#format-status').textContent = checking ? 'Checking the source formats… You can close and reopen this menu.' : `${formats.filter(f => f.kind === 'video').length} video · ${formats.filter(f => f.kind === 'audio').length} audio options`;
    renderFormats();
    if (checking) formatPoll = setTimeout(checkFormats, 1200);
  } catch (error) {
    if (picker !== current) return;
    checking = true; renderFormats();
    el('#format-status').textContent = (error as Error).message;
  }
}
function showPicker() {
  if (!picker) return;
  el('#choices').hidden = true; el('#format-picker').hidden = false;
  el('#format-title').textContent = picker.candidate.title;
  el<HTMLSelectElement>('#output-format').value = picker.profile;
  el<HTMLSelectElement>('#audio-bitrate').value = String(picker.bitrate);
  checking = true; formats = []; renderFormats();
  void checkFormats();
}
async function openPicker(candidate: Candidate) {
  const old = picker;
  if (old) await request({ type: 'cancel', jobId: old.probeId });
  const result = z.object({ jobId: z.string() }).parse(await request({ type: 'inspect', requestId: crypto.randomUUID(), candidate }));
  picker = { candidate, probeId: result.jobId, at: Date.now(), profile: 'compatible', choice: '', bitrate: 320 };
  showPicker();
}
async function fromPage(intent: DownloadIntent) {
  if (picker) { await choose(picker.candidate, intent); return; }
  if (pendingCandidates) {
    if (pendingCandidates.length === 1) await choose(pendingCandidates[0]!, intent);
    else choices(pendingCandidates, intent);
    return;
  }
  if (tabId === undefined) throw new Error('Open a website with a video first.');
  el('#notice').hidden = true;
  const result = z.object({ candidates: z.array(candidateSchema) }).parse(await request({ type: 'find', tabId }));
  const candidate = automaticChoice(result.candidates);
  if (candidate) await choose(candidate, intent); else choices(result.candidates, intent);
}
for (const [id, intent] of [['download', 'video'], ['choose-format', 'formats'], ['download-mp3', 'audio']] as const) {
  el<HTMLButtonElement>(`#${id}`).onclick = async () => {
    const button = el<HTMLButtonElement>(`#${id}`); button.disabled = true; button.setAttribute('aria-busy', 'true');
    try { await fromPage(intent); } catch (error) { notice((error as Error).message); }
    finally { button.disabled = false; button.removeAttribute('aria-busy'); }
  };
}
el<HTMLSelectElement>('#output-format').onchange = () => {
  if (!picker) return;
  picker.profile = z.enum(['compatible', 'original', 'mp3']).parse(el<HTMLSelectElement>('#output-format').value);
  picker.choice = ''; renderFormats(); void savePicker();
};
el<HTMLSelectElement>('#source-format').onchange = () => { if (picker) { picker.choice = el<HTMLSelectElement>('#source-format').value; void savePicker(); } };
el<HTMLSelectElement>('#audio-bitrate').onchange = () => { if (picker) { picker.bitrate = z.union([z.literal(128), z.literal(192), z.literal(256), z.literal(320)]).parse(Number(el<HTMLSelectElement>('#audio-bitrate').value)); void savePicker(); } };
el<HTMLButtonElement>('#format-download').onclick = async () => {
  if (!picker || checking) return;
  const button = el<HTMLButtonElement>('#format-download'); button.disabled = true;
  try {
    const { candidate, probeId, profile, choice, bitrate } = picker;
    await start(candidate, { assetType: profile === 'mp3' ? 'audio' : 'video', outputProfile: profile === 'mp3' ? 'compatible' : profile, audioBitrate: bitrate, ...(choice ? { formatSelection: { probeId, optionId: choice } } : {}) });
  } catch (error) { notice((error as Error).message); }
  finally { button.disabled = checking; }
};
el<HTMLButtonElement>('#close-formats').onclick = async () => {
  const previous = picker; picker = undefined; clearTimeout(formatPoll);
  el('#format-picker').hidden = true;
  await chrome.storage.session.remove(['formatPicker', 'choices']); pendingCandidates = undefined;
  if (previous) try { await request({ type: 'cancel', jobId: previous.probeId }); } catch (error) { notice((error as Error).message); }
};
el<HTMLButtonElement>('#refresh-formats').onclick = async () => {
  const candidate = picker?.candidate; if (!candidate) return;
  const button = el<HTMLButtonElement>('#refresh-formats'); button.disabled = true;
  try { await openPicker(candidate); } catch (error) { notice((error as Error).message); } finally { button.disabled = false; }
};
el<HTMLButtonElement>('#clear').onclick = async () => { try { await request({ type: 'clear' }); await refresh(); } catch (error) { notice((error as Error).message); } };
el<HTMLButtonElement>('#copy-clean-link').onclick = async () => {
  const button = el<HTMLButtonElement>('#copy-clean-link'); button.disabled = true;
  try {
    if (tabId === undefined) throw new Error('Open a website first.');
    await request({ type: 'copy-context-link', tabId }); button.querySelector('span')!.textContent = 'Link copied'; button.setAttribute('aria-label', 'Link copied');
  } catch (error) { notice((error as Error).message); }
  finally { button.disabled = false; }
};
async function init() {
  void featureStatus();
  const platform = await chrome.runtime.getPlatformInfo();
  el('#download-shortcut').textContent = platform.os === 'mac' ? '⌥⇧V' : 'Alt+Shift+V';
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true }); tabId = tab?.id;
  const state = await chrome.storage.session.get(['lastError', 'choices', 'formatPicker']);
  if (state.lastError && typeof (state.lastError as { message?: unknown }).message === 'string') notice((state.lastError as { message: string }).message);
  const savedPicker = pickerSchema.safeParse(state.formatPicker);
  const pending = z.object({ tabId: z.number(), at: z.number(), candidates: z.array(candidateSchema), intent: intentSchema.default('video') }).safeParse(state.choices);
  if (savedPicker.success && Date.now() - savedPicker.data.at < 15 * 60 * 1000) { picker = savedPicker.data; showPicker(); }
  else if (pending.success && Date.now() - pending.data.at < 5 * 60 * 1000) {
    pendingCandidates = pending.data.candidates;
    if (pending.data.intent === 'formats' && pendingCandidates.length === 1) await openPicker(pendingCandidates[0]!);
    else choices(pendingCandidates, pending.data.intent);
    if (pending.data.tabId !== tabId) notice('Your video selection is from another tab. Choose the original video below, even if the site opened a popup.');
  }
  try {
    const status = z.object({ ready: z.boolean() }).parse(await request({ type: 'ping' }));
    el('#helper-status').textContent = status.ready ? 'Ready · Downloads continue after you leave.' : 'Run the installer to finish setup.';
    el('#helper-status').dataset.ready = String(status.ready);
    for (const id of ['download', 'choose-format', 'download-mp3']) el<HTMLButtonElement>(`#${id}`).disabled = !status.ready;
  } catch (error) { el('#helper-status').textContent = (error as Error).message; for (const id of ['download', 'choose-format', 'download-mp3']) el<HTMLButtonElement>(`#${id}`).disabled = true; }
  await refresh();
}
async function featureStatus() {
  for (const [type, selector] of [['screenshot-companion-status', '#screenshot-availability'], ['youtube-protection-status', '#youtube-availability']] as const) {
    try {
      const value = z.object({ installed: z.boolean(), enabled: z.boolean().optional() }).parse(await request({ type }));
      const state = el(selector);
      state.textContent = !value.installed ? 'Setup' : value.enabled === false ? 'Paused' : '';
      state.title = !value.installed ? 'Load this companion once in Settings.' : value.enabled === false ? 'Protection is paused in the YouTube companion.' : 'Companion connected.';
      state.dataset.ready = String(value.installed && value.enabled !== false);
    } catch { el(selector).textContent = 'Check Settings'; }
  }
}
void init().catch((error) => notice((error as Error).message));
