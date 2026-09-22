#!/usr/bin/env python3
"""Van feiten naar een weerbericht voor Rijnmond, in gewone mensentaal.

De tekst wordt regelgebaseerd opgebouwd uit de consensus van rijnmond_analyse:
iedere zin is terug te voeren op een berekende grootheid, er worden geen
getallen verzonnen. Per onderwerp zijn meerdere formuleringen beschikbaar; een
vaste toevalsgenerator per uitgifte kiest ertussen, zodat het bericht niet
elke dag hetzelfde klinkt maar wel reproduceerbaar is.

Opbouw per dagdeel (zoals een regionale weerman het vertelt): eerst het
weerbeeld en de neerslag, dan de temperatuur, dan de wind en tot slot mist of
een bijzonderheid. Onzekerheid wordt in woorden uitgedrukt ("waarschijnlijk",
"de timing is nog onzeker"); modelnamen en modelwaarden staan niet in de
hoofdtekst maar in de modelvergelijking.
"""

from __future__ import annotations

import hashlib
import math
import random
import re
from datetime import date, datetime, timedelta

RICHTING_ZN = {"noord": "noorden", "noordoost": "noordoosten", "oost": "oosten", "zuidoost": "zuidoosten",
               "zuid": "zuiden", "zuidwest": "zuidwesten", "west": "westen", "noordwest": "noordwesten"}
RICHTING_WIND = {k: v + "wind" for k, v in RICHTING_ZN.items()}
RICHTING_BN = {"noord": "noordelijke", "noordoost": "noordoostelijke", "oost": "oostelijke",
               "zuidoost": "zuidoostelijke", "zuid": "zuidelijke", "zuidwest": "zuidwestelijke",
               "west": "westelijke", "noordwest": "noordwestelijke"}
AFK = {"noord": "N", "noordoost": "NO", "oost": "O", "zuidoost": "ZO", "zuid": "Z",
       "zuidwest": "ZW", "west": "W", "noordwest": "NW"}
WIND_NAAM = {0: "windstil", 1: "zwak", 2: "zwak", 3: "matig", 4: "matig", 5: "vrij krachtig",
             6: "krachtig", 7: "hard", 8: "stormachtig", 9: "storm", 10: "zware storm",
             11: "zeer zware storm", 12: "orkaan"}
DAGEN = ["maandag", "dinsdag", "woensdag", "donderdag", "vrijdag", "zaterdag", "zondag"]


def afr(x) -> int | None:
    """Afronden zoals een weerman: 19,5 → 20 (niet bankiersafronding)."""
    if x is None:
        return None
    return int(math.floor(float(x) + 0.5))


def afr5(x) -> int | None:
    return None if x is None else int(5 * math.floor(float(x) / 5 + 0.5))


def cap(s: str) -> str:
    return s[:1].upper() + s[1:] if s else s


def graden(a: int, b: int | None = None) -> str:
    if b is None or a == b:
        return f"{a} graden"
    lo, hi = min(a, b), max(a, b)
    return f"{lo} tot {hi} graden"


def bft_tekst(lo: int, hi: int | None = None) -> str:
    if hi is None or hi == lo:
        return f"kracht {lo}"
    return f"kracht {min(lo, hi)} tot {max(lo, hi)}"


_VERBOGEN = {"windstil": "windstille", "zwak": "zwakke", "matig": "matige", "vrij krachtig": "vrij krachtige",
             "krachtig": "krachtige", "hard": "harde", "stormachtig": "stormachtige"}


def verbogen(naam: str) -> str | None:
    """"zwak tot matig" → "zwakke tot matige"; None als een deel niet te verbuigen is."""
    delen = [d.strip() for d in naam.split(" tot ")]
    if all(d in _VERBOGEN for d in delen):
        return " tot ".join(_VERBOGEN[d] for d in delen)
    return None


def wind_naam(lo: int, hi: int | None = None) -> str:
    a = WIND_NAAM.get(lo, "matig")
    b = WIND_NAAM.get(hi if hi is not None else lo, a)
    return a if a == b else f"{a} tot {b}"


def uur_van(iso: str | None) -> datetime | None:
    return datetime.fromisoformat(iso) if iso else None


# Twee opeenvolgende zinnen met dezelfde opening klinken als een opsomming;
# de tweede krijgt dan een verbindende opening.
_HERHAAL = {"Het blijft": "Verder blijft het", "Het wordt": "Verder wordt het",
            "Het is": "Verder is het", "Er is": "Verder is er", "De wind": "Die wind"}


def glad(zinnen: list[str]) -> str:
    uit: list[str] = []
    for z in zinnen:
        z = " ".join(z.split())
        if not z:
            continue
        if uit:
            vorige = uit[-1]
            for kop, vervang in _HERHAAL.items():
                if z.startswith(kop + " ") and vorige.startswith(kop + " ") and kop != "De wind":
                    z = vervang + z[len(kop):]
                    break
        uit.append(z)
    return " ".join(uit).replace("zo'n", "zo’n").replace(" ,", ",").replace(" .", ".")


def dagdeel_woord(t: datetime, nacht_context: bool = False) -> str:
    h = t.hour + t.minute / 60
    if h < 1.5:
        return "rond middernacht"
    if h < 4.5:
        return "in de loop van de nacht" if not nacht_context else "in de tweede helft van de nacht"
    if h < 7.5:
        return "vroeg in de ochtend"
    if h < 10.5:
        return "in de loop van de ochtend"
    if h < 13.5:
        return "rond het middaguur"
    if h < 16.5:
        return "in de loop van de middag"
    if h < 18.5:
        return "tegen de avond"
    if h < 21.5:
        return "in de loop van de avond"
    return "laat in de avond"


