/* YouTube companion distribution changes: GPL-3.0-or-later. */
import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, join } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const source = join(root, 'companion/youtube');
const output = join(root, '.output/chrome-mv3/youtube-companion');
const json = async path => JSON.parse(await readFile(path, 'utf8'));
const provenance = await json(join(source, 'provenance.json'));
for (const [path, hash] of Object.entries(provenance.files)) {
  if (createHash('sha256').update(await readFile(join(source, 'upstream', path))).digest('hex') !== hash) throw new Error(`Still source changed: ${path}`);
}
const main = await json(join(root, 'extension-identity.json'));
const identity = await json(join(source, 'identity.json'));
const version = (await json(join(root, 'package.json'))).version;
await mkdir(output, { recursive: true });
await cp(join(source, 'upstream'), output, { recursive: true });
await cp(join(source, 'upstream/background.js'), join(output, 'still-background.js'));
await cp(join(source, 'bundle-sync.js'), join(output, 'bundle-sync.js'));
await cp(join(source, 'branding.css'), join(output, 'branding.css'));
await mkdir(join(output, 'brand'), { recursive: true });
await cp(join(root, 'extension/public/brand/mark.svg'), join(output, 'brand/mark.svg'));
for (const size of [16, 32, 48, 128]) await cp(join(root, `extension/public/icon-${size}.png`), join(output, `icons/${size}.png`));
await writeFile(join(output, 'background.js'), `/* GPL-3.0-or-later. Packaged code only. */\nimportScripts('still-background.js', 'bundle-sync.js');\n`);
const manifest = await json(join(output, 'manifest.json'));
Object.assign(manifest, {
  name: 'YouTube Protection by Abomination81', short_name: 'YouTube', version,
  version_name: `${version} (Still ${provenance.version})`, key: identity.key,
  minimum_chrome_version: '127', externally_connectable: { ids: [main.id] },
});
manifest.content_security_policy.extension_pages = manifest.content_security_policy.extension_pages.replace("connect-src 'none'", "connect-src 'self'");
manifest.action.default_title = 'YouTube Protection · Still';
await writeFile(join(output, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
let popup = await readFile(join(output, 'popup.html'), 'utf8');
popup = popup.replace('<title>Still</title>', '<title>YouTube Protection · Abomination81</title>')
  .replace('</head>', '<link rel="stylesheet" href="branding.css"></head>')
  .replace('<span class="mark" aria-hidden="true">Ⅱ</span>', '<img class="mark" src="brand/mark.svg" alt="" width="32" height="32">')
  .replace('<h1>Still</h1>', '<h1>YouTube Protection</h1>')
  .replace('Data sent by Still', 'Remote data sharing')
  .replace('Filters are included in this extension.', 'Powered by Still. Only version and on/off status are shared locally with Video Downloader. Filters are included in this extension.')
  .replace('v0.1.2 · Local by design', '<a href="https://abomination81.com" target="_blank" rel="noopener noreferrer">Built by abomination81</a><a href="https://x.com/Abomination81" target="_blank" rel="noopener noreferrer">@abomination81</a>');
await writeFile(join(output, 'popup.html'), popup);
console.log('Built YouTube companion', identity.id);
