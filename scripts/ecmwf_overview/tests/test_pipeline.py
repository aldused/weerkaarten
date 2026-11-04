import json
import os, sys, tempfile, unittest
from unittest import mock
import numpy as np
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'pipeline'))
import lcc, process, update  # noqa: E402
from config import ENC  # noqa: E402


class T(unittest.TestCase):
    def test_lcc_roundtrip(self):
        lon = np.array([-89.9, -50, 0, 5.18, 45, 94.9]); lat = np.array([8.1, 27, 45, 52.1, 72, 85.9])
        a, b = lcc.inverse(*lcc.forward(lon, lat))
        np.testing.assert_allclose(a, lon, atol=1e-9); np.testing.assert_allclose(b, lat, atol=1e-9)

    def test_ijsregen_en_ijskorrels_apart(self):
        prate = np.array([1.0, 2.0, 3.0, 4.0, 5.0]); ptype = np.array([1, 3, 12, 8, 5])
        fz, ip = process.freezing_precip(prate, ptype)
        np.testing.assert_array_equal(fz, [0, 2, 3, 0, 0])
        np.testing.assert_array_equal(ip, [0, 0, 0, 4, 0])

    def test_theta_e(self):
        from sources.ecmwf_opendata import theta_e
        # 850 hPa: droog = potentiële temperatuur, vocht tilt hem op; 10 °C/80 % circa 43 °C
        self.assertAlmostEqual(float(theta_e(np.array([10.0]), np.array([80.0]), 850.0)[0]), 43.0, delta=2.0)
        self.assertAlmostEqual(float(theta_e(np.array([10.0]), np.array([0.0]), 850.0)[0]), 23.4, delta=0.5)
        self.assertGreater(float(theta_e(np.array([10.0]), np.array([100.0]), 850.0)[0]), float(theta_e(np.array([10.0]), np.array([50.0]), 850.0)[0]))

    def test_nieuwe_coderingen(self):
        self.assertEqual(int(process.encode('hcc', np.array([55.0]))[0]), 11)
        self.assertEqual(float(process.decode('w100', process.encode('w100', np.array([12.5])))[0]), 12.5)
        self.assertEqual(int(process.encode('snow24', np.array([0.0]))[0]), 0)

    def test_zonuren(self):
        from sources.ecmwf_opendata import sunshine_hours
        lats = np.array([52.0, 80.0])
        grijs = sunshine_hours(np.array([[0.2e6, 0.0]]) * np.ones((2, 2)), lats, 355)
        helder = sunshine_hours(np.array([[30e6, 40e6]]) * np.ones((2, 2)), lats, 172)
        self.assertLess(float(grijs[0, 0]), 0.5)
        self.assertEqual(float(grijs[1, 0]), 0.0)                 # poolnacht
        self.assertTrue(14 < float(helder[0, 0]) < 16.5)           # De Bilt, langste dag
        self.assertGreater(float(helder[1, 1]), 23)                # middernachtzon

    def test_gevoelstemperatuur(self):
        from sources.ecmwf_opendata import feels_like
        t = np.array([10.0, 0.0, 18.0, 32.0, 32.0]); td = np.array([5.0, -3.0, 10.0, 24.0, 5.0]); v = np.array([27.8, 30.0, 40.0, 10.0, 10.0])
        # windchill, zelfde bij 0 °C; tussen 10 en 26 °C de temperatuur; hitte-index alleen bij genoeg vocht
        np.testing.assert_allclose(feels_like(t, td, v)[:3], [6.73, -6.47, 18.0], atol=0.01)
        self.assertLess(float(feels_like(np.array([12.5]), np.array([5.0]), np.array([30.0]))[0]), 12.5)
        self.assertGreater(feels_like(t, td, v)[3], 36.0)
        self.assertEqual(float(feels_like(t, td, v)[4]), 32.0)
        self.assertEqual(float(feels_like(np.array([5.0]), np.array([1.0]), np.array([3.0]))[0]), 5.0)

    def test_bodem_zee_gevuld(self):
        from sources.ecmwf_opendata import land_fill
        x = np.array([[1.0, 2.0, 99.0], [3.0, 99.0, 99.0]]); land = np.array([[True, True, False], [True, False, False]])
        # land blijft, zee krijgt de dichtstbijzijnde landwaarde; geen land = leeg
        np.testing.assert_array_equal(land_fill(x, land), [[1, 2, 2], [3, 3, 2]])
        self.assertTrue(np.isnan(land_fill(x, np.zeros_like(land))).all())

    def test_aifs_vocht_en_vorticiteit(self):
        from sources.aifs_opendata import rel_humidity, vorticity
        # verzadigd bij 0 °C op 850 hPa: q = 0,622 e / (p - 0,378 e) met e = 6,112 hPa
        q = 0.622 * 6.112 / (850 - 0.378 * 6.112)
        self.assertAlmostEqual(float(rel_humidity(np.array([q]), np.array([0.0]), 850.0)[0]), 100.0, places=1)
        self.assertAlmostEqual(float(rel_humidity(np.array([q / 2]), np.array([0.0]), 850.0)[0]), 50.0, delta=0.2)
        # vaste rotatie: v = c·x geeft ζ = c (op de evenaar, zonder krommingsterm)
        lats = np.array([0.25, 0.0, -0.25]); d = 0.25; dx = 6.371e6 * np.radians(d)
        v = np.tile(1e-5 * dx * np.arange(5), (3, 1)); u = np.zeros_like(v)
        np.testing.assert_allclose(vorticity(u, v, lats, d)[1], 1e-5, rtol=1e-3)
        # westenwind die naar het noorden toeneemt = anticyclonaal (negatief)
        u2 = np.array([[10.0] * 5, [5.0] * 5, [0.0] * 5])
        self.assertLess(float(vorticity(u2, np.zeros_like(u2), lats, d)[1, 2]), 0)

    def test_nulgradenniveau(self):
        from sources.ecmwf_opendata import freezing_level
        z = [np.array([100.0] * 4), np.array([800.0] * 4), np.array([1500.0] * 4)]
        # warm-koud midden tussen vlakken, inversie telt de bovenste overgang, overal koud, overal warm
        t = [np.array([10.0, -2.0, -5.0, 9.0]), np.array([2.0, 3.0, -6.0, 8.0]), np.array([-2.0, -4.0, -7.0, 1.0])]
        np.testing.assert_allclose(freezing_level(t, z), [1150.0, 800.0 + 700 * 3 / 7, 0.0, 1500.0], rtol=1e-5)

    def test_nul_cape_is_code_nul(self):
        self.assertEqual(int(process.encode('cape', np.array([0.0]))[0]), 0)
        self.assertEqual(int(process.encode('jet', np.array([137.0]))[0]), 137)
        self.assertEqual(float(process.decode('juv', process.encode('juv', np.array([90.0])))[0]), 90.0)

    def test_linear_codes_halve_stap(self):
        for name in ('t2m', 'msl'):
            e = ENC[name]
            lo = (e['lo'] + 1) * e['scale'] + e['offset']; hi = 254 * e['scale'] + e['offset']
            x = np.linspace(lo, hi, 5001)
            err = np.abs(process.decode(name, process.encode(name, x)) - x)
            self.assertLessEqual(err.max(), e['scale'] / 2 + 1e-9, name)

    def test_neerslag_relatief(self):
        x = np.array([0.2, 0.6, 1, 5, 20, 80])
        rel = np.abs(process.decode('rain', process.encode('rain', x)) / x - 1)
        self.assertLess(rel.max(), 0.035)      # halve code = 2^(1/24) ≈ 3 %, iets meer dicht bij 0
        self.assertEqual(process.encode('rain', np.array([0.0]))[0], 0)

    def test_wind_codering(self):
        self.assertEqual(process.wind_stride(0.25), 1)
        self.assertEqual(process.wind_stride(0.1), 3)
        x = np.array([-63.5, -10.3, 0.0, 7.7, 63.5])
        self.assertLessEqual(np.abs(process.decode('wuv', process.encode('wuv', x)) - x).max(), 0.25)
        self.assertGreaterEqual(process.encode('wuv', x).min(), 1)      # 0 = geen waarde

    def test_neerslagtype(self):
        rate = np.array([1.0, 1.0, 1.0, 1.0]); pt = np.array([1, 5, 7, 3])
        r, s = process.split_precip(rate, pt)
        np.testing.assert_array_equal(r, [1, 0, 0, 1]); np.testing.assert_array_equal(s, [0, 1, 1, 0])

    def test_blokgemiddelde(self):
        a = np.arange(5 * 7, dtype=float).reshape(5, 7)
        b = process.block_mean(a)
        self.assertEqual(b.shape, (2, 3)); self.assertAlmostEqual(b[0, 0], (0 + 1 + 7 + 8) / 4)

    def test_hoog_aandeel(self):
        h = process.high_share(np.array([100., 80., 50., 2.]), np.array([100., 0., 25., 0.]), np.array([0., 0., 50., 0.]), )
        np.testing.assert_allclose(h, [0, 1, 0, 0])

    def test_nan_wordt_code0(self):
        self.assertEqual(process.encode('t2m', np.array([np.nan]))[0], 0)


class TestRunIndex(unittest.TestCase):
    def _run(self, root, rid, status, n):
        d = os.path.join(root, 'ecmwf', rid)
        os.makedirs(d)
        m = {'run': rid, 'run_time': rid, 'status': status, 'gaps': [], 'expected': list(range(0, 145, 3)),
             'steps': {str(i * 3): {} for i in range(n)}}
        with open(os.path.join(d, 'manifest.json'), 'w') as f:
            json.dump(m, f)

    def test_nieuwste_run_is_standaard_ook_als_die_binnenkomt(self):
        with tempfile.TemporaryDirectory() as root, mock.patch.object(update, 'DATA_DIR', root):
            self._run(root, '2026103100', 'complete', 49)
            self._run(root, '2026103106', 'partial', 1)
            idx = update.write_index('ecmwf')
        self.assertEqual(idx['default'], '2026103106')
        self.assertEqual([r['run'] for r in idx['runs']], ['2026103106', '2026103100'])
        self.assertEqual(idx['runs'][0]['last_expected'], 144)


if __name__ == '__main__':
    unittest.main()
