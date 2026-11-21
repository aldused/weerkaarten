#!/usr/bin/env python3
"""Build a durable KNMI warning archive; live warnings remain a separate feed.

The operational JSON history starts on 2026-11-02. Earlier orange/red events
come from KNMI's annual tables; yellow warnings are imported from all legacy
XML publications, newest first. A bounded batch uses one registered Open Data
credential, at most 600 requests/hour. Raw XML is discarded after extraction.
"""
from __future__ import annotations

import argparse
import fcntl
import hashlib
import json
import os
import time
import xml.etree.ElementTree as ET
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.parse import quote, urlencode
from urllib.error import HTTPError

from knmi_public_warnings import (API, COLORS, PHENOMENA,
                                  SEVERITIES, api_json, read_json, timestamp, validate)

CUTOVER = '2026-11-02T00:00:00Z'
LEGACY_API = 'https://api.dataplatform.knmi.nl/open-data/v1/datasets/waarschuwingen_nederland_48h/versions/1.0'
LEGACY_SOURCE = 'https://dataplatform.knmi.nl/dataset/waarschuwingen-nederland-48h-1-0'
PUBLIC_SOURCE = 'https://dataplatform.knmi.nl/dataset/knmi-public-weather-warnings-1-0'


def iso(value):
    return value.astimezone(timezone.utc).isoformat(timespec='seconds').replace('+00:00', 'Z')


