#!/bin/bash
# Harmonie 43 data update script
# Draait het Python script en exporteert alle binaire data + overlay
cd "/Users/aldus/KNMI_Project/weerlab"

echo "$(date): Harmonie update gestart"

# Download nieuwste run + exporteer binaire data
/usr/local/bin/python3 -c "
import os, json, struct, time, tempfile, tarfile
import numpy as np
import eccodes
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

os.chdir('/Users/aldus/KNMI_Project/weerlab')
LOCAL_TZ = ZoneInfo('Europe/Amsterdam')
EXTENT = [0.5, 12.5, 47.5, 56.5]
KEY = 'eyJvcmciOiI1ZTU1NGUxOTI3NGE5NjAwMDEyYTNlYjEiLCJpZCI6Ijk5YjZhMzkwMTlkYzQxYzlhMzJjNmNmY2MyNDgxNGRkIiwiaCI6Im11cm11cjEyOCJ9'

import requests

import contextlib as _ctx

@_ctx.contextmanager
def atomisch(fn, mode='wb'):
    # Schrijf naar <fn>.tmp en hernoem pas als het bestand compleet is.
    # benelux_neerslag_anim.py leest deze bins terwijl deze pijplijn draait.
    # Rechtstreeks over het live bestand schrijven gaf halve of half-verouderde
    # bins; os.replace is atomair, dus een lezer ziet altijd of de oude of de
    # nieuwe versie, nooit een mengsel van allebei.
    tmp = fn + '.tmp'
    try:
        with open(tmp, mode) as f:
            yield f
        os.replace(tmp, fn)
    except BaseException:
        if os.path.exists(tmp):
            os.remove(tmp)
        raise

# 1. Laatste bestand zoeken
print('1. Laatste Harmonie run zoeken...')
url = 'https://api.dataplatform.knmi.nl/open-data/v1/datasets/harmonie_arome_cy43_p1/versions/1.0/files'
r = requests.get(url, headers={'Authorization': KEY}, params={'maxKeys':1,'orderBy':'created','sorting':'desc'}, timeout=30)
r.raise_for_status()
filename = r.json()['files'][0]['filename']
print(f'   {filename}')

# Check of deze run al verwerkt is
parts = filename.replace('.tar','').split('_')
run_str_raw = parts[-1] if parts else ''
try:
    run_dt_check = datetime.strptime(run_str_raw[:10], '%Y%m%d%H').replace(tzinfo=timezone.utc)
    run_utc_check = run_dt_check.strftime('%Y-%m-%dT%H:%M:%SZ')
except:
    run_utc_check = ''

if os.path.exists('harmonie_canvas_meta.json'):
    with open('harmonie_canvas_meta.json') as mf:
        old_meta = json.load(mf)
    if old_meta.get('run_utc') == run_utc_check:
        print(f'   Run {run_utc_check} al verwerkt, skip.')
        raise SystemExit(0)

