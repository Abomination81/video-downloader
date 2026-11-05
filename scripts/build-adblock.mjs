import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve,join} from 'node:path';
import {build} from 'esbuild';
import {compileAdFilters} from './lib/compile-ad-filters.mjs';
const root=resolve(import.meta.dirname,'..'), output=join(root,'.output/chrome-mv3/adblock');
const provenance=JSON.parse(await readFile(join(root,'filters/provenance.json'),'utf8'));
const source=await readFile(join(root,'filters/easylist.txt'));
if(createHash('sha256').update(source).digest('hex')!==provenance.sha256)throw new Error('Pinned EasyList source changed');
const compiled=compileAdFilters(source.toString('utf8'));
// Pluto's pause sponsorship is a separate DOM element; never hide its video or resume control.
compiled.cosmetics.rules.push({selector:'.pause-panel-ad-container',include:['pluto.tv'],exclude:[],exception:false});
await mkdir(output,{recursive:true});
const rulesJSON=JSON.stringify(compiled.rules);
await writeFile(join(output,'rules.json'),rulesJSON);
await writeFile(join(output,'cosmetics.json'),JSON.stringify(compiled.cosmetics));
await writeFile(join(output,'manifest.json'),JSON.stringify({...provenance,rulesSha256:createHash('sha256').update(rulesJSON).digest('hex'),networkRules:compiled.rules.length,cosmeticRules:compiled.cosmetics.rules.length,stats:compiled.stats},null,2)+'\n');
await build({entryPoints:[join(root,'extension/adblock/pluto-main.ts')],outfile:join(output,'pluto-main.js'),bundle:true,minify:true,format:'iife',platform:'browser',target:'chrome127',tsconfigRaw:{compilerOptions:{alwaysStrict:true}}});
console.log('Compiled ad filters:',JSON.stringify({rules:compiled.rules.length,cosmetics:compiled.cosmetics.rules.length,...compiled.stats}));
