"""Download a recent daily NOAA OISST analysis and publish European sea cells."""
import argparse,datetime as dt,io,json,pathlib,urllib.request
import h5py
import numpy as np
BASE='https://www.ncei.noaa.gov/data/sea-surface-temperature-optimum-interpolation/v2.1/access/avhrr/'
def convert(content,url):
 with h5py.File(io.BytesIO(content)) as f:
  lat=f['lat'][:];lon=(f['lon'][:]+180)%360-180;a=f['sst'];raw=a[0,0,:,:]
  scale=float(a.attrs['scale_factor'][0]);offset=float(a.attrs['add_offset'][0]);fill=int(a.attrs['_FillValue'][0])
  stamp=dt.datetime(1978,1,1,12,tzinfo=dt.timezone.utc)+dt.timedelta(days=float(f['time'][0]));points=[]
  for i in np.where((lat>=34)&(lat<=65))[0]:
   for j in np.where((lon>=-14)&(lon<=32))[0]:
    v=int(raw[i,j])
    if v!=fill and -300<=v<=4500:points.append([float(lat[i]),float(lon[j]),round(v*scale+offset,2)])
  if len(points)<1000:raise ValueError('Insufficient SST coverage')
  return dict(source='NOAA NCEI OISST v2.1',url=url,valid=stamp.isoformat(),generated=dt.datetime.now(dt.timezone.utc).isoformat(),resolution=.25,preliminary='preliminary' in url,points=points)
def download():
 for age in range(1,8):
  day=dt.datetime.now(dt.timezone.utc).date()-dt.timedelta(days=age)
  for suffix in ['_preliminary','']:
   url=f'{BASE}{day:%Y%m}/oisst-avhrr-v02r01.{day:%Y%m%d}{suffix}.nc'
   try:
    with urllib.request.urlopen(url,timeout=25) as r:d=convert(r.read(),url)
    if d['valid'][:10]!=day.isoformat():raise ValueError('Unexpected date')
    return d
   except Exception as exc:print(day,suffix,type(exc).__name__)
 raise RuntimeError('No recent NOAA analysis; refusing to publish old data')
if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('--input');p.add_argument('--source-url');p.add_argument('--output',default='zeetemp_noaa.json');a=p.parse_args()
 if a.input and not a.source_url:p.error('--input requires --source-url')
 d=convert(pathlib.Path(a.input).read_bytes(),a.source_url) if a.input else download()
 target=pathlib.Path(a.output);tmp=target.with_suffix('.tmp');tmp.write_text(json.dumps(d,separators=(',',':'),allow_nan=False));tmp.replace(target)
 print('NOAA SST:',d['valid'],len(d['points']),'sea cells')
