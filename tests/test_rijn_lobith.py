import datetime as dt
import importlib.util
import pathlib
import unittest
spec = importlib.util.spec_from_file_location('rijn', pathlib.Path(__file__).resolve().parents[1]/'scripts/rijn_lobith_update.py')
rijn = importlib.util.module_from_spec(spec)
spec.loader.exec_module(rijn)
class Coverage(unittest.TestCase):
    def test_dutch_calendar_day_and_invalid_values(self):
        rows=rijn.dagwaarden([('2026-09-13T22:10:00Z',100),('2026-09-14T00:20:00+02:00',200),('2026-09-14T00:20:00+02:00',300),('2026-09-14T00:30:00+02:00',float('nan')),('2026-09-14T00:40:00+02:00',999999999)])
        self.assertEqual(len(rows),1)
        self.assertEqual(rows[0],{'d':'2026-09-14','q':200,'aantal':2,'verwacht':144,'volledig':False})
    def test_summer_and_winter_clock_changes(self):
        for day,expected in [(dt.date(2026,3,29),138),(dt.date(2026,10,25),150)]:
            start=dt.datetime.combine(day,dt.time(),rijn.NL).astimezone(dt.timezone.utc)
            readings=[((start+dt.timedelta(minutes=10*i)).isoformat(),100) for i in range(expected)]
            row=rijn.dagwaarden(readings)[0]
            self.assertEqual(row['verwacht'],expected)
            self.assertTrue(row['volledig'])
            self.assertFalse(rijn.dagwaarden(readings[:-1])[0]['volledig'])
    def test_unknown_timezone_and_negative_discharge_are_rejected(self):
        self.assertIsNone(rijn.meettijd('2026-09-14T00:00:00'))
        self.assertFalse(rijn.geldige_waarde(-2,afvoer=True))
        self.assertTrue(rijn.geldige_waarde(-20))
        self.assertFalse(rijn.geldige_waarde(True))
if __name__=='__main__': unittest.main()
