export class BlueprintFirestoreDouble {
  records=new Map(); serial=Promise.resolve(); failAudit=false;
  collection(path){return {doc:id=>this.ref(path+'/'+id)};}
  ref(path){return {path,id:path.split('/').at(-1),collection:name=>this.collection(path+'/'+name),get:async()=>({exists:this.records.has(path),data:()=>structuredClone(this.records.get(path))})};}
  async runTransaction(worker){
    const run=async()=>{let writing=false;const writes=[];const tx={get:async ref=>{if(writing)throw Error('read after write');return ref.get();},
      set:(ref,data)=>{writing=true;writes.push(['set',ref,structuredClone(data)]);},create:(ref,data)=>{writing=true;writes.push(['create',ref,structuredClone(data)]);}};
      const result=await worker(tx);for(const [kind,ref]of writes){if(kind==='create'&&this.records.has(ref.path))throw Error('already exists');if(this.failAudit&&ref.path.includes('/auditEvents/'))throw Error('audit failed');}
      for(const [,ref,data]of writes)this.records.set(ref.path,data);return result;};
    const result=this.serial.then(run);this.serial=result.catch(()=>{});return result;
  }
}
