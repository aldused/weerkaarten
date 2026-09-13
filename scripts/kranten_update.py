#!/usr/bin/env python3
"""Bron ophalen en redactioneel geschreven krantconcepten gecontroleerd plaatsen.

Geen automatische woordvervanging: de geplande Codex-taak schrijft de teksten.
Gebruik: fetch [--html bestand], validate kandidaat.json, publish kandidaat.json.
"""
import argparse
import hashlib
from html.parser import HTMLParser
import json
import os
from pathlib import Path
import re
import tempfile
from datetime import datetime, timedelta
from urllib.request import Request, urlopen
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / 'data'
TZ = ZoneInfo('Europe/Amsterdam')
URL = 'https://www.buienradar.nl/nederland/weerbericht/weerbericht'
MONTHS = 'januari februari maart april mei juni juli augustus september oktober november december'.split()
LENGTH_RULES = {
    'vk_kort': ('words', 1, 30),
    'vk_lang': ('words', 167, 203),
    'trouw': ('characters', 900, 1100),
    'parool': ('words', 90, 110),
    'ad': ('words', 90, 110),
}
TITLE_LIMITS = {
    'vk_kort': (1, 5),
    'vk_lang': (0, 0),
    'trouw': (1, 5),
    'parool': (1, 5),
    'ad': (1, 5),
}


def atomic_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, temp = tempfile.mkstemp(dir=path.parent, prefix='.' + path.name)
    try:
        with os.fdopen(fd, 'w') as f:
            json.dump(value, f, ensure_ascii=False, indent=2)
            f.write('\n')
        os.replace(temp, path)
    finally:
        if os.path.exists(temp):
            os.unlink(temp)


class ArticleParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.stack = []
        self.blocks = []
        self.current = None
        self.all_text = []
        self.title = ''

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        self.stack.append((tag, a)) if tag not in {'img', 'br', 'meta', 'link', 'input', 'hr', 'source', 'wbr'} else None
        in_article = any(x.get('id') == 'readarea' for _, x in self.stack)
        in_reporter = any('weather-reporter-card' in x.get('class', '') for _, x in self.stack)
        if tag in {'p', 'h1'} and in_article and not in_reporter:
            self.current = (tag, [])
        if tag == 'br' and self.current:
            self.current[1].append(' ')

    def handle_data(self, text):
        if not any(tag in {'script', 'style'} for tag, _ in self.stack):
            self.all_text.append(text)
        if self.current:
            self.current[1].append(text)

    def handle_endtag(self, tag):
        if self.current and tag == self.current[0]:
            value = re.sub(r'\s+', ' ', ''.join(self.current[1])).strip()
            if tag == 'h1':
                self.title = value
            elif value:
                self.blocks.append(value)
            self.current = None
        for i in range(len(self.stack) - 1, -1, -1):
            if self.stack[i][0] == tag:
                del self.stack[i:]
                break


def parse_source(raw, now):
    parser = ArticleParser()
    parser.feed(raw)
    visible = re.sub(r'\s+', ' ', ' '.join(parser.all_text))
    match = re.search(r'(\d{1,2}) (' + '|'.join(MONTHS) + r') (\d{4}) om (\d{2}):(\d{2})\s+door\s+(.+?)(?: Lees voor| Vandaag| Morgen| Het | De )', visible)
    # Date and author are also read separately: titles need not start with a date word.
    stamp = re.search(r'(\d{1,2}) (' + '|'.join(MONTHS) + r') (\d{4}) om (\d{2}):(\d{2})', visible)
    if not stamp or not parser.title or len(parser.blocks) < 2:
        raise ValueError('De herkenbare artikeltekst of brondatum ontbreekt; eerdere concepten blijven behouden.')
    day, month, year, hour, minute = stamp.groups()
    published = datetime(int(year), MONTHS.index(month) + 1, int(day), int(hour), int(minute), tzinfo=TZ)
    if published.date() != now.date() or published > now + timedelta(minutes=5):
        raise ValueError('De bron is niet van vandaag of ligt in de toekomst; geen nieuwe editie gemaakt.')
    tomorrow_indices = [i for i, p in enumerate(parser.blocks) if re.match(r'^Morgen\b', p, re.I)]
    # An explicit boundary is required; never silently treat today's intro as tomorrow.
    if not tomorrow_indices:
        raise ValueError('Geen afzonderlijke morgenpassage herkend. Redactionele beoordeling nodig.')
    start = tomorrow_indices[0]
    content = {'title': parser.title, 'publishedAt': published.isoformat(), 'paragraphs': parser.blocks}
    source_id = hashlib.sha256(json.dumps(content, ensure_ascii=False, sort_keys=True).encode()).hexdigest()
    return {**content, 'id': source_id, 'url': URL, 'fetchedAt': now.isoformat(),
            'sourceDate': published.date().isoformat(), 'publicationDate': (published.date() + timedelta(days=1)).isoformat(),
            'eligibleParagraphs': list(range(start, len(parser.blocks))),
            'author': match.group(6).strip() if match else ''}


def words(value):
    return len(value.split())


def measured_length(value, unit):
    return len(value) if unit == 'characters' else words(value)


