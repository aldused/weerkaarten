"""Independent official ECMWF 0.25° TP snapshots; native O1280 delivery is not public here."""
import json, hashlib, urllib.request, pathlib, datetime
import eccodes
OUT=pathlib.Path(__file__).parent
POINTS=[('Bristol',51.5,-2.5),('Reading',51.5,-1),('Cuxhaven',53.75,8.75),('Groningen',53.25,6.5),('Arnhem',52,6),('Paris',48.75,2.25),('Alpen',46.75,10.5)]
def get(url, headers={}):
    with urllib.request.urlopen(urllib.request.Request(url,headers=headers),timeout=60) as r: return r.read()
results=[]
for run,steps in [('2026091900',[12,15,90,93,144,150]),('2026091812',[24,27,90,93,144,150])]:
    for step in steps:
        base=f'https://data.ecmwf.int/forecasts/{run[:8]}/{run[8:]}z/ifs/0p25/oper/{run}0000-{step}h-oper-fc'
        path=OUT/f'{run}-{step}-tp.grib2'
        if not path.exists():
            index=[json.loads(l) for l in get(base+'.index').decode().splitlines()]
            entry=next(x for x in index if x['param']=='tp')
            start,length=entry['_offset'],entry['_length']
            data=get(base+'.grib2',{'Range':f'bytes={start}-{start+length-1}'})
            assert len(data)==length
            path.write_bytes(data)
        with path.open('rb') as f: msg=eccodes.codes_grib_new_from_file(f)
        meta={k:eccodes.codes_get(msg,k) for k in ['shortName','paramId','units','stepType','startStep','endStep','dataDate','dataTime','validityDate','validityTime','gridType','Ni','Nj']}
        assert meta['shortName']=='tp' and meta['paramId']==228 and meta['units']=='m'
        samples=[]
        for name,lat,lon in POINTS:
            point=eccodes.codes_grib_find_nearest(msg,lat,lon)[0]
            assert abs(point['lat']-lat)<1e-8 and abs((point['lon']-lon+180)%360-180)<1e-8
            samples.append(dict(name=name,lat=lat,lon=lon,cumulativeMetres=point['value']))
        eccodes.codes_release(msg)
        results.append(dict(run=run,lead=step,url=base+'.grib2',sha256=hashlib.sha256(path.read_bytes()).hexdigest(),metadata=meta,samples=samples))
        print(run,step,[(p['name'],round(p['cumulativeMetres']*1000,3)) for p in samples],flush=True)
(OUT/'grib-source.json').write_text(json.dumps(results,indent=2)+'\n')
