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


def reference_bundle(weerlab, now=None):
    now = now or datetime.now(timezone.utc)
    lines, register = ['\n# BRONTEKSTEN — dezelfde bronnen voor auteur en eindcontrole'], []
    for filename, source, sections in (
        ('guidance.json', 'knmi', [('kort', 'KNMI korte termijn'), ('lang', 'KNMI meerdaagse')]),
        ('dwd_guidance.json', 'dwd', [('kurzfrist', 'DWD Kurzfrist'), ('mittelfrist', 'DWD Mittelfrist')]),
    ):
        try:
            data = json.loads((Path(weerlab) / filename).read_text())
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
    for text in texts:
        # Controle per zin, zodat windschering in kn in een andere zin kan blijven.
        for sentence in re.split(r'(?<=[.!?])\s+', text):
            if re.search(r'windstot|windstoot', sentence, re.I) and re.search(r'\d\s*(?:m/s|kn(?:open)?|kt(?:s)?)\b', sentence, re.I):
                raise ValueError('windstoten moeten in km/u worden vermeld')
