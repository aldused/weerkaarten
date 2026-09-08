"""Compare original KNMI +15/+16 GRIBs with canvas encoding and map rendering.

Usage: python audit_harmonie_precip.py SOURCE_DIRECTORY OUTPUT_DIRECTORY
Expected inputs: HA43/HA46_N20_202609080100_01500_GB and ..._01600_GB.
"""
from pathlib import Path
import sys, json
import eccodes as ec
import numpy as np
from harmonie_precip import grib1_precip_kind, rain_rate_mm_h, rain_rate_to_dbz, hourly_from_accumulation
import benelux_neerslag_anim as charts


def read_precip(path):
    fields = {}
    with path.open('rb') as f:
        while (g := ec.codes_grib_new_from_file(f)) is not None:
            try:
                if ec.codes_get(g, 'edition') == 1:
                    kind = grib1_precip_kind(*[ec.codes_get_long(g,k) for k in
                        ['indicatorOfParameter','indicatorOfTypeOfLevel','level','timeRangeIndicator']])
                else:
                    kind = {'tp':'cum','rprate':'regenrate'}.get(ec.codes_get(g,'shortName'))
                if kind:
                    nj,ni = ec.codes_get(g,'Nj'),ec.codes_get(g,'Ni')
                    a=ec.codes_get_values(g).reshape(nj,ni)
                    fields[kind]=rain_rate_mm_h(a) if kind=='regenrate' else a
                    fields['lats']=np.linspace(ec.codes_get(g,'latitudeOfFirstGridPointInDegrees'),ec.codes_get(g,'latitudeOfLastGridPointInDegrees'),nj)
                    fields['lons']=np.linspace(ec.codes_get(g,'longitudeOfFirstGridPointInDegrees'),ec.codes_get(g,'longitudeOfLastGridPointInDegrees'),ni)
            finally:
                ec.codes_release(g)
    return fields


def audit(source, output):
    output.mkdir(parents=True, exist_ok=True)
    stats={}
    for cycle,model in [(43,'harmonie43'),(46,'harmonie')]:
        a,b=[read_precip(source/f'HA{cycle}_N20_202609080100_{h:03d}00_GB') for h in [15,16]]
        lats,lons=b['lats'],b['lons']; extent=charts.MODELS[model]['extent']
        hourly=hourly_from_accumulation([a['cum'],b['cum']])[0]
        rate=b['regenrate']; dbz=rain_rate_to_dbz(rate); old=rain_rate_to_dbz(hourly)
        crop=lambda f:f[np.ix_((lats>=extent[2])&(lats<=extent[3]),(lons>=extent[0])&(lons<=extent[1]))]
        q_hour=(np.clip(np.rint(hourly**(1/3)*50),0,255)/50)**3
        q_dbz=np.clip(np.rint(dbz*3),0,255)/3
        smoothed=charts.crop_and_upsample(lats,lons,q_dbz,extent,.02)
        c=stats[f'V{cycle}']={
            'run_utc':'2026-09-08T01:00Z','valid_utc':'2026-09-08T17:00Z',
            'hourly_max_mm':float(crop(hourly).max()),
            'instantaneous_max_mm_h':float(crop(rate).max()),
            'radar_from_hourly_max_dbz':float(crop(old).max()),
            'radar_instantaneous_max_dbz':float(crop(dbz).max()),
            'hourly_encoding_mae_mm':float(np.abs(crop(q_hour-hourly)).mean()),
            'hourly_encoding_max_error_mm':float(np.abs(crop(q_hour-hourly)).max()),
            'radar_encoding_max_error_dbz':float(np.abs(crop(q_dbz-dbz)).max()),
            'grid_lat_degrees':float(lats[1]-lats[0]),'grid_lon_degrees':float(lons[1]-lons[0]),
        }
        if cycle==43:
            current=charts.harmonie_fields(model,'uursom',16)[15]
            if current[1]==charts.datetime(2026,9,8,1):
                rlat,rlon=current[3:5]
                ilat=np.abs(lats[:,None]-rlat).argmin(axis=0); ilon=np.abs(lons[:,None]-rlon).argmin(axis=0)
                c['existing_hourly_bin_max_error_mm']=float(np.max(np.abs(current[5]-q_hour[np.ix_(ilat,ilon)])))
        run=charts.datetime(2026,9,8,1); valid=run+charts.timedelta(hours=16)
        for name,field in [('radar',q_dbz),('uursom',q_hour)]:
            var=dict(charts.VARS[name]); var['dpi']=180
            rendered=charts.plot_frame(16,run,valid,lats,lons,field,str(output/f'V{cycle}_{name}_17z.png'),charts.MODELS[model],var,f'HARMONIE V{cycle} 2 km',model_id=model)
            np.testing.assert_allclose(rendered,charts.crop_and_upsample(lats,lons,field,extent,None)[2][::8,::8])
        if cycle==43:
            var=dict(charts.VARS['radar']); var.update(native_render=False,subtitel='oude methode · uit uursom',dpi=180)
            charts.plot_frame(16,run,valid,lats,lons,old,str(output/'V43_radar_oud_17z.png'),charts.MODELS[model],var,'HARMONIE V43 2 km',model_id=model)
    (output/'controle.json').write_text(json.dumps(stats,indent=2)+'\n')
    print(json.dumps(stats,indent=2))


if __name__=='__main__': audit(Path(sys.argv[1]),Path(sys.argv[2]))
