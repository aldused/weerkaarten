import sys,unittest,tempfile,json,struct
from pathlib import Path
from datetime import datetime,timezone
from unittest.mock import patch
import numpy as np
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts'))
import modelplaten as model
class ModelTests(unittest.TestCase):
 def test_regrid_preserves_linear_field(self):
  la=np.array([54,53,52]);lo=np.array([3,4,5]);field=la[:,None]*2+lo[None,:]*3
  result=model.regrid(field,(la,lo),np.array([52.25,53.5]),np.array([3.25,4.75]))
  np.testing.assert_allclose(result,np.array([52.25,53.5])[:,None]*2+np.array([3.25,4.75])[None,:]*3)
 def test_native_rain_decode_and_spatial_average(self):
  with tempfile.TemporaryDirectory() as tmp:
   r=Path(tmp);(r/'weerlab').mkdir();a=np.array([[[[0,50],[100,150]]]],dtype='u1');(r/'weerlab/rain.bin').write_bytes(struct.pack('<HHHH',2,2,1,1)+bytes(8)+a.tobytes())
   g=dict(n_lat=2,n_lon=2,lat_min=50,lat_max=52,lon_min=3,lon_max=5);m={'tijden':['2026-01-01T01:00'],'grid':g,'parameters':{'neerslag':{'file':'rain.bin','dtype':'u8sqrt','scale':50,'power':3,'components':1}}}
   value=model.native_field(r,m,'neerslag',np.array([51]),np.array([4]))
   self.assertAlmostEqual(value[0,0,0,0],(0+1+8+27)/4)
 def test_dst_hours_are_distinct(self):
  times=model.native_times({'tijden':['2026-10-25T02:00','2026-10-25T02:00','2026-10-25T03:00']})
  self.assertEqual((times[1]-times[0]).total_seconds(),3600);self.assertNotEqual(times[0].astimezone(model.Z).utcoffset(),times[1].astimezone(model.Z).utcoffset())
 def rain_fixture(self,amounts):
  now=datetime.now(timezone.utc).replace(hour=0,minute=0,second=0,microsecond=0);messages=[]
  for step,value in zip([0,3,6],amounts):
   messages.append(dict(shortName='tp',dataDate=int(now.strftime('%Y%m%d')),dataTime=0,startStep=0,stepType='accum',units='m',endStep=step,Ni=5,Nj=5,latitudeOfFirstGridPointInDegrees=54,longitudeOfFirstGridPointInDegrees=3,iDirectionIncrementInDegrees=1,jDirectionIncrementInDegrees=1,jScansPositively=0,packingError=0,values=np.full(25,value)))
  with tempfile.TemporaryDirectory() as tmp:
   root=Path(tmp);(root/'grib_cache').mkdir();(root/'grib_cache/wx_precip24.grib2').touch()
   with patch.object(model.ec,'codes_grib_new_from_file',side_effect=messages+[None]),patch.object(model.ec,'codes_get',side_effect=lambda h,k:h[k]),patch.object(model.ec,'codes_get_values',side_effect=lambda h:h['values']),patch.object(model.ec,'codes_release'):
    return model.rain_ifs(root,np.array([52.5]),np.array([4.5]),now,6)
 def test_ifs_three_hour_sums_are_conserved(self):
  run,rain,blocks=self.rain_fixture([0,.003,.009]);np.testing.assert_allclose(rain[:,0,0],[1,1,1,2,2,2]);self.assertEqual(blocks,[3]*6);self.assertAlmostEqual(float(rain.sum()),9)
 def test_ifs_reset_is_rejected(self):
  with self.assertRaisesRegex(ValueError,'reset'):self.rain_fixture([0,.003,.002])
if __name__=='__main__':unittest.main()
