// Rebuild the checked-in PNGs from our editable SVG; no image-generation API.
import { chromium } from 'playwright';
import { readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
const root = resolve(import.meta.dirname, '..');
const svg = await readFile(join(root, 'extension/public/brand/mark.svg'), 'utf8');
const browser = await chromium.launch({ channel: 'chromium', headless: true });
try {
  for (const size of [16, 32, 48, 128, 192]) {
    const page = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 2 });
    const mark = size <= 32 ? svg.replace(/<rect[^>]+\/>/, '').replace('viewBox="0 0 192 192"', 'viewBox="32 30 128 128"') : svg;
    await page.setContent(`<style>html,body{margin:0;width:100%;height:100%;overflow:hidden}svg{width:100%;height:100%;display:block}</style>${mark}`);
    const png = await page.screenshot({ omitBackground: true, scale: 'css' });
    await writeFile(join(root, size === 192 ? 'extension/public/brand/icon-192.png' : `extension/public/icon-${size}.png`), png);
    if (size === 192) await writeFile(join(root, 'docs/assets/icon-192.png'), png);
    await page.close();
  }
} finally { await browser.close(); }
