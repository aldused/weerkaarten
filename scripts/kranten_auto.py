#!/usr/bin/env python3
"""Goedkope automatische krantenredactie (vervangt de Codex-heartbeat).

Elk uur 08-12 via launchd. Stappen:
1. `kranten_update.py fetch` (geen taalmodel).
2. Stop als de bruikbare bronpassages (morgen en verder) al verwerkt zijn.
3. Anders één kale `claude -p` (Sonnet, geen tools, lege context) die de
   kandidaat-JSON schrijft; bij een validatiefout één herkansing.
4. validate → publish → shell/kranten_publish.sh.
"""
import hashlib
import json
import os
import re
import subprocess
import sys
from datetime import datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / 'data'
WORK = ROOT.parent / 'artifacts' / 'kranten-demo'
STATE = WORK / 'auto_state.json'
TZ = ZoneInfo('Europe/Amsterdam')
MODEL = os.environ.get('KRANTEN_MODEL', 'sonnet')
MAX_EDITIONS_PER_DAY = 3
ALERT_HOUR = 10
DAYS = 'maandag dinsdag woensdag donderdag vrijdag zaterdag zondag'.split()
MONTHS = 'januari februari maart april mei juni juli augustus september oktober november december'.split()

SYSTEM = """Je bent weerredacteur en schrijft landelijke weerberichten voor Nederlandse kranten.
Antwoord uitsluitend met één JSON-object, zonder uitleg en zonder codeblok.

Tijdlijn: de bronpassage die met 'Morgen' begint is in de krant VANDAAG. De dag daarna heet in de krant MORGEN. Noem latere dagen bij hun weekdag. Gebruik nooit 'overmorgen'. Het weer van de schrijfdag en de nacht ervoor komt niet voor.

Vijf versies, allemaal over heel Nederland (ook Parool):
- vk_kort: MAXIMAAL 30 woorden (mik op 28-30), titel 1-5 woorden, weer en temperatuur voor krant-vandaag én het woord 'morgen' met het weer van de volgende dag.
- vk_lang: 185-200 woorden (harde grens 167-203), GEEN titel (lege string).
- trouw: 1.000-1.090 karakters inclusief spaties (harde grens 900-1.100), titel 1-5 woorden.
- parool: 100-108 woorden (harde grens 90-110), titel 1-5 woorden.
- ad: 100-108 woorden (harde grens 90-110), titel 1-5 woorden.
Titels en auteursnaam tellen niet mee. Alinea's scheiden met \\n\\n. Elke tekst eindigt met een punt.

Inhoud: alleen feiten uit de bron. Geen verzonnen temperaturen, wind, tijdstippen, oorzaken of waarschuwingen. Behoud onzekerheden en regionale verschillen. Bouw chronologisch op: vandaag, morgen, de dagen erna.

Stijl: helder krantennederlands, informeel en menselijk, als een weerman die de lezer direct aanspreekt. Concreet en actief. Wissel korte en langere zinnen af, varieer zinsopeningen en woordkeuze. Geen clichés, geen droge opsomming, geen sensatie, geen vakjargon, geen ambtelijke taal, geen 'voorts'/'derhalve'/'desalniettemin'. Een tekst hoeft niet met 'Vandaag' te beginnen. Een praktische zin (paraplu mee e.d.) mag af en toe, niet in elke versie. Laat de vijf versies niet op elkaar lijken: andere openingen en titels.

Schema:
{"articles":{"vk_kort":{"title":"","body":""},"vk_lang":{"title":"","body":""},"trouw":{"title":"","body":""},"parool":{"title":"","body":""},"ad":{"title":"","body":""}}}"""


def log(msg):
    print(datetime.now(TZ).strftime('%Y-%m-%d %H:%M:%S'), msg, flush=True)


def load(path, default=None):
    try:
        return json.loads(Path(path).read_text())
    except (OSError, ValueError):
        return default


def notify(msg):
    subprocess.run(['osascript', '-e', f'display notification {json.dumps(msg)} with title "Krantenredactie"'],
                   check=False, capture_output=True)


def source_key(source):
    parts = [source['paragraphs'][i] for i in source['eligibleParagraphs']]
    return hashlib.sha256(json.dumps([source['publicationDate'], parts], ensure_ascii=False).encode()).hexdigest()


def long_date(d):
    return f'{DAYS[d.weekday()]} {d.day} {MONTHS[d.month - 1]} {d.year}'


def build_prompt(source, previous, feedback=None):
    pub = datetime.fromisoformat(source['publicationDate']).date()
    lines = [f'Krantdatum: {long_date(pub)}. In de krant is dat VANDAAG.',
             f'MORGEN in de krant = {long_date(pub + timedelta(days=1))}.']
    if pub.weekday() == 6:
        lines.append('Let op: er verschijnt geen zondagskrant; dit is een demo-editie.')
    lines.append('\nBron (Buienradar), alleen de bruikbare passages:')
    for i in source['eligibleParagraphs']:
        lines.append(source['paragraphs'][i])
    if previous and previous.get('articles'):
        ex = previous['articles']
        lines.append('\nStijlvoorbeeld uit een eerdere editie (andere dag, NIET inhoudelijk gebruiken, ook niet de openingen kopiëren):')
        lines.append(json.dumps({'vk_kort': ex['vk_kort'], 'parool': ex['parool']}, ensure_ascii=False))
    if feedback:
        lines.append('\nJe vorige poging werd afgekeurd door de controle:\n' + feedback['errors'])
        lines.append('Vorige poging (herstel alleen wat nodig is):\n' + feedback['json'])
    return '\n'.join(lines)