def write_json(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_name(path.name + '.tmp')
    with temp.open('w') as out:
        json.dump(data, out, ensure_ascii=False, separators=(',', ':'), allow_nan=False)
        out.flush()
        os.fsync(out.fileno())
    temp.replace(path)


def compact_id(*values):
    return hashlib.sha256(json.dumps(values, ensure_ascii=False).encode()).hexdigest()[:24]


def snapshot_records(snapshot):
    """Keep actual issued warnings, including subsequent cancellations/expiry.

    Historical data must not pass through the live normalizer's freshness or
    expiry filters. Test/Exercise and potentially dangerous weather are excluded.
    """
    validate(snapshot)
    meta = snapshot['metadata']
    if meta['schema_version'] != '0.7':
        raise ValueError('Onbekend KNMI-schema')
    if timestamp(meta['generated_at']) < timestamp(CUTOVER):
        return []
    if meta.get('publication_type') == 'test':
        return []
    if meta.get('publication_type') not in ('manual', 'heartbeat') or meta.get('domain', 'public') != 'public':
        raise ValueError('Niet-operationele publicatie')
    sets = snapshot['warnings']
    if snapshot['num_warning_sets'] != len(sets) or snapshot['num_warnings'] != sum(len(w['parts']) for w in sets):
        raise ValueError('Tellingen KNMI-publicatie kloppen niet')
    result = []
    for warning in sets:
        if warning['operational_status'] != 'Actual' or warning['warning_type'] != 'warning' or warning.get('domain', 'public') != 'public':
            continue
        texts = warning['texts']['nl']
        for part in warning['parts']:
            code = SEVERITIES[part['severity']]
            if part.get('color') and COLORS[part['color']] != code:
                raise ValueError('Tegenstrijdige KNMI-kleurcode')
            if timestamp(part['onset']) >= timestamp(part['expires']):
                raise ValueError('Ongeldige periode')
            guidance = (part.get('guidance') or {}).get('nl') or {}
            area = (part.get('area_description') or part.get('area description') or {}).get('nl') or 'KNMI-waarschuwingsgebied'
            result.append({
                'id': 'public-' + part['part_uuid'] + '-' + code,
                'part_id': part['part_uuid'], 'warning_set_id': warning['warning_set_uuid'], 'codes': [code],
                'phenomenon': PHENOMENA[warning['phenomenon']],
                'headline': texts['headline'], 'description': texts['description'],
                'detail': texts.get('detailed_description') or '',
                'areas': [area], 'onset': part['onset'], 'expires': part['expires'],
                'issued': part['version_dt'], 'observed': meta['generated_at'],
                'status': warning['status'] if warning.get('status', 'active') != 'active' else part.get('status', 'active'),
                'impact': guidance.get('impact') or '', 'instruction': guidance.get('instruction') or '',
                'source': PUBLIC_SOURCE, 'source_kind': 'public',
            })
    return result


def public_history(snapshots):
    records = {}
    for snapshot in sorted(snapshots, key=lambda d: timestamp(d['metadata']['generated_at'])):
        for record in snapshot_records(snapshot):
            previous = records.get(record['id'])
            first = previous['issued'] if previous else record['issued']
            history = previous.get('revisions', []) if previous else []
            revision = {k: record[k] for k in ('issued', 'onset', 'expires', 'headline', 'areas', 'status')}
            if not history or history[-1] != revision:
                history = [*history, revision]
            records[record['id']] = {**record, 'issued': min(first, record['issued']),
                                     'updated': record['issued'], 'revisions': history}
    return list(records.values())


def legacy_records(raw):
    """Decode the explicit hourly province cube; never infer colors from prose."""
    root = ET.fromstring(raw)
    if root.tag != 'report' or root.find('./data/cube') is None:
        raise ValueError('Onbekend oud KNMI-XML-formaat')
    issued = root.findtext('./metadata/report_info/report_dtg_issued')
    timestamp(issued)
    locations = {item.findtext('location_id'): item.findtext('./location_descr/text/text_header')
                 for item in root.findall('./metadata/report_structure/report_locations/report_location')}
    phenomena = {item.findtext('phenomenon_id'): item.findtext('./report_phenomenon_descr/text/text_header')
                 for item in root.findall('./metadata/report_structure/report_phenomena/report_phenomenon')}
    # KNMI's definition blocks use varying wrappers across the legacy years.
    for item in root.findall('./metadata//report_phenomenon'):
        label = item.findtext('./report_phenomenon_descr/text/text_header')
        if label:
            phenomena[item.findtext('phenomenon_id')] = label
    records = {}
    for slot in root.findall('./data/cube/timeslice'):
        onset = timestamp(slot.findtext('timeslice_id'))
        if onset >= timestamp(CUTOVER):
            continue
        for phenomenon in slot.findall('phenomenon'):
            kind = phenomenon.findtext('phenomenon_id')
            for location in phenomenon.findall('location'):
                # Orange/red have a reviewed annual source covering back to 2010.
                if location.findtext('color_id') != 'YELLOW' or location.findtext('location_warning_status') != '1':
                    continue
                area_id = location.findtext('location_id')
                area = locations.get(area_id) or area_id
                date = location.findtext('location_dtg_issued') or issued
                timestamp(date)
                text = next((t for t in location.findall('text') if t.findtext('text_language_id', '').lower() == 'nl'), None)
                headline = text.findtext('text_header', '') if text is not None else ''
                detail = text.findtext('text_data', '') if text is not None else ''
                identity = 'legacy-' + compact_id(kind, area_id, iso(timestamp(date)), headline, detail)
                record = {'id': identity, 'codes': ['geel'], 'phenomenon': phenomena.get(kind) or kind,
                          'headline': headline or phenomena.get(kind) or 'KNMI-waarschuwing',
                          'description': detail, 'detail': '', 'areas': [area],
                          'onset': iso(onset), 'expires': iso(min(onset + timedelta(hours=1), timestamp(CUTOVER))),
                          'issued': iso(timestamp(date)), 'updated': iso(timestamp(issued)),
                          'source': LEGACY_SOURCE, 'source_kind': 'legacy', 'status': 'archived',
                          'intervals': [[iso(onset), iso(min(onset + timedelta(hours=1), timestamp(CUTOVER)))]]}
                previous = records.get(identity)
                if previous:
                    record['onset'] = min(previous['onset'], record['onset'])
                    record['expires'] = max(previous['expires'], record['expires'])
                    record['intervals'] = previous['intervals'] + record['intervals']
                records[identity] = record
    return list(records.values())


def merged_legacy(summaries):
    result = {}
    for summary in summaries:
        for record in summary['records']:
            old = result.get(record['id'])
            if old:
                record = {**record, 'onset': min(old['onset'], record['onset']),
                          'expires': max(old['expires'], record['expires']),
                          'updated': max(old['updated'], record['updated']),
                          'intervals': old['intervals'] + record['intervals']}
            result[record['id']] = record
    segments = []
    for record in result.values():
        intervals = []
        for start, end in sorted(record['intervals']):
            if intervals and start <= intervals[-1][1]:
                intervals[-1][1] = max(end, intervals[-1][1])
            else:
                intervals.append([start, end])
        for start, end in intervals:
            segment = {**record, 'id': record['id'] + '-' + start,
                       'onset': start, 'expires': end}
            segment.pop('intervals')
            segments.append(segment)
    return segments


def sync_public(cache):
    existing = sorted(cache.glob('public_warnings_*.json'))
    cursor = existing[-1].name if existing else 'public_warnings_2026-11-02'
    while True:
        listing = api_json(API + '/files?' + urlencode({'maxKeys': 1000, 'startAfterFilename': cursor}))
        files = listing['files']
        for item in files:
            name = item['filename']
            if name.endswith('.json') and name.startswith('public_warnings_'):
                link = api_json(API + '/files/' + quote(name, safe='') + '/url')
                doc = read_json(link['temporaryDownloadUrl'])
                snapshot_records(doc)  # Validate before the durable checkpoint.
                write_json(cache / name, doc)
        if not listing.get('isTruncated'):
            break
        if not files or files[-1]['filename'] <= cursor:
            raise ValueError('KNMI-paginering gaat niet vooruit')
        cursor = files[-1]['filename']


def legacy_key():
    configured = os.environ.get('KNMI_ARCHIVE_API_KEY') or os.environ.get('KNMI_API_KEY')
    if configured:
        return configured
    # Select one existing registered credential with Open Data access. Once
    # selected, NEVER change keys on rate limits or quota exhaustion.
    from knmi_api import KNMI_KEYS
    for key in KNMI_KEYS:
        try:
            read_json(LEGACY_API + '/files?maxKeys=1', key)
            return key
        except HTTPError as error:
            if error.code not in (401, 403):
                raise
            body = error.read().decode('utf-8', 'replace').lower()
            if 'quota' in body or 'rate limit' in body:
                raise
    raise ValueError('Geen bestaande sleutel met Open Data-toegang')


def legacy_batch(state, limit):
    listing = state / 'legacy-files.json'
    if not listing.exists():
        return
    cache = state / 'legacy'
    cache.mkdir(exist_ok=True)
    files = [f for f in json.loads(listing.read_text()) if f['filename'].endswith('.xml')]
    valid = set()
    for path in cache.glob('*.json'):
        summary = json.loads(path.read_text())
        if summary.get('schema') != 2 and not summary['records']:
            # Empty older summaries cannot contain an interval gap.
            summary['schema'] = 2
            write_json(path, summary)
        if summary.get('schema') == 2:
            valid.add(path.name)
    remaining = [f for f in reversed(files) if f['filename'] + '.json' not in valid]
    budget_path = state / 'legacy-budget.json'
    budget = json.loads(budget_path.read_text()) if budget_path.exists() else []
    budget = [t for t in budget if time.time() - t < 3600]
    limit = min(limit, max(0, 600 - len(budget)))
    if not limit or not remaining:
        return
    token = legacy_key()
    next_request = 0.0
    for item in remaining[:limit]:
        # Keep 400/hour of the normal 1000/hour quota free for live products.
        time.sleep(max(0, next_request - time.monotonic()))
        next_request = time.monotonic() + 3.0
        name = item['filename']
        budget.append(time.time())
        write_json(budget_path, budget)
        link = read_json(LEGACY_API + '/files/' + quote(name, safe='') + '/url', token)
        from urllib.request import Request, urlopen
        with urlopen(Request(link['temporaryDownloadUrl'], headers={'User-Agent': 'Weerlab-warning-archive/1.0'}), timeout=60) as response:
            records = legacy_records(response.read())
        write_json(cache / (name + '.json'), {'schema': 2, 'filename': name, 'records': records})
        print('Oud archief:', name, len(records), 'gele meldingen', flush=True)


def build(state, annual):
    snapshots = [json.loads(p.read_text()) for p in (state / 'snapshots').glob('public_warnings_*.json')]
    native = public_history(snapshots)
    summaries = [d for p in (state / 'legacy').glob('*.json') if (d := json.loads(p.read_text())).get('schema') == 2]
    legacy = merged_legacy(summaries)
    files_path = state / 'legacy-files.json'
    files = [f['filename'] for f in json.loads(files_path.read_text()) if f['filename'].endswith('.xml')] if files_path.exists() else []
    processed = {s['filename'] for s in summaries}
    # Only advertise a contiguous fully imported suffix, never the earliest sample.
    oldest = None
    for filename in reversed(files):
        if filename not in processed:
            break
        oldest = filename[20:28]
    # A batch may stop halfway through a day. Only claim coverage from the
    # following whole day; the earliest archive day itself may also be partial.
    coverage = min((datetime.strptime(oldest, '%Y%m%d') + timedelta(days=1)).strftime('%Y-%m-%d'), CUTOVER[:10]) if oldest else CUTOVER[:10]
    return {'schema': 1, 'checked_at': iso(datetime.now(timezone.utc)),
            'latest_issue': max((s['metadata']['generated_at'] for s in snapshots), default=None),
            'coverage': {'orange_red_since': '2010-01-01', 'all_colors_since': coverage,
                         'legacy_total': len(files), 'legacy_imported': len(processed),
                         'legacy_complete': bool(files) and len(processed) == len(files)},
            'records': sorted([*annual, *legacy, *native], key=lambda r: (r.get('onset') or r['dates'][0], r['id']), reverse=True)}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--state', type=Path, default=Path.home() / 'Library/Application Support/Weerlab/waarschuwingenarchief')
    parser.add_argument('--out', type=Path, default=Path(__file__).resolve().parents[1] / 'waarschuwingen-archief.json')
    parser.add_argument('--annual', type=Path, default=Path(__file__).resolve().parents[1] / 'data/knmi-waarschuwingen-jaararchief.json')
    parser.add_argument('--legacy-limit', type=int, default=150)
    args = parser.parse_args()
    args.state.mkdir(parents=True, exist_ok=True)
    with (args.state / '.lock').open('w') as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            return 3
        cache = args.state / 'snapshots'
        cache.mkdir(exist_ok=True)
        sync_public(cache)
        if not (args.state / 'legacy-files.json').exists():
            files, cursor = [], ''
            while True:
                listing = api_json(LEGACY_API + '/files?' + urlencode({'maxKeys': 1000, 'startAfterFilename': cursor}))
                page = listing['files']
                files.extend(page)
                if not listing.get('isTruncated'):
                    break
                if not page or page[-1]['filename'] <= cursor:
                    raise ValueError('Oud KNMI-archief: ongeldige paginering')
                cursor = page[-1]['filename']
            write_json(args.state / 'legacy-files.json', files)
        annual = json.loads(args.annual.read_text())['records']
        write_json(args.out, build(args.state, annual))
        try:
            legacy_batch(args.state, args.legacy_limit)
        except Exception as error:
            # A bounded historical import must not block new issued warnings.
            print('Oude historie wordt later hervat:', type(error).__name__, str(error)[:160], flush=True)
        write_json(args.out, build(args.state, annual))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
