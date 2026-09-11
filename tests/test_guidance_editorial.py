import copy
import importlib.util
import json
from pathlib import Path
import sys
import tempfile
import unittest
from datetime import datetime, timezone
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'shell'))
from guidance_editorial import issued_at, reference_bundle, validate_assessment, validate_short_term, ELEMENTS
import guidance_pressure_facts as facts


class EditorialTests(unittest.TestCase):
    def test_actual_issue_and_dst(self):
        self.assertEqual(issued_at('Uitgifte: 09/09/2026 00.51 uur LT.', 'knmi').astimezone(timezone.utc).isoformat(), '2026-09-08T22:51:00+00:00')
        self.assertEqual(issued_at('Uitgifte: 09/01/2026 00.51 uur LT.', 'knmi').utcoffset().total_seconds(), 3600)
        self.assertEqual(issued_at('Dienstag, den 08.09.2026 um 10.30 UTC', 'dwd').hour, 10)
        self.assertEqual(issued_at('ausgegeben am 08.09.2026 um 08 UTC', 'dwd').minute, 0)

    def test_full_text_and_fresh_download_of_stale_source(self):
        with tempfile.TemporaryDirectory() as temp:
            text = 'A' * 7000 + '\nModellvergleich: relevante verschillen aan het einde.'
            Path(temp, 'dwd_guidance.json').write_text(json.dumps({'bijgewerkt': '2026-09-09T04:30:00', 'kurzfrist': {'original': text, 'issuedAt': '08.09.2026 um 08 UTC'}, 'mittelfrist': {'original': 'OUDE TEKST', 'issuedAt': '06.09.2026 um 10 UTC'}}))
            bundle, register = reference_bundle(temp, datetime(2026, 9, 9, 4, tzinfo=timezone.utc))
            self.assertIn(text, bundle)
            self.assertNotIn('OUDE TEKST', bundle)
            self.assertEqual(register[3]['status'], 'buiten actualiteitsgrens')
            self.assertEqual(register[0]['status'], 'ontbreekt')

    def test_dwd_source_packet_uses_separate_full_original(self):
        with tempfile.TemporaryDirectory() as temp:
            Path(temp, 'dwd_guidance.json').write_text(json.dumps({'mittelfrist': {'original': 'OUDE VERTALINGSFEED', 'issuedAt': '08.09.2026 um 08 UTC'}}))
            full = Path(temp, 'full.json')
            full.write_text(json.dumps({'mittelfrist': {'original': 'VOLLEDIGE BRON ' + 'A' * 11000, 'issuedAt': '09.09.2026 um 08 UTC'}}))
            bundle, register = reference_bundle(temp, datetime(2026, 9, 9, 10, tzinfo=timezone.utc), dwd_path=full)
            self.assertIn('VOLLEDIGE BRON', bundle)
            self.assertNotIn('OUDE VERTALINGSFEED', bundle)
            self.assertEqual(register[-1]['status'], 'beschikbaar')

    def test_unknown_issue_not_silently_fresh(self):
        with tempfile.TemporaryDirectory() as temp:
            Path(temp, 'guidance.json').write_text(json.dumps({'kort': {'tekst': 'GEEN UITGIFTE', 'opgehaald': '2026-09-09T04:30:00'}}))
            bundle, register = reference_bundle(temp)
            self.assertEqual(register[0]['status'], 'uitgifte onbekend')
            self.assertNotIn('GEEN UITGIFTE', bundle)

    def test_assessment_rejects_missing_source_and_wrong_wind_units(self):
        guidance = {'intro': 'Windstoten rond 60 km/u.', 'days': [], 'modelbeoordeling': [{'onderwerp': 'Buien', 'periode': '9 september', 'vergelijking': 'Brongebonden verschil.', 'betekenis': 'De timing kan veranderen.', 'bron_ids': ['knmi_kort']}]}
        validate_assessment(guidance, {'knmi_kort'})
        with self.assertRaises(ValueError):
            validate_assessment(guidance, set())
        for unit in ['m/s', 'knopen', 'kt', 'kts']:
            with self.subTest(unit=unit), self.assertRaises(ValueError):
                validate_assessment(dict(guidance, intro=f'Windstoten rond 20 {unit}.'), {'knmi_kort'})

    def test_nighttime_gust_and_cape_not_lost(self):
        hourly = {field: [0] * 24 for field in facts.NL_HOURLY}
        hourly['time'] = [f'2026-09-09T{hour:02}:00' for hour in range(24)]
        hourly['temperature_2m'] = [18] * 24
        hourly['wind_speed_10m'] = [10] * 24
        hourly['wind_direction_10m'] = [270] * 24
        hourly['wind_gusts_10m'] = [25] * 24
        hourly['wind_gusts_10m'][23] = 80
        hourly['cape'][23] = 900
        locations = [{'hourly': copy.deepcopy(hourly)} for _ in facts.NL_PUNTEN]
        with patch.object(facts, '_get_multi', return_value=locations):
            result = facts._dagmetrics(facts._haal_nl_model('ecmwf_ifs025', 'ecmwf'))
        self.assertEqual(result['2026-09-09']['windstoot'], 80)
        self.assertEqual(result['2026-09-09']['cape'], 900)
        self.assertIn('over het etmaal 80 km/u', '\n'.join(facts.nl_weersfeiten(result)))

    def test_short_term_requires_complete_current_evidence(self):
        context = {'geldig_van': '2026-09-11T15:00:00+00:00', 'geldig_tot': '2026-09-13T15:00:00+00:00'}
        guidance = {'bronnotities': '', 'korte_termijn': dict(context, elementen=[
            {'element': element, 'tekst': 'Brongebonden verwachting.', 'bron_ids': ['knmi_kort']} for element in ELEMENTS])}
        validate_short_term(guidance, {'knmi_kort'}, context)
        with self.assertRaises(ValueError):
            validate_short_term(guidance, set(), context)
        guidance['korte_termijn']['elementen'][0]['tekst'] = 'Vanmiddag bewolking.'
        with self.assertRaises(ValueError):
            validate_short_term(guidance, {'knmi_kort'}, context)
        guidance['korte_termijn']['elementen'][0]['tekst'] = 'Vrijdagmiddag bewolking.'
        validate_short_term(guidance, {'knmi_kort'}, context)
        short = guidance['korte_termijn']
        short['elementen'][-1]['element'] = 'wind'
        with self.assertRaises(ValueError):
            validate_short_term(guidance, {'knmi_kort'}, context)
        short['elementen'][-1]['element'] = 'zicht'
        short['geldig_tot'] = '2026-09-12T15:00:00+00:00'
        with self.assertRaises(ValueError):
            validate_short_term(guidance, {'knmi_kort'}, context)

    def test_upcoming_night_crosses_date_and_gust_keeps_place_time(self):
        hourly = {field: [0] * 48 for field in facts.NL_HOURLY}
        hourly['time'] = [f'2026-09-{11+i//24:02}T{i%24:02}:00' for i in range(48)]
        hourly['temperature_2m'] = [20] * 48
        hourly['temperature_2m'][5] = 3  # verstreken ochtend, niet komende nacht
        hourly['temperature_2m'][29] = 9  # volgende ochtend
        hourly['wind_speed_10m'] = [10] * 48
        hourly['wind_direction_10m'] = [270] * 48
        hourly['wind_gusts_10m'] = [25] * 48
        locations = [{'hourly': copy.deepcopy(hourly)} for _ in facts.NL_PUNTEN]
        locations[2]['hourly']['wind_gusts_10m'][23] = 80
        with patch.object(facts, '_get_multi', return_value=locations):
            result = facts._dagmetrics(facts._haal_nl_model('ecmwf_ifs025', 'ecmwf'))
        day = result['2026-09-11']
        self.assertEqual(day['nacht']['laagste']['minimum'], 9)
        self.assertEqual(day['windstoot_piek']['naam'], 'Den Helder')
        self.assertEqual(day['windstoot_piek']['tijd'], '2026-09-11T23:00')
        self.assertIsNone(result['2026-09-12']['nacht'])
        self.assertIn('Den Helder, 2026-09-11T23:00', '\n'.join(facts.nl_weersfeiten(result)))

    def test_missing_gust_not_zero(self):
        metric = {'tmin': 17, 'tmax': 20, 'koelste_punt': 'A', 'warmste_punt': 'B', 'neerslag_max': 0, 'bewolking_mediaan': None, 'windsnelheid': 10, 'windrichting': 270, 'windstoot': None, 'cape': None}
        result = '\n'.join(facts.nl_weersfeiten({'2026-09-09': metric}))
        self.assertIn('windstoten ontbreken', result)
        self.assertNotIn('windstoot 0', result)


if __name__ == '__main__':
    unittest.main()
