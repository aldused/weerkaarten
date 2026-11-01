"""Choose the newest due ENS cycle, then catch up missing cycles from the past day."""
import argparse
import json
import sys
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path


def choose_run(now, archive, published):
    due = now - timedelta(hours=6, minutes=30)
    latest = due.replace(hour=due.hour // 6 * 6, minute=0, second=0, microsecond=0)
    candidates = [latest - timedelta(hours=6 * i) for i in range(4)]
    floor = published.get('run', '')
    complete = {r['run'] for r in archive.get('runs', [])
                if r.get('complete') is True and r.get('station_count') == 39
                and r.get('member_count', 51) == 51 and r['run'] <= floor}
    stamp = lambda d: d.strftime('%Y-%m-%dT%H:00:00Z')
    if stamp(latest) not in complete:
        selected = latest
    else:
        selected = next((d for d in reversed(candidates) if stamp(d) not in complete), latest)
    return selected, bool(floor and stamp(selected) < floor)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--published-state', type=Path, required=True)
    parser.add_argument('--archive-url', default='https://data.weerlab.nl/pluim_archive_meta.json')
    args = parser.parse_args()
    request = urllib.request.Request(args.archive_url, headers={'Cache-Control': 'no-cache'})
    with urllib.request.urlopen(request, timeout=30) as response:
        archive = json.load(response)
    if archive.get('complete') is not True or archive.get('station_count') != 39:
        raise RuntimeError('Cannot choose recovery run from invalid published archive')
    selected, archive_only = choose_run(datetime.now(timezone.utc), archive, json.loads(args.published_state.read_text()))
    print(selected.strftime('%Y%m%d'), selected.hour, int(archive_only))
    print(f'ENS queue: {selected.isoformat()} archive_only={archive_only}', file=sys.stderr)

if __name__ == '__main__':
    main()
