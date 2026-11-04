#!/usr/bin/env python3
"""Lokale frames → R2 (data.weerlab.nl/ecmwf-overview/<model>/...).

Volgorde maakt elke publicatie atomair voor de browser:
  1. stapmappen (PNG/JSON)  Cache-Control: immutable (pad bevat run + ?v=pipeline)
  2. manifest.json per run  Cache-Control: no-cache   (pas nu 'bestaan' de stappen)
  3. runs.json              Cache-Control: no-cache   (pas nu wordt een run standaard)
  4. opgeruimde runs remote verwijderen (nooit de standaardrun)

    python3 pipeline/publish.py [--model ecmwf] [--runs 2026103106,...] [--dry-run]
"""
import argparse
import json
import os
import queue
import subprocess
import sys
import tempfile
import threading

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from config import DATA_DIR  # noqa: E402

REMOTE = os.environ.get('OVERVIEW_R2', 'r2:weerlab-data/ecmwf-overview')
RCLONE = os.environ.get('RCLONE', 'rclone')
IMMUTABLE = 'Cache-Control: public, max-age=31536000, immutable'
NOCACHE = 'Cache-Control: no-cache'


def rc(*args, dry=False):
    cmd = [RCLONE, *args, '--transfers', '16', '--checkers', '16', '--retries', '5', '--low-level-retries', '10']
    if dry:
        cmd.append('--dry-run')
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode != 0:
        raise SystemExit(f'rclone faalde: {" ".join(args[:3])}\n{r.stderr[-2000:]}')
    return r.stdout


class LivePublisher:
    """Zet elke klare stap meteen op R2, terwijl de run nog verwerkt wordt. Wat zich intussen
    opstapelt gaat in één rclone-aanroep. Het manifest is een kopie van het moment dat de stap
    klaar was, dus het noemt nooit een stap die nog niet online staat. Mislukt een upload, dan
    haalt de gewone publicatie na afloop het in."""

    def __init__(self, model):
        self.model = model
        self.q = queue.Queue()
        self.static_done = False
        self.t = threading.Thread(target=self._loop, daemon=True)
        self.t.start()

    def add(self, rid, step, manifest):
        with open(os.path.join(DATA_DIR, self.model, 'runs.json'), 'rb') as f:
            index = f.read()
        self.q.put((rid, step, json.dumps(manifest, separators=(',', ':'), ensure_ascii=False), index))

    def close(self):
        self.q.put(None)
        self.t.join()

    def _loop(self):
        stop = False
        pending = []
        while not stop:
            batch = [self.q.get()]
            while not self.q.empty():
                batch.append(self.q.get())
            if batch[-1] is None:
                batch.pop()
                stop = True
            if batch:
                try:
                    self._upload(pending + batch)
                    pending = []
                except (SystemExit, OSError) as e:
                    pending += batch
                    print(f'live-upload mislukt (wordt opnieuw meegenomen): {e}', flush=True)

    def _upload(self, batch):
        local, remote = os.path.join(DATA_DIR, self.model), f'{REMOTE}/{self.model}'
        if not self.static_done and os.path.isdir(os.path.join(local, 'static')):
            rc('copy', os.path.join(local, 'static'), f'{remote}/static', '--exclude', '*.tmp',
               '--header-upload', IMMUTABLE)
            self.static_done = True
        for rid in dict.fromkeys(b[0] for b in batch):
            inc = [x for b in batch if b[0] == rid for x in ('--include', f'/{b[1]:03d}/*')]
            rc('copy', os.path.join(local, rid), f'{remote}/{rid}', *inc, '--header-upload', IMMUTABLE)
        with tempfile.TemporaryDirectory() as td:
            mp, ip = os.path.join(td, 'manifest.json'), os.path.join(td, 'runs.json')
            # Een batch kan meerdere runs bevatten: elk manifest vóór de index.
            latest = {b[0]: b[2] for b in batch}
            for rid, manifest in latest.items():
                with open(mp, 'w') as f:
                    f.write(manifest)
                rc('copyto', mp, f'{remote}/{rid}/manifest.json', '--header-upload', NOCACHE)
            with open(ip, 'wb') as f:
                f.write(batch[-1][3])
            rc('copyto', ip, f'{remote}/runs.json', '--header-upload', NOCACHE)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--model', default='ecmwf')
    ap.add_argument('--runs', help='komma-lijst: alleen deze runs uploaden (runs.json altijd)')
    ap.add_argument('--dry-run', action='store_true')
    a = ap.parse_args()
    local = os.path.join(DATA_DIR, a.model)
    remote = f'{REMOTE}/{a.model}'
    with open(os.path.join(local, 'runs.json')) as f:
        idx = json.load(f)
    runs = [r['run'] for r in idx['runs']]
    # vaste lagen eerst: het manifest verwijst ernaar
    if os.path.isdir(os.path.join(local, 'static')):
        rc('copy', os.path.join(local, 'static'), f'{remote}/static', '--exclude', '*.tmp',
           '--header-upload', IMMUTABLE, dry=a.dry_run)
    for rid in (a.runs.split(',') if a.runs else runs):
        # 1. frames (manifest uitgesloten); alleen nieuwe/gewijzigde bestanden
        rc('copy', os.path.join(local, rid), f'{remote}/{rid}', '--exclude', 'manifest.json',
           '--exclude', '*.tmp', '--header-upload', IMMUTABLE, dry=a.dry_run)
        # 2. manifest
        rc('copyto', os.path.join(local, rid, 'manifest.json'), f'{remote}/{rid}/manifest.json',
           '--header-upload', NOCACHE, dry=a.dry_run)
    # 3. index
    rc('copyto', os.path.join(local, 'runs.json'), f'{remote}/runs.json', '--header-upload', NOCACHE, dry=a.dry_run)
    # 4. remote runs die lokaal opgeruimd zijn
    remote_dirs = [d.strip('/') for d in rc('lsf', '--dirs-only', remote + '/').split()]
    for d in remote_dirs:
        if d.isdigit() and len(d) == 10 and d not in runs and d != idx['default']:
            rc('purge', f'{remote}/{d}', dry=a.dry_run)
            print(f'remote opgeruimd: {d}')
    print(f'gepubliceerd: {", ".join(runs)} → {remote}')


if __name__ == '__main__':
    main()
