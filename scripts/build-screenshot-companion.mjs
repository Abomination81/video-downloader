import { cp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, join, relative } from 'node:path';
import assert from 'node:assert/strict';

const root = resolve(import.meta.dirname, '..');
const source = join(root, 'companion/screenshot');
const output = join(root, '.output/chrome-mv3/screenshot-companion');
const json = async path => JSON.parse(await readFile(path, 'utf8'));
const provenance = await json(join(source, 'provenance.json'));
const upstream = join(source, 'upstream');
const files = (await readdir(upstream, { recursive: true, withFileTypes: true })).filter(e => e.isFile()).map(e => relative(upstream, join(e.parentPath, e.name))).sort();
assert.deepEqual(files, Object.keys(provenance.files).sort(), 'Unexpected screenshot engine files');
for (const [path, hash] of Object.entries(provenance.files)) {
  assert.equal(createHash('sha256').update(await readFile(join(upstream, path))).digest('hex'), hash, `Screenshot source changed: ${path}`);
}
const main = await json(join(root, 'extension-identity.json'));
const identity = await json(join(source, 'identity.json'));
const version = (await json(join(root, 'package.json'))).version;
await rm(output, { recursive: true, force: true }); await mkdir(output, { recursive: true });
await cp(upstream, output, { recursive: true });
const capture = (await readFile(join(upstream, 'background.js'), 'utf8')).replace("title: 'Take full page screenshot'", "title: 'Save full-page screenshot'");
// Expose only an internal read-only busy flag to prevent updates during capture.
await writeFile(join(output, 'capture-background.js'), capture + '\nexport const isCaptureActive = () => current !== null;\n');
await cp(join(source, 'bundle-sync.js'), join(output, 'bundle-sync.js'));
await cp(join(source, 'branding.css'), join(output, 'branding.css'));
await mkdir(join(output, 'brand'), { recursive: true });
await cp(join(root, 'extension/public/brand/mark.svg'), join(output, 'brand/mark.svg'));
for (const size of [16, 32, 48, 128]) await cp(join(root, `extension/public/icon-${size}.png`), join(output, `icons/${size}.png`));
await cp(join(source, 'LICENSE'), join(output, 'LICENSE'));
await writeFile(join(output, 'background.js'), "import './capture-background.js';\nimport './bundle-sync.js';\n");
const manifest = await json(join(output, 'manifest.json'));
Object.assign(manifest, {
  name: 'Full Page Screenshot by Abomination81', short_name: 'Screenshot', version,
  version_name: `${version} (Still ${provenance.version})`, key: identity.key,
  minimum_chrome_version: '127', externally_connectable: { ids: [main.id] },
});
manifest.content_security_policy.extension_pages = manifest.content_security_policy.extension_pages.replace("connect-src 'none'", "connect-src 'self'");
manifest.action.default_title = 'Save full-page screenshot';
await writeFile(join(output, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
const html = (await readFile(join(output, 'preview.html'), 'utf8'))
  .replace('<title>Still: Private capture</title>', '<title>Full-page screenshot · Abomination81 Toolkit</title>')
  .replace('</head>', '<link rel="stylesheet" href="branding.css"></head>')
  .replace('src="icons/48.png"', 'src="brand/mark.svg"')
  .replace('<strong>Still</strong>', '<strong>Full-page screenshot</strong>')
  .replace('Private full-page capture', 'Abomination81 Toolkit')
  .replace('click Still on a webpage', 'click the screenshot toolbar button on a webpage')
  .replace('Screenshots stay in this tab until you save or discard them.', 'Screenshots stay here until you save or discard them.<span class="creator-links"><a href="https://abomination81.com" target="_blank" rel="noopener noreferrer">Built by abomination81</a><a href="https://x.com/Abomination81" target="_blank" rel="noopener noreferrer">@abomination81</a></span>');
await writeFile(join(output, 'preview.html'), html);
console.log('Built screenshot companion', identity.id);
