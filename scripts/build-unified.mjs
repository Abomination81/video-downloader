/* GPL-3.0-or-later. Reproducible integration of the pinned uBOL and Still engines. */
import { readFile, writeFile, cp, rm, readdir, rename } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import assert from 'node:assert/strict';
const out = resolve(import.meta.dirname, '../.output/chrome-mv3');
const read = file => readFile(join(out, file), 'utf8');
const write = (file, data) => writeFile(join(out, file), data);
async function replace(file, before, after) {
  const text = await read(file);
  assert(text.includes(before), `Review upstream integration: ${file}: ${before}`);
  await write(file, text.replace(before, after));
}
const manifest = JSON.parse(await read('manifest.json'));
const engine = JSON.parse(await read('protection-companion/manifest.json'));
// Preserve upstream absolute asset paths. Only its popup name conflicts with WXT.
for (const entry of await readdir(join(out, 'protection-companion'))) {
  if (['manifest.json', 'bundle-bridge.js', 'popup.html'].includes(entry)) continue;
  assert(!(await readdir(out)).includes(entry), `Asset collision: ${entry}`);
  await cp(join(out, 'protection-companion', entry), join(out, entry), { recursive: true });
}
await cp(join(out, 'protection-companion/popup.html'), join(out, 'protection-popup.html'));
manifest.declarative_net_request = engine.declarative_net_request;
manifest.web_accessible_resources = engine.web_accessible_resources;
manifest.default_locale = engine.default_locale;
manifest.background = { service_worker: 'background.js', type: 'module' };
await cp(resolve(import.meta.dirname, '../extension/integration'), join(out, 'integration'), { recursive: true });

// Retire only the old first-party filter IDs before uBOL initializes. Its rules
// may use the same numeric IDs, so this migration must run exactly once first.
await write('integration/migrate.js', `export async function migrate() {
  if ((await chrome.storage.local.get('unifiedEngineV1')).unifiedEngineV1) return;
  const rules = await chrome.declarativeNetRequest.getDynamicRules();
  const ids = rules.filter(r => r.id >= 1 && r.id <= 27000 || r.id >= 100000 && r.id <= 100399).map(r => r.id);
  if (ids.length) await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds: ids });
  const scripts = await chrome.scripting.getRegisteredContentScripts();
  if (scripts.some(s => s.id === 'abomination81-pluto-ads')) await chrome.scripting.unregisterContentScripts({ ids: ['abomination81-pluto-ads'] });
  await chrome.alarms.clear('protection-companion');
  await chrome.storage.local.set({ unifiedEngineV1: true });
}\n`);
await replace('js/background.js', "const isFullyInitialized = start().then", "const isFullyInitialized = migrate().then(() => start()).then");
await write('js/background.js', "import { migrate } from '../integration/migrate.js';\n" + await read('js/background.js'));
await replace('js/background.js', "if ( request.what.includes(':') ) { return; }", "if ( sender.id !== runtime.id || typeof request?.what !== 'string' || request.what.includes(':') ) { return; }");
await replace('js/utils.js', "? '<all_urls>' :", "? '*://*/*' :");
await replace('js/background.js',
  "const isTrustedOrigin = sender?.origin === undefined ||\n        sender.origin.toLowerCase() === UBOL_ORIGIN;",
  "const isTrustedOrigin = sender === undefined || sender.id === runtime.id && ['dashboard.html','protection-popup.html','matched-rules.html','report.html','strictblock.html','picker-ui.html','unpicker-ui.html','zapper-ui.html'].some(path => sender.url?.split(/[?#]/)[0] === runtime.getURL(path));");
