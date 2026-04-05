#!/bin/bash
# Harmonie 43 data update script
# Draait het Python script en exporteert alle binaire data + overlay
cd "/Users/aldus/KNMI_Project/weerkaarten 2"

echo "$(date): Harmonie update gestart"

# Download nieuwste run + exporteer binaire data
/usr/local/bin/python3 -c "
import os, json, struct, time, tempfile, tarfile
import numpy as np
import eccodes
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

os.chdir('/Users/aldus/KNMI_Project/weerkaarten 2')
LOCAL_TZ = ZoneInfo('Europe/Amsterdam')
EXTENT = [1.5, 9.0, 49.3, 53.9]
KEY = 'eyJvcmciOiI1ZTU1NGUxOTI3NGE5NjAwMDEyYTNlYjEiLCJpZCI6Ijk5YjZhMzkwMTlkYzQxYzlhMzJjNmNmY2MyNDgxNGRkIiwiaCI6Im11cm11cjEyOCJ9'

import requests

# 1. Laatste bestand zoeken
print('1. Laatste Harmonie run zoeken...')
url = 'https://api.dataplatform.knmi.nl/open-data/v1/datasets/harmonie_arome_cy43_p1/versions/1.0/files'
r = requests.get(url, headers={'Authorization': KEY}, params={'maxKeys':1,'orderBy':'created','sorting':'desc'}, timeout=30)
r.raise_for_status()
filename = r.json()['files'][0]['filename']
print(f'   {filename}')

# 2. Downloaden
print('2. Downloaden...')
url2 = f'https://api.dataplatform.knmi.nl/open-data/v1/datasets/harmonie_arome_cy43_p1/versions/1.0/files/{filename}/url'
r2 = requests.get(url2, headers={'Authorization': KEY}, timeout=15)
download_url = r2.json()['temporaryDownloadUrl']

