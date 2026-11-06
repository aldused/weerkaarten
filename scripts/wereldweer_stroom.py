#!/usr/bin/env python3
"""Wereldweer-nieuwsstroom: doorlopend Europees en wereldwijd weernieuws in nieuwsdossiers.

Naast de dagelijkse editie (wereldweer_auto.py, ≤10 lange artikelen) houdt dit script een veel bredere
nieuwsstroom bij. Eén run (launchd elke 5 min) doet, elk onderdeel los afgeschermd:

  1. ingestie    bronnen uit wereldweer_bronnen.py die 'aan de beurt' zijn (eigen interval per bron);
                 een kapotte bron geeft een foutstatus maar houdt niets tegen
  2. normalisatie + ontdubbeling op URL en genormaliseerde kop (ook tussen bronnen)
  3. waarschuwingen  Meteoalarm (alle Europese landen, alle niveaus) → waarschuwingen.json, apart van nieuws
  4. triage      nieuwe berichten → taalmodel (Haiku): relevant?, dossier, fenomeen, soort, land/plaats, belang
  5. redactie    nieuwe/gewijzigde dossiers → taalmodel (Sonnet): Nederlandse kop + samenvatting uit de bron,
                 daarna een cijfercontrole zonder model (elk getal moet in de bron staan)
  6. selectie    transparante score 0–100 per dossier → stroom.json
  7. publicatie  data.weerlab.nl/wereldweer/stroom/ (R2)

    python3 scripts/wereldweer_stroom.py              # gewone run
    python3 scripts/wereldweer_stroom.py --alles      # alle bronnen nu, ongeacht interval
    python3 scripts/wereldweer_stroom.py --geen-model # alleen ingestie/waarschuwingen/selectie
    python3 scripts/wereldweer_stroom.py --bulk       # grotere triage-/redactiebatches (eerste vulling)
    WERELDWEER_R2=0 …                                 # niet publiceren

Opslag: data/wereldweer/stroom/{items,dossiers,bronstatus,waarschuwingen,stroom}.json; beheer: beheer.json.
Log: ../logs/wereldweer_stroom.log; prompts/antwoorden: ../artifacts/wereldweer/stroom/.
"""
import argparse
import hashlib
import json
import math
import os
import re
import subprocess
import sys
import time
import urllib.error
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

sys.path.insert(0, str(Path(__file__).resolve().parent))
import wereldweer_bronnen as B  # noqa: E402
import wereldweer_fetch as F  # noqa: E402
import wereldweer_geo as G  # noqa: E402

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / 'data' / 'wereldweer' / 'stroom'
WORK = ROOT.parent / 'artifacts' / 'wereldweer' / 'stroom'
LOG = ROOT.parent / 'logs' / 'wereldweer_stroom.log'
BEHEER = ROOT / 'data' / 'wereldweer' / 'beheer.json'
EDITIES = ROOT / 'data' / 'wereldweer'
TZ = ZoneInfo('Europe/Amsterdam')
CLAUDE = os.environ.get('CLAUDE_BIN', '/opt/homebrew/bin/claude')
RCLONE = '/opt/homebrew/bin/rclone'
R2_DOEL = 'r2:weerlab-data/wereldweer/stroom'
PUBLICEER = os.environ.get('WERELDWEER_R2', '1') == '1'

BEWAAR_DAGEN = 9          # items/dossiers daarna weg (pagina toont max. 7 dagen)
VENSTER_DAGEN = 7         # ouder bij binnenkomst = niet opnemen
STANDAARD = {             # overschrijfbaar in beheer.json → 'instellingen'
    'model_triage': 'haiku', 'model_schrijver': 'sonnet',
    'llm_interval_dag': 15, 'llm_interval_nacht': 60,     # minuten tussen modelrondes (abonnementslimiet!)
    'max_triage': 140, 'max_schrijf': 10, 'max_herschrijf_per_dossier': 6,
}

CATEGORIEEN = ['storm', 'onweer', 'tornado', 'hagel', 'neerslag', 'overstroming', 'kust', 'sneeuw', 'ijzel',
               'lawine', 'kou', 'hitte', 'droogte', 'brand', 'mist', 'stof', 'tropisch', 'depressie', 'circulatie',
               'record', 'klimaat', 'wetenschap', 'satelliet', 'overig']
TYPES = ['extreem', 'bijzonder', 'ontwikkeling', 'wintersport', 'klimaat']
SOORTEN = ['waargenomen', 'lopend', 'verwacht', 'waarschuwing', 'rapport']


# ---------------------------------------------------------------- hulpjes

def log(msg):
    LOG.parent.mkdir(parents=True, exist_ok=True)
    regel = f'{datetime.now(TZ):%Y-%m-%d %H:%M:%S} {msg}'
    print(regel, file=sys.stderr)
    with LOG.open('a') as f:
        f.write(regel + '\n')


def lees(pad, standaard):
    try:
        return json.loads(Path(pad).read_text())
    except (OSError, ValueError):
        return standaard


def schrijf(pad, data, compact=False):
    pad = Path(pad)
    pad.parent.mkdir(parents=True, exist_ok=True)
    tmp = pad.with_suffix('.tmp')
    tmp.write_text(json.dumps(data, ensure_ascii=False, separators=(',', ':')) if compact
                   else json.dumps(data, ensure_ascii=False, indent=1))
    tmp.replace(pad)


def iso(d):
    return d.astimezone(timezone.utc).isoformat(timespec='seconds') if d else None


def dt(s):
    return datetime.fromisoformat(s) if s else None


def norm_url(u):
    u = (u or '').strip()
    if 'news.google.com' in u:
        return u.split('?')[0]
    u = re.sub(r'[?#].*$', '', u)
    return re.sub(r'^https?://(www\.)?', '', u).rstrip('/').lower()


def norm_kop(t):
    t = re.sub(r'\s+[-|–]\s+[^-|–]{2,40}$', '', t or '')  # " - Medium"
    t = re.sub(r'[^\w ]', '', t.lower(), flags=re.U)
    return re.sub(r'\s+', ' ', t).strip()[:90]


def sleutel(s):
    return hashlib.sha1(s.encode()).hexdigest()[:12]


def outlet_sleutel(o):
    return re.sub(r'[^a-z0-9]', '', (o or '').lower().replace('www.', ''))[:30]


def beheer():
    b = lees(BEHEER, {})
    b.setdefault('bronnen', {})
    for k in ('geblokkeerd', 'vastgezet', 'uitgelicht', 'goedgekeurd', 'geblokkeerde_urls'):
        b.setdefault(k, [])
    inst = dict(STANDAARD)
    inst.update(b.get('instellingen') or {})
    b['instellingen'] = inst
    return b


# ---------------------------------------------------------------- taalmodel

def claude(system, prompt, model, naam, timeout=600):
    env = dict(os.environ)
    tok = Path.home() / '.config' / 'weerlab' / 'claude_oauth_token'
    if tok.exists():
        env['CLAUDE_CODE_OAUTH_TOKEN'] = tok.read_text().strip()
    env['MAX_THINKING_TOKENS'] = '0'
    cmd = [CLAUDE, '-p', '--model', model, '--tools', '', '--setting-sources', '', '--strict-mcp-config',
           '--disable-slash-commands', '--no-session-persistence', '--output-format', 'json', '--system-prompt', system]
    WORK.mkdir(parents=True, exist_ok=True)
    (WORK / f'prompt_{naam}.txt').write_text(prompt)
    res = subprocess.run(cmd, input=prompt, capture_output=True, text=True, timeout=timeout, cwd=WORK, env=env)
    try:
        meta = json.loads(res.stdout)
    except ValueError:
        meta = None
    if res.returncode != 0 or meta is None or meta.get('is_error'):
        reden = meta.get('result') if meta else (res.stderr or res.stdout)[-300:]
        raise RuntimeError(f'claude {naam} faalde ({res.returncode}): {str(reden)[:300]}')
    u = meta.get('usage', {})
    log(f"{naam} ({model}): in {u.get('input_tokens')} (+cache {u.get('cache_read_input_tokens', 0)}), "
        f"uit {u.get('output_tokens')}, ${meta.get('total_cost_usd', 0):.3f}")
    tekst = meta['result'].strip()
    (WORK / f'antwoord_{naam}.json').write_text(tekst)
    return json_uit(tekst)


def json_uit(tekst):
    """Het (grootste) JSON-object uit een modelantwoord, ook als er toch uitleg omheen staat."""
    try:
        return json.loads(tekst[tekst.index('{'):tekst.rindex('}') + 1])
    except ValueError:
        pass
    dec, beste = json.JSONDecoder(), None
    for m in re.finditer(r'\{', tekst):
        try:
            obj, eind = dec.raw_decode(tekst, m.start())
        except ValueError:
            continue
        if isinstance(obj, dict) and (beste is None or eind - m.start() > beste[0]):
            beste = (eind - m.start(), obj)
    if beste is None:
        raise ValueError('geen JSON in modelantwoord')
    return beste[1]


# ---------------------------------------------------------------- 1-2. ingestie en ontdubbeling

