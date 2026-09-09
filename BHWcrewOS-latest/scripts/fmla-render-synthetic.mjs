import {readFile,writeFile,mkdir} from 'node:fs/promises';
import * as PDFLib from 'pdf-lib';
import {fillFmlaPdf} from '../assets/fmla-pdf.mjs';
import {certificationFields} from '../assets/fmla-certification.mjs';
const out=new URL('../../../../fmla-reference/',import.meta.url);
// Explicit output directory supplied to keep synthetic artifacts outside the published site.
await mkdir(process.argv[2],{recursive:true});
for(const type of ['WH-380-E','WH-380-F']){
 const values={};
 for(const [key,,,,,,,source,kind] of certificationFields(type))values[key]=kind==='checkbox'?false:/Date|Start|End|onset|deadline|From|To/i.test(key)?'09/09/2026':key==='episodeFrequency'?'2':key==='episodeDuration'?'4':key==='requestedHours'?'4':key==='requestedDays'?'3':key.startsWith('employeeName')?'Synthetic Employee':/Patient|patientName/.test(key)?'Synthetic Patient':'Synthetic review';
 values.chronic=true;values.perMonth=true;values.durationHours=true;
 const result=await fillFmlaPdf(PDFLib,await readFile(new URL(`../assets/forms/fmla-wh380${type==='WH-380-E'?'e':'f'}-2029.pdf`,import.meta.url)),type,values);
 await writeFile(`${process.argv[2]}/${type}-synthetic.pdf`,result.bytes);
}
