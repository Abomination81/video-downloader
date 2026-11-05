import { filename, integer, LIMITS, partsFor, validateMetrics } from './core.js';
import { pngArchive } from './zip.js';

const heading = document.querySelector('#heading'), status = document.querySelector('#status');
const progress = document.querySelector('#progress'), images = document.querySelector('#images');
const save = document.querySelector('#save'), discard = document.querySelector('#discard'), zoom = document.querySelector('#zoom');
const notice = document.querySelector('#notice');
let parts = [], urls = [], metrics, total = 0, expected = 0, done = false, discarded = false, failed = false;
let scaleX, scaleY, port, ping;
const release = () => {
  for (const url of urls) URL.revokeObjectURL(url);
  urls = [];
  for (const part of parts) { part.canvas.width = 0; part.canvas.height = 0; }
  parts = []; images.replaceChildren(); save.removeAttribute('href'); save.removeAttribute('download');
  save.setAttribute('aria-disabled', 'true'); zoom.disabled = true;
};
function error(text) {
  failed = true; release(); progress.hidden = true;
  heading.textContent = 'Capture stopped'; status.textContent = text;
  discard.textContent = 'Close'; clearInterval(ping);
}

async function receive(message) {
  if (failed || discarded || done || !message || typeof message !== 'object') return;
  if (message.type === 'error') {
    error(typeof message.text === 'string' ? message.text.slice(0, 220) : 'Capture failed.');
    if (integer(message.id, 1, 1000)) port.postMessage({ type: 'ack', id: message.id, ok: true });
    return;
  }
  if (!integer(message.id, 1, 1000)) return;
  try {
    if (message.type === 'status') {
      if (typeof message.text !== 'string' || message.text.length > 150) throw new Error();
      status.textContent = message.text;
    } else if (message.type === 'begin') {
      if (metrics || !integer(message.total, 1, LIMITS.frames)) throw new Error();
      metrics = validateMetrics(message.metrics); total = message.total;
    } else if (message.type === 'tile') {
      if (!metrics || message.index !== expected || expected >= total || typeof message.data !== 'string' || message.data.length > 64_000_000 || !/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(message.data) ||
          ![message.x, message.y].every(n => Number.isFinite(n) && n >= 0) || message.x > metrics.width || message.y > metrics.height) throw new Error();
      // HTMLImageElement.decode() can wait for rendering in a hidden real Chrome tab.
      // Decode and encode off the display pipeline so background-tab throttling is harmless.
      const raw = atob(message.data.slice('data:image/png;base64,'.length));
      const bytes = new Uint8Array(raw.length);
      for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
      const img = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
      try {
      if (failed || discarded) return;
      const sx = img.width / metrics.vw, sy = img.height / metrics.vh;
      if (![sx, sy].every(n => n >= .25 && n <= 8) || Math.abs(sx - sy) > .02) throw new Error();
      if (!parts.length) {
        scaleX = sx; scaleY = sy;
        parts = partsFor(Math.round(metrics.width * sx), Math.round(metrics.height * sy)).map(part => {
          const canvas = new OffscreenCanvas(part.width, part.height);
          const context = canvas.getContext('2d', { alpha: false });
          if (!context) throw new Error();
          return { ...part, canvas, context };
        });
      }
      if (sx !== scaleX || sy !== scaleY) throw new Error();
      const dx = Math.round(message.x * sx), dy = Math.round(message.y * sy);
      for (const part of parts) {
        const left = Math.max(dx, part.x), top = Math.max(dy, part.y);
        const right = Math.min(dx + img.width, part.x + part.width), bottom = Math.min(dy + img.height, part.y + part.height);
        if (right > left && bottom > top) part.context.drawImage(img, left - dx, top - dy, right - left, bottom - top, left - part.x, top - part.y, right - left, bottom - top);
      }
      expected++;
      progress.value = expected / total * 100;
      status.textContent = `Captured ${expected} of ${total} frames. Keep the source tab selected.`;
      } finally { img.close(); }
    } else if (message.type === 'finish') {
      if (expected !== total || !parts.length) throw new Error();
      const date = new Date();
      for (const [index, part] of parts.entries()) {
        const blob = await part.canvas.convertToBlob({ type: 'image/png' });
        if (!blob || discarded || failed) throw new Error();
        if (message.autoSave === true) part.blob = blob;
        const url = URL.createObjectURL(blob); urls.push(url);
        const figure = document.createElement('figure'), img = document.createElement('img');
        img.src = url; img.alt = parts.length === 1 ? 'Your full-page screenshot' : `Screenshot part ${index + 1}`;
        img.width = part.width; img.height = part.height; img.draggable = false;
        figure.append(img);
        if (parts.length > 1) {
          const caption = document.createElement('figcaption'), label = document.createElement('span'), link = document.createElement('a');
          label.textContent = `Part ${index + 1} of ${parts.length} (${part.width} × ${part.height} pixels)`;
          link.textContent = `Save part ${index + 1}`; link.className = 'part-save'; link.href = url; link.download = filename(date, index, parts.length);
          caption.append(label, link); figure.append(caption);
        }
        images.append(figure);
        part.canvas.width = 0; part.canvas.height = 0;
      }
      const width = Math.round(metrics.width * scaleX), height = Math.round(metrics.height * scaleY);
      status.textContent = `${width.toLocaleString()} × ${height.toLocaleString()} pixels${parts.length > 1 ? `, ${parts.length} lossless PNG parts` : ', lossless PNG'}`;
      heading.textContent = 'Your page, captured'; progress.hidden = true;
      if (parts.length === 1) { save.href = urls[0]; save.download = filename(date); save.setAttribute('aria-disabled', 'false'); }
      else { save.hidden = true; notice.textContent = 'This large capture is split into full-resolution PNG parts. Save each part below its image.'; notice.hidden = false; }
      if (metrics.nested) { notice.textContent += ' This page has independently scrolling panels. Their visible content is included; hidden panel content is not expanded.'; notice.hidden = false; }
      images.tabIndex = 0; zoom.disabled = false; discard.textContent = 'Discard';
      if (message.autoSave === true) {
        // Browser-native downloads keep the extension free of download-history access.
        const link = document.createElement('a');
        if (parts.length === 1) { link.href = urls[0]; link.download = filename(date); }
        else {
          const archive = await pngArchive(parts.map((part, i) => ({ name: filename(date, i, parts.length), blob: part.blob })));
          const url = URL.createObjectURL(archive); urls.push(url);
          link.href = url; link.download = filename(date).replace(/\.png$/, '.zip');
        }
        document.body.append(link); link.click(); link.remove();
        // Retain Blob URLs while Chrome accepts the download, then erase the background preview.
        // No download permission means Chrome owns prompts, destination, and completion reporting.
        setTimeout(() => { discarded = true; release(); window.close(); }, 30000);
      }
      done = true; clearInterval(ping);
    } else { throw new Error(); }
    port.postMessage({ type: 'ack', id: message.id, ok: true });
  } catch {
    error('The image could not be assembled safely. Try a smaller page.');
    try { port.postMessage({ type: 'ack', id: message.id, ok: false }); } catch { /* Worker ended. */ }
  }
}

