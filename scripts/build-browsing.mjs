import {cp,mkdir,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
const root=resolve(import.meta.dirname,'..'), out=join(root,'.output/chrome-mv3/ocr');
await mkdir(out,{recursive:true});
await cp(join(root,'node_modules/tesseract.js/dist/worker.min.js'),join(out,'worker.min.js'));
await cp(join(root,'node_modules/tesseract.js-core/tesseract-core-lstm.wasm.js'),join(out,'tesseract-core-lstm.wasm.js'));
await cp(join(root,'node_modules/@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz'),join(out,'eng.traineddata.gz'));
await writeFile(join(out,'NOTICES.txt'),'Local OCR: Tesseract.js 7.0.0, Tesseract.js-core and the Tesseract English model, Apache-2.0. Sources and license notices are included in browsing-source.zip in the installer bundle. No CDN or remote OCR service is used.\n');
console.log('Built local image text recognition assets');