with tempfile.TemporaryDirectory(prefix='harmonie_') as tmpdir:
    tarpath = os.path.join(tmpdir, filename)
    r3 = requests.get(download_url, stream=True, timeout=300)
    r3.raise_for_status()
    with open(tarpath, 'wb') as f:
        for chunk in r3.iter_content(chunk_size=65536):
            f.write(chunk)
    print(f'   {os.path.getsize(tarpath)/1024/1024:.0f} MB')

    # 3. Extract
    print('3. Extracten...')
    with tarfile.open(tarpath, 'r') as tar:
        tar.extractall(path=tmpdir)
    grib_files = sorted([os.path.join(tmpdir, f) for f in os.listdir(tmpdir) if f.endswith('_GB')])
    print(f'   {len(grib_files)} bestanden')

    # Parse run
    parts = filename.replace('.tar','').split('_')
    run_str_raw = parts[-1] if parts else ''
    try:
        run_dt = datetime.strptime(run_str_raw[:10], '%Y%m%d%H').replace(tzinfo=timezone.utc)
    except:
        run_dt = datetime.now(tz=timezone.utc)

    # 4. Alle data lezen
    print('4. Data lezen...')
    TEMP_LEVELS = [2, 50, 100, 200, 300]
    WIND_LEVELS = [10, 50, 100, 200, 300]

    all_data = {k: [] for k in ['temp','cum','hoog','mid','laag','uw','vw','ug','vg','zicht','rv','cape','onweer','druk','dauwpunt']}
    all_stral_cum = []
    all_temp_prof = {l: [] for l in TEMP_LEVELS}
    all_wspd_prof = {l: [] for l in WIND_LEVELS}
    lats = lons = None; nj = ni = 0

    for gf in grib_files:
        temp=cum=hoog=mid=laag=uw=vw=ug=vg=zicht=druk=rv=dp=stral=None
        cape_list=[]; onweer=None; druk_n=0
        temps_p={}; u_w_p={}; v_w_p={}
        with open(gf,'rb') as fh:
            while True:
                msgid=eccodes.codes_grib_new_from_file(fh)
                if msgid is None: break
                ind=eccodes.codes_get(msgid,'indicatorOfParameter')
                lvl=eccodes.codes_get(msgid,'level')
                ni2=eccodes.codes_get(msgid,'Ni'); nj2=eccodes.codes_get(msgid,'Nj')
                vals=eccodes.codes_get_values(msgid).reshape(nj2,ni2)
                if ind==11 and lvl==2: temp=vals-273.15
                elif ind==11 and lvl in TEMP_LEVELS: temps_p[lvl]=vals-273.15
                elif ind==17 and lvl==2: dp=vals-273.15
                elif ind==52 and lvl==2: rv=vals*100
                elif ind==61: cum=vals
                elif ind==75: hoog=vals
                elif ind==74: mid=vals
                elif ind==73: laag=vals
                elif ind==33 and lvl==10: uw=vals
                elif ind==34 and lvl==10: vw=vals
                elif ind==33 and lvl in WIND_LEVELS: u_w_p[lvl]=vals
                elif ind==34 and lvl in WIND_LEVELS: v_w_p[lvl]=vals
                elif ind==162 and lvl==10: ug=vals
                elif ind==163 and lvl==10: vg=vals
                elif ind==20 and zicht is None: zicht=vals
                elif ind==117 and stral is None: stral=vals
                elif ind==201: cape_list.append(vals)
                elif ind==184 and onweer is None: onweer=vals
                elif ind==1 and lvl==0:
                    druk_n+=1
                    if druk_n==1: druk=vals
                if lats is None:
                    lat1=eccodes.codes_get(msgid,'latitudeOfFirstGridPointInDegrees')
                    lat2=eccodes.codes_get(msgid,'latitudeOfLastGridPointInDegrees')
                    lon1=eccodes.codes_get(msgid,'longitudeOfFirstGridPointInDegrees')
                    lon2=eccodes.codes_get(msgid,'longitudeOfLastGridPointInDegrees')
                    lats=np.linspace(lat1,lat2,nj2); lons=np.linspace(lon1,lon2,ni2)
                    nj=nj2; ni=ni2
                eccodes.codes_release(msgid)
        z=np.zeros((nj,ni))
        all_data['temp'].append(temp); all_data['cum'].append(cum)
        all_data['hoog'].append(hoog); all_data['mid'].append(mid); all_data['laag'].append(laag)
        all_data['uw'].append(uw); all_data['vw'].append(vw)
        all_data['ug'].append(ug); all_data['vg'].append(vg)
        all_data['zicht'].append(zicht); all_data['rv'].append(rv); all_data['dauwpunt'].append(dp)
        all_data['cape'].append(cape_list[-1] if cape_list else z)
        all_data['onweer'].append(onweer if onweer is not None else z)
        all_data['druk'].append(druk)
        all_stral_cum.append(stral if stral is not None else z)
        for l in TEMP_LEVELS: all_temp_prof[l].append(temps_p.get(l,z))
        for l in WIND_LEVELS:
            u=u_w_p.get(l,z); v=v_w_p.get(l,z)
            all_wspd_prof[l].append(np.sqrt(u**2+v**2))

    if lats[0]>lats[-1]:
        lats=lats[::-1]
        for key in all_data:
            for i in range(len(all_data[key])):
                if all_data[key][i] is not None: all_data[key][i]=all_data[key][i][::-1,:]
        all_stral_cum=[d[::-1,:] for d in all_stral_cum]
        for l in TEMP_LEVELS: all_temp_prof[l]=[d[::-1,:] for d in all_temp_prof[l]]
        for l in WIND_LEVELS: all_wspd_prof[l]=[d[::-1,:] for d in all_wspd_prof[l]]

    hourly_precip=[np.maximum(all_data['cum'][i]-all_data['cum'][i-1],0) for i in range(1,len(all_data['cum']))]
    hourly_stral=[(all_stral_cum[i]-all_stral_cum[i-1])/3600 for i in range(1,len(all_stral_cum))]
    hourly_stral=[np.maximum(s,0) for s in hourly_stral]

    # 5. Crop en exporteer
    print('5. Exporteren...')
    lat_idx=np.where((lats>=EXTENT[2])&(lats<=EXTENT[3]))[0]
    lon_idx=np.where((lons>=EXTENT[0])&(lons<=EXTENT[1]))[0]
    n_lat=len(lat_idx); n_lon=len(lon_idx); n_steps=len(grib_files)-1
    def crop(d): return d[np.ix_(lat_idx,lon_idx)]
    def write_bin(fn, data_list, nc=1):
        with open(fn,'wb') as f:
            f.write(struct.pack('<HHHH',n_lat,n_lon,len(data_list),nc))
            f.write(b'\x00'*8)
            for item in data_list:
                if nc==1: f.write(crop(item).astype(np.float32).tobytes())
                else:
                    for comp in item: f.write(crop(comp).astype(np.float32).tobytes())

    write_bin('harmonie_data_neerslag.bin', hourly_precip)
    write_bin('harmonie_data_temp.bin', all_data['temp'][1:])
    write_bin('harmonie_data_bewolking.bin', list(zip(all_data['hoog'][1:],all_data['mid'][1:],all_data['laag'][1:])), 3)
    write_bin('harmonie_data_wind.bin', list(zip(all_data['uw'][1:],all_data['vw'][1:])), 2)
    write_bin('harmonie_data_windstoten.bin', list(zip(all_data['ug'][1:],all_data['vg'][1:])), 2)
    write_bin('harmonie_data_zicht.bin', all_data['zicht'][1:])
    write_bin('harmonie_data_rv.bin', all_data['rv'][1:])
    write_bin('harmonie_data_cape.bin', all_data['cape'][1:])
    write_bin('harmonie_data_druk.bin', all_data['druk'][1:])
    write_bin('harmonie_data_dauwpunt.bin', all_data['dauwpunt'][1:])
    write_bin('harmonie_data_straling.bin', hourly_stral)

    # Profiel
    with open('harmonie_data_profiel.bin','wb') as f:
        f.write(struct.pack('<HHHH',n_lat,n_lon,n_steps,10))
        f.write(b'\x00'*8)
        for s in range(1,len(grib_files)):
            for l in TEMP_LEVELS: f.write(crop(all_temp_prof[l][s]).astype(np.float32).tobytes())
            for l in WIND_LEVELS: f.write(crop(all_wspd_prof[l][s]).astype(np.float32).tobytes())

    # 6. Metadata
    run_str=run_dt.astimezone(LOCAL_TZ).strftime('%a %d.%m.%Y %Hz').lower()
    times_str=[]
    for h in range(1,len(grib_files)):
        times_str.append((run_dt+timedelta(hours=h)).astimezone(LOCAL_TZ).strftime('%Y-%m-%dT%H:%M'))

    c_lats=lats[lat_idx]; c_lons=lons[lon_idx]
    meta={'model':'Harmonie 43','run':run_str,
      'bijgewerkt':datetime.now(tz=LOCAL_TZ).strftime('%d %b %Y %H:%M'),
      'uren':n_steps,'tijden':times_str,
      'grid':{'n_lat':n_lat,'n_lon':n_lon,
        'lat_min':float(c_lats[0]),'lat_max':float(c_lats[-1]),
        'lon_min':float(c_lons[0]),'lon_max':float(c_lons[-1])},
      'parameters':{
        'neerslag':{'file':'harmonie_data_neerslag.bin','components':1,'label':'Gesimuleerde radar (dBZ)'},
        'temp':{'file':'harmonie_data_temp.bin','components':1,'label':'Temperatuur 2m (°C)'},
        'bewolking':{'file':'harmonie_data_bewolking.bin','components':3,'label':'Bewolking (hoog/midden/laag)'},
        'wind':{'file':'harmonie_data_wind.bin','components':2,'label':'Wind 10m (Bft)'},
        'windstoten':{'file':'harmonie_data_windstoten.bin','components':2,'label':'Windstoten 10m (km/u)'},
        'zicht':{'file':'harmonie_data_zicht.bin','components':1,'label':'Zicht'},
        'rv':{'file':'harmonie_data_rv.bin','components':1,'label':'Relatieve vochtigheid (%)'},
        'cape':{'file':'harmonie_data_cape.bin','components':1,'label':'CAPE (J/kg)'},
        'druk':{'file':'harmonie_data_druk.bin','components':1,'label':'Luchtdruk (hPa)'},
        'dauwpunt':{'file':'harmonie_data_dauwpunt.bin','components':1,'label':'Dauwpuntstemperatuur 2m (°C)'},
        'straling':{'file':'harmonie_data_straling.bin','components':1,'label':'Globale straling (W/m²)'},
        'profiel':{'file':'harmonie_data_profiel.bin','components':10,'label':'Grenslaagprofiel','levels':[2,50,100,200,300]},
      },
      'overlay':'harmonie_overlay.png'}
    with open('harmonie_canvas_meta.json','w') as f:
        json.dump(meta,f,indent=2,ensure_ascii=False)

    print(f'Klaar! Run: {run_str}, {n_steps} uur, grid {n_lat}x{n_lon}')
" 2>&1

echo "$(date): Harmonie update klaar"
