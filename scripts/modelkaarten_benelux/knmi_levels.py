"""Lees de benodigde GRIB-berichten uit het KNMI-tarbestand via HTTP Range."""
from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta
import os
import tarfile
from urllib.parse import urlsplit

import eccodes as grib
import numpy as np
import requests

from ruc_zon import map_indices

API = 'https://api.dataplatform.knmi.nl/open-data/v1'


def knmi_fields(project, model, start, leads, grid, get, packages=('P3','P1')):
    cycle = 43 if model == 'harmonie' else 46
    stamp = start.strftime('%Y%m%d%H')
    key = os.environ.get('KNMI_API_KEY')
    if not key:
        lines = (project/'pascal/.env').read_text().splitlines()
        key = next((l.partition('=')[2].strip() for l in lines if l.startswith('KNMI_API_KEY=')), None)
    if not key:
        raise ValueError('KNMI-datatoegang ontbreekt')

    def package(pkg):
        filename = f'HARM{cycle}_V1_{pkg}_{stamp}.tar'
        dataset = f'harmonie_arome_cy{cycle}_{pkg.lower()}'
        response = requests.get(f'{API}/datasets/{dataset}/versions/1.0/files/{filename}/url',
                                headers={'Authorization':key}, timeout=15)
        if response.status_code == 404:
            return {}
        response.raise_for_status()
        url = response.json()['temporaryDownloadUrl']
        if urlsplit(url).scheme != 'https':
            raise ValueError('Onverwachte KNMI-download-URL')

        def partial(offset, size):
            last = offset+size-1
            try:
                r = get(url, {'Range': f'bytes={offset}-{last}'})
            except requests.RequestException:
                raise ValueError(f'KNMI-download mislukt voor {filename}') from None
            if r is None or r.status_code != 206 or not r.headers.get('Content-Range','').startswith(f'bytes {offset}-{last}/') or len(r.content) != size:
                raise ValueError(f'KNMI geeft geen passend bereik voor {filename}')
            return r.content

        # PAX-metadata staat vóór elk lid. Lees alleen de koppen en spring over de leden.
        members = {}
        offset = 0
        while len(members)<len(leads):
            block = partial(offset,1536)
            if not any(block[:512]):
                break
            info = tarfile.TarInfo.frombuf(block[:512],'ascii','strict')
            if info.type == tarfile.XHDTYPE and info.size <= 512:
                offset += 1024
                info = tarfile.TarInfo.frombuf(block[1024:1536],'ascii','strict')
            if info.isfile() and info.name.endswith('_GB') and f'_{stamp}00_' in info.name:
                lead = int(info.name.split('_')[-2]) // 100
                if lead in leads:
                    members[lead] = (offset+512, info.size)
            offset += 512 + ((info.size+511)//512)*512

        def match_grib(header):
            edition = header[7]
            if edition == 1:
                size = int.from_bytes(header[4:7],'big')
                level = int.from_bytes(header[18:20],'big')
                if pkg=='P1' and (header[16],header[17],level)==(66,105,0):
                    return size,'sdep'
                if pkg=='P3' and header[16]==11 and header[17]==100 and level in (500,850):
                    return size,f't{level}'
                return size,None
            if edition != 2:
                raise ValueError('Onbekende GRIB-editie')
            size = int.from_bytes(header[8:16],'big')
            pos = 16
            while pos+28 <= len(header):
                length = int.from_bytes(header[pos:pos+4],'big')
                if header[pos+4] == 4:
                    cat, number, surface = header[pos+9],header[pos+10],header[pos+22]
                    if pkg=='P1' and (header[6],cat,number,surface)==(0,1,11,1):
                        return size,'sdep'
                    level = int.from_bytes(header[pos+24:pos+28],'big') // 100
                    if pkg=='P3' and (header[6],cat,number,surface)==(0,0,0,100) and level in (500,850):
                        return size,f't{level}'
                    return size,None
                if length<5:
                    break
                pos += length
            raise ValueError('KNMI GRIB-metadata past niet in de gelezen kop')

        first_grid = {}
        target_keys = {'sdep'} if pkg=='P1' else {'t500','t850'}

        def member(entry):
            lead,(start_byte,size)=entry
            end=start_byte+size
            offset=start_byte
            out={}
            while offset<end and set(out)!=target_keys:
                head=partial(offset,min(640,end-offset))
                if head[:4]!=b'GRIB':
                    raise ValueError(f'Ongeldige GRIB-kop bij KNMI T+{lead}')
                span,field=match_grib(head)
                if span<16 or offset+span>end:
                    raise ValueError(f'Ongeldige GRIB-lengte bij KNMI T+{lead}')
                if field in target_keys:
                    msg=grib.codes_new_from_message(partial(offset,span))
                    try:
                        actual=lambda k:grib.codes_get(msg,k)
                        if (actual('dataDate')!=int(stamp[:8]) or actual('dataTime')!=start.hour*100 or actual('endStep')!=lead
                                or (field!='sdep' and (actual('typeOfLevel')!='isobaricInhPa' or actual('level')!=int(field[1:])))):
                            raise ValueError(f'KNMI GRIB heeft een verkeerde run of druk: {field} T+{lead}')
                        values=grib.codes_get_values(msg)
                        if actual('bitmapPresent'):
                            values[values==actual('missingValue')]=np.nan
                        index=first_grid.get(field)
                        if index is None:
                            coords=grib.codes_grib_get_data(msg)
                            lat=np.array([p.lat for p in coords])
                            lon=np.array([p.lon for p in coords])
                            lon=(lon+180)%360-180
                            index=map_indices(lat,lon,grid)
                            first_grid[field]=index
                        sample,inside=index
                        v=values[sample]
                        v=np.where((v>=0)&(v<90),v*100,np.nan) if field=='sdep' else v-273.15
                        out[field]=np.where(inside,v,np.nan)
                    finally:
                        grib.codes_release(msg)
                offset+=span
            return start+timedelta(hours=lead),out

        # Projecteer het gemeenschappelijke bronraster eenmaal, daarna parallel per tijdstap.
        if not members:
            return {}
        entries=list(members.items())
        t,first=member(entries[0])
        with ThreadPoolExecutor(max_workers=7) as pool:
            return {t:first,**dict(pool.map(member,entries[1:]))}

    merged={}
    for pkg in packages:
        for when,fields in package(pkg).items():
            merged.setdefault(when,{}).update(fields)
    return merged
