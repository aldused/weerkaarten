"""Tests voor de Wereldweer-nieuwsstroom (geen netwerk, geen taalmodel).

    python3 -m unittest tests.test_wereldweer_stroom
"""
import json
import re
import sys
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
import wereldweer_bronnen as B  # noqa: E402
import wereldweer_geo as G  # noqa: E402
import wereldweer_stroom as S  # noqa: E402

NU = datetime(2026, 11, 6, 15, 0, tzinfo=timezone.utc)


class Basis(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        t = Path(self.tmp.name)
        self._oud = (S.DATA, S.WORK, S.LOG, S.BEHEER, S.EDITIES, S.PUBLICEER)
        S.DATA, S.WORK, S.LOG, S.BEHEER, S.EDITIES = t / 'stroom', t / 'work', t / 'log.txt', t / 'beheer.json', t
        S.PUBLICEER = False
        self._bronnen = dict(B.BRONNEN)
        self._haal = S.haal_bron

    def tearDown(self):
        S.DATA, S.WORK, S.LOG, S.BEHEER, S.EDITIES, S.PUBLICEER = self._oud
        B.BRONNEN.clear()
        B.BRONNEN.update(self._bronnen)
        S.haal_bron = self._haal
        self.tmp.cleanup()

    def bronnen(self, feeds):
        """feeds: {bron_id: lijst items of Exception}"""
        B.BRONNEN.clear()
        for bid in feeds:
            B.bron(bid, bid, 'https://example.org/' + bid, 'omroep', 'IT', 'it', 20, 0.85)

        def haal(bid):
            f = feeds[bid]
            if isinstance(f, Exception):
                raise f
            return [dict(x) for x in f], 0.1
        S.haal_bron = haal


def item(titel, url, uur=1, outlet=None, datum=True):
    return {'title': titel, 'url': url, 'summary': '', 'outlet': outlet,
            'date': NU - timedelta(hours=uur) if datum else None}


class TestIngestie(Basis):
    def test_ontdubbeling_en_herinlezen(self):
        a = [item('Nubifragio a Cagliari, strade allagate', 'https://a.it/1'),
             item('Nubifragio a Cagliari, strade allagate', 'https://a.it/1')]          # zelfde URL
        b = [item('Nubifragio a Cagliari, strade allagate - Unione Sarda', 'https://b.it/9')]  # zelfde kop, andere bron
        self.bronnen({'a': a, 'b': b})
        items, status = {}, {}
        cfg = S.beheer()
        self.assertEqual(S.ingestie(NU, cfg, True, items, status), 1)
        self.assertEqual(len(items), 1)
        it = next(iter(items.values()))
        self.assertEqual(it['ook'][0]['bron'], 'b')
        self.assertEqual(status['b']['dubbel_totaal'], 1)
        # opnieuw inlezen: niets nieuw, ook niet na een uur
        self.assertEqual(S.ingestie(NU + timedelta(hours=1), cfg, True, items, status), 0)

    def test_oud_en_zonder_datum(self):
        f = [item('Alluvione in Toscana', 'https://a.it/2', uur=24 * 9),           # ouder dan 7 dagen
             item('Neve sulle Alpi', 'https://a.it/3', datum=False)]               # geen datum
        self.bronnen({'a': f})
        items, status = {}, {}
        S.ingestie(NU, S.beheer(), True, items, status)
        self.assertEqual(items, {})  # 1e kennismaking: datumloos bericht telt niet (kan oud zijn)
        f.append(item('Grandine a Roma', 'https://a.it/4', datum=False))
        S.ingestie(NU + timedelta(minutes=30), S.beheer(), True, items, status)
        self.assertEqual([i['titel'] for i in items.values()], ['Grandine a Roma'])
        self.assertTrue(next(iter(items.values()))['datum_geschat'])

    def test_bronuitval_houdt_niets_tegen(self):
        self.bronnen({'kapot': RuntimeError('HTTP 503'), 'goed': [item('Tempesta in Liguria', 'https://g.it/1')]})
        items, status = {}, {}
        S.ingestie(NU, S.beheer(), True, items, status)
        self.assertEqual(len(items), 1)
        self.assertIn('503', status['kapot']['fout'])
        self.assertEqual(status['kapot']['fouten_op_rij'], 1)
        # terugval: kapotte bron niet elke run opnieuw
        b = B.BRONNEN['kapot']
        self.assertFalse(S.aan_de_beurt('kapot', b, status, S.beheer(), NU + timedelta(minutes=25), False))
        self.assertTrue(S.aan_de_beurt('kapot', b, status, S.beheer(), NU + timedelta(minutes=41), False))

    def test_uitgeschakelde_bron(self):
        self.bronnen({'a': [item('Tempesta', 'https://a.it/5')]})
        S.BEHEER.write_text(json.dumps({'bronnen': {'a': {'actief': False}}}))
        self.assertFalse(S.aan_de_beurt('a', B.BRONNEN['a'], {}, S.beheer(), NU, True))

    def test_weerfilter(self):
        self.assertTrue(B.lijkt_weer('Zware regenval in Valencia'))
        self.assertTrue(B.lijkt_weer('Kältewelle erreicht Bayern'))
        self.assertFalse(B.lijkt_weer('Hij komt weer terug naar Ajax'))
        self.assertFalse(B.lijkt_weer('Sturm Graz wint van Rapid'))


class TestCijfercontrole(unittest.TestCase):
    def test_omrekening_en_verzinsel(self):
        bron = 'Gusts reached 70 mph on the coast and 4 inches of rain fell in 24 hours.'
        o = {'kop': 'Windstoten tot 113 km/u', 'samenvatting': 'Er viel 102 mm regen; 3.000 huizen zonder stroom.',
             'details': ['De temperatuur zakte naar 9 graden.'],
             'cijfers': [{'waarde': '113', 'eenheid': 'km/u'}, {'waarde': '250', 'eenheid': 'mm'}]}
        probleem, o = S.cijfercontrole(o, bron)
        self.assertIn('3.000', probleem)          # niet in de bron
        self.assertEqual(len(re.findall(r"(?:kop|samenvatting): '", probleem)), 1)  # 113 km/u (=70 mph) en 102 mm (=4 inch) kloppen wel
        self.assertEqual([c['waarde'] for c in o['cijfers']], ['113'])  # 250 mm vervalt

    def test_datum_en_jaartal_tellen_niet(self):
        probleem, _ = S.cijfercontrole({'kop': 'Zwaarste storm sinds 1990', 'samenvatting': 'Op 28 november om 14.30 uur.'},
                                       'Worst storm since 1990')
        self.assertIsNone(probleem)
        probleem, _ = S.cijfercontrole({'kop': 'Code oranje van 22:00 tot 06.00 uur', 'samenvatting': 'Golven tot 4 meter.'},
                                       'Warning from 10 pm')
        self.assertIsNone(probleem)  # kloktijden en kleine getallen zijn niet toetsbaar, geen afkeur


class TestScoreEnGeo(unittest.TestCase):
    def dossier(self, land, uur):
        t = (NU - timedelta(hours=uur)).isoformat()
        return {'id': 'd1', 'land': land, 'laatste': t, 'eerste': t}

    def its(self, b=8, i=7):
        return [{'bron': 'x', 'outlet': 'Reuters', 'triage': {'b': b, 'i': i}}]

    def test_europa_en_actualiteit(self):
        s_eu = S.score(self.dossier('IT', 2), self.its(), NU, None)[0]
        s_w = S.score(self.dossier('JP', 2), self.its(), NU, None)[0]
        s_oud = S.score(self.dossier('IT', 60), self.its(), NU, None)[0]
        self.assertGreater(s_eu, s_w)
        self.assertGreater(s_eu, s_oud)
        # een uitzonderlijke wereldgebeurtenis wint van alledaags Europees nieuws
        self.assertGreater(S.score(self.dossier('JP', 2), self.its(10, 10), NU, None)[0],
                           S.score(self.dossier('IT', 2), self.its(2, 0), NU, None)[0])

    def test_verificatie_kost_punten(self):
        d = self.dossier('IT', 2)
        zonder = S.score(d, self.its(), NU, None)[0]
        d['verificatie'] = 'opvallende claim uit één bron'
        self.assertEqual(round(zonder - S.score(d, self.its(), NU, None)[0]), 15)

    def test_geo_binnen_land(self):
        self.assertEqual(G.zoek('ES', 'Valencia')['nauwkeurigheid'], 'plaats')
        self.assertAlmostEqual(G.zoek('ES', 'Valencia')['lon'], -0.38, delta=0.3)  # niet Valencia in Venezuela
        self.assertEqual(G.zoek('FR', None, 'Corse')['nauwkeurigheid'], 'regio')
        self.assertEqual(G.zoek('IT', 'Onbekendedorp')['nauwkeurigheid'], 'land')
        self.assertIsNone(G.zoek('ZZ', 'X'))
        self.assertEqual(G.groepen('AT')[:2], ['europa', 'alpen'])
        self.assertIn('alpen', G.groepen('FR', 45.92, 6.87))  # Chamonix
        self.assertEqual(G.groepen('JP'), ['azie'])


class TestWaarschuwingenEnSelectie(Basis):
    def test_verlopen_waarschuwing_valt_weg(self):
        S.MA_LAND_OUD = S.MA_LAND
        S.MA_LAND = {'italy': 'IT'}
        oud = S.meteoalarm_land
        S.meteoalarm_land = lambda slug: [
            {'kleur': 'Orange', 'gevaar': 'Thunderstorm', 'regio': 'Sardegna', 'van': (NU - timedelta(hours=5)).isoformat(),
             'tot': (NU - timedelta(hours=1)).isoformat(), 'uitgegeven': NU.isoformat(), 'zekerheid': 'Likely',
             'urgentie': 'Immediate', 'bericht': 'Alert', 'cap': None, 'url': 'https://meteoalarm.org?geocode=EMMA_ID:IT020'},
            {'kleur': 'Red', 'gevaar': 'Rain', 'regio': 'Sardegna', 'van': NU.isoformat(),
             'tot': (NU + timedelta(hours=6)).isoformat(), 'uitgegeven': NU.isoformat(), 'zekerheid': 'Likely',
             'urgentie': 'Immediate', 'bericht': 'Alert', 'cap': None, 'url': None}]
        try:
            w = S.waarschuwingen(NU, {}, True)
        finally:
            S.MA_LAND, S.meteoalarm_land = S.MA_LAND_OUD, oud
        ws = w['landen']['IT']['waarschuwingen']
        self.assertEqual([x['kleur'] for x in ws], ['rood'])
        self.assertEqual(ws[0]['geo'], 'regio')
        self.assertEqual(ws[0]['cat'], 'neerslag')

    def test_lege_stroom_geeft_geldige_uitvoer(self):
        d = S.selectie({}, {}, NU, S.beheer(), {'landen': {}}, {}, [])
        self.assertEqual(d['dossiers'], [])
        self.assertEqual(json.loads((S.DATA / 'stroom.json').read_text())['schema'], 1)

    def test_selectie_volgorde_en_beheer(self):
        t = (NU - timedelta(hours=1)).isoformat()
        items = {f'i{n}': {'k': f'i{n}', 'bron': 'aemet', 'outlet': o, 'url': f'https://x/{n}', 'titel': 'x', 'taal': 'es',
                           'tijd': t, 'triage': {'b': b, 'i': 0, 'v': 1}}
                 for n, (o, b) in enumerate([('AEMET', 3), ('AEMET', 9), ('AEMET', 5)])}
        dossiers = {f'd{n}': {'id': f'd{n}', 'items': [f'i{n}'], 'land': 'ES', 'cat': 'storm', 'type': 'extreem',
                              'soort': 'waargenomen', 'eerste': t, 'laatste': t, 'kop': f'kop {n}'} for n in range(3)}
        S.BEHEER.write_text(json.dumps({'vastgezet': ['d0'], 'geblokkeerd': ['d2']}))
        d = S.selectie(items, dossiers, NU, S.beheer(), {'landen': {}}, {}, [])
        self.assertEqual([x['id'] for x in d['dossiers']], ['d0', 'd1'])  # vastgezet boven, geblokkeerd weg
        self.assertTrue(d['dossiers'][0]['vastgezet'])
        self.assertEqual(d['geblokkeerd'][0]['id'], 'd2')

    def test_samenvoegen_volgt_verwijzing(self):
        t = NU.isoformat()
        dossiers = {'dA': {'id': 'dA', 'items': ['i1'], 'land': 'FR', 'cat': 'storm', 'eerste': t, 'laatste': t,
                           'samengevoegd': 'dB'},
                    'dB': {'id': 'dB', 'items': [], 'land': 'FR', 'cat': 'storm', 'eerste': t, 'laatste': t}}
        it = {'k': 'i2', 'tijd': t, 'titel': 'x', 'triage': {'r': 1, 'd': 'dA', 'cat': 'storm', 'l': 'FR', 'b': 5, 'i': 1}}
        S.dossiers_bijwerken({'i2': it}, dossiers, NU, [it])
        self.assertIn('i2', dossiers['dB']['items'])
        self.assertNotIn('i2', dossiers['dA']['items'])


if __name__ == '__main__':
    unittest.main()