def aan_de_beurt(bid, b, status, cfg, nu, alles):
    over = cfg['bronnen'].get(bid, {})
    if over.get('actief') is False:
        return False
    if alles:
        return True
    st = status.get(bid, {})
    laatst = dt(st.get('geprobeerd'))
    interval = over.get('interval') or b['interval']
    # na een fout sneller opnieuw, maar met terugval (max. 4x interval) zodat een dode bron niet blijft hameren
    if st.get('fouten_op_rij'):
        interval = min(interval * (1 + st['fouten_op_rij']), interval * 4)
    return laatst is None or nu - laatst >= timedelta(minutes=interval) - timedelta(seconds=40)


def haal_bron(bid):
    b = B.BRONNEN[bid]
    t0 = time.time()
    raw = F.get(b['url'], timeout=25, pogingen=2)
    items = F.parse_feed('x', raw)
    for it in items:
        if b['soort'] == 'aggregator':  # Google News: "Kop - Medium"
            if not it['outlet'] and ' - ' in it['title']:
                it['title'], it['outlet'] = it['title'].rsplit(' - ', 1)
            it['summary'] = ''
    return items, round(time.time() - t0, 1)


def ingestie(nu, cfg, alles, items, status):
    beurt = [bid for bid, b in B.BRONNEN.items() if aan_de_beurt(bid, b, status, cfg, nu, alles)]
    if not beurt:
        return 0
    titels = {it['nk']: k for k, it in items.items() if it.get('nk')}
    geblokkeerd = {norm_url(u) for u in cfg['geblokkeerde_urls']}
    nieuw_totaal = 0

    def een(bid):
        try:
            return bid, haal_bron(bid), None
        except Exception as e:  # noqa: BLE001 – elke fout = bronstatus, nooit de hele run
            return bid, None, f'{type(e).__name__}: {str(e)[:140]}'

    with ThreadPoolExecutor(14) as ex:
        resultaten = list(ex.map(een, beurt))
    for bid, res, fout in resultaten:
        b = B.BRONNEN[bid]
        st = status.setdefault(bid, {'nieuw_totaal': 0, 'dubbel_totaal': 0})
        st['geprobeerd'] = iso(nu)
        if fout:
            st['fout'] = fout
            st['fouten_op_rij'] = st.get('fouten_op_rij', 0) + 1
            continue
        lijst, duur = res
        eerste_keer = 'ok' not in st
        st.update({'ok': iso(nu), 'fout': None, 'fouten_op_rij': 0, 'duur_s': duur, 'in_feed': len(lijst)})
        n_nieuw = n_dubbel = n_weer = n_oud = 0
        nieuwste = dt(st.get('nieuwste_item'))
        for it in lijst:
            titel = (it.get('title') or '').strip()
            if not titel or not it.get('url'):
                continue
            tekst = titel + ' ' + (it.get('summary') or '')
            if b['filter'] and not B.lijkt_weer(tekst):
                continue
            n_weer += 1
            d = it.get('date')
            if d and d > nu + timedelta(hours=1):
                d = nu  # klok van de bron loopt voor
            if d is None:
                # zonder datum alleen wat ná de eerste kennismaking verschijnt (anders oud als nieuw)
                kd = sleutel(norm_url(it['url']))
                basis = st.setdefault('zonder_datum', [])
                if eerste_keer or kd in basis:
                    if kd not in basis:
                        basis.append(kd)
                        del basis[:-600]
                    continue
                d = nu
            if d < nu - timedelta(days=VENSTER_DAGEN):
                n_oud += 1
                continue
            nieuwste = max(nieuwste, d) if nieuwste else d
            nu_ = norm_url(it['url'])
            k = sleutel(nu_)
            if k in items or nu_ in geblokkeerd:
                continue  # al bekend: opnieuw inlezen maakt een bericht nooit 'nieuw'
            nk = norm_kop(titel)
            if nk and nk in titels and titels[nk] in items:
                ouder = items[titels[nk]]  # zelfde kop via andere bron/link = duplicaat, wel als vindplaats bewaren
                ouder.setdefault('ook', [])
                if len(ouder['ook']) < 8 and bid not in [o['bron'] for o in ouder['ook']]:
                    ouder['ook'].append({'bron': bid, 'url': it['url'], 'outlet': it.get('outlet')})
                n_dubbel += 1
                continue
            items[k] = {'k': k, 'bron': bid, 'url': it['url'], 'titel': titel[:300],
                        'tekst': (it.get('summary') or '')[:500], 'outlet': it.get('outlet') or b['naam'],
                        'taal': b['taal'], 'gebied': b['gebied'], 'tijd': iso(d), 'gezien': iso(nu),
                        'datum_geschat': it.get('date') is None, 'nk': nk, 'triage': None}
            titels[nk] = k
            n_nieuw += 1
        st['nieuw_laatst'] = n_nieuw
        st['nieuw_totaal'] = st.get('nieuw_totaal', 0) + n_nieuw
        st['dubbel_totaal'] = st.get('dubbel_totaal', 0) + n_dubbel
        st['weer_laatst'] = n_weer
        st['te_oud_laatst'] = n_oud
        st['nieuwste_item'] = iso(nieuwste)
        nieuw_totaal += n_nieuw
    fout = sum(1 for bid, r, f in resultaten if f)
    log(f'ingestie: {len(beurt)} bronnen ({fout} fout), {nieuw_totaal} nieuwe berichten')
    return nieuw_totaal


# ---------------------------------------------------------------- 3. waarschuwingen (Meteoalarm)

MA_LAND = {
    'austria': 'AT', 'belgium': 'BE', 'bosnia-herzegovina': 'BA', 'bulgaria': 'BG', 'croatia': 'HR', 'cyprus': 'CY',
    'czechia': 'CZ', 'denmark': 'DK', 'estonia': 'EE', 'finland': 'FI', 'france': 'FR', 'germany': 'DE',
    'greece': 'GR', 'hungary': 'HU', 'iceland': 'IS', 'ireland': 'IE', 'israel': 'IL', 'italy': 'IT', 'latvia': 'LV',
    'lithuania': 'LT', 'luxembourg': 'LU', 'malta': 'MT', 'moldova': 'MD', 'montenegro': 'ME', 'netherlands': 'NL',
    'north-macedonia': 'MK', 'norway': 'NO', 'poland': 'PL', 'portugal': 'PT', 'romania': 'RO', 'serbia': 'RS',
    'slovakia': 'SK', 'slovenia': 'SI', 'spain': 'ES', 'sweden': 'SE', 'switzerland': 'CH', 'ukraine': 'UA',
    'united-kingdom': 'GB',
}
MA_FENOMEEN = {  # Meteoalarm-gevaartype → Nederlands + fenomeencategorie van de stroom
    'wind': ('wind', 'storm'), 'snow-ice': ('sneeuw/ijzel', 'sneeuw'), 'snow/ice': ('sneeuw/ijzel', 'sneeuw'),
    'thunderstorm': ('onweer', 'onweer'), 'thunderstorms': ('onweer', 'onweer'), 'fog': ('mist', 'mist'),
    'high-temperature': ('hitte', 'hitte'), 'extreme high temperature': ('hitte', 'hitte'),
    'low-temperature': ('kou', 'kou'), 'extreme low temperature': ('kou', 'kou'), 'coastalevent': ('kust', 'kust'),
    'coastal event': ('kust', 'kust'), 'forest-fire': ('natuurbrand', 'brand'), 'forest fire': ('natuurbrand', 'brand'),
    'avalanches': ('lawines', 'lawine'), 'avalanche': ('lawines', 'lawine'), 'rain': ('regen', 'neerslag'),
    'flooding': ('overstroming', 'overstroming'), 'flood': ('overstroming', 'overstroming'),
    'rain-flood': ('regen/overstroming', 'overstroming'), 'rain flood': ('regen/overstroming', 'overstroming'),
}
MA_NIVEAU = {'Yellow': ('geel', 'potentieel gevaarlijk', 1), 'Orange': ('oranje', 'gevaarlijk', 2),
             'Red': ('rood', 'zeer gevaarlijk', 3)}


def meteoalarm_land(slug):
    raw = F.get(f'https://feeds.meteoalarm.org/feeds/meteoalarm-legacy-atom-{slug}', timeout=25)
    root = F.ET.fromstring(raw)
    ns = F.NS
    uit = []
    for e in root.iter('{%s}entry' % ns['atom']):
        titel = e.findtext('atom:title', '', ns)
        m = re.match(r'(Yellow|Orange|Red) (.+?) Warning issued for (.+?) - (.+)$', titel)
        if not m:
            continue
        cap = next((l.get('href') for l in e.findall('atom:link', ns) if l.get('type') == 'application/cap+xml'), None)
        regio_link = next((l.get('href') for l in e.findall('atom:link', ns) if 'geocode=' in (l.get('href') or '')), None)
        uit.append({'kleur': m[1], 'gevaar': m[2], 'regio': e.findtext('cap:areaDesc', '', ns) or m[4],
                    'van': e.findtext('cap:onset', '', ns) or e.findtext('cap:effective', '', ns),
                    'tot': e.findtext('cap:expires', '', ns), 'uitgegeven': e.findtext('cap:sent', '', ns),
                    'zekerheid': e.findtext('cap:certainty', '', ns), 'urgentie': e.findtext('cap:urgency', '', ns),
                    'bericht': e.findtext('cap:message_type', '', ns), 'cap': cap, 'url': regio_link})
    return uit


