import { build } from 'esbuild';
import { mkdir, copyFile, readFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const source = join(root, 'companion/audio');
const output = join(root, '.output/chrome-mv3/audio-companion');
const identity = JSON.parse(await readFile(join(source, 'identity.json'), 'utf8'));
const main = JSON.parse(await readFile(join(root, 'extension-identity.json'), 'utf8'));
const version = JSON.parse(await readFile(join(root, 'package.json'), 'utf8')).version;
await mkdir(join(output, 'fonts'), { recursive: true });
await build({ entryPoints: { background: join(source, 'background.ts'), popup: join(source, 'popup.ts') }, outdir: output, bundle: true, minify: true, format: 'esm', platform: 'browser', target: 'chrome127' });
for (const name of ['popup.html', 'popup.css']) await copyFile(join(source, name), join(output, name));
for (const name of ['icon-16.png', 'icon-48.png']) await copyFile(join(root, 'extension/public', name), join(output, name));
await copyFile(join(root, 'extension/public/fonts/anton-latin.woff2'), join(output, 'fonts/anton-latin.woff2'));
await copyFile(join(root, 'extension/public/fonts/OFL-Anton.txt'), join(output, 'fonts/OFL-Anton.txt'));
await writeFile(join(output, 'manifest.json'), JSON.stringify({
  manifest_version: 3, name: 'Download Audio by Abomination81', version, key: identity.key, minimum_chrome_version: '127',
  description: 'Separate Download audio right-click command. Uses Video Downloader’s helper and verified MP3 metadata cleanup. Built by abomination81.',
  homepage_url: 'https://abomination81.com/video-downloader/', permissions: ['contextMenus', 'storage', 'alarms'],
  externally_connectable: { ids: [main.id] }, background: { service_worker: 'background.js', type: 'module' },
  icons: { 16: 'icon-16.png', 48: 'icon-48.png' },
  action: { default_title: 'Download audio · Abomination81', default_popup: 'popup.html', default_icon: { 16: 'icon-16.png', 48: 'icon-48.png' } },
  content_security_policy: { extension_pages: "script-src 'self'; object-src 'none'; base-uri 'none'" },
}, null, 2) + '\n');
console.log('Built audio companion', identity.id);