class Schrijver:
    def __init__(self, feiten: dict):
        self.f = feiten
        self.nu = datetime.fromisoformat(feiten["nu"])
        zaad = hashlib.sha256((feiten["nu"][:13]).encode()).hexdigest()
        self.rng = random.Random(int(zaad[:12], 16))
        self.perioden = {p["key"]: p for p in feiten["perioden"]}
        self.vakken = feiten.get("tijdvakken", [])
        self.guidance = feiten.get("guidance") or {}

    # ── Hulp ────────────────────────────────────────────────────────────────
    def kies(self, *opties: str) -> str:
        return self.rng.choice([o for o in opties if o])

    def vak(self, datum: date | str, label: str) -> dict | None:
        d = datum if isinstance(datum, str) else datum.isoformat()
        for v in self.vakken:
            if v["datum"] == d and v["vak"] == label:
                return v
        return None

    def dagnaam(self, iso: str) -> str:
        d = date.fromisoformat(iso[:10])
        verschil = (d - self.nu.date()).days
        if verschil == 0:
            return "vandaag"
        if verschil == 1:
            return "morgen"
        if verschil == 2:
            return "overmorgen"
        return DAGEN[d.weekday()]

    def guidance_noemt(self, datum_iso: str, woord: str) -> bool:
        dag = (self.guidance.get("dagen") or {}).get(datum_iso[:10]) or {}
        tekst = " ".join(str(v or "") for v in dag.values()).lower()
        return woord in tekst

    # ── Weerbeeld overdag ───────────────────────────────────────────────────
    def lucht_dag(self, p: dict, middag_modus: bool = False) -> list[str]:
        L = p["lucht"]
        k = L["klasse"]
        zinnen = []
        ochtend = self.vak(p["datum"], "06-12")
        middag = self.vak(p["datum"], "12-18")
        verloop = None
        if ochtend and middag and not middag_modus and p["neerslag"]["kans"] < 60:
            zo, zm = ochtend.get("zon_frac"), middag.get("zon_frac")
            lo, lm = ochtend.get("cl_l") or 0, middag.get("cl_l") or 0
            if zo is not None and zm is not None:
                if zm - zo >= 0.25 or (lo - lm >= 0.3 and lo >= 0.6):
                    verloop = "opklarend"
                elif zo - zm >= 0.25 or (lm - lo >= 0.3 and lm >= 0.6):
                    verloop = "dichtrekkend"
        if middag_modus:
            teksten = {
                "zonnig": "De rest van de middag schijnt de zon volop.",
                "sluier": "De zon schijnt nog geregeld, al trekken er velden met hoge sluierbewolking over.",
                "stapel": "Zon en stapelwolken wisselen elkaar de rest van de middag af.",
                "halfbewolkt": "De rest van de middag is het wisselend bewolkt, met af en toe zon.",
                "wisselend": "De rest van de middag blijft het overwegend bewolkt; de zon laat zich hooguit af en toe zien.",
                "middelhoog": "De rest van de middag blijft er veel bewolking; de zon laat zich weinig zien.",
                "grijs": "Het blijft de rest van de middag grijs, met veel lage bewolking.",
                "zwaar": "Het blijft de rest van de middag zwaar bewolkt.",
            }
            zinnen.append(teksten.get(k, "Het blijft de rest van de middag bewolkt."))
            return zinnen
        if verloop == "opklarend" and k not in ("zonnig",):
            if (ochtend.get("cl_l") or 0) >= 0.6:
                zinnen.append(self.kies(
                    "Na een grijze start breekt de zon in de loop van de ochtend steeds vaker door.",
                    "De dag begint grijs, maar in de loop van de dag komt de zon er steeds vaker door.",
                    "Na een bewolkte ochtend krijgt de zon in de middag meer ruimte."))
            else:
                zinnen.append(self.kies(
                    "In de middag komt de zon er vaker door dan in de ochtend.",
                    "De bewolking breekt in de loop van de dag steeds verder open."))
            if k == "sluier":
                zinnen.append("Wel trekken er velden met hoge sluierbewolking over.")
            return zinnen
        if verloop == "dichtrekkend":
            begin = {"zonnig": "De dag begint zonnig", "sluier": "De dag begint met zon en sluierbewolking",
                     "stapel": "De dag begint met zon en een paar stapelwolken"}.get(k, "In de ochtend is er nog regelmatig zon")
            zinnen.append(self.kies(
                f"{begin}, maar in de loop van de middag neemt de bewolking toe.",
                f"{begin}; later op de dag raakt de lucht meer bewolkt."))
            return zinnen
        teksten = {
            "zonnig": ("Het wordt een zonnige dag.", "De zon schijnt volop.", "Er is veel zon, met hooguit een enkel wolkje."),
            "sluier": ("De zon schijnt geregeld, al trekken er ook velden met hoge sluierbewolking over.",
                       "Hoge sluierbewolking maakt de zon af en toe wat flets, maar er is toch geregeld zon.",
                       "Er is geregeld zon, soms wat getemperd door hoge sluierbewolking."),
            "stapel": ("Zon en stapelwolken wisselen elkaar af.", "Er zijn zonnige perioden, afgewisseld met stapelwolken.",
                       "Het is een dag met zon en stapelwolken."),
            "halfbewolkt": ("Het is wisselend bewolkt, met regelmatig zon.", "Wolken en zon wisselen elkaar af.",
                            "Er zijn wolkenvelden, maar de zon komt er regelmatig door."),
            "wisselend": ("Het is wisselend bewolkt; de zon laat zich af en toe zien.",
                          "Er is veel bewolking, maar af en toe breekt de zon door.",
                          "Het is overwegend bewolkt, met af en toe een zonnige periode."),
            "middelhoog": ("Er drijft veel bewolking over op middelbare hoogte; de zon laat zich maar af en toe zien.",
                           "Een wolkendek op middelbare hoogte houdt de zon grotendeels tegen."),
            "grijs": ("Het is een grijze dag met veel lage bewolking.", "Laaghangende bewolking houdt de zon het grootste deel van de dag tegen.",
                      "Het blijft grijs; de lage bewolking breekt nauwelijks open."),
            "zwaar": ("Het is zwaar bewolkt.", "De lucht blijft dicht bewolkt."),
        }
        zinnen.append(self.kies(*teksten.get(k, ("Het is wisselend bewolkt.",))))
        return zinnen

    # ── Weerbeeld 's nachts ─────────────────────────────────────────────────
    def lucht_nacht(self, p: dict, na_neerslag: bool = False) -> list[str]:
        k = p["lucht"]["klasse"]
        if na_neerslag:
            return [{"helder": "Daarna klaart het op.", "opklaringen": "Daarna breekt de bewolking af en toe open.",
                     "sluier": "Daarna is het vrij helder.", "bewolkt": "Daarna blijft het bewolkt."}.get(k, "Daarna breekt de bewolking af en toe open.")]
        start = uur_van(p["start"])
        avond = self.vak(start.date(), "18-24") if start.hour < 22 else None
        nacht = self.vak(uur_van(p["eind"]).date(), "00-06")
        zinnen = []
        if avond and nacht and avond.get("cl_l") is not None and nacht.get("cl_l") is not None:
            la, ln = avond["cl_l"], nacht["cl_l"]
            ta = 1 - (1 - (avond.get("cl_h") or 0)) * (1 - (avond.get("cl_m") or 0)) * (1 - la)
            tn = 1 - (1 - (nacht.get("cl_h") or 0)) * (1 - (nacht.get("cl_m") or 0)) * (1 - ln)
            if ta - tn >= 0.3:
                zinnen.append(self.kies(
                    "In de loop van de nacht breekt de bewolking open.",
                    "Later in de nacht ontstaan er opklaringen.",
                    "Na een bewolkte avond klaart het in de loop van de nacht op."))
                return zinnen
            if tn - ta >= 0.3:
                zinnen.append(self.kies(
                    "In de loop van de nacht neemt de bewolking toe.",
                    "Het begint vrij helder, maar later in de nacht trekt de lucht dicht."))
                return zinnen
        teksten = {
            "helder": ("Het is een heldere nacht.", "De nacht is grotendeels helder.", "Er is weinig bewolking."),
            "opklaringen": ("Er zijn wolkenvelden, afgewisseld met opklaringen.", "Af en toe breekt de bewolking open.",
                            "Bewolking en opklaringen wisselen elkaar af."),
            "sluier": ("Er drijven wat hoge wolkenvelden over, maar verder is het vrij helder.",),
            "bewolkt": ("Het blijft overwegend bewolkt.", "De lucht blijft grotendeels bewolkt.", "Het is bewolkt."),
        }
        zinnen.append(self.kies(*teksten.get(k, ("Het is wisselend bewolkt.",))))
        return zinnen

    # ── Neerslag ────────────────────────────────────────────────────────────
    def neerslag(self, p: dict, nacht: bool = False) -> list[str]:
        N = p["neerslag"]
        kans = N["kans"]
        soort = N.get("soort") or "regen"
        zinnen = []
        self.droog_na = False
        t_begin = uur_van(N.get("timing", {}).get("begin_mediaan"))
        t_eind = uur_van(N.get("timing", {}).get("eind_mediaan"))
        start, eind = uur_van(p["start"]), uur_van(p["eind"])
        duur_periode = (eind - start).total_seconds() / 3600
        wanneer = ""
        if t_begin and (t_begin - start).total_seconds() / 3600 >= 1.5:
            wanneer = dagdeel_woord(t_begin, nacht)
        elif t_begin and nacht and start.hour == 18:
            wanneer = "in de avond"
        regio = self.neerslag_regio(N)
        bui = {"buien": "een bui", "regen": "wat regen", "motregen": "wat motregen"}[soort]

        if kans < 10:
            if nacht:
                zinnen.append(self.kies("Het blijft droog.", "Het blijft overal droog."))
            else:
                zinnen.append(self.kies("Het blijft droog.", "Het blijft de hele dag droog.", "Neerslag wordt niet verwacht."))
            return zinnen
        if kans < 25:
            if N.get("uitschieters"):
                wn = f" {wanneer}" if wanneer else ""
                zinnen.append(self.kies(
                    f"De meeste modellen houden het droog. Een enkel model laat{wn} {bui} vallen, dus helemaal uitgesloten is het niet.",
                    f"Vrijwel overal blijft het droog. Alleen een enkele berekening laat{wn} {bui} vallen; de kans daarop is klein."))
            else:
                deel = f" {wanneer}" if wanneer else ""
                zinnen.append(self.kies(
                    f"Het blijft grotendeels droog; heel misschien valt er{deel}{regio} {bui}.",
                    f"De meeste plaatsen blijven droog, al is{deel}{regio} {bui} niet uitgesloten."))
            return zinnen
        if soort == "motregen":
            if kans < 55:
                zinnen.append(f"Uit het wolkendek kan{(' ' + wanneer) if wanneer else ''} af en toe wat motregen vallen{regio}.")
            else:
                zinnen.append(f"Uit het wolkendek valt{(' ' + wanneer) if wanneer else ''} af en toe wat motregen{regio}.")
            return zinnen
        def zin(met_tijd: str, zonder_tijd: str) -> str:
            """met_tijd: bijzin na de tijdsbepaling ("trekken er buien over");
            zonder_tijd: volledige zin als er geen tijdsbepaling is."""
            return cap(f"{wanneer} {met_tijd}") if wanneer else cap(zonder_tijd)

        if kans < 45:
            if soort == "buien":
                zinnen.append(self.kies(
                    zin(f"kan er{regio} hier en daar een bui vallen, maar lang niet overal.",
                        f"Hier en daar kan{regio} een bui vallen, maar lang niet overal."),
                    zin(f"is er{regio} een kleine kans op een bui.", f"Er is{regio} een kleine kans op een bui.")))
            else:
                zinnen.append(self.kies(
                    zin(f"valt er{regio} mogelijk wat regen, al blijft het op veel plaatsen droog.",
                        f"Er valt{regio} mogelijk wat regen, al blijft het op veel plaatsen droog."),
                    zin(f"kan er{regio} wat regen vallen.", f"Er kan{regio} wat regen vallen.")))
        elif kans < 65:
            if soort == "buien":
                zinnen.append(self.kies(
                    zin(f"trekken er{regio} enkele buien over.", f"Er trekken{regio} enkele buien over."),
                    zin(f"is er{regio} een redelijke kans op een bui.", f"Er is{regio} een redelijke kans op een bui.")))
            else:
                zinnen.append(self.kies(
                    zin(f"komt er{regio} regen, al wordt het waarschijnlijk niet overal nat.",
                        f"Er valt{regio} af en toe regen, al wordt het waarschijnlijk niet overal nat."),
                    zin(f"valt er{regio} af en toe regen.", f"Er valt{regio} af en toe regen.")))
        else:
            if soort == "buien":
                zinnen.append(self.kies(
                    zin(f"trekken er{regio} buien over.", f"Er trekken{regio} buien over."),
                    zin(f"krijgen we{regio} te maken met buien.", f"We krijgen{regio} te maken met buien.")))
            else:
                zinnen.append(self.kies(
                    zin(f"gaat het{regio} regenen.", f"Het gaat{regio} regenen."),
                    zin(f"trekt er{regio} een regenzone over.", f"Er trekt{regio} een regenzone over.")))
        # Hoeveelheid
        als_nat = N.get("als_nat") or {}
        if soort == "buien":
            if kans >= 35 and ((als_nat.get("p80") or 0) >= 10 or (N.get("max_uur") or 0) >= 10):
                zinnen.append("Onder een zware bui kan plaatselijk in korte tijd veel regen vallen.")
        elif kans >= 50 and (als_nat.get("mediaan") or 0) >= 2:
            lo, hi = afr(als_nat.get("p20") or als_nat["mediaan"]), afr(als_nat.get("p80") or als_nat["mediaan"])
            lo = max(1, lo)
            if hi >= 10:
                zinnen.append(f"Er valt {lo} tot {hi} millimeter; plaatselijk kan het flink nat worden.")
            elif hi > lo:
                zinnen.append(f"Er valt in totaal {lo} tot {hi} millimeter.")
        elif kans >= 50 and 0 < (als_nat.get("mediaan") or 0) < 1:
            zinnen.append(self.kies("Veel neerslag valt er niet.", "Het gaat om kleine hoeveelheden."))
        # Onweer en hagel
        if N.get("onweer") == "redelijk":
            zinnen.append("Bij de buien kan het ook onweren" + (", met kans op hagel." if N.get("hagel") else "."))
        elif N.get("onweer") == "klein" and soort == "buien":
            zinnen.append(self.kies("Een onweersbui is niet helemaal uitgesloten.",
                                    "Een enkele bui kan gepaard gaan met onweer."))
        if t_eind and t_begin and (t_eind - t_begin).total_seconds() / 3600 <= 4 and kans >= 45 \
                and (eind - t_eind).total_seconds() / 3600 >= 3:
            self.droog_na = True
            zinnen.append(cap(f"{dagdeel_woord(t_eind + timedelta(hours=1), nacht)} wordt het weer droog."))
        if N.get("timing", {}).get("begin_spreiding_uur", 0) >= 6:
            zinnen.append("Hoe laat de neerslag precies komt, is nog onzeker.")
        return zinnen

    def neerslag_regio(self, N: dict) -> str:
        r = N.get("regio") or {}
        noord, zuid = r.get("noord") or 0, r.get("zuid") or 0
        kust, land = r.get("kust") or 0, r.get("land") or 0
        if max(noord, zuid) >= 0.2 and abs(noord - zuid) >= 0.15:
            return " vooral ten noorden van de Maas" if noord > zuid else " vooral ten zuiden van de Maas"
        if max(kust, land) >= 0.2 and abs(kust - land) >= 0.2:
            return " vooral aan de kust" if kust > land else " vooral landinwaarts"
        return ""

    # ── Temperatuur ─────────────────────────────────────────────────────────
    def temp_dag(self, p: dict, middag_modus: bool = False) -> list[str]:
        T = p["temperatuur"]
        z = []
        tx = afr(T["waarde"])
        lo, hi = afr(T["p20"]), afr(T["p80"])
        if middag_modus:
            gemeten = T.get("gemeten_max_tot_nu")
            eind = afr(T.get("t_eind") or T["waarde"])
            if gemeten is not None and gemeten >= T["waarde"] - 0.3:
                z.append(self.kies(
                    f"De warmste uren liggen achter ons: het werd vanmiddag {afr(gemeten)} graden. Tegen de avond is het nog zo'n {eind} graden.",
                    f"Vanmiddag werd het {afr(gemeten)} graden; tot het begin van de avond blijft het rond {eind} graden."))
            else:
                z.append(f"De temperatuur loopt de rest van de middag nog op tot ongeveer {tx} graden.")
            return z
        if hi - lo >= 3:
            z.append(self.kies(
                f"Hoe warm het wordt, is nog wat onzeker: de middagtemperatuur komt ergens tussen {lo} en {hi} graden uit.",
                f"De middagtemperatuur ligt waarschijnlijk tussen {lo} en {hi} graden."))
        elif hi > lo:
            z.append(self.kies(f"Het wordt {graden(lo, hi)}.", f"De middagtemperatuur komt uit op {graden(lo, hi)}.",
                               f"De temperatuur loopt op tot {graden(lo, hi)}."))
        else:
            z.append(self.kies(f"Het wordt ongeveer {tx} graden.", f"De middagtemperatuur komt uit op ongeveer {tx} graden.",
                               f"De temperatuur loopt op tot zo'n {tx} graden."))
        # Vergelijking met de dag ervoor en met normaal direct na het hoofdgetal
        verschil = T.get("verschil_vorige_dag")
        norm = T.get("normaal")
        gisteren = self.dagnaam((date.fromisoformat(p["datum"]) - timedelta(days=1)).isoformat())
        if T["waarde"] >= 29.5:
            z.append("Het wordt tropisch warm.")
        elif T["waarde"] >= 24.5 and (norm is None or T["waarde"] - norm >= 3):
            z.append("Het wordt zomers warm.")
        elif verschil is not None and abs(verschil) >= 1.5:
            mate = "duidelijk " if abs(verschil) >= 2.5 else "iets "
            z.append(f"Daarmee is het {mate}{'warmer' if verschil > 0 else 'koeler'} dan {gisteren}.")
        if norm is not None and T["waarde"] < 24.5:
            afwijking = T["waarde"] - norm
            if afwijking >= 4:
                z.append("Dat is warm voor de tijd van het jaar.")
            elif afwijking <= -3:
                z.append("Dat is aan de frisse kant voor de tijd van het jaar.")
        kust = T.get("kust")
        if kust is not None and T["waarde"] - kust >= 1.5:
            mate = "duidelijk" if T["waarde"] - kust >= 3 else "wat"
            z.append(self.kies(f"Aan zee blijft het met {afr(kust)} graden {mate} koeler.",
                               f"Aan de kust is het met {afr(kust)} graden {mate} frisser."))
        elif kust is not None and kust - T["waarde"] >= 1.5:
            z.append(f"Aan zee is het met {afr(kust)} graden iets zachter.")
        if (T.get("warmst") or tx) - T["waarde"] >= 1.5:
            z.append(f"Op de warmste plekken, landinwaarts, wordt het {afr(T['warmst'])} graden.")
        return z

    def temp_nacht(self, p: dict) -> list[str]:
        T = p["temperatuur"]
        z = []
        tn = afr(T["waarde"])
        lo, hi = afr(T["p20"]), afr(T["p80"])
        stad, plat, koud, kust = T.get("stad"), T.get("platteland"), T.get("koudst"), T.get("kust")
        stad_zacht = stad is not None and koud is not None and stad - koud >= 1.5
        kust_zacht = kust is not None and koud is not None and kust - koud >= 1.5 and kust - T["waarde"] >= 1.0
        if stad_zacht and kust_zacht:
            a, b = sorted((afr(stad), afr(kust)))
            z.append(self.kies(
                f"Het koelt af naar {afr(koud)} graden in de polders. In de stad en aan zee blijft het met {graden(a, b)} zachter.",
                f"Op het platteland zakt de temperatuur naar {afr(koud)} graden; in de stad en aan de kust blijft het met {graden(a, b)} zachter."))
        elif stad_zacht:
            z.append(self.kies(
                f"Het koelt af naar {afr(koud)} graden in de polders; in de stad blijft het met {afr(stad)} graden wat zachter.",
                f"In de stad zakt de temperatuur naar ongeveer {afr(stad)} graden, op het platteland naar {afr(koud)} graden."))
        else:
            if hi - lo >= 3:
                z.append(f"De laagste temperatuur ligt waarschijnlijk tussen {lo} en {hi} graden.")
            else:
                z.append(self.kies(f"Het koelt af naar {graden(lo, hi) if hi > lo else f'ongeveer {tn} graden'}.",
                                   f"De temperatuur zakt naar {graden(lo, hi) if hi > lo else f'zo’n {tn} graden'}."))
            if kust_zacht:
                z.append(self.kies(f"Aan zee blijft het zachter, rond {afr(kust)} graden.",
                                   f"Aan de kust blijft het met {afr(kust)} graden zachter."))
        norm = T.get("normaal")
        if norm is not None:
            if T["waarde"] - norm >= 4:
                z.append(self.kies("Voor de tijd van het jaar is het een zachte nacht.", "Het is een zachte nacht voor de tijd van het jaar."))
            elif T["waarde"] - norm <= -3:
                z.append("Voor de tijd van het jaar is het een frisse nacht.")
        if (T.get("koudst") or tn) <= 3 and (T.get("koudst") or tn) > 0:
            z.append("Op enkele plaatsen kan het aan de grond licht vriezen.")
        elif (T.get("koudst") or tn) <= 0:
            z.append("Het vriest licht; houd rekening met gladheid door rijp of bevroren plekken.")
        return z

    # ── Wind ────────────────────────────────────────────────────────────────
    def wind(self, p: dict, nacht: bool = False) -> list[str]:
        W = p["wind"]
        z = []
        b = W.get("bft")
        if b is None:
            return z
        lo, hi = W.get("bft_p20") or b, W.get("bft_p80") or b
        lo, hi = min(lo, b), max(hi, b)
        if hi - lo > 1:
            lo, hi = b, b + 1 if hi > b else b
        r = W.get("richting")
        d = W.get("draaiing")
        naam = wind_naam(lo, hi)
        if b <= 1 or (W.get("eensgezind") or 1) < 0.45:
            if b <= 1:
                z.append(self.kies("Er staat nauwelijks wind.", "Het is vrijwel windstil."))
            else:
                z.append(f"De wind is {naam} en komt uit wisselende richting.")
        elif d and b >= 2:
            later = "later in de nacht" if nacht else "in de loop van de dag"
            z.append(self.kies(
                f"De wind komt eerst uit het {RICHTING_ZN[d['van']]} en draait {later} naar het {RICHTING_ZN[d['naar']]}; hij is {naam}, {bft_tekst(lo, hi)}.",
                f"De {RICHTING_WIND[d['van']]} is {naam}, {bft_tekst(lo, hi)}, en draait {later} naar het {RICHTING_ZN[d['naar']]}."))
        else:
            bv = verbogen(naam)
            z.append(self.kies(
                f"De {RICHTING_WIND[r]} is {naam}, {bft_tekst(lo, hi)}.",
                f"De wind komt uit het {RICHTING_ZN[r]} en is {naam}, {bft_tekst(lo, hi)}.",
                f"Er staat een {bv} {RICHTING_BN[r]} wind, {bft_tekst(lo, hi)}." if bv else
                f"De {RICHTING_WIND[r]} is {naam}, {bft_tekst(lo, hi)}."))
        bmax = W.get("bft_max")
        if bmax is not None and bmax >= hi + 1 and bmax >= 4:
            woord = f" ({WIND_NAAM[bmax]})" if bmax >= 6 else ""
            z.append(f"Tijdelijk neemt de wind toe tot {bft_tekst(bmax)}{woord}.")
        bk = W.get("bft_kust")
        if bk is not None and bk >= hi + 1:
            if bk >= 8:
                z.append(f"Aan zee {'stormt het' if bk >= 9 else 'is het stormachtig'}, {bft_tekst(bk)}.")
            elif bk >= 6:
                z.append(self.kies(f"Aan zee staat duidelijk meer wind, {bft_tekst(bk)}.",
                                   f"Aan de kust is de wind {WIND_NAAM[bk]}, {bft_tekst(bk)}."))
            else:
                z.append(self.kies(f"Aan zee staat wat meer wind, {bft_tekst(bk)}.",
                                   f"Aan de kust waait het wat harder, {bft_tekst(bk)}."))
        sl, sk = W.get("stoten_land_kmh"), W.get("stoten_kust_kmh")
        if (sl or 0) >= 50 or (sk or 0) >= 60:
            zwaar = "zware " if max(sl or 0, sk or 0) >= 90 else ""
            if (sk or 0) >= (sl or 0) + 10 and (sk or 0) >= 60:
                z.append(f"Aan zee zijn {zwaar}windstoten tot ongeveer {afr5(sk)} km/u mogelijk"
                         + (f", landinwaarts tot {afr5(sl)} km/u." if (sl or 0) >= 45 else "."))
            else:
                z.append(f"Er staan {zwaar}windstoten tot ongeveer {afr5(max(sl or 0, sk or 0))} km/u.")
            if (sl or 0) >= 75:
                z.append("Houd rekening met overlast door de wind.")
        return z

    # ── Mist ────────────────────────────────────────────────────────────────
    def mist(self, p: dict) -> list[str]:
        M = p.get("mist") or {}
        k = M.get("klasse", "geen")
        z = []
        if k in ("geen",):
            return z
        waar = ""
        regio = M.get("regio") or {}
        if regio:
            beste = max(regio, key=regio.get)
            if regio[beste] >= 0.15 and regio[beste] - min(regio.values()) >= 0.1:
                waar = {"eilanden": ", vooral op de Zuid-Hollandse eilanden", "oost": ", vooral rond Dordrecht en Ridderkerk",
                        "stad": ", ook in het stedelijk gebied"}.get(beste, "")
        if not waar and p["lucht"]["klasse"] in ("helder", "opklaringen", "sluier"):
            waar = ", vooral buiten de stad"
        if k == "klein":
            if (M.get("ws_nacht") or 9) <= 1.5 and p["lucht"]["klasse"] in ("helder", "opklaringen"):
                z.append(f"Plaatselijk kan wat nevel ontstaan{waar}.")
            return z
        if k == "mogelijk":
            z.append(self.kies(f"Tijdens langere opklaringen kan plaatselijk mist ontstaan{waar}.",
                               f"Waar de wind wegvalt en het opklaart, kan mist ontstaan{waar}."))
        elif k == "waarschijnlijk":
            z.append(self.kies(f"In de tweede helft van de nacht ontstaat op veel plaatsen mist{waar}.",
                               f"Later in de nacht vormt zich mist{waar}."))
        else:
            z.append(f"Er vormt zich mist{waar}.")
            if M.get("dicht"):
                z.append("Plaatselijk is die dicht, met zicht van minder dan 200 meter. Houd daar in de ochtendspits rekening mee.")
        tot = uur_van(M.get("tot"))
        if tot and k in ("waarschijnlijk", "zeker"):
            if tot.hour <= 10:
                z.append("In de loop van de ochtend lost de mist op.")
            else:
                z.append("De mist kan tot het middaguur blijven hangen.")
        return z

    # ── Synoptische aanloop ─────────────────────────────────────────────────
    def aanloop(self, p: dict, volgende: dict | None) -> str | None:
        """Hooguit één zin over de grote lijn, alleen bij een duidelijk signaal."""
        d = p.get("druk") or {}
        dp = p.get("drukpatroon") or {}
        N = p["neerslag"]
        W = p["wind"]
        niveau = d.get("begin")
        tendens = d.get("tendens") or 0
        # Koufront: neerslag + wind draait naar west/noordwest + druk stijgt daarna
        stijgt_erna = (tendens >= 2) or ((volgende or {}).get("druk", {}).get("tendens", 0) >= 2)
        naar_nw = (W.get("draaiing") or {}).get("naar") in ("west", "noordwest", "noord") or \
                  (W.get("richting") in ("west", "noordwest") and p["soort"] == "nacht")
        if N["kans"] >= 40 and stijgt_erna and naar_nw:
            koeler = volgende is not None and volgende["soort"] == "dag" and \
                (volgende["temperatuur"].get("verschil_vorige_dag") or 0) <= -1.5
            if self.guidance_noemt(p["datum"], "koufront") or self.guidance_noemt(p["start"], "koufront"):
                kern = self.kies("Een koufront trekt over Rijnmond heen", "Er trekt een koufront over de regio")
            else:
                kern = "Er trekt een storing over"
            return kern + ("; daarachter stroomt wat koelere lucht binnen." if koeler else ".")
        if niveau and niveau >= 1025 and N["kans"] < 15 and (dp.get("gradient") or 9) < 0.6:
            return self.kies("Een hogedrukgebied ligt dicht bij ons land en zorgt voor rustig weer.",
                             "Hogedruk houdt het weer rustig.")
        if tendens <= -4 and N["kans"] < 30 and volgende and volgende["neerslag"]["kans"] >= 40:
            return "De luchtdruk daalt: vanaf zee nadert een storing."
        return None

    # ── Secties ─────────────────────────────────────────────────────────────
    def windkop(self, p: dict) -> str | None:
        W = p["wind"]
        if (W.get("bft") or 0) >= 7 or (W.get("bft_kust") or 0) >= 8 or (W.get("stoten_land_kmh") or 0) >= 75:
            return self.kies(f"Het wordt een onstuimige {'nacht' if p['soort'] == 'nacht' else 'dag'} met veel wind.",
                             f"De wind is {'deze nacht' if p['soort'] == 'nacht' else 'vandaag'} het belangrijkste weerelement.") \
                if p["key"] == "vandaag" else f"Het wordt een onstuimige {'nacht' if p['soort'] == 'nacht' else 'dag'} met veel wind."
        return None

    def sectie_dag(self, p: dict, volgende: dict | None) -> list[str]:
        middag = p["key"] == "vandaag" and p.get("deel") == "middag"
        alinea1 = []
        kop = self.windkop(p)
        if kop:
            alinea1.append(kop)
        a = self.aanloop(p, volgende)
        if a and not middag:
            alinea1.append(a)
        if middag and self.f.get("waarnemingen"):
            obs = self.f["waarnemingen"]["stations"].get("rtha") or {}
            n = obs.get("bewolking_octa")
            if n is not None and obs.get("t") is not None:
                lucht = "zwaar bewolkt" if n >= 7 else "half bewolkt" if n >= 4 else "vrij zonnig"
                alinea1.append(f"Op dit moment is het in Rotterdam {lucht} en {afr(obs['t'])} graden.")
        alinea1 += self.samen(self.lucht_dag(p, middag), self.neerslag(p), p["neerslag"]["kans"])
        # Avondvooruitblik als de volgende nacht duidelijk natter is
        if not middag and volgende and volgende["neerslag"]["kans"] >= 40 and p["neerslag"]["kans"] < 35:
            alinea1.append("In de avond neemt de kans op een bui toe." if volgende["neerslag"].get("soort") == "buien"
                           else "In de avond neemt de kans op regen toe.")
        alinea2 = self.temp_dag(p, middag) + self.wind(p)
        onzeker = self.onzekerheid(p)
        if onzeker:
            alinea2.append(onzeker)
        return [glad(alinea1), glad(alinea2)]

    def sectie_nacht(self, p: dict, volgende: dict | None) -> list[str]:
        alinea1 = []
        kop = self.windkop(p)
        if kop:
            alinea1.append(kop)
        a = self.aanloop(p, volgende)
        if a:
            alinea1.append(a)
        if p["neerslag"]["kans"] >= 35:
            alinea1 += self.neerslag(p, nacht=True)
            alinea1 += self.lucht_nacht(p, na_neerslag=self.droog_na)
        else:
            alinea1 += self.samen(self.lucht_nacht(p), self.neerslag(p, nacht=True), p["neerslag"]["kans"])
        alinea1 += self.mist(p)
        alinea2 = self.temp_nacht(p) + self.wind(p, nacht=True)
        return [glad(alinea1), glad(alinea2)]

    @staticmethod
    def samen(lucht: list[str], neerslag: list[str], kans: int) -> list[str]:
        """Droog weer hoort in dezelfde zin als de bewolking ("Het blijft bewolkt
        en droog.") in plaats van twee zinnen die met dezelfde woorden beginnen."""
        if kans >= 10 or not lucht or not neerslag:
            return lucht + neerslag
        laatste = lucht[-1]
        m = re.match(r"^(Het (?:wordt|is) een )(\w+)( dag| nacht)(.*)\.$", laatste)
        if m and "," not in laatste:
            return lucht[:-1] + [f"{m.group(1)}{m.group(2)} en droge{m.group(3)}{m.group(4)}."] + neerslag[1:]
        eenvoudig = laatste.endswith(".") and not any(t in laatste for t in (",", ";", ":"))
        if eenvoudig and re.match(r"^(Het blijft|Het is|De nacht is|De nacht blijft) (?!een )", laatste):
            return lucht[:-1] + [laatste[:-1] + " en droog."] + neerslag[1:]
        if laatste.startswith("Het blijft") and neerslag[0].startswith("Het blijft"):
            return lucht + ["Het is wel droog."] + neerslag[1:]
        return lucht + neerslag

    def onzekerheid(self, p: dict) -> str | None:
        if p["zekerheid"] == "laag":
            return self.kies("Over de details van deze dag bestaat nog flinke onzekerheid.",
                             "De berekeningen lopen voor deze dag nog behoorlijk uiteen.")
        if p["key"] == "overmorgen" and p["zekerheid"] == "redelijk":
            return "Zo ver vooruit kunnen de details nog veranderen."
        return None

    def nacht2_relevant(self, p: dict) -> bool:
        N, W, M, T = p["neerslag"], p["wind"], p.get("mist") or {}, p["temperatuur"]
        return (N["kans"] >= 35 or M.get("klasse") in ("mogelijk", "waarschijnlijk", "zeker")
                or (W.get("bft") or 0) >= 5 or (W.get("bft_kust") or 0) >= 6
                or (W.get("stoten_land_kmh") or 0) >= 55 or (T.get("koudst") or 9) <= 3
                or N.get("onweer") != "geen")

    # ── Vooruitzicht ────────────────────────────────────────────────────────
    def daarna(self) -> str | None:
        dagen = self.f.get("daarna") or []
        if not dagen:
            return None
        zinnen = []
        namen = [DAGEN[date.fromisoformat(d["datum"]).weekday()] for d in dagen]
        kansen = [d.get("kans_neerslag") for d in dagen]
        tx = [d.get("tmax") for d in dagen]
        norm = [d.get("normaal_tx") for d in dagen]
        druk = [d.get("druk") for d in dagen]
        # Grote lijn: druk en neerslag
        droog = [k is not None and k < 25 for k in kansen]
        nat = [k is not None and k >= 50 for k in kansen]
        if all(droog):
            if druk[0] and druk[0] >= 1018:
                zinnen.append(self.kies("Hogedrukgebieden blijven de komende dagen de baas en het blijft overwegend droog.",
                                        "De rest van de week blijft het onder invloed van hogedruk overwegend droog."))
            else:
                zinnen.append("De dagen daarna blijft het overwegend droog.")
        else:
            eerste_nat = next((i for i, n in enumerate(nat) if n), None)
            if eerste_nat is not None:
                ervoor = [namen[i] for i in range(eerste_nat) if droog[i]]
                if ervoor and len(ervoor) == eerste_nat:
                    tot = ervoor[-1]
                    zinnen.append(f"Tot en met {tot} blijft het waarschijnlijk droog.")
                daling = druk[0] is not None and druk[eerste_nat] is not None and druk[0] - druk[eerste_nat] >= 5
                if daling:
                    zinnen.append(f"Daarna krijgen lagedrukgebieden meer invloed en neemt {namen[eerste_nat]} de kans op regen flink toe.")
                else:
                    zinnen.append(f"{cap(namen[eerste_nat])} neemt de kans op regen flink toe.")
            else:
                wisselend = [namen[i] for i, k in enumerate(kansen) if k is not None and 25 <= k < 50]
                if wisselend:
                    zinnen.append(f"Het blijft overwegend droog, al is er {self.opsomming(wisselend)} een kleine kans op een bui.")
                else:
                    zinnen.append("Het blijft overwegend droog.")
        # Temperatuur
        geldig = [t for t in tx if t is not None]
        if geldig:
            lo, hi = afr(min(geldig)), afr(max(geldig))
            gem_norm = sum(n for n in norm if n) / max(1, len([n for n in norm if n])) if any(norm) else None
            gem = sum(geldig) / len(geldig)
            afwijking = gem - gem_norm if gem_norm is not None else 0
            if afwijking >= 3:
                niveau = ", en dat is zacht voor de tijd van het jaar."
            elif afwijking >= 1.5:
                niveau = ", iets boven normaal voor de tijd van het jaar."
            elif afwijking <= -2.5:
                niveau = ", wat fris is voor de tijd van het jaar."
            elif afwijking <= -1.5:
                niveau = ", iets onder normaal voor de tijd van het jaar."
            else:
                niveau = ", ongeveer normaal voor de tijd van het jaar."
            zin = f"De middagtemperatuur ligt {'op' if lo == hi else 'tussen'} {lo if lo == hi else f'{lo} en {hi}'} graden"
            zinnen.append(zin + niveau)
        # Zon: noem de zonnigste dag als die er duidelijk uitspringt
        zon = [(d.get("lucht") or {}).get("zon_uren") for d in dagen]
        if all(z is not None for z in zon) and len(zon) >= 2:
            beste = max(range(len(zon)), key=lambda i: zon[i])
            if zon[beste] >= 6 and zon[beste] - sorted(zon)[-2] >= 2:
                zinnen.append(f"{cap(namen[beste])} lijkt de zonnigste dag.")
        # Wind
        bft_max = max((d.get("wind") or {}).get("bft") or 0 for d in dagen)
        bft_kust_max = max((d.get("wind") or {}).get("bft_kust") or 0 for d in dagen)
        if bft_max >= 5 or bft_kust_max >= 6:
            winderig = [namen[i] for i, d in enumerate(dagen) if ((d.get("wind") or {}).get("bft") or 0) >= 5 or ((d.get("wind") or {}).get("bft_kust") or 0) >= 6]
            zinnen.append(f"{cap(self.opsomming(winderig))} kan het flink waaien, vooral aan zee.")
        elif bft_max <= 3:
            zinnen.append(self.kies("De wind is meestal zwak tot matig.", "Veel wind staat er niet."))
        # Onzekerheid en consistentie
        breed = [namen[i] for i, d in enumerate(dagen) if d.get("tmax_ens") and d["tmax_ens"][0] is not None
                 and d["tmax_ens"][2] - d["tmax_ens"][0] >= 4]
        weinig_modellen = [namen[i] for i, d in enumerate(dagen) if d.get("tmax_ens") is None]
        trend = {r["datum"]: r for r in self.f.get("ens_trend", [])}
        verschuiving = [(namen[i], trend[d["datum"]]["verschil_tmax"]) for i, d in enumerate(dagen)
                        if d["datum"] in trend and trend[d["datum"]].get("verschil_tmax") is not None
                        and abs(trend[d["datum"]]["verschil_tmax"]) >= 1.5]
        if verschuiving:
            naam, dt = verschuiving[0]
            zinnen.append(f"Voor {naam} zijn de nieuwste berekeningen wat {'warmer' if dt > 0 else 'koeler'} dan een dag eerder.")
        if breed or weinig_modellen:
            wie = (weinig_modellen or breed)[-1]
            zinnen.append(self.kies(f"Vooral voor {wie} is de onzekerheid nog groot.",
                                    f"Hoe het weer vanaf {wie} precies uitpakt, is nog onzeker."))
        return " ".join(zinnen)

    @staticmethod
    def opsomming(namen: list[str]) -> str:
        if not namen:
            return ""
        if len(namen) == 1:
            return namen[0]
        return ", ".join(namen[:-1]) + " en " + namen[-1]

    # ── Overzicht (drie kaartjes) ───────────────────────────────────────────
    @staticmethod
    def neerslag_kort(N: dict) -> str:
        k, s = N["kans"], N.get("soort") or "regen"
        if k < 10:
            return "droog"
        if k < 25:
            return "vrijwel droog"
        if s == "motregen":
            return "af en toe motregen"
        if k < 45:
            return "kans op een bui" if s == "buien" else "kans op regen"
        if k < 65:
            return "enkele buien" if s == "buien" else "af en toe regen"
        return "buien" if s == "buien" else "regen"

    @staticmethod
    def lucht_kort(klasse: str, nacht: bool) -> str:
        if nacht:
            return {"helder": "Helder", "opklaringen": "Opklaringen", "bewolkt": "Bewolkt", "sluier": "Vrij helder"}.get(klasse, "Wisselend bewolkt")
        return {"zonnig": "Zonnig", "sluier": "Zon en sluierwolken", "stapel": "Zon en stapelwolken",
                "halfbewolkt": "Wisselend bewolkt", "wisselend": "Veel bewolking", "middelhoog": "Bewolkt",
                "grijs": "Grijs", "zwaar": "Zwaar bewolkt"}.get(klasse, "Wisselend bewolkt")

    @staticmethod
    def icoon(p: dict) -> str:
        N, L = p["neerslag"], p["lucht"]["klasse"]
        nacht = p["soort"] == "nacht"
        if N.get("onweer") == "redelijk" and N["kans"] >= 35:
            return "onweer"
        if N["kans"] >= 45:
            return "bui" if N.get("soort") == "buien" else "regen"
        if nacht and (p.get("mist") or {}).get("klasse") in ("waarschijnlijk", "zeker"):
            return "mist"
        if nacht:
            return {"helder": "maan", "sluier": "maan", "opklaringen": "maan_wolk"}.get(L, "wolk")
        return {"zonnig": "zon", "sluier": "zon_sluier", "stapel": "zon_wolk", "halfbewolkt": "zon_wolk"}.get(L, "wolk")

    def kaart(self, p: dict, titel: str) -> dict:
        nacht = p["soort"] == "nacht"
        T, W, N = p["temperatuur"], p["wind"], p["neerslag"]
        omschr = self.lucht_kort(p["lucht"]["klasse"], nacht)
        extra = self.neerslag_kort(N)
        if nacht and (p.get("mist") or {}).get("klasse") in ("mogelijk", "waarschijnlijk", "zeker") and N["kans"] < 45:
            extra = {"mogelijk": "kans op mist", "waarschijnlijk": "mist", "zeker": "mist"}[p["mist"]["klasse"]]
        temp = afr(T["waarde"])
        if p["key"] == "vandaag" and T.get("gemeten_max_tot_nu") is not None:
            temp = max(temp, afr(T["gemeten_max_tot_nu"]))
        return {
            "key": p["key"], "titel": titel, "dag_label": p["dag_label"],
            "temp_soort": "max" if not nacht else "min", "temp": temp,
            "temp_kust": afr(T.get("kust")) if T.get("kust") is not None else None,
            "wind_richting": AFK.get(W.get("richting") or "", ""), "wind_bft": W.get("bft"),
            "wind_bft_kust": W.get("bft_kust"),
            "neerslagkans": int(10 * round(N["kans"] / 10)) if N["kans"] >= 10 else (5 if N["kans"] >= 5 else 0),
            "omschrijving": f"{omschr}, {extra}",
            "icoon": self.icoon(p),
            "mist": (p.get("mist") or {}).get("klasse"),
            "zon_uren": afr(p["lucht"].get("zon_uren")) if p["lucht"].get("zon_uren") is not None else None,
        }

    # ── Alles ───────────────────────────────────────────────────────────────
    def schrijf(self) -> dict:
        per = self.f["perioden"]
        secties, kaarten = [], []
        for i, p in enumerate(per):
            volgende = per[i + 1] if i + 1 < len(per) else None
            if p["key"] == "nacht2" and not self.nacht2_relevant(p):
                continue
            if p["soort"] == "dag":
                alineas = self.sectie_dag(p, volgende)
            else:
                alineas = self.sectie_nacht(p, volgende)
            titel = p["titel"]
            if p["key"] in ("morgen", "overmorgen"):
                titel = f"{p['titel']} ({p['dag_label']})"
            secties.append({"key": p["key"], "titel": titel, "alineas": [a for a in alineas if a]})
        d = self.daarna()
        if d:
            eerste = self.f["daarna"][0]["dag_label"]
            laatste = self.f["daarna"][-1]["dag_label"]
            secties.append({"key": "daarna", "titel": "Daarna",
                            "subtitel": f"{eerste} t/m {laatste}", "alineas": [d]})
        # Overzicht: vandaag / vannacht / morgen; na 17 uur (geen "vandaag" meer)
        # schuift het op naar vannacht / morgen / overmorgen.
        nacht = self.perioden.get("vanavond")
        if self.perioden.get("vandaag"):
            reeks = [("vandaag", "Vandaag"), ("vanavond", "Vannacht"), ("morgen", "Morgen")]
        else:
            reeks = [("vanavond", "Vannacht"), ("morgen", "Morgen"), ("overmorgen", "Overmorgen")]
        for key, titel in reeks:
            if self.perioden.get(key):
                kaarten.append(self.kaart(self.perioden[key], titel))
        return {"overzicht": kaarten, "secties": secties}


