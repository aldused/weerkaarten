#!/usr/bin/env python3
"""Lokale beheerserver voor Wereldweer (alleen 127.0.0.1): serveert de weerlab-map en een kleine API.

    python3 scripts/wereldweer_beheer_server.py      # → http://127.0.0.1:8805/wereldweer_beheer.html

GET  /api/wereldweer/beheer  → data/wereldweer/beheer.json
POST /api/wereldweer/beheer  {"actie": …}:
     bron {id, actief?, interval?} · blokkeer/deblokkeer {id} · vastzetten/losmaken {id} · uitlichten/niet_uitlichten {id}
     goedkeuren/afkeuren {id} · blokkeer_url {url} · instelling {sleutel, waarde}
Na elke wijziging draait de selectie opnieuw (zonder model, zonder ophalen) en wordt gepubliceerd,
zodat vastzetten of blokkeren binnen enkele seconden op de site staat.
De publieke site kan hier niet bij: daar is het beheerpaneel alleen-lezen.
"""
import json
import subprocess
import sys
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BEHEER = ROOT / 'data' / 'wereldweer' / 'beheer.json'
LIJSTEN = {'blokkeer': ('geblokkeerd', True), 'deblokkeer': ('geblokkeerd', False),
           'vastzetten': ('vastgezet', True), 'losmaken': ('vastgezet', False),
           'uitlichten': ('uitgelicht', True), 'niet_uitlichten': ('uitgelicht', False),
           'goedkeuren': ('goedgekeurd', True), 'afkeuren': ('goedgekeurd', False)}
INSTELLINGEN = {'llm_interval_dag': int, 'llm_interval_nacht': int, 'max_triage': int, 'max_schrijf': int,
                'model_triage': str, 'model_schrijver': str}


def lees():
    try:
        return json.loads(BEHEER.read_text())
    except (OSError, ValueError):
        return {}


def wijzig(verzoek):
    b = lees()
    b.setdefault('bronnen', {})
    actie = verzoek.get('actie')
    if actie in LIJSTEN:
        sleutel, aan = LIJSTEN[actie]
        lst = b.setdefault(sleutel, [])
        did = str(verzoek['id'])
        if aan and did not in lst:
            lst.append(did)
        if not aan and did in lst:
            lst.remove(did)
    elif actie == 'bron':
        sys.path.insert(0, str(ROOT / 'scripts'))
        import wereldweer_bronnen as B
        bid = str(verzoek['id'])
        if bid not in B.BRONNEN:
            raise ValueError('onbekende bron')
        o = b['bronnen'].setdefault(bid, {})
        if 'actief' in verzoek:
            o['actief'] = bool(verzoek['actief'])
        if verzoek.get('interval'):
            o['interval'] = max(5, min(1440, int(verzoek['interval'])))
    elif actie == 'blokkeer_url':
        b.setdefault('geblokkeerde_urls', []).append(str(verzoek['url'])[:500])
    elif actie == 'instelling':
        k = verzoek['sleutel']
        if k not in INSTELLINGEN:
            raise ValueError('onbekende instelling')
        b.setdefault('instellingen', {})[k] = INSTELLINGEN[k](verzoek['waarde'])
    else:
        raise ValueError('onbekende actie')
    tmp = BEHEER.with_suffix('.tmp')
    tmp.write_text(json.dumps(b, ensure_ascii=False, indent=1))
    tmp.replace(BEHEER)
    # selectie opnieuw (snel, geen model, geen ophalen) zodat de wijziging meteen zichtbaar is
    subprocess.Popen([sys.executable, str(ROOT / 'scripts' / 'wereldweer_stroom.py'), '--alleen-selectie'], cwd=ROOT,
                     stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    return b


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *a, **k):
        super().__init__(*a, directory=str(ROOT), **k)

    def _json(self, code, data):
        body = json.dumps(data, ensure_ascii=False).encode()
        self.send_response(code)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Cache-Control', 'no-store')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path.startswith('/api/wereldweer/beheer'):
            return self._json(200, lees())
        return super().do_GET()

    def do_POST(self):
        if not self.path.startswith('/api/wereldweer/beheer'):
            return self._json(404, {'fout': 'niet gevonden'})
        if self.headers.get('Origin') not in (None, f'http://127.0.0.1:{PORT}', f'http://localhost:{PORT}'):
            return self._json(403, {'fout': 'alleen lokaal'})
        try:
            n = int(self.headers.get('Content-Length') or 0)
            return self._json(200, wijzig(json.loads(self.rfile.read(n) or b'{}')))
        except (ValueError, KeyError, TypeError) as e:
            return self._json(400, {'fout': str(e)})


PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8805

if __name__ == '__main__':
    print(f'Wereldweer-beheer: http://127.0.0.1:{PORT}/wereldweer_beheer.html', file=sys.stderr)
    ThreadingHTTPServer(('127.0.0.1', PORT), Handler).serve_forever()