def waarschuwingen(nu, status, alles):
    """Alle Meteoalarm-landen; elk land los (bij een fout blijft de vorige stand van dat land staan)."""
    oud = lees(DATA / 'waarschuwingen.json', {'landen': {}})
    st = status.setdefault('meteoalarm', {'nieuw_totaal': 0, 'dubbel_totaal': 0})
    if not alles and st.get('geprobeerd') and nu - dt(st['geprobeerd']) < timedelta(minutes=9, seconds=20):
        return oud
    st['geprobeerd'] = iso(nu)

    def een(slug):
        try:
            return slug, meteoalarm_land(slug), None
        except Exception as e:  # noqa: BLE001
            return slug, None, str(e)[:120]

    with ThreadPoolExecutor(10) as ex:
        res = list(ex.map(een, MA_LAND))
    landen = oud.get('landen', {})
    fouten = {}
    for slug, lijst, fout in res:
        iso2 = MA_LAND[slug]
        if fout:
            fouten[iso2] = fout
            if iso2 in landen:
                landen[iso2]['fout'] = fout
            continue
        ws = []
        for w in lijst:
            tot = dt(w['tot'].replace('Z', '+00:00')) if w['tot'] else None
            if tot and tot < nu:
                continue  # verlopen: niet tonen
            nl, cat = MA_FENOMEEN.get(w['gevaar'].lower(), (w['gevaar'].lower(), 'overig'))
            kleur, betekenis, ernst = MA_NIVEAU[w['kleur']]
            geo = G.zoek(iso2, regio=w['regio'])
            ws.append({'kleur': kleur, 'ernst': ernst, 'betekenis': betekenis, 'gevaar': nl, 'cat': cat,
                       'regio': w['regio'], 'van': w['van'], 'tot': w['tot'], 'uitgegeven': w['uitgegeven'],
                       'zekerheid': w['zekerheid'], 'url': w['url'], 'cap': w['cap'],
                       'lat': geo['lat'] if geo else None, 'lon': geo['lon'] if geo else None,
                       'geo': geo['nauwkeurigheid'] if geo else None})
        ws.sort(key=lambda w: (-w['ernst'], w['van'] or ''))
        landen[iso2] = {'land': G.land(iso2)['nl'] if G.land(iso2) else iso2, 'bijgewerkt': iso(nu), 'fout': None,
                        'waarschuwingen': ws}
    # oud gebleven landen: verlopen waarschuwingen er toch uit, ook al faalt de feed
    for l in landen.values():
        l['waarschuwingen'] = [w for w in l['waarschuwingen'] if not w['tot'] or
                               dt(w['tot'].replace('Z', '+00:00')) >= nu]
    st.update({'ok': iso(nu), 'fout': '; '.join(f'{k}: {v}' for k, v in fouten.items())[:300] or None,
               'fouten_op_rij': 0 if len(fouten) < len(MA_LAND) else st.get('fouten_op_rij', 0) + 1,
               'in_feed': sum(len(l['waarschuwingen']) for l in landen.values())})
    data = {'gemaakt': iso(nu), 'bron': 'Meteoalarm (EUMETNET) – officiële waarschuwingen van de nationale diensten',
            'landen': landen}
    schrijf(DATA / 'waarschuwingen.json', data, compact=True)
    n = [sum(1 for l in landen.values() for w in l['waarschuwingen'] if w['ernst'] == e) for e in (3, 2, 1)]
    log(f'waarschuwingen: {n[0]} rood, {n[1]} oranje, {n[2]} geel in {len(landen)} landen ({len(fouten)} fout)')
    return data


def rampen(nu, status, alles):
    """GDACS: tropische cyclonen (alle niveaus) en oranje/rode overstromingen/droogte/branden, met coördinaten."""
    pad = DATA / 'gdacs.json'
    st = status.setdefault('gdacs', {'nieuw_totaal': 0, 'dubbel_totaal': 0})
    if not alles and st.get('geprobeerd') and nu - dt(st['geprobeerd']) < timedelta(minutes=29):
        return lees(pad, [])
    st['geprobeerd'] = iso(nu)
    try:
        ev = F.fetch_gdacs()
    except Exception as e:  # noqa: BLE001
        st.update({'fout': str(e)[:150], 'fouten_op_rij': st.get('fouten_op_rij', 0) + 1})
        return lees(pad, [])
    NIV = {'Red': 'rood', 'Orange': 'oranje', 'Green': 'groen'}
    uit = [{'type': e['type'], 'niveau': NIV.get(e['niveau'], e['niveau']), 'naam': e['naam'], 'land': e['land'],
            'titel': e['titel'], 'lat': e['lat'], 'lon': e['lon'], 'van': e['van'], 'bijgewerkt': e['bijgewerkt'],
            'url': e['url']} for e in ev]
    st.update({'ok': iso(nu), 'fout': None, 'fouten_op_rij': 0, 'in_feed': len(uit)})
    schrijf(pad, uit)
    return uit


# ---------------------------------------------------------------- 4. triage

SYSTEM_TRIAGE = f"""Je bent de nieuwsdienst van Weerlab Wereldweer, een Nederlandstalig overzicht van actueel weernieuws (Europa eerst, daarna de wereld).
Je krijgt NIEUWE berichten (kop + soms een korte tekst, in allerlei talen) en de lijst LOPENDE DOSSIERS. Beoordeel elk bericht.

Relevant (r=1): actueel weer- of weergerelateerd nieuws met inhoud: extreem of bijzonder weer, schade/impact door weer, officiële waarschuwingen, opvallende verwachtingen (storm, sneeuw, hitte, kou, zware neerslag), records en metingen, meteorologische ontwikkelingen (depressies, blokkades, poolwervel, straalstroom), wintersport-sneeuw en lawinegevaar, klimaatmetingen/rapporten en meteorologisch onderzoek, satellietwaarnemingen.
Niet relevant (r=0): sport, politiek en klimaatbeleid zonder meteorologische inhoud, aardbevingen en vulkanen, ruimteweer (geomagnetische stormen, zonnevlammen, noorderlicht), verkeer zonder weeroorzaak, energieprijzen, 'storm' als beeldspraak, horoscopen, reclame, een gewone dagverwachting zonder iets bijzonders, berichten ouder dan de gebeurtenis zelf (jubilea, terugblikken op jaren geleden).

Dossier (d): berichten over DEZELFDE gebeurtenis of weersituatie (zelfde verschijnsel, zelfde gebied, zelfde dagen) horen in één dossier. Past een bericht bij een lopend dossier, geef dan precies dat dossier-id. Anders een nieuwe slug "n:<land>-<onderwerp>" (kleine letters, koppeltekens, bv. "n:it-noodweer-sardinie"); berichten uit deze batch over dezelfde gebeurtenis krijgen dezelfde nieuwe slug. Een verwachting en de latere waarneming van dezelfde storm = zelfde dossier. Een storm die meerdere landen raakt = één dossier (land = zwaarst getroffen land).

Velden per relevant bericht:
- cat: fenomeen, één van {CATEGORIEEN}
- t: type, één van {TYPES} (extreem = gevaarlijk/schadelijk weer; bijzonder = opvallend maar niet gevaarlijk, records, ongewoon voor het seizoen; ontwikkeling = grootschalige meteorologie/verwachtingen; wintersport = sneeuw in berggebieden, sneeuwhoogten, lawinegevaar; klimaat = klimaat en wetenschap)
- s: soort, één van {SOORTEN} (waargenomen = gebeurd/gemeten; lopend = is nu bezig; verwacht = verwachting/voorspelling, nog niet gebeurd; waarschuwing = een officiële waarschuwing is uitgegeven; rapport = rapport, studie, statistiek)
- l: land als ISO 3166-1 alpha-2 (hoofdletters). Geen land: XA Atlantische Oceaan, XP Grote Oceaan, XI Indische Oceaan, XM Middellandse Zee, XN Noordpoolgebied, XS Zuidpoolgebied, XE Europa als geheel, XW wereld/mondiaal
- p: belangrijkste plaats zoals in het bericht (Engelse of lokale spelling), of null
- g: regio/provincie/deelstaat/gebergte, of null
- b: meteorologische bijzonderheid 0-10 (0 alledaags, 3 gewoon seizoensweer, 5 opvallend, 7 zeldzaam, 8 uitzonderlijk of record, 10 historisch)
- i: maatschappelijke impact 0-10 (doden, gewonden, evacuaties, stroomuitval, schade, verkeer/luchtvaart, scholen dicht); 0 als niets genoemd
- v: 1 = officieel bevestigd of gemeten (instituut, autoriteit, metingen); 0 = onbevestigd (sociale media, 'naar verluidt', amateur); null = niet te zeggen

Antwoord ALLEEN met JSON, compact, één object per bericht in dezelfde volgorde:
{{"items":[{{"id":"…","r":0}},{{"id":"…","r":1,"d":"…","cat":"…","t":"…","s":"…","l":"..","p":null,"g":null,"b":5,"i":0,"v":1}}]}}"""


