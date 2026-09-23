#!/usr/bin/env python3
"""Split existing regional Weerlab bytes into immutable, hourly map objects.
No GRIB conversion, rounding or recalculation of precipitation is performed.
"""
import argparse, hashlib, json, mmap, os, shutil, struct, tempfile
from datetime import datetime, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

PARAMETERS={'precipitation':'neerslag','temperature_2m':'temp','cloud_cover':'bewolking','wind_u_component_10m':'wind','visibility':'zicht','wind_gusts_10m':'windstoten','cloud_base':'wolkenbasis'}
def build(model, meta_path, output):
    meta_path=Path(meta_path); raw=meta_path.read_bytes(); meta=json.loads(raw)
    run=datetime.fromisoformat(meta['run_utc'].replace('Z','+00:00'))
    if model not in ('harmonie','harmonie46','icond2') or run.utcoffset()!=timedelta(0): raise ValueError('Ongeldig model of UTC-run')
    if model=='icond2' and (meta.get('model')!='ICON-D2' or run.hour%3 or run.minute or run.second or run.microsecond or not 1<=meta['uren']<=48): raise ValueError('Verwacht reguliere ICON-D2-bron, geen RUC')
    times=[]
    for i,wall in enumerate(meta['tijden']):
        instant=run+timedelta(hours=i+1)
        parsed=datetime.fromisoformat(wall.replace('Z','+00:00'))
        valid=parsed==instant if parsed.tzinfo else parsed==instant.astimezone(ZoneInfo('Europe/Amsterdam')).replace(tzinfo=None)
        if not valid: raise ValueError('Tijdreeks sluit niet aan op de run: '+wall)
        times.append(instant.isoformat().replace('+00:00','Z'))
    if len(times)!=meta['uren'] or not times: raise ValueError('Onvolledige tijdreeks')
    fields={}; sources=[]; offset=0
    for variable,key in PARAMETERS.items():
        # Full model resolution when the exporter provides it (<key>_hr);
        # the ~4 km canvas fields are only a fallback for older runs.
        if key+'_hr' in meta['parameters']:key=key+'_hr'
        info=meta['parameters'].get(key)
        if not info:continue
        path=meta_path.parent/info['file']; stamp=path.stat(); stream=path.open('rb'); data=mmap.mmap(stream.fileno(),0,access=mmap.ACCESS_READ)
        ny,nx,steps,components=struct.unpack_from('<4H',data);dtype=data[8];size=1 if dtype in (1,2) else 4
        grid=info.get('grid',meta['grid'])
        if dtype not in (0,1,2) or (ny,nx,steps,components)!=(grid['n_lat'],grid['n_lon'],len(times),info['components']) or len(data)!=16+ny*nx*steps*components*size:raise ValueError('Bestand wijkt af van metadata: '+str(path))
        if variable in ('wind_u_component_10m','wind_gusts_10m') and (components!=2 or dtype!=0):raise ValueError('Wind vereist twee oorspronkelijke m/s-componenten')
        length=ny*nx*components*size
        fields[variable]={'grid':grid,'offset':offset,'length':length,'dtype':dtype,'bytes':size,'components':components,'scale':info.get('scale',16),'power':info.get('power',2),'source_parameter':key}
        sources.append((path,stamp,stream,data,length));offset+=length
    if any(v not in fields for v in PARAMETERS if v not in ('wind_gusts_10m','cloud_base')):raise ValueError('Een vereist weerveld ontbreekt')
    contract={'schema':1,'model':model,'reference_time':run.isoformat().replace('+00:00','Z'),'valid_times':times,'fields':fields,'frame_bytes':offset,'cloud_method':'maximum of high/middle/low cloud fraction','source':('DWD' if model=='icond2' else 'KNMI')+' via Weerlab'}
    digest=hashlib.sha256(json.dumps(contract,sort_keys=True).encode())
    output=Path(output);output.mkdir(parents=True,exist_ok=True)
    temp=Path(tempfile.mkdtemp(prefix='building-',dir=output))
    try:
        for i in range(len(times)):
            with (temp/f'{i:03}.bin').open('wb') as dest:
                for path,stamp,stream,data,length in sources:
                    block=data[16+i*length:16+(i+1)*length];digest.update(block);dest.write(block)
        if raw!=meta_path.read_bytes() or any(p.stat().st_mtime_ns!=s.st_mtime_ns or p.stat().st_size!=s.st_size for p,s,_,_,_ in sources):raise ValueError('Bronrun veranderde tijdens de export')
        version=run.strftime('%Y%m%d%H')+'-'+digest.hexdigest()[:16]
        manifest={**contract,'version':version,'last_modified_time':datetime.fromtimestamp(meta_path.stat().st_mtime,timezone.utc).isoformat().replace('+00:00','Z')}
        (temp/'meta.json').write_text(json.dumps(manifest,separators=(',',':')))
        target=output/version
        if target.exists():shutil.rmtree(temp)
        else:temp.rename(target)
        print(json.dumps({'model':model,'version':version,'path':str(target),'steps':len(times),'bytes':offset*len(times)}))
        return target
    finally:
        for _,_,stream,data,_ in sources:data.close();stream.close()
        if temp.exists():shutil.rmtree(temp)
if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--model',required=True);p.add_argument('--meta',required=True);p.add_argument('--output',required=True);a=p.parse_args();build(a.model,a.meta,a.output)
