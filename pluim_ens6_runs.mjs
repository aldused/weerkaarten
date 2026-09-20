import {MODEL, PARAMETERS, runId, runToken, runLabel, assertDataset} from './pluim_ens6_data.mjs';
export {runId, runToken, runLabel};

export class RunController {
  constructor({fetcher=globalThis.fetch.bind(globalThis), base='https://om.weerlab.nl', requested=null}={}) {
    this.fetcher=fetcher; this.base=base; this.requested=requested;
    this.selectedRun=null; this.runs=[]; this.catalogs=new Map(); this.cache=new Map();
    this.serial=0; this.abort=null; this.activeKey=null; this.pending=null;
  }
  async catalog(location, signal, refresh=false) {
    const key=`${location.lat},${location.lon}`;
    const cached=this.catalogs.get(key);
    if (!refresh && cached && Date.now()-cached.at<60000) {this.runs=cached.data.runs;return cached.data;}
    const query=new URLSearchParams({latitude:location.lat,longitude:location.lon,model:MODEL});
    const data=await this.json(`${this.base}/ens6-runs?${query}`,signal);
    signal.throwIfAborted();
    data.runs=(data.runs || []).map(r=>({...r,run:runId(r.run)})).sort((a,b)=>Date.parse(b.run)-Date.parse(a.run));
    this.catalogs.set(key,{data,at:Date.now()}); this.runs=data.runs;
    return data;
  }
  async json(url,signal) {
    const response=await this.fetcher(url,{signal,cache:'no-store'});
    const data=await response.json();
    if (!response.ok) throw new Error(data.error || `Gegevens niet beschikbaar (HTTP ${response.status}).`);
    return data;
  }
  choose(value) {
    this.abort?.abort(); this.serial++;
    this.requested=value; this.selectedRun=null;
    if (value && !/^(00|06|12|18)$/.test(value)) this.selectedRun=runId(value);
  }
  async load(location,{refresh=false,onSelection=()=>{}}={}) {
    const key=JSON.stringify([location.lat,location.lon,this.selectedRun || this.requested,refresh]);
    if (this.pending && key===this.activeKey && !this.abort?.signal.aborted) return this.pending;
    this.abort?.abort();
    const abort=new AbortController(), serial=++this.serial;
    this.abort=abort; this.activeKey=key;
    const {signal}=abort;
    const work=(async()=>{
      const catalog=await this.catalog(location,signal,refresh);
      signal.throwIfAborted();
      if (!this.selectedRun) {
        if (/^(00|06|12|18)$/.test(this.requested || '')) {
          this.selectedRun=this.runs.find(r=>new Date(r.run).getUTCHours()===Number(this.requested))?.run;
          if (!this.selectedRun) throw new Error(`De gekozen ${this.requested} UTC-run is niet beschikbaar.`);
        } else if (this.requested) this.selectedRun=runId(this.requested);
        else this.selectedRun=this.runs[0]?.run;
      }
      const id=this.selectedRun;
      if (!id) throw new Error('Geen bruikbare ENS6plus-runs beschikbaar voor deze locatie.');
      onSelection(id,catalog);
      const option=this.runs.find(r=>r.run===id);
      if (!option) throw new Error(`Modelrun ${runLabel(id)} is niet beschikbaar voor deze locatie. Kies bewust een andere run.`);
      const query=new URLSearchParams({latitude:location.lat,longitude:location.lon,model:MODEL,run:id,hourly:[...PARAMETERS].sort().join(','),start_hour:id,forecast:'all-native',revision:option.revision || catalog.revision || ''});
      const cacheKey=query.toString();
      let data=!refresh && this.cache.get(cacheKey);
      if (!data) {
        data=assertDataset(await this.json(`${this.base}/ens6-run?${query}`,signal),id);
        signal.throwIfAborted();
        if (data.location?.latitude!==location.lat || data.location?.longitude!==location.lon) throw new Error('De ontvangen gegevens horen bij een andere locatie.');
        this.cache.set(cacheKey,data);
        if (this.cache.size>24) this.cache.delete(this.cache.keys().next().value);
      }
      signal.throwIfAborted();
      if (serial!==this.serial || id!==this.selectedRun) throw new DOMException('Ingehaald door een nieuwe keuze','AbortError');
      return {data,serial,location:{...location},cacheKey};
    })();
    this.pending=work;
    try {return await work;} finally {if(this.pending===work){this.pending=null;this.activeKey=null;}}
  }
  isCurrent(result) {return result.serial===this.serial && result.data.run===this.selectedRun && !this.abort.signal.aborted;}
}