def dossier_regels(dossiers, nu):
    regels = []
    for d in sorted(dossiers.values(), key=lambda d: d['laatste'], reverse=True):
        if dt(d['laatste']) < nu - timedelta(days=4) or d.get('samengevoegd'):
            continue
        kop = d.get('kop') or d.get('voorlopig', '')
        regels.append(f"{d['id']} | {d['land']} | {d['cat']} | {d['laatste'][:10]} | {kop[:110]}")
        if len(regels) >= 160:
            break
    return regels


def triage(items, dossiers, nu, cfg, bulk):
    wacht = [it for it in items.values() if it['triage'] is None]
    if not wacht:
        return []
    # Europese bronnen eerst, dan nieuwste eerst: bij een achterstand gaat Europa voor
    eur = set(G.EUROPA)
    wacht.sort(key=lambda it: it['tijd'], reverse=True)
    totaal = len(wacht)
    n = cfg['instellingen']['max_triage'] * (3 if bulk else 1)
    # Europa voorop maar niet exclusief: ±65 % van de plekken Europees, de rest wereld (anders verhongert de wereld)
    e_lijst = [it for it in wacht if it['gebied'] in eur]
    w_lijst = [it for it in wacht if it['gebied'] not in eur]
    n_w = min(len(w_lijst), max(int(n * 0.35), n - len(e_lijst)))
    wacht = e_lijst[:n - n_w] + w_lijst[:n_w]
    batch_groot = 70
    verwerkt = []
    for start in range(0, min(n, len(wacht)), batch_groot):
        batch = wacht[start:start + batch_groot]
        regels = []
        for j, it in enumerate(batch):
            it['_tid'] = f't{j}'
            regels.append(f"{it['_tid']} | {B.BRONNEN.get(it['bron'], {}).get('naam', it['bron'])} ({it['gebied'] or '-'}) | "
                          f"{it['taal']} | {it['tijd'][:16]} | {it['titel']}"
                          + (f" — {it['tekst'][:220]}" if it['tekst'] else ''))
        prompt = (f"Nu: {nu:%Y-%m-%d %H:%M} UTC\n\nLOPENDE DOSSIERS (id | land | fenomeen | laatst | kop):\n"
                  + ('\n'.join(dossier_regels(dossiers, nu)) or '(geen)')
                  + '\n\nNIEUWE BERICHTEN (id | bron (gebied) | taal | tijd UTC | kop — tekst):\n' + '\n'.join(regels))
        try:
            uit = claude(SYSTEM_TRIAGE, prompt, cfg['instellingen']['model_triage'], f'triage{start // batch_groot}')
        except Exception as e:  # noqa: BLE001
            log(f'triage faalde: {e}')
            break
        per_id = {o.get('id'): o for o in uit.get('items', []) if isinstance(o, dict)}
        for it in batch:
            o = per_id.get(it.pop('_tid'))
            if o is None:
                continue  # model sloeg hem over → volgende ronde opnieuw
            it['triage'] = o
            verwerkt.append(it)
        # nieuwe dossiers meteen aanmaken, zodat de volgende batch ze als 'lopend' ziet
        dossiers_bijwerken(items, dossiers, nu, [x for x in batch if x.get('triage')])
    log(f"triage: {len(verwerkt)} van {totaal} wachtende berichten, "
        f"{sum(1 for i in verwerkt if i['triage'].get('r'))} relevant")
    return verwerkt


def schoon_triage(o):
    l = str(o.get('l') or 'XW').upper()[:2]
    if not G.land(l):
        l = 'XW'
    cat = o.get('cat') if o.get('cat') in CATEGORIEEN else 'overig'
    return {'cat': cat, 't': o.get('t') if o.get('t') in TYPES else 'bijzonder',
            's': o.get('s') if o.get('s') in SOORTEN else 'waargenomen', 'l': l,
            'p': (o.get('p') or None), 'g': (o.get('g') or None),
            'b': max(0, min(10, int(o.get('b') or 0))), 'i': max(0, min(10, int(o.get('i') or 0))),
            'v': o.get('v') if o.get('v') in (0, 1) else None}


def dossiers_bijwerken(items, dossiers, nu, nieuw):
    slug_naar_id = {}
    for it in nieuw:
        o = it['triage']
        if not o.get('r'):
            continue
        t = schoon_triage(o)
        it['triage'] = {**o, **t, 'r': 1}
        did = str(o.get('d') or '')
        if did in dossiers:
            d = dossiers[did]
            while d.get('samengevoegd') and d['samengevoegd'] in dossiers:
                d = dossiers[d['samengevoegd']]
        else:
            if did not in slug_naar_id:
                nieuw_id = 'd' + sleutel(did + it['k'])[:9]
                dossiers[nieuw_id] = {'id': nieuw_id, 'slug': did, 'items': [], 'land': t['l'], 'cat': t['cat'],
                                      'type': t['t'], 'soort': t['s'], 'plaats': t['p'], 'regio': t['g'],
                                      'eerste': it['tijd'], 'laatste': it['tijd'], 'aangemaakt': iso(nu),
                                      'voorlopig': it['titel'], 'kop': None, 'herschrijf': True, 'schrijfrondes': 0}
                slug_naar_id[did] = nieuw_id
            d = dossiers[slug_naar_id[did]]
        if it['k'] not in d['items']:
            d['items'].append(it['k'])
            it['dossier'] = d['id']
            d['laatste'] = max(d['laatste'], it['tijd'])
            d['eerste'] = min(d['eerste'], it['tijd'])
            # kenmerken: het belangrijkste bericht bepaalt land/plaats/fenomeen tot de redactie ze vastlegt
            if not d.get('kop') and (t['b'] + t['i']) >= d.get('_max', -1):
                d.update({'land': t['l'], 'cat': t['cat'], 'type': t['t'], 'soort': t['s'],
                          'plaats': t['p'] or d.get('plaats'), 'regio': t['g'] or d.get('regio'),
                          '_max': t['b'] + t['i']})
            d['herschrijf'] = True
            d.setdefault('nieuw_sinds_tekst', 0)
            d['nieuw_sinds_tekst'] += 1


SYSTEM_SAMENVOEG = """Je bent eindredacteur van de Nederlandstalige weernieuwsstroom Wereldweer. Je krijgt de lopende nieuwsdossiers (id | land | fenomeen | plaats/regio | eerste–laatste bericht | kop).
Zoek dossiers die over DEZELFDE gebeurtenis of weersituatie gaan en dus één dossier moeten zijn:
- hetzelfde noodweer in hetzelfde gebied in dezelfde dagen, ook als de ene kop de verwachting, de andere de gevolgen en een derde een detail (een rivier, een dorp, een dodental) beschrijft;
- dezelfde benoemde storm/depressie/cycloon, ook in meerdere landen;
- hetzelfde grootschalige onderwerp in dezelfde week (bv. de verstoring van de poolwervel, een koudegolf over meerdere buurlanden, dezelfde waarschuwing voor mist in één land);
- dezelfde waarschuwing of verwachting van hetzelfde instituut.
NIET samenvoegen: hetzelfde soort weer in verschillende gebieden zonder gemeenschappelijke oorzaak, verschillende gebeurtenissen in hetzelfde land, een rapport/statistiek met een actuele gebeurtenis, klimaatnieuws met weernieuws. Bij twijfel niet samenvoegen.
Geef GEEN uitleg, analyse of tussenstappen. Antwoord ALLEEN met JSON: {"groepen":[["id","id"],["id","id","id"]]} (lege lijst als er niets samen moet)."""


CAT_GROEP = {'storm': 'storm', 'tornado': 'storm', 'depressie': 'storm', 'tropisch': 'storm', 'kust': 'storm',
             'neerslag': 'water', 'overstroming': 'water', 'onweer': 'water', 'hagel': 'water',
             'sneeuw': 'winter', 'ijzel': 'winter', 'lawine': 'winter', 'kou': 'winter', 'mist': 'winter',
             'hitte': 'warm', 'droogte': 'warm', 'brand': 'warm'}


def km(a, b):
    la1, lo1, la2, lo2 = map(math.radians, (a['lat'], a['lon'], b['lat'], b['lon']))
    h = math.sin((la2 - la1) / 2) ** 2 + math.cos(la1) * math.cos(la2) * math.sin((lo2 - lo1) / 2) ** 2
    return 6371 * 2 * math.asin(math.sqrt(h))


STORMNAAM = re.compile(r'\b(?:storm|borrasca|depressie|depressão|depresión|tempête|tempesta|sturmtief|tief|orkaan|'
                       r'hurricane|cyclone|cycloon|typhoon|tyfoon|ouragan|huracán|uragano|tormenta)\s+([A-Z][a-zà-ÿ]{2,})',
                       re.I)