def validate(candidate, source, now):
    errors = []
    if candidate.get('sourceId') != source['id']:
        errors.append('Concept hoort niet bij de laatst opgehaalde bron.')
    if source['sourceDate'] != now.date().isoformat():
        errors.append('Bron is niet van vandaag.')
    expected = (now.date() + timedelta(days=1)).isoformat()
    if candidate.get('publicationDate') != expected or candidate.get('sourceDate') != source['sourceDate']:
        errors.append('Schrijfdatum of krantdatum klopt niet.')
    if candidate.get('demoOnly') is not (now.weekday() == 5):
        errors.append('Zaterdag moet expliciet als demo zonder zondagskrant gemarkeerd zijn.')
    if not isinstance(candidate.get('author'), str) or not candidate['author'].strip():
        errors.append('Auteursnaam ontbreekt.')
    used = candidate.get('usedParagraphs', [])
    if not used or not set(used).issubset(source['eligibleParagraphs']):
        errors.append('Bronverwijzing bevat vandaag/nacht of ontbreekt.')
    articles = candidate.get('articles', {})
    if not isinstance(articles, dict) or set(articles) != set(LENGTH_RULES):
        return errors + ['Precies vijf krantversies vereist.']
    for key, (unit, low, high) in LENGTH_RULES.items():
        item = articles[key]
        if not isinstance(item, dict) or not all(isinstance(item.get(x), str) for x in ('title', 'body')):
            errors.append(key + ': ongeldige titel of tekst.')
            continue
        title, body = item['title'].strip(), item['body'].strip()
        title_low, title_high = TITLE_LIMITS[key]
        if not title_low <= words(title) <= title_high:
            errors.append(key + (': geen titel gebruiken.' if title_high == 0 else ': titel moet 1–5 woorden bevatten.'))
        length = measured_length(body, unit)
        if not low <= length <= high:
            label = 'karakters inclusief spaties' if unit == 'characters' else 'woorden'
            errors.append(f'{key}: {length} {label}, verwacht {low}–{high}.')
        if key == 'vk_kort' and not re.search(r'\bmorgen\b', body, re.I):
            errors.append(key + ': weer voor de volgende krantdag ontbreekt.')
        if not re.search(r'[.!?]$', body) or re.search(r'[,;:!?]{2,}|\S[ \t]+[,.;:!?]|[.!?][A-Za-zÀ-ÿ]', body):
            errors.append(key + ': controleer de leestekens.')
        if re.search(r'\bovermorgen\b', body, re.I):
            errors.append(key + ': gebruik een concrete weekdag of de dagen erna.')
    return errors


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command', choices=['fetch', 'validate', 'publish'])
    parser.add_argument('candidate', nargs='?')
    parser.add_argument('--html', type=Path, help='Al opgehaalde HTML als invoer (ook voor testen).')
    args = parser.parse_args()
    now = datetime.now(TZ)
    try:
        if args.command == 'fetch':
            if args.html:
                raw = args.html.read_text()
            else:
                request = Request(URL, headers={'User-Agent': 'Weerlab-krantendemo/1.0', 'Cache-Control': 'no-cache'})
                with urlopen(request, timeout=35) as response:
                    raw = response.read().decode('utf-8')
            source = parse_source(raw, now)
            atomic_json(DATA / 'kranten_bron.json', source)
            atomic_json(DATA / 'kranten_status.json', {'checkedAt': now.isoformat(), 'ok': True, 'sourceId': source['id'], 'message': 'Bron opgehaald.'})
            print(json.dumps(source, ensure_ascii=False, indent=2))
        else:
            if not args.candidate:
                parser.error('Geef het kandidaatbestand op.')
            source = json.loads((DATA / 'kranten_bron.json').read_text())
            candidate = json.loads(Path(args.candidate).read_text())
            errors = validate(candidate, source, now)
            if errors:
                raise ValueError('\n'.join(errors))
            if args.command == 'publish':
                candidate['updatedAt'] = now.isoformat()
                # De online demo heeft alleen de gebruikte passages nodig. Houd
                # de volledige opgehaalde pagina in het lokale bronbestand.
                selected = candidate['usedParagraphs']
                candidate['source'] = {
                    'id': source['id'], 'url': source['url'], 'title': source['title'],
                    'publishedAt': source['publishedAt'], 'author': source['author'],
                    'paragraphs': [source['paragraphs'][i] for i in selected]
                }
                candidate['usedParagraphs'] = list(range(len(selected)))
                candidate['revision'] = hashlib.sha256(json.dumps(candidate, sort_keys=True, ensure_ascii=False).encode()).hexdigest()[:16]
                current = DATA / 'kranten_demo.json'
                if current.exists():
                    previous = json.loads(current.read_text())
                    archive = ROOT / 'kranten-archief' / (previous['publicationDate'] + '-' + previous['revision'] + '.json')
                    atomic_json(archive, previous)
                atomic_json(current, candidate)
                atomic_json(DATA / 'kranten_status.json', {'checkedAt': now.isoformat(), 'ok': True, 'sourceId': source['id'], 'message': 'Concepten bijgewerkt.'})
            print('OK: krantdatum, vijf versies, bronverwijzing, tekstlengtes, titels en basisleestekens gecontroleerd.')
    except Exception as error:
        if args.command in {'fetch', 'publish'}:
            atomic_json(DATA / 'kranten_status.json', {'checkedAt': now.isoformat(), 'ok': False, 'message': str(error)})
        parser.exit(1, str(error) + '\n')


if __name__ == '__main__':
    main()
