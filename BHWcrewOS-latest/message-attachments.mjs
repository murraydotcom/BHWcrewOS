const MAX_BYTES=512*1024;
const TYPES={pdf:'application/pdf',png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg',txt:'text/plain'};
export async function readMessageFiles(fileList){
  const files=Array.from(fileList || []);
  if(files.length>3)throw new Error('Attach up to three files.');
  return Promise.all(files.map(async file=>{
    if(!/^[a-z0-9][a-z0-9 _().-]{0,99}$/i.test(file.name) || file.name.includes('..'))throw new Error('Use a short file name without path characters.');
    const mediaType=TYPES[file.name.split('.').at(-1).toLowerCase()];
    if(!mediaType || (file.type && file.type!==mediaType))throw new Error('Choose PDF, PNG, JPEG, or text files.');
    if(!file.size || file.size>MAX_BYTES)throw new Error('Each file must be between 1 byte and 512 KB.');
    const bytes=new Uint8Array(await file.arrayBuffer());let binary='';
    for(let start=0;start<bytes.length;start+=8192)binary+=String.fromCharCode(...bytes.subarray(start,start+8192));
    return {name:file.name,mediaType,contentBase64:btoa(binary)};
  }));
}
export async function downloadMessageFile({api,threadId,file,isCurrent=()=>true}){
  const {blob}=await api({query:{threadId,attachmentId:file.id},download:true});
  if(blob.size!==file.size)throw new Error('File download could not be verified.');
  const hash=await crypto.subtle.digest('SHA-256',await blob.arrayBuffer());
  if(Array.from(new Uint8Array(hash),b=>b.toString(16).padStart(2,'0')).join('')!==file.sha256)throw new Error('File download could not be verified.');
  if(!isCurrent())return;
  const url=URL.createObjectURL(blob);const link=document.createElement('a');link.href=url;link.download=file.name;
  document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