def stormnamen(d, items):
    teksten = [d.get('kop') or '', d.get('voorlopig') or ''] + [items[k].get('titel', '') for k in d['items'][:30] if k in items]
    return {m[1].lower() for t in teksten for m in STORMNAAM.finditer(t) if m[1][0].isupper()}


def mag_samen(doel, d, items=None):
    """Vangrail tegen te gretig samenvoegen: afstand en soort weer moeten kloppen.

    Uitzonderingen: dezelfde stormnaam (Bruna op de Canarische Eilanden én in Andalusië) en grootschalige
    onderwerpen (poolwervel, klimaat, records) die per definitie meerdere landen beslaan.
    """
    if items is not None and stormnamen(doel, items) & stormnamen(d, items):
        return True
    vrij = {'circulatie', 'klimaat', 'record'}
    if doel['cat'] in vrij and d['cat'] in vrij | {'kou', 'hitte'} or d['cat'] in vrij and doel['cat'] in vrij | {'kou', 'hitte'}:
        return True
    g1, g2 = G.zoek(doel['land'], doel.get('plaats'), doel.get('regio')), G.zoek(d['land'], d.get('plaats'), d.get('regio'))
    afstand = km(g1, g2) if g1 and g2 and g1.get('lat') is not None and g2.get('lat') is not None else 0
    if doel['land'] == d['land']:
        return afstand <= 1500
    zelfde = CAT_GROEP.get(doel['cat'], doel['cat']) == CAT_GROEP.get(d['cat'], d['cat'])
    return afstand <= 1200 and zelfde


def samenvoegen(items, dossiers, nu, cfg):
    actief = [d for d in dossiers.values() if not d.get('samengevoegd') and not d.get('irrelevant')
              and dt(d['laatste']) > nu - timedelta(days=4)]
    if len(actief) < 2:
        return 0
    actief.sort(key=lambda d: d['laatste'], reverse=True)
    regels = [f"{d['id']} | {d['land']} | {d['cat']} | {d.get('plaats') or '-'} / {d.get('regio') or '-'} | "
              f"{d['eerste'][5:13]}–{d['laatste'][5:13]} | {(d.get('kop') or d.get('voorlopig') or '')[:120]}"
              for d in actief[:220]]
    try:
        uit = claude(SYSTEM_SAMENVOEG, 'LOPENDE DOSSIERS:\n' + '\n'.join(regels), cfg['instellingen']['model_schrijver'],
                     'samenvoeg')
    except Exception as e:  # noqa: BLE001
        log(f'samenvoegen faalde: {e}')
        return 0
    n = 0
    for groep in uit.get('groepen') or []:
        ds = [dossiers[g] for g in groep if g in dossiers and not dossiers[g].get('samengevoegd')]
        if len(ds) < 2:
            continue
        # doel = een dossier dat al een Nederlandse tekst heeft (anders verdwijnt het tot de volgende redactie)
        ds.sort(key=lambda d: (d.get('kop') is None, -len(d['items']), d['eerste']))
        doel = ds[0]
        ds = [doel] + [d for d in ds[1:] if mag_samen(doel, d, items)]
        for d in ds[1:]:
            for k in d['items']:
                if k not in doel['items']:
                    doel['items'].append(k)
                    if k in items:
                        items[k]['dossier'] = doel['id']
            doel['eerste'] = min(doel['eerste'], d['eerste'])
            doel['laatste'] = max(doel['laatste'], d['laatste'])
            d.update({'samengevoegd': doel['id'], 'items': [], 'herschrijf': False})
            n += 1
        doel['herschrijf'] = True
        doel['schrijfrondes'] = min(doel.get('schrijfrondes', 0), 2)
    log(f'samenvoegen: {n} dossiers opgegaan in een ander')
    return n


# ---------------------------------------------------------------- 5. redactie

SYSTEM_SCHRIJF = f"""Je bent weerredacteur van Weerlab.nl en schrijft de nieuwsstroom "Wereldweer": korte, feitelijke Nederlandstalige nieuwsberichten over actueel weer in Europa en de wereld, voor een breed publiek van weerliefhebbers.

Je krijgt per DOSSIER alle bronberichten (originele kop, taal, medium, tijd) en soms de tekst van een of twee artikelen. Schrijf per dossier één bericht.

Harde regels (correctheid gaat voor alles):
- Gebruik UITSLUITEND informatie uit de aangeleverde bronnen. Verzin geen getallen, plaatsen, tijden, oorzaken, schade of slachtoffers. Staat iets niet in de bron, dan laat je het weg.
- Elk getal dat je noemt staat in de bron (eenheden omrekenen mag: mph→km/u ×1,609; knopen→km/u ×1,852; inch→mm ×25,4; ft→m ×0,3048; °F→°C). Rond niet op tot een mooier getal.
- Houd waarneming, verwachting en waarschuwing strikt uit elkaar: "is gevallen/gemeten" alleen bij een waarneming; "verwacht", "kan", "volgens de verwachting" bij een verwachting; "het weerinstituut heeft code oranje afgegeven" bij een waarschuwing. Een waarschuwing is geen gebeurtenis.
- Onbevestigd (sociale media, 'naar verluidt', alleen één niet-officiële bron bij een opvallende claim): schrijf dat expliciet ("volgens lokale media", "nog niet officieel bevestigd").
- Spreken bronnen elkaar tegen (aantallen doden, windsnelheden), noem dan beide en zet "tegenstrijdig" op een korte uitleg.
- Records: alleen "record" als de bron het een record noemt; officieel bevestigd alleen als een instituut dat zegt.
- Tijden: met dag en tijdzone ("zaterdagmiddag", "vrijdag 18 uur UTC"); meetperiode bij hoeveelheden ("in 24 uur", "sinds zondag").

Stijl:
- Natuurlijk, journalistiek Nederlands op het niveau van een KNMI-bericht of NOS-weerbericht. Geen letterlijke vertaling, geen germanismen of anglicismen ("zware regenval", niet "heftige regenval"; "windstoten", niet "windvlagen" voor gusts; "noodweer", "wateroverlast").
- Gebruik "verwachting" (niet voorspelling) en "neerslag" waar het om de meteorologische grootheid gaat.
- Kop: kort en krachtig, max 85 tekens, met plaats of land, geen vraag, geen uitroepteken, geen sensatie ("chaos", "apocalyptisch" alleen als citaat). Begin met het nieuws, niet met het land.
- Samenvatting: 2 à 3 zinnen, max 420 tekens: wat, waar, wanneer, hoeveel, gevolgen. Eerste zin = de kern.
- details: 0-4 korte losse feiten die niet al in de samenvatting staan (elk één zin, uit de bron).
- cijfers: 0-4 kerncijfers die echt in de bron staan: {{"waarde":"110","eenheid":"km/u","wat":"zwaarste windstoot","waar":"Cap Corse","periode":"zaterdag"}}. Geen cijfers bij twijfel.
- duiding: hoogstens 2 zinnen meteorologische context, ALLEEN als de bron de oorzaak of situatie noemt (bv. "een diepe depressie boven de Golf van Biskaje"); anders null.
- plaats/regio: zoals de bron (Nederlandse spelling als die gangbaar is), land als ISO2.

Antwoord ALLEEN met JSON:
{{"dossiers":[{{"id":"…","kop":"…","samenvatting":"…","details":["…"],"cijfers":[],"duiding":null,"soort":"{'|'.join(SOORTEN)}","type":"{'|'.join(TYPES)}","cat":"…","land":"..","plaats":null,"regio":null,"bevestigd":true,"tegenstrijdig":null,"relevant":true}}]}}
Zet "relevant": false als het dossier bij nader inzien geen weernieuws is (dan mag de rest leeg)."""


def haal_tekst(it):
    try:
        url = F.resolve_gn(it['url']) if 'news.google.com' in it['url'] else it['url']
        it['url_echt'] = url
        return F.artikeltekst(url, n=2600)
    except Exception as e:  # noqa: BLE001
        return ''


def bron_blok(d, items):
    """Bronberichten van een dossier (nieuwste eerst, max 12) + de tekst van de twee beste artikelen."""
    its = sorted((items[k] for k in d['items'] if k in items), key=lambda i: (
        -B.BRONNEN.get(i['bron'], {}).get('betrouwbaarheid', .5), i['tijd']), reverse=False)
    its = sorted(its, key=lambda i: i['tijd'], reverse=True)[:12]
    beste = sorted(its, key=lambda i: (-B.BRONNEN.get(i['bron'], {}).get('betrouwbaarheid', .5)
                                       - (0.2 if B.STERKE_MEDIA.search(i['outlet'] or '') else 0)))[:2]
    return its, beste


