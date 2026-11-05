/* GPL-3.0-or-later distribution/integration of uBlock Origin Lite. */
import {readFile,writeFile,mkdir,cp} from 'node:fs/promises';
import {createHash} from 'node:crypto';import {join,resolve} from 'node:path';
const root=resolve(import.meta.dirname,'..'),source=join(root,'companion/protection'),output=join(root,'.output/chrome-mv3/protection-companion');
const json=async path=>JSON.parse(await readFile(path,'utf8'));
const provenance=await json(join(source,'provenance.json'));
for(const [path,sha] of Object.entries(provenance.files))if(createHash('sha256').update(await readFile(join(source,'upstream',path))).digest('hex')!==sha)throw new Error('Protection source changed: '+path);
await mkdir(output,{recursive:true});await cp(join(source,'upstream/chromium'),output,{recursive:true});
const identity=await json(join(source,'identity.json')),main=await json(join(root,'extension-identity.json')),version=(await json(join(root,'package.json'))).version;
const manifest=await json(join(output,'manifest.json'));
Object.assign(manifest,{name:'Ad Protection by Abomination81',short_name:'Ad Protection',description:'Comprehensive website and video ad filtering. Powered by uBlock Origin Lite; built by abomination81.',version,version_name:`${version} (uBOL ${provenance.version})`,key:identity.key,homepage_url:'https://abomination81.com',externally_connectable:{ids:[main.id]},background:{service_worker:'bundle-bridge.js',type:'module'},minimum_chrome_version:'127'});
manifest.action.default_title='Ad Protection · Abomination81';
await writeFile(join(output,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');
await writeFile(join(output,'bundle-bridge.js'),(await readFile(join(source,'bundle-bridge.js'),'utf8')).replace("engineVersion:'2026.1103.1743'",`engineVersion:${JSON.stringify(provenance.version)}`));await cp(join(source,'branding.css'),join(output,'branding.css'));
const background=await readFile(join(output,'js/background.js'),'utf8');
// Engine migrations compare calendar-style uBOL versions, not our bundle semver.
const versionGetter='function getCurrentVersion() {\n    return runtime.getManifest().version;\n}';
if(!background.includes(versionGetter))throw new Error('Review upstream engine-version getter');
await writeFile(join(output,'js/background.js'),background.replace(versionGetter,`function getCurrentVersion() {\n    return ${JSON.stringify(provenance.version)};\n}`)+'\nexport { isFullyInitialized };\n');
const mode=await readFile(join(output,'js/mode-manager.js'),'utf8');
const before="none: [],\n    basic: [],\n    optimal: [ 'all-urls' ],\n    complete: [],";
if(!mode.includes(before))throw new Error('Review upstream default-mode change');
await writeFile(join(output,'js/mode-manager.js'),mode.replace(before,"none: [ 'localhost', '127.0.0.1' ],\n    basic: [],\n    optimal: [],\n    complete: [ 'all-urls' ],"));
for(const file of ['popup.html','dashboard.html']){
 let html=await readFile(join(output,file),'utf8');html=html.replace('src="img/ublock.svg" alt="uBO Lite"','src="img/icon_32.png" alt="Ad Protection"').replace('</head>','<link rel="stylesheet" href="branding.css"></head>').replace('</body>','<footer class="vd-brand"><span>Ad Protection · powered by uBlock Origin Lite</span><a href="https://x.com/Abomination81" target="_blank" rel="noopener noreferrer">Built by abomination81</a></footer></body>');await writeFile(join(output,file),html);
}
// Keep upstream attribution; the renamed distribution uses the user's own mark.
for(const size of [16,32,128])await cp(join(root,`extension/public/icon-${size}.png`),join(output,`img/icon_${size}.png`));
await cp(join(root,'extension/public/icon-128.png'),join(output,'img/icon_64.png'));
for(const size of [16,32,64,128])await cp(join(output,`img/icon_${size}.png`),join(output,`img/icon_${size}_off.png`));
await cp(join(source,'README.md'),join(output,'ABOMINATION81-NOTICES.md'));
console.log('Built comprehensive protection',identity.id,provenance.version);
