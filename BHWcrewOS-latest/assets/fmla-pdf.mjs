import {certificationFields,validateCertification} from './fmla-certification.mjs';
export async function fillFmlaPdf(PDFLib, bytes, type, values) {
 const errors=validateCertification(values); if(errors.length) throw new Error(errors.join(' '));
 const doc=await PDFLib.PDFDocument.load(bytes), form=doc.getForm();
 const font=await doc.embedFont(PDFLib.StandardFonts.Helvetica);
 let filled=0;
 for(const [key,label,page,x,top,width,height,,kind] of certificationFields(type)) {
  const rect={x,y:792-top-height,width,height,borderWidth:0,backgroundColor:undefined,borderColor:undefined,font};
  if(kind==='checkbox') {
   const field=form.createCheckBox(key); field.addToPage(doc.getPage(page),rect);
   if(values[key]===true){field.check();filled++;} continue;
  }
  const value=String(values[key] ?? '').replace(/[\u2018\u2019]/g,"'").replace(/[\u201c\u201d]/g,'"').replace(/[\u2013\u2014]/g,'-');
  let size=9;
  const multiline=height>20;
  function fits(size) {
   try {
    if(!multiline) return font.widthOfTextAtSize(value,size)<=width-4;
    let lines=0;
    for(const paragraph of value.split('\n')) {
     let used=0; lines++;
     for(const word of paragraph.split(/\s+/)) {
      const length=font.widthOfTextAtSize(word+' ',size);
      if(length>width-4) return false;
      if(used+length>width-4){lines++;used=0;} used+=length;
     }
    }
    return lines*size*1.2<=height-2;
   }catch{throw new Error(`Use plain text supported by the PDF in ${label}.`);}
  }
  while(size>7&&!fits(size)) size-=0.5;
  if(value&&!fits(size)) throw new Error(`${label} is too long for the official form. Shorten it before downloading; no text was discarded.`);
  const field=form.createTextField(key); if(multiline)field.enableMultiline();
  field.addToPage(doc.getPage(page),rect);field.setFontSize(size);field.setText(value);if(value)filled++;
 }
 for(const page of doc.getPages()) page.drawText('DRAFT - Clinician must verify all applicable sections and sign before release.',{x:21,y:778,size:7,font,color:PDFLib.rgb(.55,.12,.08)});
 form.updateFieldAppearances(font);
 return {bytes:await doc.save(),filled,name:`${type}-review-draft.pdf`};
}