def schrijf_dossiers(items, dossiers, nu, cfg, bulk):
    max_n = cfg['instellingen']['max_schrijf'] * (3 if bulk else 1)
    kand = [d for d in dossiers.values() if d.get('herschrijf') and not d.get('samengevoegd')
            and d['id'] not in cfg['geblokkeerd'] and d.get('schrijfrondes', 0) < cfg['instellingen']['max_herschrijf_per_dossier']
            and dt(d['laatste']) > nu - timedelta(days=VENSTER_DAGEN)]
    if not kand:
        return 0
    # eerst wat het meest oplevert: zonder tekst, Europees, belangrijk, recent
    def prio(d):
        its = [items[k]['triage'] for k in d['items'] if k in items and items[k].get('triage')]
        b = max((t.get('b', 0) + t.get('i', 0) for t in its), default=0)
        return (d.get('kop') is None, G.groepen(d['land'])[0] == 'europa', b + min(len(d['items']), 5), d['laatste'])
    kand.sort(key=prio, reverse=True)
    eu_k = [d for d in kand if G.groepen(d['land'])[0] == 'europa']
    w_k = [d for d in kand if G.groepen(d['land'])[0] != 'europa']
    n_w = min(len(w_k), max(round(max_n * 0.3), max_n - len(eu_k)))
    kand = eu_k[:max_n - n_w] + w_k[:n_w]
    # artikelteksten parallel ophalen
    taken = {}
    for d in kand:
        its, beste = bron_blok(d, items)
        d['_its'], d['_beste'] = its, beste
        for it in beste:
            if not it.get('volledig'):
                taken[it['k']] = it
    with ThreadPoolExecutor(8) as ex:
        for k, tekst in zip(taken, ex.map(haal_tekst, taken.values())):
            if tekst:
                items[k]['volledig'] = tekst
    geschreven = 0
    for start in range(0, len(kand), 6):
        groep = kand[start:start + 6]
        blokken, bronteksten = [], {}
        for d in groep:
            regels = [f"- [{it['taal']}] {it['outlet']} ({B.BRONNEN.get(it['bron'], {}).get('soort', '?')}, "
                      f"{it['tijd'][:16]} UTC): {it['titel']}" + (f" — {it['tekst'][:300]}" if it['tekst'] else '')
                      for it in d['_its']]
            teksten = [f"ARTIKEL {it['outlet']}:\n{it['volledig']}" for it in d['_beste'] if it.get('volledig')]
            vorige = f"\nEerdere versie (alleen bijwerken als er nieuwe feiten zijn): {d['kop']} — {d.get('samenvatting', '')}" \
                if d.get('kop') else ''
            fb = f"\nLet op, vorige versie afgekeurd: {d['_afkeur']}" if d.get('_afkeur') else ''
            blokken.append(f"=== DOSSIER {d['id']} (triage: {d['land']}, {d['cat']}, {d['soort']}){vorige}{fb}\n"
                           + '\n'.join(regels) + ('\n\n' + '\n\n'.join(teksten) if teksten else ''))
            bronteksten[d['id']] = '\n'.join(regels + teksten)
        prompt = f"Nu: {nu:%A %d %B %Y %H:%M} UTC (Nederlandse tijd {nu.astimezone(TZ):%H:%M}).\n\n" + '\n\n'.join(blokken)
        try:
            uit = claude(SYSTEM_SCHRIJF, prompt, cfg['instellingen']['model_schrijver'], f'schrijf{start // 6}')
        except Exception as e:  # noqa: BLE001
            log(f'redactie faalde: {e}')
            break
        per_id = {o.get('id'): o for o in uit.get('dossiers', []) if isinstance(o, dict)}
        for d in groep:
            o = per_id.get(d['id'])
            d.pop('_its', None)
            d.pop('_beste', None)
            d['schrijfrondes'] = d.get('schrijfrondes', 0) + 1
            if not o:
                continue
            if o.get('relevant') is False:
                d.update({'herschrijf': False, 'irrelevant': True})
                continue
            probleem, o = cijfercontrole(o, bronteksten[d['id']])
            if probleem and d.get('_afkeur') is None and d['schrijfrondes'] < 2:
                d['_afkeur'] = probleem  # één herkansing in de volgende ronde, met de reden erbij
                continue
            schrijf_in(d, o, nu, probleem)
            (WORK / 'bronteksten').mkdir(parents=True, exist_ok=True)
            (WORK / 'bronteksten' / f"{d['id']}.txt").write_text(bronteksten[d['id']])
            geschreven += 1
    log(f'redactie: {geschreven} van {len(kand)} dossiers geschreven')
    return geschreven


def schrijf_in(d, o, nu, probleem):
    land_ = str(o.get('land') or d['land']).upper()[:2]
    d.update({
        'kop': str(o.get('kop') or '')[:120], 'samenvatting': str(o.get('samenvatting') or '')[:600],
        'details': [str(x)[:240] for x in (o.get('details') or [])][:4], 'cijfers': (o.get('cijfers') or [])[:4],
        'duiding': (str(o['duiding'])[:400] if o.get('duiding') else None),
        'soort': o.get('soort') if o.get('soort') in SOORTEN else d['soort'],
        'type': o.get('type') if o.get('type') in TYPES else d['type'],
        'cat': o.get('cat') if o.get('cat') in CATEGORIEEN else d['cat'],
        'land': land_ if G.land(land_) else d['land'], 'plaats': o.get('plaats') or d.get('plaats'),
        'regio': o.get('regio') or d.get('regio'), 'bevestigd': bool(o.get('bevestigd')),
        'tegenstrijdig': o.get('tegenstrijdig') or None, 'inhoud_bijgewerkt': iso(nu),
        'cijferprobleem': probleem, 'herschrijf': False, 'nieuw_sinds_tekst': 0,
    })
    d.pop('_afkeur', None)
    if not d.get('tekst_eerst'):
        d['tekst_eerst'] = iso(nu)


# ---- cijfercontrole zonder taalmodel

GETAL = re.compile(r'(?<![\w.,])[−-]?\d{1,3}(?:[.\s]\d{3})+(?:,\d+)?(?![\d])|(?<![\w.,])[−-]?\d+(?:[.,]\d+)?(?![\d])')
MAANDEN_RE = r'(januari|februari|maart|april|mei|juni|juli|augustus|september|oktober|november|december)'


def getallen(tekst, nl=True):
    uit = []
    for m in GETAL.finditer(tekst or ''):
        s = m[0].replace('−', '-')
        if nl:
            s = re.sub(r'(?<=\d)[.\s](?=\d{3}\b)', '', s).replace(',', '.')
        else:
            s = re.sub(r'(?<=\d)[,\s](?=\d{3}\b)', '', s)
            s = s.replace(',', '.') if re.match(r'^-?\d+,\d{1,2}$', s) else s
        try:
            uit.append((float(s), m.start(), m.end()))
        except ValueError:
            pass
    return uit


FACTOREN = {  # eenheid in de Nederlandse tekst → toegestane omrekeningen vanuit de bron
    'km/u': (1, 1.609344, 1.852, 3.6), 'mm': (1, 25.4, 10), 'cm': (1, 2.54, 0.1), 'm': (1, 0.3048),
    'km': (1, 1.609344, 1.852), 'hpa': (1, 33.8639), 'ha': (1, 0.4047, 100), 'km2': (1, 2.59),
    'kg': (1, 0.4536),
}
EENHEID = re.compile(r'\s*(km/u|km/h|mm|cm|m\b|meter|km\b|kilometer|hpa|ha\b|hectare|km²|km2|kg|°\s*c|graden)', re.I)


def eenheid(tekst, eind):
    m = EENHEID.match(tekst, eind)
    if not m:
        return None
    u = m[1].lower().replace(' ', '')
    return {'km/h': 'km/u', 'meter': 'm', 'kilometer': 'km', 'hectare': 'ha', 'km²': 'km2', 'graden': '°c'}.get(u, u)


def bron_getallen(tekst):
    vals = set()
    for nl in (True, False):
        vals |= {abs(v) for v, *_ in getallen(tekst, nl=nl)}
        vals |= {v for v, *_ in getallen(tekst, nl=nl)}
    return vals


def klopt(v, bron, u=None):
    if abs(v) <= 12 and v == int(v) and u is None:
        return True  # kleine telwoorden/dagen: vaak anders geschreven ("twee", "zondag 9 nov.") → niet toetsbaar
    if u == '°c':
        kand = {b for b in bron} | {(b - 32) * 5 / 9 for b in bron} | {b * 5 / 9 for b in bron}
        return any(abs(v - c) <= 0.6 or abs(abs(v) - abs(c)) <= 0.6 for c in kand)
    for f in FACTOREN.get(u, (1,)):
        if any(abs(abs(v) - abs(b) * f) <= max(0.025 * abs(b) * f, 0.6) for b in bron):
            return True
    return False


