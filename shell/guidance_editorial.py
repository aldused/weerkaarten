"""Bronselectie en inhoudelijke publicatiegrenzen voor de modellenbespreking."""
import json
import re
from datetime import datetime, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

NL = ZoneInfo('Europe/Amsterdam')


def issued_at(text, source):
    """Werkelijke uitgifte, niet de datum waarop een oude tekst is opgehaald."""
    if source == 'knmi':
        match = re.search(r'Uitgifte:\s*(\d{2}/\d{2}/\d{4})\s+(\d{1,2})[.:](\d{2})\s*uur\s*LT', text, re.I)
        if match:
            day, hour, minute = match.groups()
            return datetime.strptime(day, '%d/%m/%Y').replace(hour=int(hour), minute=int(minute), tzinfo=NL)
    else:
        match = re.search(r'(\d{2}\.\d{2}\.\d{4})\s+um\s+(\d{1,2})(?:[.:](\d{2}))?\s*UTC', text, re.I)
        if match:
            day, hour, minute = match.groups()
            return datetime.strptime(day, '%d.%m.%Y').replace(hour=int(hour), minute=int(minute or 0), tzinfo=timezone.utc)
    return None


def reference_bundle(weerlab, now=None, dwd_path=None):
    now = now or datetime.now(timezone.utc)
    lines, register = ['\n# BRONTEKSTEN — dezelfde bronnen voor auteur en eindcontrole'], []
    for filename, source, sections in (
        ('guidance.json', 'knmi', [('kort', 'KNMI korte termijn'), ('lang', 'KNMI meerdaagse')]),
        ('dwd_guidance.json', 'dwd', [('kurzfrist', 'DWD Kurzfrist'), ('mittelfrist', 'DWD Mittelfrist')]),
    ):
        try:
            source_path = Path(dwd_path) if source == 'dwd' and dwd_path else Path(weerlab) / filename
            data = json.loads(source_path.read_text())
        except (OSError, ValueError):
            data = {}
        if not isinstance(data, dict):
            data = {}
        for key, label in sections:
            part = data.get(key) or {}
            if not isinstance(part, dict):
                part = {}
            text = (part.get('tekst') or part.get('original') or '').strip()
            try:
                issued = issued_at((part.get('issuedAt') or '') + '\n' + text, source)
            except ValueError:
                issued = None
            status = 'beschikbaar'
            if not text:
                status = 'ontbreekt'
            elif issued is None:
                status = 'uitgifte onbekend'
            elif not -timedelta(minutes=15) <= now - issued <= timedelta(hours=36):
                status = 'buiten actualiteitsgrens'
            elif len(text) > 64000:
                status = 'onverwacht lange brontekst'
            item = {'id': source + '_' + key, 'naam': label, 'status': status,
                    'issued_utc': issued.astimezone(timezone.utc).isoformat() if issued else None,
                    'retrieved_at': part.get('opgehaald') or part.get('fetchedAt') or data.get('bijgewerkt')}
            register.append(item)
            lines += [f"\n## {item['id']} — {label}", f"Status: {status}; uitgifte: {item['issued_utc'] or 'onbekend'}."]
            if status == 'beschikbaar':
                lines += ['Gebruik alleen de beschreven geldigheidsperiode. DWD beschrijft Duitsland; vertaal effecten niet automatisch naar Nederland.', text]
            else:
                lines += ['Niet gebruiken voor actuele meteorologische claims.']
    return '\n'.join(lines) + '\n', register