def call_model(prompt):
    env = dict(os.environ)
    token_file = Path.home() / '.config' / 'weerlab' / 'claude_oauth_token'
    if token_file.exists():
        env['CLAUDE_CODE_OAUTH_TOKEN'] = token_file.read_text().strip()
    cmd = ['claude', '-p', '--model', MODEL, '--tools', '', '--setting-sources', '',
           '--strict-mcp-config', '--disable-slash-commands', '--no-session-persistence',
           '--output-format', 'json', '--system-prompt', SYSTEM]
    WORK.mkdir(parents=True, exist_ok=True)
    res = subprocess.run(cmd, input=prompt, capture_output=True, text=True, timeout=300, cwd=WORK, env=env)
    if res.returncode != 0:
        raise RuntimeError(f'claude faalde ({res.returncode}): {(res.stderr or res.stdout)[-500:]}')
    meta = json.loads(res.stdout)
    if meta.get('is_error'):
        raise RuntimeError('claude-fout: ' + str(meta.get('result'))[:500])
    usage = meta.get('usage', {})
    log(f"model {MODEL}: in {usage.get('input_tokens')} (+cache {usage.get('cache_read_input_tokens', 0)}), "
        f"uit {usage.get('output_tokens')}, ${meta.get('total_cost_usd', 0):.4f}")
    text = meta['result'].strip()
    text = re.sub(r'^```(?:json)?\s*|\s*```$', '', text)
    return json.loads(text[text.index('{'):text.rindex('}') + 1])


def run_update(*args):
    return subprocess.run([sys.executable, str(ROOT / 'scripts' / 'kranten_update.py'), *args],
                          capture_output=True, text=True, cwd=ROOT)


def main():
    now = datetime.now(TZ)
    state = load(STATE, {})
    res = run_update('fetch')
    if res.returncode != 0:
        log('fetch mislukt: ' + (res.stderr or res.stdout).strip()[-300:])
        check_fresh(now, state)
        return 1
    source = load(DATA / 'kranten_bron.json')
    demo = load(DATA / 'kranten_demo.json', {})
    key = source_key(source)
    today = now.date().isoformat()
    if demo.get('publicationDate') == source['publicationDate'] and state.get('lastKey') == key:
        log('bron ongewijzigd; niets te doen.')
        return 0
    count = state.get('count', 0) if state.get('date') == today else 0
    if count >= MAX_EDITIONS_PER_DAY:
        log(f'al {count} edities vandaag; wijziging overgeslagen.')
        return 0

    previous = load(DATA / 'kranten_demo.json')
    base = {'sourceId': source['id'], 'sourceDate': source['sourceDate'],
            'publicationDate': source['publicationDate'], 'demoOnly': now.weekday() == 5,
            'author': 'Ed Aldus', 'usedParagraphs': source['eligibleParagraphs']}
    cand_path = WORK / f"kandidaat-{source['publicationDate'].replace('-', '')}-{now:%H%M}-auto.json"
    feedback = None
    for attempt in (1, 2):
        try:
            out = call_model(build_prompt(source, previous, feedback))
        except Exception as e:  # netwerk/auth/JSON
            log(f'poging {attempt}: {e}')
            if attempt == 2 or 'claude faalde' in str(e) or 'claude-fout' in str(e):
                notify('Automatische concepten mislukt: ' + str(e)[:120])
                check_fresh(now, state)
                return 1
            continue
        cand = {**base, 'articles': out.get('articles', out)}
        cand_path.write_text(json.dumps(cand, ensure_ascii=False, indent=2))
        val = run_update('validate', str(cand_path))
        if val.returncode == 0:
            break
        errors = (val.stderr or val.stdout).strip()
        log(f'poging {attempt} afgekeurd: {errors}')
        feedback = {'errors': errors, 'json': json.dumps(cand['articles'], ensure_ascii=False)}
    else:
        notify('Concepten afgekeurd na herkansing; zie logs/kranten_auto.log')
        check_fresh(now, state)
        return 1

    pub = run_update('publish', str(cand_path))
    if pub.returncode != 0:
        log('publish mislukt: ' + pub.stderr.strip())
        return 1
    lengths = {k: (len(a['body']) if k == 'trouw' else len(a['body'].split())) for k, a in cand['articles'].items()}
    log(f"editie {source['publicationDate']} geschreven: {lengths}")
    git = subprocess.run(['bash', str(ROOT / 'shell' / 'kranten_publish.sh'),
                          f"Krantconcepten {source['publicationDate']} bijgewerkt"],
                         capture_output=True, text=True, cwd=ROOT)
    log(git.stdout.strip().splitlines()[-1] if git.stdout.strip() else git.stderr.strip()[-300:])
    STATE.write_text(json.dumps({'date': today, 'count': count + 1, 'lastKey': key}))
    return 0 if git.returncode == 0 else 1


def check_fresh(now, state):
    """Waarschuw als er rond de deadline nog geen editie voor morgen staat."""
    demo = load(DATA / 'kranten_demo.json', {})
    expected = (now.date() + timedelta(days=1)).isoformat()
    if now.hour >= ALERT_HOUR and demo.get('publicationDate') != expected:
        notify(f'Nog geen krantconcepten voor {expected} (deadline 13.00).')
        log(f'WAARSCHUWING: geen editie voor {expected}.')


if __name__ == '__main__':
    sys.exit(main())