# ── Modelvergelijking in tabelvorm ──────────────────────────────────────────
def _nl(x, n=1) -> str:
    if x is None:
        return "–"
    s = f"{x:.{n}f}".replace(".", ",")
    return s


def modelvergelijking(feiten: dict) -> list[dict]:
    uit = []
    for p in feiten["perioden"]:
        T, N, W, L = p["temperatuur"], p["neerslag"], p["wind"], p["lucht"]
        n = len(p["modellen"])
        rijen = []
        naam = "Maximumtemperatuur" if T["soort"] == "max" else "Minimumtemperatuur"
        bronnen = []
        if T.get("mosmix") is not None:
            bronnen.append(f"MOSMIX {_nl(T['mosmix'])}")
        ens = T.get("ens") or {}
        p50 = ens.get("tmax_p50") if T["soort"] == "max" else ens.get("tmin_p50")
        if p50 is not None:
            bronnen.append(f"ENS-mediaan {_nl(p50)}")
        lo, hi = afr(T["p20"]), afr(T["p80"])
        aangehouden = afr(T["waarde"])
        uitleg = (f"De meeste modellen komen uit op {lo} tot {hi} graden. Daarom wordt voor Rijnmond ongeveer {aangehouden} graden aangehouden."
                  if hi > lo else f"De modellen liggen dicht bij elkaar; aangehouden wordt ongeveer {aangehouden} graden.")
        gemeten = T.get("gemeten_max_tot_nu")
        if gemeten is not None and gemeten >= T["waarde"] - 0.3:
            aangehouden = max(aangehouden, afr(gemeten))
            uitleg = (f"Het hoogtepunt van de dag is al bereikt: gemeten {_nl(gemeten)} °C. Voor de rest van de middag "
                      f"geven de modellen {graden(lo, hi)}.")
        elif gemeten is not None:
            uitleg += f" Gemeten tot nu: {_nl(gemeten)} °C."
        rijen.append({
            "parameter": naam,
            "modellen": f"{_nl(T['min'])} – {_nl(T['max'])} °C ({n} modellen); meeste {_nl(T['p20'])} – {_nl(T['p80'])}"
                        + (f"; {', '.join(bronnen)}" if bronnen else ""),
            "verwachting": f"{aangehouden} °C" + (f" (kust {afr(T['kust'])})" if T.get("kust") is not None and abs(T['kust'] - T['waarde']) >= 1 else ""),
            "uitleg": uitleg,
        })
        hv = N.get("hoeveelheid") or {}
        ensk = f"; ENS {N['kans_ens']}% ≥ 0,3 mm" if N.get("kans_ens") is not None else ""
        uitleg_n = ""
        if N["modellen_nat"] == 0:
            uitleg_n = "Alle modellen houden het droog."
        elif N.get("uitschieters"):
            namen = ", ".join(u["model"] for u in N["uitschieters"])
            uitleg_n = f"Alleen {namen} berekent neerslag van betekenis; de rest blijft droog. Daarom een kleine neerslagkans."
        elif N["modellen_nat"] >= 0.7 * N["modellen_totaal"]:
            uitleg_n = "De meeste modellen berekenen neerslag."
        else:
            uitleg_n = f"De modellen zijn verdeeld: {N['modellen_nat']} van de {N['modellen_totaal']} berekenen neerslag van betekenis."
        rijen.append({
            "parameter": "Neerslag",
            "modellen": f"{N['modellen_nat']} van {N['modellen_totaal']} nat; gebiedsgemiddeld {_nl(hv.get('min'))} – {_nl(hv.get('max'))} mm{ensk}",
            "verwachting": f"kans {N['kans']}%" + (f", {N['soort']}" if N.get("soort") and N["kans"] >= 25 else "")
                           + (f", onweer {N['onweer']}" if N.get("onweer") not in (None, "geen") else ""),
            "uitleg": uitleg_n,
        })
        bft_modellen = [r["wind_bft"] for r in p["modellen"] if r.get("wind_bft") is not None]
        kust_modellen = [r["wind_bft_kust"] for r in p["modellen"] if r.get("wind_bft_kust") is not None]
        stoten = [r["stoten_kmh"] for r in p["modellen"] if r.get("stoten_kmh") is not None]
        rijen.append({
            "parameter": "Wind",
            "modellen": (f"{min(bft_modellen)} – {max(bft_modellen)} Bft land, {min(kust_modellen)} – {max(kust_modellen)} Bft kust"
                         + (f"; stoten {min(stoten)} – {max(stoten)} km/u" if stoten else "")) if bft_modellen else "–",
            "verwachting": f"{AFK.get(W.get('richting') or '', '')} {W.get('bft')} Bft, kust {W.get('bft_kust')}"
                           + (f"; stoten ~{afr5(W['stoten_land_kmh'])} km/u" if W.get("stoten_land_kmh") else ""),
            "uitleg": ("Windrichting eensgezind." if (W.get("eensgezind") or 0) >= 0.8 else "Windrichting verschilt tussen de modellen.")
                      + (f" Draaiend van {W['draaiing']['van']} naar {W['draaiing']['naar']}." if W.get("draaiing") else ""),
        })
        if p["soort"] == "dag":
            zon_modellen = [r["zon_uren"] for r in p["modellen"] if r.get("zon_uren") is not None]
            rijen.append({
                "parameter": "Bewolking en zon",
                "modellen": f"laag {_pct(L.get('laag'))}, midden {_pct(L.get('midden'))}, hoog {_pct(L.get('hoog'))}"
                            + (f"; zon {_nl(min(zon_modellen))} – {_nl(max(zon_modellen))} uur" if zon_modellen else ""),
                "verwachting": Schrijver.lucht_kort(L["klasse"], False) + (f", ~{afr(L['zon_uren'])} uur zon" if L.get("zon_uren") is not None else ""),
                "uitleg": "Hoge bewolking telt niet als grijs weer: bij veel sluierbewolking kan de zon geregeld schijnen." if L["klasse"] == "sluier" else "",
            })
        else:
            M = p.get("mist") or {}
            rijen.append({
                "parameter": "Mist en zicht",
                "modellen": f"modellen {M.get('kans_modellen')}%"
                            + (f", MOSMIX {M['kans_mosmix']}%" if M.get("kans_mosmix") is not None else "")
                            + (f", ENS {M['kans_ens']}%" if M.get("kans_ens") is not None else ""),
                "verwachting": f"{M.get('klasse', '–')} ({M.get('kans')}%)",
                "uitleg": "Kans op zicht onder 1 km, uit modelzicht, zwakke wind met kleine dauwpuntspreiding en MOSMIX.",
            })
        uit.append({"key": p["key"], "titel": p["titel"], "dag_label": p["dag_label"], "zekerheid": p["zekerheid"],
                    "rijen": rijen, "per_model": p["modellen"]})
    return uit


def _pct(x) -> str:
    return "–" if x is None else f"{round(x * 100)}%"


def schrijf_alles(feiten: dict) -> dict:
    s = Schrijver(feiten)
    tekst = s.schrijf()
    tekst["modelvergelijking"] = modelvergelijking(feiten)
    return tekst