def validate_assessment(guidance, available_ids):
    """Geen lege vergelijkingen, onbekende bronverwijzingen of gusts in m/s/kn."""
    cards = guidance.get('modelbeoordeling')
    if not isinstance(cards, list) or not 1 <= len(cards) <= 4:
        raise ValueError('modelbeoordeling vereist 1–4 onderbouwde onderwerpen')
    for card in cards:
        if not isinstance(card, dict):
            raise ValueError('modelbeoordeling moet uit objecten bestaan')
        for field, limit in [('onderwerp', 10), ('periode', 14), ('vergelijking', 85), ('betekenis', 55)]:
            value = card.get(field)
            if not isinstance(value, str) or not value.strip() or len(value.split()) > limit:
                raise ValueError(f'modelbeoordeling: ongeldig veld {field}')
        ids = card.get('bron_ids')
        if not isinstance(ids, list) or not ids or any(not isinstance(i, str) or i not in available_ids for i in ids):
            raise ValueError('modelbeoordeling verwijst naar een ontbrekende of verouderde bron')
    texts = [guidance.get(k, '') for k in ('intro', 'aandachtspunten', 'vooruitzichten')]
    for day in guidance.get('days', []):
        uncertainty = day.get('onzekerheid', '')
        if not isinstance(uncertainty, str) or len(uncertainty.split()) > 45:
            raise ValueError('ongeldige onzekerheid per dag')
        texts += [day.get('synoptiek', ''), day.get('weertype', ''), uncertainty]
    texts += [card[k] for card in cards for k in ('vergelijking', 'betekenis')]
    texts += [e.get('tekst', '') for e in guidance.get('korte_termijn', {}).get('elementen', [])]
    for text in texts:
        # Controle per zin, zodat windschering in kn in een andere zin kan blijven.
        for sentence in re.split(r'(?<=[.!?])\s+', text):
            if re.search(r'windstot|windstoot', sentence, re.I) and re.search(r'\d\s*(?:m/s|kn(?:open)?|kt(?:s)?)\b', sentence, re.I):
                raise ValueError('windstoten moeten in km/u worden vermeld')


ELEMENTS = ('bewolking', 'neerslag', 'wind', 'temperatuur', 'zicht')


def validate_short_term(guidance, available_ids, context):
    """Controleer het geldige tijdvak en de dekking van de Nederlandse guidance."""
    short = guidance.get('korte_termijn')
    if not isinstance(short, dict):
        raise ValueError('korte_termijn ontbreekt')
    for key in ('geldig_van', 'geldig_tot'):
        if short.get(key) != context.get(key) or not context.get(key):
            raise ValueError('korte_termijn: geldigheid wijkt af van het bronpakket')
    start = datetime.fromisoformat(short['geldig_van'])
    end = datetime.fromisoformat(short['geldig_tot'])
    if start.tzinfo is None or end.tzinfo is None or end - start != timedelta(hours=48):
        raise ValueError('korte_termijn moet precies 48 uur met tijdzone beslaan')
    elements = short.get('elementen')
    if not isinstance(elements, list) or len(elements) != len(ELEMENTS):
        raise ValueError('korte_termijn vereist vijf weerelementen')
    if any(not isinstance(e, dict) for e in elements) or [e.get('element') for e in elements] != list(ELEMENTS):
        raise ValueError('korte_termijn: onjuiste of dubbele weerelementen')
    for item in elements:
        value, ids = item.get('tekst'), item.get('bron_ids')
        if not isinstance(value, str) or not value.strip() or len(value.split()) > 65:
            raise ValueError('korte_termijn: elementtekst ontbreekt of is te lang')
        if not isinstance(ids, list) or not ids or any(not isinstance(i, str) or i not in available_ids for i in ids):
            raise ValueError('korte_termijn verwijst naar een ontbrekende of verouderde bron')
    timed_texts = [e['tekst'] for e in elements] + [guidance.get('aandachtspunten', '')]
    if any(re.search(r"\b(?:vandaag|vanmiddag|vanavond|vannacht|morgen(?:ochtend|middag|avond|nacht)?|komende nacht)\b", t, re.I) for t in timed_texts):
        raise ValueError('gebruik vaste kalenderdagen in korte termijn en aandachtspunten')
    notes = guidance.get('bronnotities')
    if not isinstance(notes, str) or len(notes.split()) > 90:
        raise ValueError('bronnotities ontbreekt of is te lang')