def cijfercontrole(o, brontekst):
    """Elk getal in kop/samenvatting/details moet (na omrekening) in de bron staan; foute kerncijfers vervallen."""
    bron = bron_getallen(brontekst)
    fout = []
    for veld in ('kop', 'samenvatting'):
        tekst = str(o.get(veld) or '')
        for v, a, b in getallen(tekst):
            ctx = tekst[max(0, a - 1):b + 14]
            if re.match(r'^\D?\d+\s*' + MAANDEN_RE, ctx[1:] if not ctx[0].isdigit() else ctx) or \
                    re.match(r'\d{1,2}[:.]\d{2}(?!\d)', tekst[a:b + 3]) or re.search(r'\d[:.]$', tekst[max(0, a - 3):a]) \
                    or 1900 <= v <= 2100:
                continue  # datum, kloktijd (22:00, 14.50 uur) of jaartal
            if abs(v) <= 12 and v == int(v):
                continue  # kleine gehele getallen ('4 meter', 'twee doden') zijn vaak als woord geschreven
            if not klopt(v, bron, eenheid(tekst, b)):
                fout.append(f'{veld}: {tekst[max(0, a - 25):b + 15]!r}')
    o['details'] = [x for x in (o.get('details') or [])
                    if all(klopt(v, bron, eenheid(str(x), e)) or 1900 <= v <= 2100 for v, _, e in getallen(str(x)))]
    goed = []
    for c in o.get('cijfers') or []:
        try:
            v = getallen(str(c.get('waarde')))[0][0]
        except (IndexError, AttributeError):
            continue
        u = str(c.get('eenheid') or '').strip().lower().replace('km/h', 'km/u').replace('graden', '°c').replace(' ', '')
        if klopt(v, bron, u or None):
            goed.append({k: str(c.get(k) or '')[:60] for k in ('waarde', 'eenheid', 'wat', 'waar', 'periode')})
    o['cijfers'] = goed
    return ('; '.join(fout)[:400] or None), o


# ---------------------------------------------------------------- 6. selectie en score

def score(d, its, nu, waarsch):
    """Transparante score 0–100 met de onderdelen erbij (getoond in het detailvenster)."""
    tri = [i['triage'] for i in its if i.get('triage')]
    b = max((t.get('b', 0) for t in tri), default=0)
    imp = max((t.get('i', 0) for t in tri), default=0)
    uren = (nu - dt(d['laatste'])).total_seconds() / 3600
    officieel = any(B.BRONNEN.get(i['bron'], {}).get('soort') in ('instituut', 'organisatie')
                    or B.INSTITUUT_NAAM.search(i.get('outlet') or '') for i in its)
    outlets = {outlet_sleutel(i['outlet']) for i in its} | {outlet_sleutel(o.get('outlet')) for i in its for o in i.get('ook', [])}
    outlets.discard('')
    betr = max((B.BRONNEN.get(i['bron'], {}).get('betrouwbaarheid', .5)
                + (0.15 if B.STERKE_MEDIA.search(i.get('outlet') or '') else 0) for i in its), default=.5)
    europa = G.groepen(d['land'])[0] == 'europa'
    eerst_uren = (nu - dt(d['eerste'])).total_seconds() / 3600
    delen = {
        'actualiteit': round(20 * math.exp(-max(uren, 0) / 30), 1),
        'bijzonderheid': round(2.6 * b, 1),
        'impact': round(2.0 * imp, 1),
        'betrouwbaarheid': round(10 * min(betr, 1.0), 1),
        'bevestiging': round(min(len(outlets), 4) / 4 * 7 + (3 if officieel or d.get('bevestigd') else 0), 1),
        'geografie': 8 if europa else 3,
        'nieuwheid': round(6 * math.exp(-max(eerst_uren, 0) / 24), 1),
    }
    if waarsch:
        delen['waarschuwing'] = 4 if waarsch['ernst'] >= 3 else 2 if waarsch['ernst'] == 2 else 0
    s = sum(delen.values())
    if d.get('verificatie'):
        delen['verificatie'] = -15
        s -= 15
    return round(max(0, min(100, s)), 1), delen, outlets, officieel


def passende_waarschuwing(d, w_data, nu):
    """Officiële waarschuwing in hetzelfde land voor hetzelfde fenomeen die nu geldt of nog komt."""
    l = (w_data.get('landen') or {}).get(d['land'])
    if not l:
        return None
    cats = {d['cat']} | ({'storm'} if d['cat'] in ('storm', 'depressie', 'tropisch') else set()) \
        | ({'neerslag', 'overstroming'} if d['cat'] in ('neerslag', 'overstroming') else set()) \
        | ({'sneeuw'} if d['cat'] in ('sneeuw', 'ijzel', 'lawine') else set())
    ws = [w for w in l['waarschuwingen'] if w['cat'] in cats and w['ernst'] >= 2]
    if not ws:
        return None
    top = max(w['ernst'] for w in ws)
    w0 = next(w for w in ws if w['ernst'] == top)
    return {'kleur': w0['kleur'], 'ernst': top, 'gevaar': w0['gevaar'], 'n': sum(1 for w in ws if w['ernst'] == top),
            'betekenis': w0['betekenis']}


def selectie(items, dossiers, nu, cfg, w_data, status, gdacs=()):
    uit = []
    for d in dossiers.values():
        if not d.get('kop') or d.get('irrelevant') or d.get('samengevoegd') or d['id'] in cfg['geblokkeerd']:
            continue
        if dt(d['laatste']) < nu - timedelta(days=VENSTER_DAGEN):
            continue
        its = sorted((items[k] for k in d['items'] if k in items), key=lambda i: i['tijd'], reverse=True)
        if not its:
            continue
        verif = []
        tri = [i['triage'] for i in its if i.get('triage')]
        if d.get('cijferprobleem'):
            verif.append('getal niet in de bron teruggevonden')
        officieel = any(B.BRONNEN.get(i['bron'], {}).get('soort') in ('instituut', 'organisatie') for i in its)
        if any(t.get('v') == 0 for t in tri) and not any(t.get('v') == 1 for t in tri) and not officieel:
            verif.append('onbevestigd volgens de bron')
        n_outlets = len({outlet_sleutel(i['outlet']) for i in its})
        if n_outlets == 1 and not officieel and max((t.get('b', 0) for t in tri), default=0) >= 8 \
                and not B.STERKE_MEDIA.search(its[0]['outlet'] or ''):
            verif.append('opvallende claim uit één bron')
        d['verificatie'] = None if d['id'] in cfg['goedgekeurd'] else ('; '.join(verif) or None)
        w = passende_waarschuwing(d, w_data, nu)
        s, delen, outlets, offic = score(d, its, nu, w)
        vast = d['id'] in cfg['vastgezet']
        geo = G.zoek(d['land'], d.get('plaats'), d.get('regio'))
        land_ = G.land(d['land']) or {}
        bronnen = []
        for i in its[:14]:
            bb = B.BRONNEN.get(i['bron'], {})
            bronnen.append({'naam': i['outlet'], 'via': bb.get('naam') if bb.get('soort') == 'aggregator' else None,
                            'url': i.get('url_echt') or i['url'], 'titel': i['titel'], 'taal': i['taal'],
                            'tijd': i['tijd'], 'soort': bb.get('soort'),
                            'officieel': bb.get('soort') in ('instituut', 'organisatie')
                            or bool(B.INSTITUUT_NAAM.search(i['outlet'] or ''))})
        uit.append({
            'id': d['id'], 'kop': d['kop'], 'samenvatting': d.get('samenvatting'), 'details': d.get('details') or [],
            'cijfers': d.get('cijfers') or [], 'duiding': d.get('duiding'), 'soort': d['soort'], 'type': d['type'],
            'cat': d['cat'], 'land': d['land'], 'land_nl': land_.get('nl', d['land']), 'plaats': d.get('plaats'),
            'regio': d.get('regio'), 'geo': geo, 'groepen': G.groepen(d['land'], geo and geo['lat'], geo and geo['lon']),
            'score': 100 + s if vast else s, 'score_delen': delen, 'eerste': d['eerste'], 'laatste_bron': d['laatste'],
            'inhoud_bijgewerkt': d.get('inhoud_bijgewerkt'), 'tekst_eerst': d.get('tekst_eerst'),
            'bronnen': bronnen, 'n_berichten': len(its), 'n_media': len(outlets), 'officieel': offic,
            'bevestigd': d.get('bevestigd'), 'tegenstrijdig': d.get('tegenstrijdig'), 'verificatie': d['verificatie'],
            'vastgezet': vast, 'uitgelicht': d['id'] in cfg['uitgelicht'], 'waarschuwing': w,
        })
    uit.sort(key=lambda x: -x['score'])
    editie = None
    ix = lees(EDITIES / 'index.json', {})
    if ix.get('edities'):
        laatste = sorted(ix['edities'])[-1]
        e = lees(EDITIES / f'editie_{laatste}.json', {})
        editie = {'datum': laatste, 'artikelen': [{'id': a['id'], 'kop': a['kop'], 'land': a.get('land'),
                                                   'categorie': a.get('categorie'), 'status': a.get('status')}
                                                  for a in e.get('artikelen', [])]}
    vb = lees(DATA / 'vooruitblik.json', None)
    ok = sum(1 for bid in B.BRONNEN if status.get(bid, {}).get('ok') and not status[bid].get('fout'))
    data = {'schema': 1, 'gemaakt': iso(nu), 'venster_uren': {'standaard': 72, 'ruim': 24 * VENSTER_DAGEN},
            'dossiers': uit, 'editie': editie, 'gdacs': list(gdacs),
            'alias': {d['id']: d['samengevoegd'] for d in dossiers.values() if d.get('samengevoegd')},
            'geblokkeerd': [{'id': d['id'], 'kop': d.get('kop') or d.get('voorlopig'), 'land': d['land']}
                            for d in dossiers.values() if d['id'] in cfg['geblokkeerd']],
            'vooruitblik': {'gemaakt': vb.get('gemaakt'), 'run': vb.get('run')} if vb else None,
            'bronnen': {'totaal': len(B.BRONNEN), 'werkend': ok,
                        'landen': len({b['land'] for b in B.BRONNEN.values() if b['land']})}}
    schrijf(DATA / 'stroom.json', data, compact=True)
    eur = sum(1 for x in uit if x['groepen'][0] == 'europa' and dt(x['laatste_bron']) > nu - timedelta(hours=72))
    log(f'selectie: {len(uit)} dossiers ({eur} Europa ≤72 u), {sum(1 for x in uit if x["verificatie"])} in verificatie')
    return data