discard.addEventListener('click', () => {
  if (!done && !failed) { try { port?.postMessage({ type: 'cancel' }); } catch { /* Worker ended. */ } }
  discarded = true; clearInterval(ping); release(); window.close();
  heading.textContent = 'Capture discarded'; status.textContent = 'You can close this tab.';
});
zoom.addEventListener('click', () => {
  const actual = images.classList.toggle('actual'); zoom.setAttribute('aria-pressed', String(actual)); zoom.textContent = actual ? 'Fit to width' : 'Actual size';
});
window.addEventListener('pagehide', () => { discarded = true; clearInterval(ping); release(); });

if (!/^#[0-9a-f-]{36}$/.test(location.hash)) {
  error('This preview has expired. Click Still on the webpage you want to capture.');
} else {
  port = chrome.runtime.connect({ name: 'still-preview-v1' });
  let chain = Promise.resolve();
  port.onMessage.addListener(message => { chain = chain.then(() => receive(message)); });
  port.onDisconnect.addListener(() => {
    clearInterval(ping);
    if (!done && !failed && !discarded) error('This capture session ended. Click Still on the webpage to try again.');
  });
  port.postMessage({ type: 'ready' });
  ping = setInterval(() => { try { port.postMessage({ type: 'ping' }); } catch { clearInterval(ping); } }, 5000);
}
