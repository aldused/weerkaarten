import importlib.util, struct, tempfile, unittest
from pathlib import Path
import numpy as np
spec=importlib.util.spec_from_file_location("arome",Path(__file__).resolve().parents[1]/"scripts/arome_native_update.py")
a=importlib.util.module_from_spec(spec);spec.loader.exec_module(a)

class AromeNativeTests(unittest.TestCase):
    def test_accumulations_and_missing_cells(self):
        x=np.array([[[0,np.nan]],[[2,np.nan]],[[5,np.nan]]],dtype="float32")
        y=a.hourly_accumulation(x)
        np.testing.assert_allclose(y[:,0,0],[0,2,3]);self.assertTrue(np.isnan(y[:,0,1]).all())
        with self.assertRaises(ValueError):a.hourly_accumulation(np.array([0,2,0],dtype="float32"))
    def test_solar_rounding_tolerance_keeps_real_reset_guard(self):
        np.testing.assert_allclose(a.hourly_accumulation(np.array([0,10000,9608],dtype="float32"),3600,.25),[0,10000/3600,0])
        with self.assertRaises(ValueError):a.hourly_accumulation(np.array([0,10000,0],dtype="float32"),3600,.25)
    def test_binary_time_component_order_and_nan(self):
        x=np.array([[[1,2]],[[3,np.nan]]],dtype="float32")
        with tempfile.TemporaryDirectory() as d:
            p=Path(d)/"x.bin";a.write_bin(p,(x,x+10));b=p.read_bytes()
        self.assertEqual(struct.unpack("<HHHH",b[:8]),(1,2,2,2))
        np.testing.assert_allclose(np.frombuffer(b[16:],dtype="<f4"),[1,2,11,12,3,np.nan,13,np.nan],equal_nan=True)
    def test_dewpoint_saturation_and_missing(self):
        np.testing.assert_allclose(a.dewpoint(np.array([10,20,np.nan]),np.array([100,50,90])),[10,9.2611,np.nan],atol=.001,equal_nan=True)
    def test_dst_repeated_hour_is_unambiguous(self):
        from datetime import datetime,timedelta
        x=datetime(2026,10,25,0,tzinfo=a.UTC)
        labels=[(x+timedelta(hours=h)).astimezone(a.LOCAL).isoformat() for h in range(3)]
        self.assertEqual(len(set(labels)),3);self.assertTrue(labels[0].endswith('+02:00'));self.assertTrue(labels[1].endswith('+01:00'))

if __name__=="__main__":unittest.main()
