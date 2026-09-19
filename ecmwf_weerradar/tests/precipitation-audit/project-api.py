"""Read-only audit of the user's existing 0.25 degree API files (never logs API keys)."""
import pathlib,json,struct,datetime,urllib.request,urllib.parse,hashlib,sys
from zoneinfo import ZoneInfo
root=pathlib.Path(sys.argv[1]);out=pathlib.Path(__file__).parent
meta=json.loads((root/'ecmwf_om_canvas_meta.json').read_text());data=(root/'ecmwf_om_data_neerslag.bin').read_bytes()
ny,nx,nt,nc=struct.unpack('<HHHH',data[:8]);assert nc==1 and (ny,nx,nt)==(meta['grid']['n_lat'],meta['grid']['n_lon'],meta['uren'])
points=[('Cuxhaven',53.75,8.75),('Groningen',53.25,6.5),('Arnhem',52,6),('Rotterdam',52,4.5),('Brussel',50.75,4.25)]
params={'latitude':','.join(str(p[1]) for p in points),'longitude':','.join(str(p[2]) for p in points),'hourly':'precipitation','models':'ecmwf_ifs025,ecmwf_ifs','start_date':'2026-09-19','end_date':'2026-09-25','timezone':'Europe/Amsterdam','precipitation_unit':'mm','cell_selection':'nearest'}
url='https://api.open-meteo.com/v1/forecast?'+urllib.parse.urlencode(params)
with urllib.request.urlopen(url,timeout=60) as r:api=json.load(r)
(out/'openmeteo-point-api.json').write_text(json.dumps(api,indent=2)+'\n')
results=[]
for (name,lat,lon),response in zip(points,api):
 iy=round((lat-meta['grid']['lat_min'])/.25);ix=round((lon-meta['grid']['lon_min'])/.25)
 row={'name':name,'lat':lat,'lon':lon,'returnedLat':response['latitude'],'returnedLon':response['longitude'],'samples':[]}
 for local in ['2026-09-19T15:00','2026-09-19T16:00','2026-09-19T17:00','2026-09-20T00:00','2026-09-23T11:00','2026-09-25T14:00']:
  t=meta['tijden'].index(local);ai=response['hourly']['time'].index(local)
  value=struct.unpack_from('<f',data,16+4*((t*ny+iy)*nx+ix))[0]
  row['samples'].append({'local':local,'utc':datetime.datetime.fromisoformat(local).replace(tzinfo=ZoneInfo('Europe/Amsterdam')).astimezone(datetime.timezone.utc).isoformat(),'projectMm':value,'api025Mm':response['hourly']['precipitation_ecmwf_ifs025'][ai],'apiNativeMm':response['hourly']['precipitation_ecmwf_ifs'][ai]})
 results.append(row)
latest={}
for model in ['ecmwf_ifs','ecmwf_ifs025']:
 with urllib.request.urlopen(f'https://openmeteo.s3.amazonaws.com/data_spatial/{model}/latest.json',timeout=60) as r: m=json.load(r)
 latest[model]={k:m.get(k) for k in ['reference_time','last_modified_time','completed']}
report={'checkedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'projectMeta':meta,'projectFile':'weerlab/ecmwf_om_data_neerslag.bin','projectSha256':hashlib.sha256(data).hexdigest(),'apiURL':url,'latestSpatialRuns':latest,'apiUnits':api[0]['hourly_units'],'results':results}
(out/'project-api-comparison.json').write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps({k:report[k] for k in ['checkedAt','latestSpatialRuns','apiUnits','results']},indent=2))
