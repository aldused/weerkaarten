import importlib.util,unittest
from datetime import datetime
from zoneinfo import ZoneInfo
s=importlib.util.spec_from_file_location('watch',str(__import__('pathlib').Path(__file__).resolve().parents[1] / 'scripts/kranten_watchdog.py'));m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
class Checks(unittest.TestCase):
 def test_dates(self):
  for hour,day,n in [(5,'2026-09-30',1),(5,'2026-10-02',0),(10,'2026-10-02',1),(10,'2026-10-03',0)]:
   self.assertEqual(len(m.issues(datetime(2026,10,2,hour,tzinfo=ZoneInfo('Europe/Amsterdam')),{'publicationDate':day},'status = "ACTIVE"')),n)
 def test_missing_schedule(self):
  self.assertEqual(len(m.issues(datetime(2026,10,2,5),{'publicationDate':'2026-10-03'},'')),1)
 def test_missing_edition(self):
  self.assertEqual(len(m.issues(datetime(2026,10,2,12),{},'status = "ACTIVE"')),1)
if __name__=='__main__': unittest.main()