// The main tool owns the toolbar badge/icon. Filtering never changes its identity.
await write('js/action.js', '// Integration owns the toolbar icon.\nexport function toggleToolbarIcon() {}\nexport async function registerToolbarIconToggler() {}\n');
await write('js/ext-offscreen.js', `import { acquireOffscreen } from '../integration/offscreen.js';
export const supportsOffscreenDocument = chrome.offscreen !== undefined;
let close;
export async function createOffscreenDocument(path) { close = await acquireOffscreen(path, ['WORKERS'], 'Compile local user-selected filters.'); }
export async function closeOffscreenDocument() { const release = close; close = undefined; if (release) await release(); }
`);
await replace('js/compiled-filters.js', "if ( typeof request !== 'object' ) { return; }", "if ( sender.id !== runtime.id || sender.tab || sender.url !== runtime.getURL('js/offscreen/compile-filters.html') || typeof request !== 'object' ) { return; }");
await replace('js/compiled-filters.js',
  "    const [ result ] = await Promise.all([\n        Promise.race([ offscreenPromise, timeoutPromise ]),\n        createOffscreenDocument('/js/offscreen/compile-filters.html'),\n    ]);\n    runtime.onMessage.removeListener(handler);\n    await closeOffscreenDocument();\n    return result;",
  "    try {\n        const [ result ] = await Promise.all([\n            Promise.race([ offscreenPromise, timeoutPromise ]),\n            createOffscreenDocument('/js/offscreen/compile-filters.html'),\n        ]);\n        return result;\n    } finally {\n        runtime.onMessage.removeListener(handler);\n        await closeOffscreenDocument();\n    }");
// Convert the strict companion RPC into a worker-internal call, retaining schemas.
let bridge = await read('protection-companion/bundle-bridge.js');
bridge = bridge.replaceAll("from './js/", "from '../js/");
const start = bridge.indexOf('chrome.runtime.onMessageExternal.addListener(');
const guardEnd = bridge.indexOf(' const keys=', start);
assert(start > 0 && guardEnd > start);
bridge = bridge.slice(0, start) + 'export async function protection(message) {\n' + bridge.slice(guardEnd);
bridge = bridge.replace(" if(!task)return false;\n void serial(task).then(reply,()=>reply(null));return true;\n});", " if(!task)throw new Error('Invalid protection command');\n return serial(task);\n}");
assert(!bridge.includes('onMessageExternal'));
await write('integration/protection.js', bridge);

await rename(join(out, 'screenshot-companion'), join(out, 'screenshot'));
let capture = await read('screenshot/capture-background.js');
capture = capture.replace("getURL('preview.html')", "getURL('screenshot/preview.html')");
const menuStart = capture.indexOf('chrome.runtime.onInstalled.addListener(');
const menuEnd = capture.indexOf('const sleep =', menuStart);
assert(menuStart > 0 && menuEnd > menuStart);
capture = capture.slice(0, menuStart) + capture.slice(menuEnd);
capture = capture.replace('chrome.action.onClicked.addListener(tab => { void capture(tab); });', '');
capture = capture.replace('chrome.contextMenus.onClicked.addListener(handleContextClick);', 'export { capture };');
capture = capture.replace("  const job = current;\n", "  if (port.name !== 'still-preview-v1') return;\n  const job = current;\n");
await write('screenshot/capture-background.js', capture);
await replace('screenshot/preview.html', '<meta charset="utf-8">', `<meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' blob: data:; connect-src 'none'; object-src 'none'; base-uri 'none'">`);
for (const file of ['manifest.json', 'background.js', 'bundle-sync.js']) await rm(join(out, 'screenshot', file));
await rename(join(out, 'background.js'), join(out, 'downloader-background.js'));
await write('background.js', `import { protection } from './integration/protection.js';
import { capture, isCaptureActive } from './screenshot/capture-background.js';
import { acquireOffscreen } from './integration/offscreen.js';
globalThis.vdServices = Object.freeze({ protection, capture, captureBusy: isCaptureActive, acquireOffscreen });
// WXT registers synchronously; its entry callback runs after this service module.
import './downloader-background.js';
`);
// Static imports evaluate before this module body: provide services in a separate
// dependency evaluated before the downloader, without delaying event registration.
await rename(join(out, 'background.js'), join(out, 'integration/services.js'));
await write('integration/services.js', (await read('integration/services.js')).replaceAll("from './", "from '../").replace("import './downloader-background.js';", ''));
await write('background.js', "import './integration/services.js';\nimport './downloader-background.js';\n");
await rm(join(out, 'protection-companion'), { recursive: true });
await write('manifest.json', JSON.stringify(manifest, null, 2) + '\n');
console.log('Built one extension: downloads, audio, images, screenshots, uBOL and browsing tools');
