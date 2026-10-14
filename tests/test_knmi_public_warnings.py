import copy
import json
import sys
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
from knmi_public_warnings import normalize, validate, verify_catalog, NonOperationalSnapshot
from scrape_waarschuwingen import collect, parse_province

FIXTURE = json.loads((Path(__file__).parent / 'fixtures/knmi-test-snapshot-0.7.json').read_text())
NOW = datetime(2026, 11, 3, 12, tzinfo=timezone.utc)


def operational():
    snapshot = copy.deepcopy(FIXTURE)
    snapshot['metadata']['generated_at'] = NOW.isoformat()
    snapshot['metadata']['publication_type'] = 'manual'
    warning = snapshot['warnings'][0]
    warning['operational_status'] = 'Actual'
    warning['status'] = 'active'
    warning['onset'] = (NOW - timedelta(hours=1)).isoformat()
    warning['expires'] = (NOW + timedelta(hours=6)).isoformat()
    for part in warning['parts']:
        part['status'] = 'active'
        part['onset'], part['expires'] = warning['onset'], warning['expires']
    return snapshot


class WarningsTests(unittest.TestCase):
    def test_catalog_test_status_prevents_activation_if_knmi_postpones(self):
        catalog = {'success':True, 'result':{'name':'knmi-public-weather-warnings-1-0','state':'active','title':'[TEST] KNMI public weather warnings'}}
        with self.assertRaises(NonOperationalSnapshot): verify_catalog(catalog)
        catalog['result']['title'] = 'KNMI public weather warnings'
        verify_catalog(catalog)
        with self.assertRaises(ValueError): verify_catalog({'success':False})
    def test_official_test_fixture_validates_but_cannot_be_live(self):
        validate(FIXTURE)
        with self.assertRaises(NonOperationalSnapshot):
            normalize(FIXTURE, now=NOW)

    def test_empty_heartbeat_before_launch_does_not_clear_real_warnings(self):
        snapshot = operational()
        snapshot['warnings'] = []
        snapshot['num_warning_sets'] = snapshot['num_warnings'] = 0
        snapshot['metadata']['publication_type'] = 'heartbeat'
        with self.assertRaises(NonOperationalSnapshot):
            normalize(snapshot, now=datetime(2026, 10, 14, tzinfo=timezone.utc))

    def test_operational_parts_keep_official_geometry_and_text(self):
        source = operational()
        result = normalize(source, now=NOW)
        part = source['warnings'][0]['parts'][0]
        item = result['warnings'][0]
        self.assertEqual(result['mode'], 'polygons')
        self.assertEqual(result['provinces'], {})
        self.assertEqual(item['geometry'], part['area'])
        self.assertEqual(item['gebieden'], [part['area_description']['nl']])
        self.assertEqual(item['id'], part['part_uuid'])
        self.assertEqual(item['onset'], part['onset'])

    def test_potential_weather_stays_separate_from_issued_warnings(self):
        source = operational()
        source['warnings'][0]['warning_type'] = 'potentially-dangerous-weather'
        result = normalize(source, now=NOW)
        self.assertFalse(result['warnings'])
        self.assertEqual(len(result['outlook']), 1)

    def test_empty_operational_snapshot_replaces_previous_state(self):
        source = operational()
        source['warnings'] = []
        source['num_warning_sets'] = source['num_warnings'] = 0
        self.assertEqual(normalize(source, now=NOW)['warnings'], [])

    def test_cancelled_expired_and_test_parts_are_not_live(self):
        for field, value in [('status', 'cancelled'), ('status', 'expired'), ('operational_status', 'Exercise')]:
            source = operational()
            source['warnings'][0][field] = value
            if field == 'operational_status':
                with self.assertRaises(NonOperationalSnapshot):
                    normalize(source, now=NOW)
            else:
                self.assertFalse(normalize(source, now=NOW)['warnings'])
        source = operational()
        source['warnings'][0]['parts'][0]['status'] = 'cancelled'
        self.assertFalse(normalize(source, now=NOW)['warnings'])

    def test_unknown_schema_invalid_counters_and_geometry_fail_closed(self):
        mutations = [lambda s: s['metadata'].update(schema_version='1.99'),
                     lambda s: s.update(num_warnings=99),
                     lambda s: s['warnings'][0]['parts'][0]['area'].update(coordinates=[[[4, 52], [5, 52], [5, 53]]]),
                     lambda s: s['warnings'][0]['parts'][0].update(expires=s['warnings'][0]['parts'][0]['onset'])]
        for mutate in mutations:
            source = operational(); mutate(source)
            with self.assertRaises(ValueError): normalize(source, now=NOW)

    def test_legacy_fallback_stops_after_first_operational_polygon_snapshot(self):
        def failed(): raise NonOperationalSnapshot('test')
        self.assertEqual(collect(polygon_loader=failed, legacy_loader=lambda: {'mode':'provinces', 'errors':{}}, now=datetime(2026,10,14,tzinfo=timezone.utc))['mode'], 'provinces')
        with self.assertRaises(RuntimeError):
            collect({'mode':'polygons'}, polygon_loader=failed, legacy_loader=lambda: self.fail('must not revert'))
        with self.assertRaises(RuntimeError):
            collect(polygon_loader=failed, legacy_loader=lambda: self.fail('must not fall back after switch'), now=NOW)

    def test_missing_or_broken_province_html_is_unknown_not_green(self):
        with self.assertRaises(ValueError): parse_province('<html>Maintenance</html>')
        self.assertEqual(parse_province('<p>Er zijn geen waarschuwingen</p>'), ('groen', []))
        with self.assertRaises(RuntimeError):
            collect(polygon_loader=lambda: (_ for _ in ()).throw(ValueError()), legacy_loader=lambda: {'errors': {'Zuid-Holland':'timeout'}})


if __name__ == '__main__': unittest.main()
