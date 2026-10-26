"""
periode.py — Tijdvakken, presets en de opdeling van een periode in blokken.

Conventies (intern alles UTC):
  * Een 5-minutenframe met eindtijd T dekt (T-5min, T].
  * Een periode (begin, eind] bevat precies de frames met begin < T <= eind.
    Aansluitende perioden overlappen dus nooit en laten geen gat.
  * Bloktypen (allemaal opgebouwd uit uursommen, die uit frames komen):
      uur     [s, s+1u)          naam = UTC-starttijd (YYYYMMDD/HH)
      dag     UTC-kalenderdag     00–24 UTC
      etmaal  KNMI-neerslagetmaal 08 UTC dag-1 → 08 UTC dag (label = einddatum,
              zelfde conventie als het KNMI-neerslagnet / MONV)
      lokdag  Nederlandse kalenderdag 00–24 lokale tijd (23/24/25 uur rond
              de wissel van zomer- naar wintertijd en terug)
      maand   UTC-kalendermaand
  * "Afgelopen 7 dagen" = exact 7 × 24 uur terug vanaf het laatste frame.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from zoneinfo import ZoneInfo

NL = ZoneInfo("Europe/Amsterdam")
UTC = timezone.utc
MIN5 = timedelta(minutes=5)
UUR = timedelta(hours=1)


def umin(dt: datetime) -> int:
    """datetime → unix-minuten (UTC)."""
    if dt.tzinfo is None:
        raise ValueError("naïeve datetime")
    return int(dt.timestamp() // 60)


def van_umin(m: int) -> datetime:
    return datetime.fromtimestamp(m * 60, tz=UTC)


@dataclass(frozen=True)
class Blok:
    soort: str          # frame | uur | dag | etmaal | lokdag | maand
    begin: datetime     # exclusief
    eind: datetime      # inclusief (eindtijd laatste frame)
    label: str          # bestands-/sleutelnaam

    @property
    def uren(self) -> float:
        return (self.eind - self.begin) / UUR


def uurblok(s: datetime) -> Blok:
    return Blok("uur", s, s + UUR, s.strftime("%Y%m%d/%H"))


def dagblok(d: date) -> Blok:
    b = datetime(d.year, d.month, d.day, tzinfo=UTC)
    return Blok("dag", b, b + timedelta(days=1), d.strftime("%Y%m%d"))


def etmaalblok(d: date) -> Blok:
    """Neerslagetmaal met label d: 08 UTC (d-1) → 08 UTC d."""
    e = datetime(d.year, d.month, d.day, 8, tzinfo=UTC)
    return Blok("etmaal", e - timedelta(days=1), e, d.strftime("%Y%m%d"))


def lokdag_grenzen(d: date):
    b = datetime(d.year, d.month, d.day, tzinfo=NL).astimezone(UTC)
    n = d + timedelta(days=1)
    e = datetime(n.year, n.month, n.day, tzinfo=NL).astimezone(UTC)
    return b, e


def lokdagblok(d: date) -> Blok:
    b, e = lokdag_grenzen(d)
    return Blok("lokdag", b, e, d.strftime("%Y%m%d"))


def maandblok(j: int, m: int) -> Blok:
    b = datetime(j, m, 1, tzinfo=UTC)
    e = datetime(j + (m == 12), m % 12 + 1, 1, tzinfo=UTC)
    return Blok("maand", b, e, f"{j:04d}{m:02d}")


# ── Presets ─────────────────────────────────────────────────────────────────
PRESETS = [
    # id, label, soort, waarde
    ("1u", "Afgelopen 1 uur", "uren", 1),
    ("3u", "Afgelopen 3 uur", "uren", 3),
    ("6u", "Afgelopen 6 uur", "uren", 6),
    ("12u", "Afgelopen 12 uur", "uren", 12),
    ("24u", "Afgelopen 24 uur", "uren", 24),
    ("48u", "Afgelopen 48 uur", "uren", 48),
    ("72u", "Afgelopen 72 uur", "uren", 72),
    ("5d", "Afgelopen 5 dagen", "uren", 5 * 24),
    ("7d", "Afgelopen 7 dagen", "uren", 7 * 24),
    ("10d", "Afgelopen 10 dagen", "uren", 10 * 24),
    ("14d", "Afgelopen 14 dagen", "uren", 14 * 24),
    ("30d", "Afgelopen 30 dagen", "uren", 30 * 24),
    ("vandaag", "Vandaag vanaf 00.00 uur", "kal", "vandaag"),
    ("gisteren", "Gisteren", "kal", "gisteren"),
    ("week", "Deze week (vanaf maandag)", "kal", "week"),
    ("maand", "Deze maand", "kal", "maand"),
    ("vorigemaand", "Vorige maand", "kal", "vorigemaand"),
    ("etmaal", "Lopend neerslagetmaal (vanaf 08 UTC)", "kal", "etmaal"),
    ("vorigetmaal", "Laatste volledige etmaal (08–08 UTC)", "kal", "vorigetmaal"),
]


def preset_tijdvak(pid: str, laatste: datetime):
    """(begin, eind] in UTC voor preset pid, gegeven het laatste frame-eind."""
    for p, _label, soort, w in PRESETS:
        if p == pid:
            break
    else:
        raise KeyError(pid)
    if soort == "uren":
        return laatste - timedelta(hours=w), laatste
    lok = laatste.astimezone(NL)
    vandaag = lok.date()
    # Om precies 00:00 lokaal is "vandaag" nog leeg en "gisteren" net compleet.
    if w == "vandaag":
        return lokdag_grenzen(vandaag)[0], laatste
    if w == "gisteren":
        return lokdag_grenzen(vandaag - timedelta(days=1))
    if w == "week":
        maandag = vandaag - timedelta(days=vandaag.weekday())
        return lokdag_grenzen(maandag)[0], laatste
    if w == "maand":
        return lokdag_grenzen(vandaag.replace(day=1))[0], laatste
    if w == "vorigemaand":
        eerste = vandaag.replace(day=1)
        vorige = (eerste - timedelta(days=1)).replace(day=1)
        return lokdag_grenzen(vorige)[0], lokdag_grenzen(eerste)[0]
    if w == "etmaal":
        e = laatste.replace(hour=8, minute=0, second=0, microsecond=0)
        if e >= laatste:
            e -= timedelta(days=1)
        return e, laatste
    if w == "vorigetmaal":
        e = laatste.replace(hour=8, minute=0, second=0, microsecond=0)
        if e > laatste:
            e -= timedelta(days=1)
        return e - timedelta(days=1), e
    raise KeyError(pid)


# ── Opdeling in blokken ─────────────────────────────────────────────────────
KOSTEN = {"frame": 1.0, "uur": 2.0, "dag": 3.0, "etmaal": 3.0, "lokdag": 3.0, "maand": 4.0}


def _kandidaten(t: datetime, eind: datetime, beschikbaar):
    """Alle blokken die op t beginnen en binnen (t, eind] vallen."""
    uit = []
    if t + MIN5 <= eind:
        uit.append(Blok("frame", t, t + MIN5, ""))
    if t.minute == 0 and t + UUR <= eind:
        uit.append(uurblok(t))
    if t.minute == 0:
        if t.hour == 0:
            b = dagblok(t.date())
            if b.eind <= eind:
                uit.append(b)
            if t.day == 1:
                b = maandblok(t.year, t.month)
                if b.eind <= eind:
                    uit.append(b)
        if t.hour == 8:
            b = etmaalblok((t + timedelta(days=1)).date())
            if b.eind <= eind:
                uit.append(b)
        lok = t.astimezone(NL)
        if lok.hour == 0 and lok.minute == 0:
            b = lokdagblok(lok.date())
            if b.eind <= eind:
                uit.append(b)
    return [b for b in uit if b.soort == "frame" or beschikbaar(b)]


def deel_op(begin: datetime, eind: datetime, beschikbaar=lambda b: True,
            frames_toegestaan=True):
    """Kortste opdeling van (begin, eind] in blokken (dynamisch programmeren).

    beschikbaar(blok) zegt of een blok gebouwd is. Resultaat: lijst Blokken
    die exact aansluiten (geen overlap, geen gat). Levert ValueError als het
    niet kan (bv. geen frames toegestaan en begin niet op een uurgrens)."""
    if (begin.minute % 5) or (eind.minute % 5) or begin.second or eind.second:
        raise ValueError("Tijdvak moet op 5-minutengrenzen liggen")
    if eind <= begin:
        return []
    stap = MIN5 if frames_toegestaan else UUR
    n = int((eind - begin) / stap)
    if begin + n * stap != eind:
        raise ValueError("Tijdvak niet op de stapgrootte uitgelijnd")
    INF = float("inf")
    best = [INF] * (n + 1)
    vorig = [None] * (n + 1)
    best[0] = 0.0
    for i in range(n):
        if best[i] == INF:
            continue
        t = begin + i * stap
        for b in _kandidaten(t, eind, beschikbaar):
            if b.soort == "frame" and not frames_toegestaan:
                continue
            j = int((b.eind - begin) / stap)
            c = best[i] + KOSTEN[b.soort]
            if c < best[j]:
                best[j] = c
                vorig[j] = (i, b)
    if best[n] == INF:
        raise ValueError("Periode is niet uit beschikbare blokken samen te stellen")
    uit = []
    j = n
    while j:
        i, b = vorig[j]
        uit.append(b)
        j = i
    return uit[::-1]
