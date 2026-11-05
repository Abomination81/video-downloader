export const LIMITS = Object.freeze({ pixels: 96_000_000, side: 32760, partSide: 16000, partPixels: 24_000_000, frames: 100, duration: 120_000, nodes: 15000 });

export function allowedURL(value) {
  try {
    const u = new URL(value);
    return ['https:', 'http:'].includes(u.protocol) &&
      !['chromewebstore.google.com', 'chrome.google.com'].includes(u.hostname);
  } catch { return false; }
}

export function integer(value, min, max) {
  return Number.isSafeInteger(value) && value >= min && value <= max;
}

export function validateMetrics(m) {
  if (!m || !['width', 'height', 'vw', 'vh'].every(k => Number.isFinite(m[k]) && m[k] >= 1 && m[k] <= 1_000_000) ||
      !Number.isFinite(m.dpr) || m.dpr < 0.25 || m.dpr > 8) throw new Error('Invalid page dimensions.');
  const width = Math.round(m.width * m.dpr), height = Math.round(m.height * m.dpr);
  if (width > LIMITS.side || height > 1_000_000 || width * height > LIMITS.pixels) throw new Error('This page exceeds the safe capture size (96 megapixels).');
  if (positions(m.width, m.vw).length * positions(m.height, m.vh).length > LIMITS.frames) throw new Error('This page needs more than 100 frames. Capture a shorter page.');
  return m;
}

export function positions(length, viewport) {
  if (!Number.isFinite(length) || !Number.isFinite(viewport) || length < 1 || viewport < 1) throw new Error('Invalid capture geometry.');
  const step = Math.max(1, viewport - Math.min(64, Math.floor(viewport / 4)));
  if (length / step > 1000) throw new Error('Page is too long.');
  const points = [0];
  while (points.at(-1) + viewport < length) points.push(Math.min(points.at(-1) + step, length - viewport));
  return points;
}

export function partsFor(width, height) {
  if (!integer(width, 1, LIMITS.side) || !integer(height, 1, 1_000_000) || width * height > LIMITS.pixels) throw new Error('Image exceeds memory limits.');
  const result = [];
  for (let x = 0; x < width; x += LIMITS.partSide) {
    const w = Math.min(LIMITS.partSide, width - x);
    const stride = Math.min(LIMITS.partSide, Math.floor(LIMITS.partPixels / w));
    for (let y = 0; y < height; y += stride) result.push({ x, y, width: w, height: Math.min(stride, height - y) });
  }
  return result;
}

export function authorizedPreview(sender, job, extensionId, base) {
  return Boolean(job && sender?.id === extensionId && sender?.tab?.id === job.previewId &&
    sender.frameId === 0 && sender.url === `${base}#${job.token}` && !sender.tab.incognito);
}

export function filename(date = new Date(), index = 0, count = 1) {
  return `still-${date.toISOString().replace(/[:.]/g, '-')}${count > 1 ? `-part-${String(index + 1).padStart(2, '0')}` : ''}.png`;
}
