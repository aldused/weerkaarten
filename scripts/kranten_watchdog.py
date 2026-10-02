#!/usr/local/bin/python3
"""Independent freshness check; never generates weather or replaces an edition."""
import json
import subprocess
import sys
from datetime import datetime,timedelta
from pathlib import Path
from zoneinfo import ZoneInfo
ROOT=Path('/Users/aldus/KNMI_Project/weerlab')
SCHEDULE=Path('/Users/aldus/.codex/automations/krantenredactie-dagelijks-bijwerken/automation.toml')

def issues(now,edition,schedule):
    result=[]
    if 'status = "ACTIVE"' not in schedule:
        result.append('De dagelijkse Codex-planning ontbreekt of is uitgeschakeld.')
    expected=(now.date()+timedelta(days=1 if now.hour>=10 else 0)).isoformat()
    if edition.get('publicationDate','')<expected:
        result.append(f"De kranteditie loopt achter: {edition.get('publicationDate','ontbreekt')}; verwacht minimaal {expected}.")
    return result

def main():
    now=datetime.now(ZoneInfo('Europe/Amsterdam'))
    try:edition=json.loads((ROOT/'data/kranten_demo.json').read_text())
    except (OSError,ValueError):edition={}
    try:schedule=SCHEDULE.read_text()
    except OSError:schedule=''
    errors=issues(now,edition,schedule)
    if not errors:return 0
    message=' '.join(errors)
    print(now.isoformat(),message,flush=True)
    if '--check' in sys.argv:return 1
    sys.path.insert(0,str(ROOT/'scripts'))
    from kranten_update import atomic_json
    path=ROOT/'data/kranten_status.json'
    try:status=json.loads(path.read_text())
    except (OSError,ValueError):status={}
    if status.get('watchdogMessage')!=message:
        status.update(ok=False,message=message,watchdogMessage=message,watchdogAt=now.isoformat())
        # Preserve checkedAt: a watchdog check is not a successful source fetch.
        atomic_json(path,status)
    pub=subprocess.run(['bash',str(ROOT/'shell/kranten_publish.sh'),'Krantenredactie: achterstand gemeld'],timeout=1100)
    return 1 if pub.returncode==0 else pub.returncode
if __name__=='__main__':sys.exit(main())
