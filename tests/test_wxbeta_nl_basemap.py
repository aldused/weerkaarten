import importlib.util,unittest
from pathlib import Path
from shapely.geometry import Point
spec=importlib.util.spec_from_file_location('nl_basemap',Path(__file__).parents[1]/'shell/wxbeta_nl/basemap.py');m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
class NetherlandsGeographyTests(unittest.TestCase):
 def test_water_and_islands_are_geographic_not_administrative(self):
  land,context,provinces,_=m.geography()
  for name,lon,lat in [('IJsselmeer',5.35,52.75),('Markermeer',5.2,52.5),('Noordzee',3.8,52.2)]:
   self.assertFalse(land.contains(Point(lon,lat)),name)
   self.assertFalse(context.contains(Point(lon,lat)),name)
   self.assertFalse(any(p.contains(Point(lon,lat)) for p in provinces),name)
  for name,lon,lat in [('Texel',4.8,53.05),('Zuid-Limburg',5.85,50.85),('Rotterdam',4.48,51.92)]:
   self.assertTrue(land.contains(Point(lon,lat)),name)
 def test_mosmix_extent_keeps_southern_limburg_and_wadden(self):
  self.assertEqual(m.BOUNDS,(3.3,7.4,50.45,53.8))
  land,_,_,_=m.geography();self.assertTrue(land.is_valid)
