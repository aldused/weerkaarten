/* Bounded, lossless viewer caches. Mutable source metadata is always revalidated. */
(function(root) {
  'use strict';
  class LRU {
    constructor({maxBytes=64*1024*1024,maxEntries=12,dispose=()=>{}}={}) {
      this.maxBytes=maxBytes;this.maxEntries=maxEntries;this.dispose=dispose;
      this.entries=new Map();this.bytes=0;this.hits=0;this.misses=0;
    }
    get(key) {
      const entry=this.entries.get(key);
      if(!entry){this.misses++;return undefined;}
      this.hits++;this.entries.delete(key);this.entries.set(key,entry);return entry.value;
    }
    set(key,value,bytes=0) {
      this.delete(key);
      if(bytes>this.maxBytes)return false;
      this.entries.set(key,{value,bytes});this.bytes+=bytes;
      while(this.entries.size>this.maxEntries||this.bytes>this.maxBytes)this.delete(this.entries.keys().next().value);
      return true;
    }
    delete(key) {const e=this.entries.get(key);if(e){this.entries.delete(key);this.bytes-=e.bytes;this.dispose(e.value);}}
    clear(){for(const key of this.entries.keys())this.delete(key);}
  }
  class ImageFrames {
    constructor(options={}) {
      this.cache=new LRU(options);this.pending=new Map();this.queue=[];this.active=0;
      this.maxActive=options.maxActive??1;this.generation=0;
    }
    get(url){return this.cache.get(url);}
    load(url,priority='high') {
      const cached=this.get(url);if(cached)return Promise.resolve(cached);
      const pending=this.pending.get(url);
      if(pending){pending.image.fetchPriority=priority;return pending.promise;}
      const image=new Image();image.decoding='async';image.fetchPriority=priority;
      let cancel, cancelled=false;
      const promise=new Promise((resolve,reject)=>{
        cancel=()=>{cancelled=true;image.onload=null;image.onerror=null;image.src='';reject(new Error('Kaartselectie gewijzigd'));};
        image.onload=async()=>{
          try{await image.decode();}catch{} // Loaded pixels remain usable in older browsers.
          if(cancelled)return;
          if(!image.naturalWidth){reject(new Error('Kaart kon niet worden gedecodeerd'));return;}
          this.cache.set(url,image,image.naturalWidth*image.naturalHeight*4);resolve(image);
        };
        image.onerror=()=>reject(new Error('Kaart niet beschikbaar'));
        image.src=url;
      });
      const task={image,promise,cancel};this.pending.set(url,task);
      const finish=()=>{if(this.pending.get(url)===task)this.pending.delete(url);};
      promise.then(finish,finish);return promise;
    }
    cancelQueued(){this.generation++;this.queue=[];}
    select(url){
      this.cancelQueued();
      for(const [key,task] of this.pending)if(key!==url){this.pending.delete(key);task.cancel();}
    }
    preload(urls) {
      this.cancelQueued();
      if(typeof document!=='undefined'&&document.hidden)return;
      const connection=globalThis.navigator?.connection;
      if(connection?.saveData||['slow-2g','2g'].includes(connection?.effectiveType))return;
      this.queue=[...new Set(urls)];this.drain();
    }
    drain() {
      while(this.active<this.maxActive&&this.queue.length) {
        const url=this.queue.shift();if(this.cache.entries.has(url)||this.pending.has(url))continue;
        this.active++;
        this.load(url,'low').catch(()=>{}).finally(()=>{this.active--;this.drain();});
      }
    }
  }
  const api={LRU,ImageFrames};
  if(typeof module==='object'&&module.exports)module.exports=api;
  root.MapPerformance=api;
})(typeof window==='object'?window:globalThis);