print(f'   Nieuwe run: {run_utc_check}')

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

    all_data = {k: [] for k in ['temp','cum','hoog','mid','laag','uw','vw','ug','vg','zicht','rv','druk','dauwpunt','wolkenbasis']}
    all_stral_cum = []
    all_stral_direct = []
    all_temp_prof = {l: [] for l in TEMP_LEVELS}
    all_wspd_prof = {l: [] for l in WIND_LEVELS}
    lats = lons = None; nj = ni = 0

    for gf in grib_files:
        temp=cum=hoog=mid=laag=uw=vw=ug=vg=zicht=druk=rv=dp=stral=stral_direct=basis=None
        druk_n=0
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
                elif ind==186: basis=vals  # wolkenbasis (m), 9999 = wolkenvrij
                elif ind==116 and stral_direct is None: stral_direct=vals
                elif ind==117 and stral is None: stral=vals
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
        all_data['wolkenbasis'].append(basis)
        all_data['druk'].append(druk)
        all_stral_cum.append(stral if stral is not None else z)
        all_stral_direct.append(stral_direct)
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
        all_stral_direct=[d[::-1,:] if d is not None else None for d in all_stral_direct]
        for l in TEMP_LEVELS: all_temp_prof[l]=[d[::-1,:] for d in all_temp_prof[l]]
        for l in WIND_LEVELS: all_wspd_prof[l]=[d[::-1,:] for d in all_wspd_prof[l]]

    hourly_precip=[np.maximum(all_data['cum'][i]-all_data['cum'][i-1],0) for i in range(1,len(all_data['cum']))]
    hourly_stral=[(all_stral_cum[i]-all_stral_cum[i-1])/3600 for i in range(1,len(all_stral_cum))]
    hourly_stral=[np.maximum(s,0) for s in hourly_stral]
    has_direct=any(d is not None for d in all_stral_direct[1:])
    # Diagnose: levert de KNMI-feed directe straling (GRIB1 param 116)? Zo ja,
    # dan kan de zonneschijnduur op het volle 4 km-rooster i.p.v. het grove
    # Open-Meteo-hulprooster van 13 km.
    print(f'   directe straling in GRIB-feed: {has_direct}')
    direct_stral=[np.maximum(d,0) if d is not None else np.full((nj,ni),np.nan) for d in all_stral_direct[1:]]

    # 5. Crop en exporteer
    print('5. Exporteren...')
    lat_idx_all=np.where((lats>=EXTENT[2])&(lats<=EXTENT[3]))[0]
    lon_idx_all=np.where((lons>=EXTENT[0])&(lons<=EXTENT[1]))[0]
    STRIDE=2  # algemene canvasdata ~4 km; wolkenverdeling krijgt apart native ~2 km
    lat_idx=lat_idx_all[::STRIDE]; lon_idx=lon_idx_all[::STRIDE]
    n_lat=len(lat_idx); n_lon=len(lon_idx); n_steps=len(grib_files)-1
    def crop(d): return np.nan_to_num(d[np.ix_(lat_idx,lon_idx)],nan=0).astype(np.float32)
    def write_bin(fn, data_list, nc=1):
        with atomisch(fn) as f:
            f.write(struct.pack('<HHHH',n_lat,n_lon,len(data_list),nc))
            f.write(b'\x00'*8)
            for item in data_list:
                if nc==1: f.write(crop(item).astype(np.float32).tobytes())
                else:
                    for comp in item: f.write(crop(comp).astype(np.float32).tobytes())

    # Neerslag op volledige modelresolutie (geen stride), uint8-gecodeerd:
    # q = round(waarde**(1/power)*scale), terug waarde = (q/scale)**power.
    # Header-byte 8 = dtype 1 zodat de viewer weet dat het een uint8-veld is;
    # de exponent staat als 'power' in de meta (ontbreekt hij, dan is het een
    # oud bestand met de wortelcodering).
    #
    # Waarom niet meer de wortel met scale 16: die zette de klassegrens
    # 0,1 mm/u tussen byte 5 (0,098) en byte 6 (0,141) en liet tussen 0,03 en
    # 0,06 mm/u maar één representeerbare waarde over, terwijl de hoogste byte
    # die deze modellen in de praktijk halen 93 is van de 255 — te grof
    # onderaan, zwaar overbemeten bovenaan. De derdemachtswortel met scale 50
    # geeft vier waarden in diezelfde laagste klasse en houdt het plafond op
    # 132 mm/u. Radar staat in dBZ en is al logaritmisch: power 1 (lineair).
    n_lat_hr=len(lat_idx_all); n_lon_hr=len(lon_idx_all)
    native_grid={
      'n_lat':n_lat_hr,'n_lon':n_lon_hr,
      'lat_min':float(lats[lat_idx_all[0]]),'lat_max':float(lats[lat_idx_all[-1]]),
      'lon_min':float(lons[lon_idx_all[0]]),'lon_max':float(lons[lon_idx_all[-1]])}

    def crop_native(d):
        return d[np.ix_(lat_idx_all,lon_idx_all)]

    # Compacte native bronbestanden uitsluitend voor wolkenkaart_topmeteo.py.
    # dtype 2 = uint8 lineair 0..1; dtype 3 = uint16 meters, 65535 = ontbrekend.
    def write_native_clouds(fn, data_list):
        with atomisch(fn) as f:
            f.write(struct.pack('<HHHH',n_lat_hr,n_lon_hr,len(data_list),3))
            f.write(bytes([2])+b'\x00'*7)
            for comps in data_list:
                for comp in comps:
                    sub=np.nan_to_num(crop_native(comp),nan=0.0)
                    f.write(np.clip(np.rint(sub*255),0,255).astype(np.uint8).tobytes())

    def write_native_u16(fn, data_list):
        with atomisch(fn) as f:
            f.write(struct.pack('<HHHH',n_lat_hr,n_lon_hr,len(data_list),1))
            f.write(bytes([3])+b'\x00'*7)
            for item in data_list:
                sub=crop_native(item).astype(np.float64)
                q=np.where(np.isfinite(sub),np.clip(np.rint(sub),0,65534),65535).astype('<u2')
                f.write(q.tobytes())

    native_files={
      'bewolking':'wolken_native_bewolking.bin',
      'zicht':'wolken_native_zicht.bin'}
    write_native_clouds(native_files['bewolking'],
                        list(zip(all_data['hoog'][1:],all_data['mid'][1:],all_data['laag'][1:])))
    write_native_u16(native_files['zicht'],all_data['zicht'][1:])
    if all(b is not None for b in all_data['wolkenbasis'][1:]):
        native_files['wolkenbasis']='wolken_native_wolkenbasis.bin'
        write_native_u16(native_files['wolkenbasis'],all_data['wolkenbasis'][1:])
    with atomisch('wolken_native_meta.json','w') as f:
        json.dump({'run_utc':run_dt.strftime('%Y-%m-%dT%H:%M:%SZ'),
                   'grid':native_grid,'files':native_files},f,separators=(',',':'))
    print(f'   native wolkenbron: {n_lat_hr}x{n_lon_hr} '
          f'({sum(os.path.getsize(x) for x in native_files.values())/1024/1024:.1f} MB)')

    def write_bin_u8hr(fn, data_list, scale, power=2):
        inv=1.0/power
        with atomisch(fn) as f:
            f.write(struct.pack('<HHHH',n_lat_hr,n_lon_hr,len(data_list),1))
            f.write(bytes([1])+b'\x00'*7)
            for item in data_list:
                sub=np.nan_to_num(item[np.ix_(lat_idx_all,lon_idx_all)],nan=0)
                q=np.clip(np.round(np.maximum(sub,0)**inv*scale),0,255).astype(np.uint8)
                f.write(q.tobytes())
        print(f'   {fn}: {os.path.getsize(fn)/1024/1024:.1f} MB (full-res {n_lat_hr}x{n_lon_hr})')

    write_bin_u8hr('harmonie_data_neerslag.bin', hourly_precip, 50, 3)
    _cumul_acc = None
    _cumul_list = []
    for _p in hourly_precip:
        _cumul_acc = _p.copy() if _cumul_acc is None else _cumul_acc + _p
        _cumul_list.append(_cumul_acc)
    write_bin_u8hr('harmonie_data_cumul.bin', _cumul_list, 32, 3)
    # Pseudo-radar: Marshall-Palmer Z=200*R^1.6 op de uursom (KNMI open data
    # bevat geen gesimuleerde reflectiviteit; dit is de eerlijke benadering)
    _pseudo_dbz = [np.where(_p >= 0.05,
                            10*np.log10(np.maximum(200*np.maximum(_p,0.001)**1.6, 1)), 0)
                   for _p in hourly_precip]
    write_bin_u8hr('harmonie_data_radar.bin', _pseudo_dbz, 3, 1)
    write_bin('harmonie_data_temp.bin', all_data['temp'][1:])
    write_bin('harmonie_data_bewolking.bin', list(zip(all_data['hoog'][1:],all_data['mid'][1:],all_data['laag'][1:])), 3)
    write_bin('harmonie_data_wind.bin', list(zip(all_data['uw'][1:],all_data['vw'][1:])), 2)
    write_bin('harmonie_data_windstoten.bin', list(zip(all_data['ug'][1:],all_data['vg'][1:])), 2)
    write_bin('harmonie_data_zicht.bin', all_data['zicht'][1:])
    if all(b is not None for b in all_data['wolkenbasis'][1:]):
        write_bin('harmonie_data_wolkenbasis.bin', all_data['wolkenbasis'][1:])
    write_bin('harmonie_data_rv.bin', all_data['rv'][1:])
    write_bin('harmonie_data_druk.bin', all_data['druk'][1:])
    write_bin('harmonie_data_dauwpunt.bin', all_data['dauwpunt'][1:])
    write_bin('harmonie_data_straling.bin', hourly_stral)
    # Dagsom: reset om middernacht lokale tijd (Kachelmann-conventie)
    _cs_acc = None; _cs_list = []; _prev_date = None
    for _i, _s in enumerate(hourly_stral):
        _d = (run_dt + timedelta(hours=_i + 1)).astimezone(LOCAL_TZ).date()
        if _cs_acc is None or _d != _prev_date:
            _cs_acc = _s.copy()
        else:
            _cs_acc = _cs_acc + _s
        _prev_date = _d
        _cs_list.append(_cs_acc)
    write_bin('harmonie_data_cumstraling.bin', _cs_list)
    if has_direct:
        write_bin('harmonie_data_straling_direct.bin', direct_stral)

    # Profiel blijft op het compactere 7.5km-rooster: dit zware 10-componenten-
    # bestand wordt niet gebruikt door het 6-luik en hoeft niet mee te groeien.
    profile_stride=3
    profile_lat_idx=lat_idx_all[::profile_stride]
    profile_lon_idx=lon_idx_all[::profile_stride]
    profile_n_lat=len(profile_lat_idx); profile_n_lon=len(profile_lon_idx)
    def crop_profile(d):
        return np.nan_to_num(d[np.ix_(profile_lat_idx,profile_lon_idx)],nan=0).astype(np.float32)

    # Profiel
    with atomisch('harmonie_data_profiel.bin') as f:
        f.write(struct.pack('<HHHH',profile_n_lat,profile_n_lon,n_steps,10))
        f.write(b'\x00'*8)
        for s in range(1,len(grib_files)):
            for l in TEMP_LEVELS: f.write(crop_profile(all_temp_prof[l][s]).tobytes())
            for l in WIND_LEVELS: f.write(crop_profile(all_wspd_prof[l][s]).tobytes())

    # 6. Metadata
    run_local=run_dt.astimezone(LOCAL_TZ)
    _nl_dagen = ['maandag','dinsdag','woensdag','donderdag','vrijdag','zaterdag','zondag']
    run_str = _nl_dagen[run_local.weekday()] + ' ' + run_local.strftime('%d.%m.%Y %H:%M LT')
    run_utc_str=run_dt.strftime('%Y-%m-%dT%H:%M:%SZ')
    times_str=[]
    for h in range(1,len(grib_files)):
        times_str.append((run_dt+timedelta(hours=h)).astimezone(LOCAL_TZ).strftime('%Y-%m-%dT%H:%M'))

    c_lats=lats[lat_idx]; c_lons=lons[lon_idx]
    meta={'model':'HARMONIE V43','run':run_str,'run_utc':run_utc_str,
      'bijgewerkt':(lambda d: str(d.day) + ' ' + ['januari','februari','maart','april','mei','juni','juli','augustus','september','oktober','november','december'][d.month-1] + d.strftime(' %Y %H:%M'))(datetime.now(tz=LOCAL_TZ)),
      'uren':n_steps,'tijden':times_str,
      'grid':{'n_lat':n_lat,'n_lon':n_lon,
        'lat_min':float(c_lats[0]),'lat_max':float(c_lats[-1]),
        'lon_min':float(c_lons[0]),'lon_max':float(c_lons[-1])},
      'parameters':{
        'neerslag':{'file':'harmonie_data_neerslag.bin','components':1,'label':'Uurlijkse neerslag (mm/u)',
          'dtype':'u8sqrt','scale':50,'power':3,
          'grid':{'n_lat':n_lat_hr,'n_lon':n_lon_hr,
            'lat_min':float(lats[lat_idx_all[0]]),'lat_max':float(lats[lat_idx_all[-1]]),
            'lon_min':float(lons[lon_idx_all[0]]),'lon_max':float(lons[lon_idx_all[-1]])}},
        'cumul':{'file':'harmonie_data_cumul.bin','components':1,'label':'Cumulatieve neerslag (mm)',
          'dtype':'u8sqrt','scale':32,'power':3,
          'grid':{'n_lat':n_lat_hr,'n_lon':n_lon_hr,
            'lat_min':float(lats[lat_idx_all[0]]),'lat_max':float(lats[lat_idx_all[-1]]),
            'lon_min':float(lons[lon_idx_all[0]]),'lon_max':float(lons[lon_idx_all[-1]])}},
        'radar':{'file':'harmonie_data_radar.bin','components':1,'label':'Radar afgeleid uit uursom (Marshall-Palmer dBZ)',
          'dtype':'u8sqrt','scale':3,'power':1,
          'grid':{'n_lat':n_lat_hr,'n_lon':n_lon_hr,
            'lat_min':float(lats[lat_idx_all[0]]),'lat_max':float(lats[lat_idx_all[-1]]),
            'lon_min':float(lons[lon_idx_all[0]]),'lon_max':float(lons[lon_idx_all[-1]])}},
        'temp':{'file':'harmonie_data_temp.bin','components':1,'label':'Temperatuur 2m (°C)'},
        'bewolking':{'file':'harmonie_data_bewolking.bin','components':3,'label':'Bewolking (hoog/midden/laag)'},
        'wind':{'file':'harmonie_data_wind.bin','components':2,'label':'Wind 10m (Bft)'},
        'windstoten':{'file':'harmonie_data_windstoten.bin','components':2,'label':'Windstoten 10m (km/u)'},
        'zicht':{'file':'harmonie_data_zicht.bin','components':1,'label':'Zicht'},
        'wolkenbasis':{'file':'harmonie_data_wolkenbasis.bin','components':1,'label':'Wolkenbasis (m, 9999 = wolkenvrij)'},
        'rv':{'file':'harmonie_data_rv.bin','components':1,'label':'Relatieve vochtigheid (%)'},
        'druk':{'file':'harmonie_data_druk.bin','components':1,'label':'Luchtdruk (hPa)'},
        'dauwpunt':{'file':'harmonie_data_dauwpunt.bin','components':1,'label':'Dauwpuntstemperatuur 2m (°C)'},
        'straling':{'file':'harmonie_data_straling.bin','components':1,'label':'Globale straling (W/m²)'},
        'cumstraling':{'file':'harmonie_data_cumstraling.bin','components':1,'label':'Straling dagsom (Wh/m², reset middernacht)'},
        'profiel':{'file':'harmonie_data_profiel.bin','components':10,'label':'Temperatuur/windprofiel 2-300 m',
          'grid':{'n_lat':profile_n_lat,'n_lon':profile_n_lon,
            'lat_min':float(lats[profile_lat_idx[0]]),'lat_max':float(lats[profile_lat_idx[-1]]),
            'lon_min':float(lons[profile_lon_idx[0]]),'lon_max':float(lons[profile_lon_idx[-1]])},'levels':{
          'temperature_m':[2,50,100,200,300],
          'wind_speed_m':[10,50,100,200,300]
        }},
      },
      'overlay':'harmonie_overlay.png'}
    if has_direct:
        meta['parameters']['straling_direct']={'file':'harmonie_data_straling_direct.bin','components':1,'label':'Directe kortgolvige straling (W/m²)'}
    # Bewolking staat óók op volle modelresolutie klaar (uint8 0..1, dtype-byte 2).
    # Dat bestand werd al voor de wolkenverdeling geschreven en is even groot als
    # de float32-variant op halve resolutie — vier keer zoveel roosterpunten voor
    # dezelfde bytes. Viewers die 'bewolking_hr' niet kennen gebruiken gewoon
    # 'bewolking'.
    meta['parameters']['bewolking_hr']={'file':native_files['bewolking'],'components':3,
      'label':'Bewolking hoog/midden/laag op volle modelresolutie','dtype':'u8lin',
      'grid':dict(native_grid)}
    with atomisch('harmonie_canvas_meta.json','w') as f:
        json.dump(meta,f,indent=2,ensure_ascii=False)

    print(f'Data export klaar! Run: {run_str}, {n_steps} uur, grid {n_lat}x{n_lon}')

    # 6b. Open-Meteo Pro: 500/850 hPa hoogtekaarten ophalen en toevoegen aan meta
    print('6b. Open-Meteo hoogtekaarten (500/850 hPa)...')
    import subprocess
    try:
        os.remove('harmonie_data_convectietemp.bin')
    except FileNotFoundError:
        pass
    try:
        subprocess.run(['/usr/local/bin/python3', 'scripts/harmonie_openmeteo.py'],
                       check=True, timeout=600)
        print('6c. Convectietemperatuur voor Cumulus...')
        subprocess.run(['/usr/local/bin/python3', 'scripts/harmonie_convectietemperatuur.py'],
                       check=True, timeout=120)
    except Exception as _e:
        print(f'   [waarschuwing] Open-Meteo/convectietemperatuur mislukt: {_e}')

    # 7. Upload naar Cloudflare R2
    print('7. Uploaden naar Cloudflare R2...')
    import boto3
    s3 = boto3.client('s3',
        endpoint_url='https://05da71c7c88b8ce49fbb2c2d0a570416.r2.cloudflarestorage.com',
        aws_access_key_id='baf991003ce3e4075d91b89f8726bc0f',
        aws_secret_access_key='0f33229e2e03fe7bc7f9fdf7f9fa0acd5336c40718c6e25fe0b6a631ade8ac97',
        region_name='auto')

    R2_BUCKET = 'weerlab-harmonie'
    # Volgorde: eerst alle databestanden, de meta als laatste. De meta noemt de
    # bestandsnamen en de run; zou hij vooraan gaan, dan wijst hij korte tijd
    # naar bins die nog van de vorige run zijn of nog niet bestaan.
    bestanden = ['harmonie_overlay.png', 'harmonie_data_lsm.bin',
                 'wolken_native_bewolking.bin']
    for f2 in sorted(os.listdir('.')):
        if f2.startswith('harmonie_data_') and f2.endswith('.bin'):
            bestanden.append(f2)
    bestanden.append('harmonie_canvas_meta.json')

    import gzip as _gzip
    for f2 in bestanden:
        ct = 'application/json' if f2.endswith('.json') else 'image/png' if f2.endswith('.png') else 'application/octet-stream'
        if f2.endswith('.png'):
            s3.upload_file(f2, R2_BUCKET, f2, ExtraArgs={'ContentType': ct})
            print(f'   {f2} ({os.path.getsize(f2)/1024/1024:.1f} MB)')
        else:
            # Gzip bij upload: browser decomprimeert transparant via Content-Encoding
            with open(f2,'rb') as fh:
                body=_gzip.compress(fh.read(),compresslevel=6)
            s3.put_object(Bucket=R2_BUCKET, Key=f2, Body=body,
                          ContentType=ct, ContentEncoding='gzip')
            print(f'   {f2} ({os.path.getsize(f2)/1024/1024:.1f} MB → {len(body)/1024/1024:.1f} MB gz)')

    # Point-major kopie voor /model-point. Deze objecten blijven bewust
    # ongecomprimeerd zodat de Worker kleine byte-ranges kan lezen.
    from scripts.build_point_source import build_point_source
    _, point_files = build_point_source(
        'harmonie', 'harmonie_canvas_meta.json', '/tmp/weerlab-point-source'
    )
    for point_file in point_files:
        point_key = f'point-source/harmonie/{point_file.name}'
        point_ct = 'application/json' if point_file.suffix == '.json' else 'application/octet-stream'
        s3.upload_file(str(point_file), R2_BUCKET, point_key, ExtraArgs={
            'ContentType': point_ct,
            'CacheControl': 'public, max-age=60',
        })
        print(f'   {point_key} ({point_file.stat().st_size/1024/1024:.1f} MB, range-ready)')

    print(f'Upload klaar!')
" 2>&1

echo "$(date): Harmonie update klaar"