def bronstatus_publiek(status, items, nu):
    per_bron = {}
    for it in items.values():
        p = per_bron.setdefault(it['bron'], {'relevant': 0, 'berichten': 0})
        p['berichten'] += 1
        if (it.get('triage') or {}).get('r'):
            p['relevant'] += 1
    cfg = beheer()
    rijen = []
    for bid, b in B.BRONNEN.items():
        st = status.get(bid, {})
        over = cfg['bronnen'].get(bid, {})
        rijen.append({'id': bid, 'naam': b['naam'], 'land': b['land'], 'soort': b['soort'], 'taal': b['taal'],
                      'interval': over.get('interval') or b['interval'], 'actief': over.get('actief', True),
                      'betrouwbaarheid': b['betrouwbaarheid'], 'url': b['url'] if b['soort'] != 'aggregator' else None,
                      'ok': st.get('ok'), 'geprobeerd': st.get('geprobeerd'), 'fout': st.get('fout'),
                      'fouten_op_rij': st.get('fouten_op_rij', 0), 'in_feed': st.get('in_feed'),
                      'nieuw_totaal': st.get('nieuw_totaal', 0), 'dubbel_totaal': st.get('dubbel_totaal', 0),
                      'nieuwste_item': st.get('nieuwste_item'), **per_bron.get(bid, {'relevant': 0, 'berichten': 0})})
    ma = status.get('meteoalarm', {})
    rijen.append({'id': 'meteoalarm', 'naam': 'Meteoalarm (38 landen)', 'land': None, 'soort': 'waarschuwingen',
                  'taal': 'en', 'interval': 10, 'actief': True, 'betrouwbaarheid': 1.0,
                  'url': 'https://feeds.meteoalarm.org/', 'ok': ma.get('ok'), 'geprobeerd': ma.get('geprobeerd'),
                  'fout': ma.get('fout'), 'fouten_op_rij': ma.get('fouten_op_rij', 0), 'in_feed': ma.get('in_feed'),
                  'nieuw_totaal': 0, 'dubbel_totaal': 0, 'nieuwste_item': ma.get('ok'), 'relevant': 0, 'berichten': 0})
    gd = status.get('gdacs', {})
    rijen.append({'id': 'gdacs', 'naam': 'GDACS (VN/EU-rampenalarm)', 'land': None, 'soort': 'rampen', 'taal': 'en',
                  'interval': 30, 'actief': True, 'betrouwbaarheid': 0.95, 'url': F.GDACS, 'ok': gd.get('ok'),
                  'geprobeerd': gd.get('geprobeerd'), 'fout': gd.get('fout'), 'fouten_op_rij': gd.get('fouten_op_rij', 0),
                  'in_feed': gd.get('in_feed'), 'nieuw_totaal': 0, 'dubbel_totaal': 0, 'nieuwste_item': gd.get('ok'),
                  'relevant': 0, 'berichten': 0})
    schrijf(DATA / 'bronstatus.json', {'gemaakt': iso(nu), 'bronnen': rijen,
                                       'llm': status.get('_llm', {})}, compact=True)


def opruimen(items, dossiers, nu):
    grens = iso(nu - timedelta(days=BEWAAR_DAGEN))
    for k in [k for k, it in items.items() if it['tijd'] < grens]:
        del items[k]
    for k in [k for k, d in dossiers.items() if d['laatste'] < grens]:
        del dossiers[k]
    for d in dossiers.values():
        d['items'] = [k for k in d['items'] if k in items]
    # niet-relevante berichten: alleen bewaren wat de ontdubbeling en de bronstatistiek nodig hebben
    for it in items.values():
        if (it.get('triage') or {}).get('r') == 0 and 'titel' in it:
            for veld in ('titel', 'tekst', 'outlet', 'url', 'ook', 'gebied', 'taal', 'datum_geschat', 'volledig'):
                it.pop(veld, None)


def publiceer():
    if not PUBLICEER:
        return
    res = subprocess.run([RCLONE, 'copy', str(DATA), R2_DOEL, '--include', '{stroom,waarschuwingen,bronstatus,vooruitblik}.json',
                          '--header-upload', 'Cache-Control: public, max-age=60'], capture_output=True, text=True, timeout=180)
    if res.returncode != 0:
        raise RuntimeError('R2-upload faalde: ' + res.stderr[-300:])


# ---------------------------------------------------------------- hoofdlijn

def model_aan_de_beurt(status, cfg, nu):
    llm = status.setdefault('_llm', {})
    uur = nu.astimezone(TZ).hour
    interval = cfg['instellingen']['llm_interval_dag'] if 7 <= uur < 23 else cfg['instellingen']['llm_interval_nacht']
    laatst = dt(llm.get('laatst'))
    return laatst is None or nu - laatst >= timedelta(minutes=interval) - timedelta(seconds=40)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--alles', action='store_true', help='alle bronnen nu ophalen')
    ap.add_argument('--geen-model', action='store_true')
    ap.add_argument('--bulk', action='store_true')
    ap.add_argument('--model-nu', action='store_true', help='modelronde ongeacht interval')
    ap.add_argument('--alleen-selectie', action='store_true', help='na een beheerwijziging: alleen selectie + publicatie')
    args = ap.parse_args()
    nu = datetime.now(timezone.utc).replace(microsecond=0)
    if args.alleen_selectie:  # leest alleen; schrijft stroom/bronstatus (atomair), botst niet met een lopende run
        items, dossiers = lees(DATA / 'items.json', {}), lees(DATA / 'dossiers.json', {})
        status = lees(DATA / 'bronstatus_intern.json', {})
        selectie(items, dossiers, nu, beheer(), lees(DATA / 'waarschuwingen.json', {'landen': {}}), status,
                 lees(DATA / 'gdacs.json', []))
        bronstatus_publiek(status, items, nu)
        publiceer()
        return
    lock = WORK / '.lock'
    WORK.mkdir(parents=True, exist_ok=True)
    if lock.exists() and time.time() - lock.stat().st_mtime < 25 * 60:
        log('vorige run loopt nog, overgeslagen')
        return
    lock.write_text(str(os.getpid()))
    try:
        cfg = beheer()
        items = lees(DATA / 'items.json', {})
        dossiers = lees(DATA / 'dossiers.json', {})
        status = lees(DATA / 'bronstatus_intern.json', {})
        stappen = []
        try:
            ingestie(nu, cfg, args.alles, items, status)
        except Exception as e:  # noqa: BLE001
            stappen.append(f'ingestie: {e}')
        try:
            w_data = waarschuwingen(nu, status, args.alles)
        except Exception as e:  # noqa: BLE001
            stappen.append(f'waarschuwingen: {e}')
            w_data = lees(DATA / 'waarschuwingen.json', {'landen': {}})
        try:
            gdacs = rampen(nu, status, args.alles)
        except Exception as e:  # noqa: BLE001
            stappen.append(f'gdacs: {e}')
            gdacs = []
        if not args.geen_model and (args.model_nu or args.bulk or model_aan_de_beurt(status, cfg, nu)):
            status.setdefault('_llm', {})['laatst'] = iso(nu)
            try:
                voor = len(dossiers)
                triage(items, dossiers, nu, cfg, args.bulk)
                n = schrijf_dossiers(items, dossiers, nu, cfg, args.bulk)
                if len(dossiers) > voor or args.bulk or n:
                    samenvoegen(items, dossiers, nu, cfg)  # na de redactie: Nederlandse koppen vergelijken
                status['_llm'].update({'ok': iso(datetime.now(timezone.utc)), 'fout': None, 'geschreven': n})
            except Exception as e:  # noqa: BLE001
                status['_llm']['fout'] = str(e)[:200]
                stappen.append(f'model: {e}')
        opruimen(items, dossiers, nu)
        schrijf(DATA / 'items.json', items, compact=True)
        schrijf(DATA / 'dossiers.json', dossiers, compact=True)
        schrijf(DATA / 'bronstatus_intern.json', status)
        selectie(items, dossiers, nu, beheer(), w_data, status, gdacs)
        bronstatus_publiek(status, items, nu)
        try:
            publiceer()
        except Exception as e:  # noqa: BLE001
            stappen.append(f'publicatie: {e}')
        for s in stappen:
            log('FOUT ' + s[:300])
    finally:
        lock.unlink(missing_ok=True)


if __name__ == '__main__':
    main()
