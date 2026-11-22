import copy
import json
import sys
import unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
from knmi_warning_archive import public_history, snapshot_records, legacy_records, merged_legacy

FIXTURE = json.loads((Path(__file__).parent / 'fixtures/knmi-test-snapshot-0.7.json').read_text())


def publication():
    doc = copy.deepcopy(FIXTURE)
    doc['metadata'].update(generated_at='2026-11-10T09:00:00Z', publication_type='manual')
    warning = doc['warnings'][0]
    warning.update(operational_status='Actual', status='active', warning_type='warning')
    for part in warning['parts']:
        part.update(status='active', version_dt='2026-11-10T08:59:00Z',
                    onset='2026-11-10T10:00:00Z', expires='2026-11-10T12:00:00Z')
    return doc


class ArchiveTests(unittest.TestCase):
    def test_test_exercise_and_outlooks_are_not_issued_warnings(self):
        self.assertEqual(snapshot_records(FIXTURE), [])
        for field, value in [('operational_status', 'Exercise'), ('warning_type', 'potentially-dangerous-weather')]:
            doc = publication(); doc['warnings'][0][field] = value
            self.assertEqual(snapshot_records(doc), [])

    def test_expired_and_withdrawn_warnings_remain_in_history(self):
        doc = publication(); doc['warnings'][0]['status'] = 'expired'
        self.assertEqual(snapshot_records(doc)[0]['status'], 'expired')
        doc['warnings'][0]['status'] = 'cancelled'
        self.assertEqual(snapshot_records(doc)[0]['status'], 'cancelled')

    def test_repeated_snapshots_do_not_duplicate_an_issued_warning(self):
        doc = publication(); later = copy.deepcopy(doc)
        later['metadata']['generated_at'] = '2026-11-10T10:00:00Z'
        records = public_history([later, doc, later])
        self.assertEqual(len(records), len(doc['warnings'][0]['parts']))
        self.assertEqual(len(records[0]['revisions']), 1)
        later['warnings'][0]['parts'][0].update(status='cancelled', version_dt='2026-11-10T10:00:00Z')
        record = next(r for r in public_history([doc, later]) if r['part_id'] == doc['warnings'][0]['parts'][0]['part_uuid'])
        self.assertEqual(record['warning_set_id'], doc['warnings'][0]['warning_set_uuid'])
        self.assertEqual(record['issued'], '2026-11-10T08:59:00Z')
        self.assertEqual(record['status'], 'cancelled')
        self.assertEqual(len(record['revisions']), 2)

    def test_map_boundaries_and_revisions_are_preserved(self):
        doc = publication()
        first = doc['warnings'][0]['parts'][0]
        record = snapshot_records(doc)[0]
        self.assertEqual(record['geometry']['coordinates'], first['area']['coordinates'])
        later = copy.deepcopy(doc)
        later['metadata']['generated_at'] = '2026-11-10T10:00:00Z'
        part = later['warnings'][0]['parts'][0]
        part['version_dt'] = '2026-11-10T10:00:00Z'
        part['area'] = {'type':'Polygon', 'coordinates':[[[4,52],[5,52],[5,53],[4,52]]]}
        record = next(r for r in public_history([doc, later]) if r['part_id'] == first['part_uuid'])
        self.assertEqual(record['geometry'], part['area'])
        self.assertEqual(record['revisions'][0]['geometry']['coordinates'], first['area']['coordinates'])
        self.assertEqual(record['revisions'][1]['geometry'], part['area'])
        broken = copy.deepcopy(doc)
        broken['warnings'][0]['parts'][0]['area']['coordinates'] = [[[4,52],[5,52],[5,53],[4,51]]]
        with self.assertRaises(ValueError): snapshot_records(broken)

    def test_conflicting_colors_and_counts_fail(self):
        doc = publication(); doc['num_warnings'] += 1
        with self.assertRaises(ValueError): snapshot_records(doc)
        doc = publication(); part = doc['warnings'][0]['parts'][0]
        part.update(severity='Extreme', color='yellow')
        with self.assertRaises(ValueError): snapshot_records(doc)

    def test_legacy_gaps_are_not_filled_and_utc_offsets_are_used(self):
        slots = ''.join(f'''<timeslice><timeslice_id>2026-10-25T0{hour}:00:00+01:00</timeslice_id>
          <phenomenon><phenomenon_id>IC</phenomenon_id><location><location_id>UT</location_id>
          <location_warning_status>1</location_warning_status><location_dtg_issued>2026-10-25T01:00:00+02:00</location_dtg_issued>
          <color_id>{'GREEN' if hour == 3 else 'YELLOW'}</color_id><text><text_language_id>NL</text_language_id>
          <text_header>Gladheid</text_header><text_data>Bevriezing</text_data></text></location></phenomenon></timeslice>''' for hour in [2,3,4])
        raw = f'<report><metadata><report_info><report_dtg_issued>2026-10-25T02:00:00+01:00</report_dtg_issued></report_info></metadata><data><cube>{slots}</cube></data></report>'
        records = legacy_records(raw)
        merged = merged_legacy([{'records': records}, {'records': records}])
        self.assertEqual([(r['onset'], r['expires']) for r in merged], [('2026-10-25T01:00:00Z', '2026-10-25T02:00:00Z'), ('2026-10-25T03:00:00Z', '2026-10-25T04:00:00Z')])
        self.assertEqual(merged[0]['issued'], '2026-10-24T23:00:00Z')


if __name__ == '__main__': unittest.main()
