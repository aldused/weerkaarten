import sys,unittest
from datetime import date
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts'))
from knmi_live_day import aggregate
from lopend_patch import patch_vandaag,recompute_tussenstand
class SyncTests(unittest.TestCase):
 def test_measured_sunshine_and_rain_units(self):
  a=aggregate([{'ss':2,'rg':6,'qg':500,'tx':-0.1,'tn':-2,'ta':-1,'ff':3}]*6)
  self.assertEqual(a['sq'],0.2);self.assertEqual(a['rh'],6.0);self.assertEqual(a['tx'],-0.1)
  self.assertIsNone(aggregate([{}])['sq'])
 def test_repeated_patch_recomputes_without_double_counting(self):
  r={'maanddetail':{'2026':{'9':{'dagen':[{'dag':29,'rh':2,'sq':7,'tx':25,'tn':10,'tg':18,'fg':3}], 'som_sq':99}}}}
  vals={'rh':1,'sq':3,'tx':22,'tn':12,'tg':19,'fg':5}
  for _ in range(2):patch_vandaag(r,vals,date(2026,9,30))
  m=r['maanddetail']['2026']['9'];self.assertEqual(len(m['dagen']),2)
  self.assertEqual(m['som_sq'],10);self.assertEqual(m['som_rh'],3);self.assertEqual(m['gem_fg'],4)
  self.assertEqual(m['warme_dagen'],2)
if __name__=='__main__': unittest.main()
