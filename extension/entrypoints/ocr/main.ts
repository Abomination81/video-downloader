import { createWorker, OEM, type Worker } from 'tesseract.js';
import { z } from 'zod';
import { el, notice, request } from '../../lib/ui';
import { rasterDimensions } from '../../lib/ocr-policy';

let worker: Worker | undefined, busy = false, imageURL = '';
const input = el<HTMLInputElement>('#image-file'), text = el<HTMLTextAreaElement>('#ocr-text'), copy = el<HTMLButtonElement>('#ocr-copy');
const status = el('#ocr-status'), progress = el<HTMLProgressElement>('#ocr-progress'), preview = el<HTMLImageElement>('#ocr-preview');
async function recognize(data: Blob) {
  if (busy) return;
  if (data.size > 12 * 1024 * 1024) { notice('Choose an image smaller than 12 MB.'); return; }
  const dimensions = rasterDimensions(new Uint8Array(await data.arrayBuffer()));
  if (!dimensions) { notice('Choose a valid PNG, JPEG, WebP, GIF or BMP image.'); return; }
  if (dimensions.width * dimensions.height > 40_000_000 || Math.max(dimensions.width, dimensions.height) > 32768) { notice('This image is too large. Crop it or choose a smaller image.'); return; }
  busy = true; input.disabled = true; copy.disabled = true; text.value = ''; el('#notice').hidden = true;
  progress.hidden = false; progress.removeAttribute('value'); status.textContent = 'Reading image…';
  let timer: ReturnType<typeof setTimeout> | undefined, expired = false;
  try {
    if (imageURL) URL.revokeObjectURL(imageURL);
    imageURL = URL.createObjectURL(data); preview.src = imageURL; preview.hidden = false;
    const bitmap = await createImageBitmap(data);
    if (bitmap.width * bitmap.height > 40_000_000) { bitmap.close(); throw new Error('This image is too large. Crop it or choose a smaller image.'); }
    const scale = Math.min(1, Math.sqrt(6_000_000 / (bitmap.width * bitmap.height)));
    const canvas = document.createElement('canvas'); canvas.width = Math.round(bitmap.width * scale); canvas.height = Math.round(bitmap.height * scale);
    const context = canvas.getContext('2d')!; context.fillStyle = '#fff'; context.fillRect(0, 0, canvas.width, canvas.height); context.drawImage(bitmap, 0, 0, canvas.width, canvas.height); bitmap.close();
    const task = (async () => {
      const created = await createWorker('eng', OEM.LSTM_ONLY, {
        workerPath: chrome.runtime.getURL('ocr/worker.min.js'), workerBlobURL: false,
        corePath: chrome.runtime.getURL('ocr/tesseract-core-lstm.wasm.js'),
        langPath: chrome.runtime.getURL('ocr'), gzip: true, cacheMethod: 'none',
        logger: info => { status.textContent = info.status === 'recognizing text' ? 'Recognizing text…' : 'Preparing local recognition…'; if (info.status === 'recognizing text') progress.value = info.progress; },
      });
      if (expired) { await created.terminate(); throw new Error('Recognition cancelled.'); }
      worker = created;
      return created.recognize(canvas);
    })();
    const result = await Promise.race([task, new Promise<never>((_, reject) => { timer = setTimeout(() => { expired = true; reject(new Error('Recognition took too long. Crop the image and try again.')); }, 60000); })]);
    text.value = result.data.text.trim(); copy.disabled = !text.value;
    status.textContent = text.value ? 'Text ready.' : 'No readable text found. Try a clearer or larger image.';
    if (text.value && document.hasFocus()) {
      try { await navigator.clipboard.writeText(text.value); status.textContent = 'Text copied. You can review or edit it below.'; } catch { /* The visible Copy button provides a focused user gesture. */ }
    }
  } catch (error) { notice(error instanceof Error ? error.message : 'This image could not be read.'); status.textContent = 'Choose another image to try again.'; }
  finally { expired = true; clearTimeout(timer); await worker?.terminate(); worker = undefined; busy = false; input.disabled = false; progress.hidden = true; }
}
copy.onclick = async () => { try { await navigator.clipboard.writeText(text.value); status.textContent = 'Text copied.'; } catch { notice('Select the text and use your computer’s Copy shortcut.'); } };
text.oninput = () => { copy.disabled = !text.value; };
input.onchange = () => { const file = input.files?.[0]; if (file) void recognize(file); };
window.addEventListener('pagehide', () => { void worker?.terminate(); if (imageURL) URL.revokeObjectURL(imageURL); text.value = ''; });
const id = z.string().uuid().safeParse(location.hash.slice(1));
if (id.success) void request({ type: 'ocr-image', id: id.data }).then(async value => {
  const data = z.object({ data: z.string().max(17_000_000).regex(/^data:image\/(png|jpeg|webp|gif|bmp);base64,/) }).strict().parse(value);
  await recognize(await (await fetch(data.data)).blob()); history.replaceState(null, '', location.pathname);
}).catch(error => { notice(error instanceof Error ? error.message : 'Choose the image again.'); status.textContent = 'Or choose a local image above.'; });
