import { BrowserBlockCache } from '@openmeteo/file-reader';
import { RangeBatcher } from './range-batcher.mjs';

/**
 * file-reader 0.0.19 calls evictIfNeeded after every persistent block write.
 * Its implementation scans every stored response. Batch that maintenance;
 * leave fetching, deduplication, persistence and cancellation to the reader.
 */
export class FastBrowserBlockCache extends BrowserBlockCache {
  #interval;
  #writeBudget;
  #pendingBytes = 0;
  #timer = null;
  #scan = null;
  #clearing = false;
  #ranges;
  #runPaths=null;
  #runPrune=null;
  #cacheName;

  constructor({ evictionIntervalMs = 30000, evictionWriteBudgetBytes, batchRanges=true, ...options } = {}) {
    super(options);
    this.#cacheName=options.cacheName??'om-file-cache';
    this.#ranges=batchRanges?new RangeBatcher():null;
    this.#interval = Math.max(1, evictionIntervalMs);
    const capacity = options.maxBytes ?? 1024 * 1024 * 1024;
    this.#writeBudget = Math.max(this.blockSize(), evictionWriteBudgetBytes ?? Math.min(8 * 1024 * 1024, capacity / 10));
  }

  async retainRuns(runPaths){
    const valid=runPaths.filter(path=>/^\d{4}\/\d{2}\/\d{2}\/(00|06|12|18)00Z$/.test(path));
    if(!valid.length)return;
    this.#runPaths=new Set(valid);
    await this.#pruneRuns();
  }

  #pruneRuns(){
    if(!this.#runPaths||this.#clearing)return Promise.resolve();
    if(this.#runPrune)return this.#runPrune;
    this.#runPrune=(async()=>{
      const cache=await caches.open(this.#cacheName);
      for(const request of await cache.keys()){
        let source;try{source=decodeURIComponent(new URL(request.url).pathname.slice('/cache/'.length));}catch{continue;}
        const run=source.match(/\/data_spatial\/ecmwf_ifs\/(\d{4}\/\d{2}\/\d{2}\/(?:00|06|12|18)00Z)\//)?.[1];
        if(!run||this.#runPaths.has(run))continue;
        await cache.delete(request.url);
        this.memCache.delete(request.url);
        clearTimeout(this.evictionTimers.get(request.url));this.evictionTimers.delete(request.url);
      }
    })().finally(()=>{this.#runPrune=null;});
    return this.#runPrune;
  }

  get(key,fetchFn,fileSize,signal){
    // file-reader keys blocks from the immutable file's end. Keep its cache
    // and in-flight deduplication; merge only the actual cache misses.
    const match=typeof key==='string'&&key.match(/^(https?:\/\/.*\.om)\/block\/(\d+)$/);
    if(this.#ranges&&match&&Number.isSafeInteger(fileSize)&&fileSize>0){
      const end=fileSize-Number(match[2])*this.blockSize(),start=Math.max(0,end-this.blockSize());
      if(end>start)return super.get(key,fetchSignal=>this.#ranges.read(match[1],start,end,fileSize,fetchSignal),fileSize,signal);
    }
    return super.get(key,fetchFn,fileSize,signal);
  }

  async seedTail(url,bytes,fileSize){
    const blockSize=this.blockSize(),tasks=[];
    if(!Number.isSafeInteger(fileSize)||fileSize<=0||!bytes.length||bytes.length>fileSize||(bytes.length!==fileSize&&bytes.length%blockSize))throw new Error('Ongeldige ECMWF-cacheblokken');
    for(let index=0,remaining=bytes.length;remaining>0;index++){
      const length=Math.min(blockSize,remaining),start=remaining-length;
      const data=bytes.slice(start,remaining);remaining=start;
      tasks.push(super.get(`${url}/block/${index}`,async()=>data,fileSize));
    }
    await Promise.all(tasks);
  }

  evictIfNeeded() {
    if (this.#clearing) return Promise.resolve();
    // Each caller follows a successful cache.put. A block can be shorter than
    // blockSize, so this is a conservative bound on newly persisted bytes.
    this.#pendingBytes += this.blockSize();
    if (this.#scan) return this.#scan;
    if (this.#pendingBytes >= this.#writeBudget) return this.#maintain();
    this.#schedule();
    return Promise.resolve();
  }

  #schedule() {
    if (this.#timer !== null || this.#clearing || !this.#pendingBytes) return;
    this.#timer = setTimeout(() => {
      this.#timer = null;
      void this.#maintain().catch(error => console.warn('ECMWF-cacheonderhoud mislukt:', error));
    }, this.#interval);
    this.#timer.unref?.();
  }

  #maintain() {
    if (this.#scan) return this.#scan;
    if (this.#timer !== null) clearTimeout(this.#timer);
    this.#timer = null;
    this.#pendingBytes = 0;
    this.#scan = this.#pruneRuns().then(()=>super.evictIfNeeded()).finally(() => {
      this.#scan = null;
      if (this.#clearing || !this.#pendingBytes) return;
      // Writes during a scan are accounted for separately. Never lose the
      // last maintenance pass, even when loading stops immediately afterward.
      if (this.#pendingBytes >= this.#writeBudget) {
        this.#timer = setTimeout(() => {
          this.#timer = null;
          void this.#maintain().catch(error => console.warn('ECMWF-cacheonderhoud mislukt:', error));
        }, 0);
        this.#timer.unref?.();
      } else this.#schedule();
    });
    return this.#scan;
  }

  async clear() {
    this.#clearing = true;
    if (this.#timer !== null) clearTimeout(this.#timer);
    this.#timer = null;
    this.#pendingBytes = 0;
    try {
      await this.#scan?.catch(() => {});
      await this.#runPrune?.catch(()=>{});
      await super.clear();
    } finally { this.#clearing = false; }
  }
}
