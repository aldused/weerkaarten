#!/usr/bin/env python3
"""
haal_dwd_guidance.py
Scrapt DWD Synoptische Übersicht (Kurzfrist + Mittelfrist),
vertaalt naar natuurlijk Nederlands en slaat op als dwd_guidance.json.

De openbare Google-vertaalservice is de primaire vertaler. Een meteorologische
woordenlijst beschermt vaktermen die algemene vertaalmodellen vaak letterlijk
of fout vertalen. Bij een storing valt het script terug op het lokale
Helsinki-NLP-model, zodat de DWD-update niet afhankelijk is van één dienst.
"""

import html as html_lib
import json
import os
import re
import time
from datetime import datetime

import requests

os.chdir(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))

URLS = {
    "kurzfrist": "https://www.dwd.de/DE/fachnutzer/hobbymet/wetter_deutschland/_functions/PlainTeaser_synUebersichten/nas_bericht_syn_ueb_kurzfrist_frueh.html",
    "mittelfrist": "https://www.dwd.de/DE/fachnutzer/hobbymet/wetter_deutschland/_functions/PlainTeaser_synUebersichten/nas_bericht_syn_ueb_mittelfrist.html",
}

OUTPUT = "dwd_guidance.json"
GOOGLE_TRANSLATE_URL = "https://translate.googleapis.com/translate_a/single"
TRANSLATION_BACKEND = os.environ.get("DWD_TRANSLATION_BACKEND", "google").lower()

# Langste patronen eerst. De vervangende METEO-tokens blijven in zowel Google
# Translate als MarianMT intact en worden na vertaling teruggezet. Zo wordt
# bijvoorbeeld Starkregen nooit meer "zware krabben" en Höhentrog geen
# "hoge droesem".
METEO_GLOSSARY = (
    (r"\bWahrscheinlichkeiten für signifikante Wettererscheinungen\b", "Kans op significante weersverschijnselen"),
    (r"\bBewertung der Ensemblevorhersagen\b", "Beoordeling van de ensembleverwachtingen"),
    (r"\bBewertung der Konsistenz des operationellen Laufs\b", "Beoordeling van de consistentie van de operationele run"),
    (r"\bVergleich mit anderen globalen Modellen\b", "Vergelijking met andere mondiale modellen"),
    (r"\bModellvergleich und -einschätzung\b", "Modelvergelijking en -beoordeling"),
    (r"\bGWL und markante Wettererscheinungen\b", "GWL en significante weersverschijnselen"),
    (r"\bBasis für Mittelfristvorhersage\b", "Basis voor de middellangetermijnverwachting"),
    (r"\bVorhersage- und Beratungszentrale\b", "Verwachtings- en adviescentrum"),
    (r"\bvereinzelte(?:r|n|m|s)? Unwetter\b", "plaatselijk zwaar weer"),
    (r"\bmaximal markante Warnstufe\b", "hoogstens waarschuwingswaardig"),
    (r"\bmarkante(?:r|n|m|s)? Entwicklungen\b", "significante onweersbuien"),
    (r"\bmarkante(?:r|n|m|s)? Kriterien\b", "waarschuwingscriteria"),
    (r"\bgering wahrscheinlich\b", "kleine kans"),
    (r"\beher leicht unbeständig\b", "licht wisselvallig"),
    (r"\bLeicht unbeständig\b", "Enigszins wisselvallig"),
    (r"\bmehrstündige(?:r|n|m|s)? Starkregen\b", "urenlange zware regenval"),
    (r"\bschauerartige(?:r|n|m|s)? Regenfälle?\b", "buiige regen"),
    (r"\bschauerartige(?:r|n|m|s)? Regenfäll(?:e|en)\b", "buiige regen"),
    (r"\bmarkante(?:r|n|m|s)? Neuschneemengen\b", "aanzienlijke hoeveelheden verse sneeuw"),
    (r"\bteilweise steife, an der Nordsee stürmische Böen\b", "plaatselijk krachtige windstoten en aan de Noordzee zware windstoten"),
    (r"\bstürmische(?:r|n|m|s)? Böen\b", "zware windstoten"),
    (r"\bsteife(?:r|n|m|s)? Böen\b", "krachtige windstoten"),
    (r"\borkanartige(?:r|n|m|s)? Böen\b", "zeer zware windstoten"),
    (r"\bwarnrelevante(?:r|n|m|s)? Böen\b", "waarschuwingswaardige windstoten"),
    (r"\b7er bis 8er Böen\b", "windstoten van 7 tot 8 Bft"),
    (r"\bmehrstündige(?:r|n|m|s)?, nichtgewittrige(?:r|n|m|s)? Starkregen\b", "urenlange zware regenval zonder onweer"),
    (r"\bdurch den hereinschwenkenden Höhentrog\b", "door de binnenzwaaiende hoogtetrog"),
    (r"\betwas Hebung durch Randtröge\b", "enige stijgbewegingen door randtroggen"),
    (r"\babgetropfte(?:r|n|m|s)? Höhentr(?:og|öge|ögen|oges)\b", "afgesnoerde hoogtetrog"),
    (r"\bzyklonale(?:r|n|m|s)? Höhenströmung\b", "cyclonale bovenluchtstroming"),
    (r"\bantizyklonale(?:r|n|m|s)? Höhenströmung\b", "anticyclonale bovenluchtstroming"),
    (r"\boperationelle(?:r|n|m|s)? Lauf\b", "operationele run"),
    (r"\bKontrolllauf(?:s|es)?\b", "controlerun"),
    (r"\bHauptlauf(?:s|es)?\b", "operationele run"),
    (r"\bHaupttr(?:og|öge|ögen|oges)\b", "hoofdtrog"),
    (r"\bKurzwellentr(?:og|öge|ögen|oges)\b", "kortgolvige trog"),
    (r"\bKW[- ]Tr(?:og|öge|ögen|oges)\b", "kortgolvige trog"),
    (r"\bRandtr(?:og|öge|ögen|oges)\b", "randtrog"),
    (r"\bHöhentr(?:og|öge|ögen|oges)\b", "hoogtetrog"),
    (r"\bHöhenkeil(?:s|es|en)?\b", "rug in de bovenlucht"),
    (r"\bHöhenströmung\b", "bovenluchtstroming"),
    (r"\bHaupttrogachse\b", "hoofdtrogas"),
    (r"\bTrogachse\b", "trogas"),
    (r"\bBodendruckfeld\b", "luchtdrukveld aan de grond"),
    (r"\bAtlantikhoch(?:s|es|en)?\b", "Atlantisch hogedrukgebied"),
    (r"\bKaltluftadvektion\b", "aanvoer van koude lucht"),
    (r"\bWarmluftadvektion\b", "aanvoer van warme lucht"),
    (r"\bLuftmassengrenze(?:n)?\b", "luchtmassagrens"),
    (r"\bFrontalzone\b", "frontale zone"),
    (r"\bDruckgradient(?:en)?\b", "luchtdrukgradiënt"),
    (r"\bWarnschwelle(?:n)?\b", "waarschuwingsdrempel"),
    (r"\bwarnrelevant(?:e|er|en|em|es)?\b", "waarschuwingswaardig"),
    (r"\bStarkregen(?:fälle|fall|s)?\b", "zware regenval"),
    (r"\bDauerregen(?:s)?\b", "aanhoudende regen"),
    (r"\bSturmböe(?:n)?\b", "stormstoten"),
    (r"\bBöe(?:n)?\b", "windstoten"),
    (r"\bUnwetterlage(?:n)?\b", "situatie met zwaar weer"),
    (r"\bUnwetter(?:s)?\b", "zwaar weer"),
    (r"\bHebungsimpulse?\b", "stijgbewegingen"),
    (r"\bHebung\b", "stijgende luchtbeweging"),
    (r"\bAbsinken\b", "dalende luchtbeweging"),
    (r"\bSchichtung\b", "opbouw van de atmosfeer"),
    (r"\bLabilität\b", "onstabiliteit"),
    (r"\bScherung\b", "windschering"),
    (r"\bSchwüle\b", "benauwdheid"),
    (r"\bDrehzentrum\b", "circulatiekern"),
    (r"\bkonvektive(?:r|n|m|s)? Baustelle\b", "gebied met convectieve buien"),
    (r"\bflache(?:r|n|m|s)? Rücken\b", "zwakke rug"),
    (r"\bRücken\b", "rug"),
    (r"\bRinne\b", "lagedruktrog"),
    (r"\bPPW um (\d+) mm\b", "PPW rond \\1 mm"),
    (r"\bMU\s*CAPE\b", "MUCAPE"),
    (r"\bDipl\.?\s*Met\.?\b", "Dipl. Met."),
    (r"\bLösungsraum\b", "oplossingsruimte"),
    (r"\bMembern?\b", "leden"),
    (r"\bNiederschlagsneigung\b", "kans op neerslag"),
    (r"\bunbeständig(?:e|er|en|em|es)?\b", "wisselvallig"),
    (r"\bwechselhaft(?:e|er|en|em|es)?\b", "wisselvallig"),
    (r"\bEntrainment\b", "inmenging"),
    (r"\bSchlagzeile\b", "Belangrijkste punten"),
)

DUITSE_DAGEN = {
    "Montag": "Maandag", "Dienstag": "Dinsdag", "Mittwoch": "Woensdag",
    "Donnerstag": "Donderdag", "Freitag": "Vrijdag", "Samstag": "Zaterdag",
    "Sonntag": "Zondag",
}
DUITSE_MAANDEN = {
    1: "januari", 2: "februari", 3: "maart", 4: "april", 5: "mei",
    6: "juni", 7: "juli", 8: "augustus", 9: "september", 10: "oktober",
    11: "november", 12: "december",
}

_model = None
_tokenizer = None

def _get_model():
    global _model, _tokenizer
    if _model is None:
        # Transformers 5 probeert anders op de achtergrond een safetensors-
        # conversie online uit te voeren, ook wanneer het model al lokaal staat.
        os.environ.setdefault("DISABLE_SAFETENSORS_CONVERSION", "1")
        from transformers import MarianMTModel, MarianTokenizer
        name = "Helsinki-NLP/opus-mt-de-nl"
        _tokenizer = MarianTokenizer.from_pretrained(name, local_files_only=True)
        _model = MarianMTModel.from_pretrained(
            name, local_files_only=True, use_safetensors=False
        )
    return _model, _tokenizer


def _vertaal_marian(tekst):
    """Vertaal één kort stuk met het lokale reservemodel."""
    model, tokenizer = _get_model()
    tokens = tokenizer([tekst], return_tensors="pt", padding=True, truncation=True, max_length=512)
    vertaald = model.generate(**tokens, num_beams=4, max_new_tokens=512)
    return tokenizer.decode(vertaald[0], skip_special_tokens=True)


def normaliseer_duits_voor_vertaling(tekst):
    """Maak DWD-afkortingen en elliptische vaktaal explicieter voor de vertaler."""
    vervangingen = (
        (r"\bbilden sind\b", "bilden sich"),
        (r"\bmit einer flachen Welle kommt sich\b", "mit einer flachen Welle kommt sie"),
        (r"\bIn der Nacht zum\b", "In der Nacht auf"),
        (r"\bdurch einen rückseitig vorstoßenden Kurzwellentrog\b", "durch einen Kurzwellentrog, der sich von der Rückseite nähert,"),
        (r"\bDas entsprechende Tief im Bodendruckfeld\b", "Das entsprechende Tiefdruckgebiet am Boden"),
        (r"\bTief im Bodendruckfeld\b", "Tiefdruckgebiet am Boden"),
        (r"\bdes Höhentiefs\b", "des Tiefdruckgebiets in der Höhe"),
        (r"\bHöhentief\b", "Tiefdruckgebiet in der Höhe"),
        (r"\bflaches Bodentief\b", "flaches Tiefdruckgebiet am Boden"),
        (r"\bBodentief\b", "Tiefdruckgebiet am Boden"),
        (r"\bdes Tiefs\b", "des Tiefdruckgebiets"),
        (r"\bam Rand des Tiefdruckgebiets\b", "am Rand des Tiefdruckgebiets"),
        (r"\bTiefs\b", "Tiefdruckgebiete"),
        (r"\bTief\b", "Tiefdruckgebiet"),
        (r"\bdes Hochs\b", "des Hochdruckgebiets"),
        (r"\bHochs\b", "Hochdruckgebiets"),
        (r"\bvom Hoch\b", "vom Hochdruckgebiet"),
        (r"\bHoch\b", "Hochdruckgebiet"),
        (r"\bDessen Ausläufer\b", "Die Ausläufer dieses Tiefdruckgebiets"),
        (r"\bderen Ausläufer\b", "die Ausläufer dieser Tiefdruckgebiete"),
        (r"\bdes Tiefausläufers\b", "des Ausläufers des Tiefdruckgebiets"),
        (r"\bTiefausläufer\b", "Ausläufer von Tiefdruckgebieten"),
        (r"\bim gradientschwachen Süden\b", "im windschwachen Süden"),
        (r"\bfür viel mehr reicht es (.*?), aber in trockener Luft wohl nicht\b", r"viel mehr ist \1 in der trockenen Luft wohl nicht zu erwarten"),
    )
    for patroon, vervanging in vervangingen:
        tekst = re.sub(patroon, vervanging, tekst)
    return tekst


def bescherm_vaktermen(tekst):
    """Vervang kwetsbare Duitse vaktermen tijdelijk door stabiele tokens."""
    beschermd = tekst
    vervangingen = {}
    teller = 0

    for patroon, nederlands in METEO_GLOSSARY:
        def vervang(match):
            nonlocal teller
            token = f"METEO{teller:03d}WX"
            teller += 1
            waarde = match.expand(nederlands)
            vervangingen[token] = waarde
            return token

        beschermd = re.sub(patroon, vervang, beschermd, flags=re.IGNORECASE)

    return beschermd, vervangingen


def herstel_vaktermen(tekst, vervangingen):
    for token, nederlands in vervangingen.items():
        tekst = tekst.replace(token, nederlands)
    return tekst


def corrigeer_vertaling(tekst):
    """Ruim bekende machinevertaalfouten en typografische rafels op."""
    correcties = (
        (r"\bzware krabben\b", "zware regenval"),
        (r"\bschurende regen(?:val)?\b", "buiige regen"),
        (r"\bhoge droesem\b", "hoogtetrog"),
        (r"\bhoogte[- ]diepte\b", "lagedrukgebied in de bovenlucht"),
        (r"\bhooggelegen trog\b", "hoogtetrog"),
        (r"\bkortegolfdal\b", "kortgolvige trog"),
        (r"\bkortegolftrog\b", "kortgolvige trog"),
        (r"\bstormboeien\b", "stormstoten"),
        (r"\bstormbogen\b", "zware windstoten"),
        (r"\brookvlekken\b", "pluimen"),
        (r"\bdieplopers\b", "uitlopers van lagedrukgebieden"),
        (r"\bneerslaande neiging\b", "kans op neerslag"),
        (r"\bonveranderlijk weer(?:karakter)?\b", "wisselvallig weer"),
        (r"\bGCO\b", "GFS"),
        (r"\bMembers\b", "leden"),
        (r"\bmembern?\b", "leden"),
        (r"\bprefrontal\b", "prefrontaal"),
        (r"\bpostfrontal\b", "postfrontaal"),
        (r"\banti-cyclonaal\b", "anticyclonaal"),
        (r"\bcycloonale\b", "cyclonale"),
        (r"\bcyclonische\b", "cyclonale"),
        (r"\bde ECMWF\b", "het ECMWF"),
        (r"\bEZMW\b", "ECMWF"),
        (r"\brookpluimen\b", "pluimen"),
        (r"\bDipl\.\s*Ontmoet\.\b", "Dipl. Met."),
        (r"\bKW[- ]dal\b", "kortgolvige trog"),
        (r"\bfilmcentrum\b", "circulatiekern"),
        (r"\blichte hagel\b", "kleine hagel"),
        (r"\bgeïsoleerde zwaar weer\b", "plaatselijk zwaar weer"),
        (r"\bdroge lucht inmenging\b", "inmenging van droge lucht"),
        (r"\benigszins onschadelijk gemaakt\b", "minder onstabiel geworden"),
        (r"\bkaap\b", "CAPE"),
        (r"\bl/qm\b", "l/m²"),
        (r"\bde droge lucht van inmenging\b", "inmenging van droge lucht"),
        (r"\bop wiens brede zuidflank wij in Duitsland\b", "aan de brede zuidflank daarvan ligt Duitsland"),
        (r"\bdeels lichtere benauwdheid\b", "lichte benauwdheid"),
        (r"\bde volgende gebied\b", "het volgende gebied"),
        (r"\bwordt opbouw van de atmosfeer\b", "wordt de opbouw van de atmosfeer"),
        (r"\bvan het westen tot het noordoosten en in delen van het zuidoosten gebeurt er niets, bij (\d+) tot (\d+)°C\b", r"van het westen tot het noordoosten en in delen van het zuidoosten blijft het droog, met minima van \1 tot \2°C"),
        (r"\bwindschering in het zuiden steeds vaker wordt toegevoegd\b", "de windschering in het zuiden toeneemt"),
        (r"\bwindstoten van 7 tot 8 Bft uit het westen naar noordwesten komt\b", "windstoten van 7 tot 8 Bft uit west tot noordwest voorkomen"),
        (r"\brond waarschuwingsdrempel\b", "rond de waarschuwingsdrempel"),
        (r"\bkan alleen in nowcasting worden beslist\b", "wordt mogelijk pas tijdens het nowcasten duidelijk"),
        (r"\btrekt het lagedrukgebied niet ver van de Oostzeekust van West-Pommeren binnen\b", "draait het lagedrukgebied vlak bij de Oostzeekust van West-Pommeren rond"),
        (r"\bzware windstoten kan worden verwacht\b", "zware windstoten kunnen worden verwacht"),
        (r"\been urenlange niet-onweersbui met zware regenval\b", "urenlange zware regenval zonder onweer"),
        (r"\bhet trog\b", "de trog"),
        (r"\bdaarnaast biedt de luchtdrukgradiënt\b", "daarnaast zorgt de luchtdrukgradiënt voor"),
        (r"\bondanks dat cyclonale bovenluchtstroming vanuit het noordwesten in de droge lucht komt, wordt er niet veel meer verwacht\b", "door de droge lucht blijft de buienactiviteit ondanks de cyclonale bovenluchtstroming uit het noordwesten beperkt"),
        (r"\bgedeeltelijk bewolkte of heldere hemel\b", "licht bewolkte of heldere hemel"),
        (r"\bom dit te doen, koelt het af\b", "daarbij koelt het af"),
        (r"\bde modellen simuleren grootschalige ontwikkeling\b", "de modellen simuleren de grootschalige ontwikkeling"),
        (r"\bwaarschuwingscriteria tegenkomen\b", "aan waarschuwingscriteria voldoen"),
        (r"\bzwaar weer minder waarschijnlijk zijn geworden\b", "zwaar weer minder waarschijnlijk is geworden"),
        (r"\bde locatie van de kleine lagedrukgebieden\b", "de locatie van het kleine lagedrukgebied"),
        (r"\bDipl\. Met\.\.\b", "Dipl. Met."),
        (r"\benigszins wisselvallig en wat regen in sommige gebieden\b", "enigszins wisselvallig met regionaal wat regen"),
        (r"\been uitgebreide high\b", "een uitgebreid hogedrukgebied"),
        (r"\bde maximale waarden\b", "de maximumtemperaturen"),
        (r"\bin het zuidwesten kan met meer zonneschijn tot (\d+) graden worden verwacht\b", r"in het zuidwesten kan het met meer zon maximaal \1 graden worden"),
        (r"\bwordt de hoofdtrog geregenereerd\b", "krijgt de hoofdtrog een nieuwe impuls"),
        (r"\bhet verschuift van het zuiden van Scandinavië\b", "deze trekt vanuit het zuiden van Scandinavië"),
        (r"\been bijbehorend ondiep lagedrukgebied\b", "een bijbehorend zwak lagedrukgebied"),
        (r"\bverspreidden zich aanvankelijk\b", "verspreiden zich aanvankelijk"),
        (r"\ben bereikten uiteindelijk\b", "en bereiken uiteindelijk"),
        (r"\bhoofdgebieden nog onzeker\b", "zwaartepunten nog onzeker"),
        (r"\bsteekt de noordwestenwind, vooral op de Noordzee, aan en is soms stormachtig\b", "trekt de noordwestenwind vooral aan de Noordzee aan en kan daar stormachtig worden"),
        (r"\bdaarvoor volgen nog enkele buien\b", "voor die tijd vallen nog enkele buien"),
        (r"\bdienovereenkomstig neemt kans op neerslag\b", "daarmee neemt de kans op neerslag"),
        (r"\bvoor het weekend en op de langere middellange termijn\b", "in het weekend en later in de middellange termijn"),
        (r"\buitbreidingen van lagedrukgebieden\b", "uitlopers van lagedrukgebieden"),
        (r"\bhet ECMWF-pluimen\b", "de ECMWF-pluimen"),
        (r"\buitspraken gebaseerd op operationele run\b", "uitspraken op basis van de operationele run"),
        (r"\bhet ECMWF-clustering\b", "de ECMWF-clustering"),
        (r"\bposities van randtrog\b", "posities van de randtrog"),
        (r"\bligt Duitsland onder (.+?) liggen\b", r"ligt Duitsland onder \1"),
        (r"\bvanwaar het koufront diagonaal boven Duitsland ligt\b", "het bijbehorende koufront ligt diagonaal over Duitsland"),
        (r"\bhet bijbehorende koufront ligt diagonaal over Duitsland en slechts langzaam zuidwaarts opschuift\b", "het bijbehorende koufront ligt diagonaal over Duitsland en schuift slechts langzaam zuidwaarts op"),
        (r"\bdeze verdwijnen nu in de ochtend, maar komen tegen de middag weer tot leven\b", "deze nemen in de ochtend eerst af, maar leven rond het middaguur weer op"),
        (r"\bhoogstwaarschijnlijk is het significante onweersbuien\b", "waarschijnlijk gaat het meestal om significante onweersbuien"),
        (r"\bplaatselijk zwaar weer, vooral als gevolg van (.*?), zijn niet volledig uitgesloten\b", r"plaatselijk zwaar weer, vooral door \1, is echter niet helemaal uitgesloten"),
        (r"\bmaar hier wordt de luchtdrukgradiënt.*?Noord-Duitsland\.", "wel zorgt de luchtdrukgradiënt rond het lagedrukgebied van de kust tot in het Noord-Duitse binnenland voor plaatselijk krachtige windstoten en aan de Noordzee voor zware windstoten uit west tot noordwest."),
        (r"\bin het noorden is stabielere en drogere lucht binnengestroomd, wel zorgt\b", "in het noorden is stabielere en drogere lucht binnengestroomd. Wel zorgt"),
        (r"\btemperaturen toe van (\d+) tot (\d+)°C in de Noordzee\b", r"temperaturen van \1 tot \2°C aan de Noordzeekust toe"),
        (r"\bde temperatuur daalt tot (\d+)°C in de Noordzee\b", r"aan de Noordzeekust daalt de temperatuur tot \1°C"),
        (r"\bop de Noordzee\b", "aan de Noordzee"),
        (r"\bin de avond NO Polen\b", "'s avonds het noordoosten van Polen"),
        (r"\bonder waarschuwingsdrempel\b", "onder de waarschuwingsdrempel"),
        (r"\bmaar lokaal zijn ze ook niet uit te sluiten\b", "maar lokaal niet volledig is uitgesloten"),
        (r"\bdonderdagnacht het zuiden\b", "in de nacht naar donderdag het zuiden"),
        (r"\been zwakke rug nadert vanuit het zuidwesten en de druk neemt toe, die zich vrijdag naar het oosten voortzet\b", "vanuit het zuidwesten nadert een zwakke rug en stijgt de luchtdruk. Deze drukstijging zet zich vrijdag oostwaarts voort"),
        (r"\bwoensdag wordt hoofdtrog geregenereerd door een kortgolvige trog die van achteren nadert\b", "woensdag krijgt de hoofdtrog een nieuwe impuls door een kortgolvige trog die vanaf de achterzijde nadert"),
        (r"\buitlopers van lagedrukgebieden verspreiden zich echter alleen in verzwakte vorm\b", "uitlopers van lagedrukgebieden bereiken Duitsland echter alleen in verzwakte vorm"),
    )
    for patroon, vervanging in correcties:
        tekst = re.sub(patroon, vervanging, tekst, flags=re.IGNORECASE)

    tekst = re.sub(
        r"Woensdag zullen er geïsoleerde onweersbuien zijn in verband met zware regenval rond de 15 l/m² in (?:een|één) uur en zware windstoten Bft 8 kleine kans, vooral in de noordelijke helft, en op donderdag in het oosten en uiterste zuiden\.",
        "Woensdag is er vooral in de noordelijke helft een kleine kans op enkele onweersbuien met zware regenval van circa 15 l/m² in één uur en zware windstoten tot Bft 8. Donderdag geldt dit voor het oosten en uiterste zuiden.",
        tekst,
        flags=re.IGNORECASE,
    )

    tekst = re.sub(r"\s+([,.;:!?])", r"\1", tekst)
    tekst = re.sub(r"([.!?])(?=[A-ZÀ-ÖØ-Þ])", r"\1 ", tekst)
    tekst = re.sub(r"\s{2,}", " ", tekst).strip()
    tekst = re.sub(r"[\u200b-\u200d\u2060\ufeff]", "", tekst)
    tekst = re.sub(r"\s{2,}", " ", tekst).strip()
    for dag in ("maandag", "dinsdag", "woensdag", "donderdag", "vrijdag", "zaterdag", "zondag"):
        tekst = re.sub(
            rf"^{dag}(?:avond|nacht)\b", f"In de nacht naar {dag}", tekst,
            flags=re.IGNORECASE,
        )
    tekst = re.sub(
        r"(^|[.!?]\s+)([a-zà-öø-ÿ])",
        lambda match: match.group(1) + match.group(2).upper(),
        tekst,
    )
    tekst = re.sub(r"^(\w+)\.\.\.\s+([A-ZÀ-ÖØ-Þ])", lambda m: f"{m.group(1)}... {m.group(2).lower()}", tekst)
    tekst = tekst.replace("Dipl. Met..", "Dipl. Met.")
    if tekst:
        tekst = tekst[:1].upper() + tekst[1:]
    return tekst


def maak_bronblokken(tekst):
    """Maak echte alinea's en dagblokken van de hard afgebroken DWD-tekst."""
    if not tekst or not tekst.strip():
        return []

    # DWD gebruikt harde regeleinden voor de regellengte en lange strepen als
    # sectiescheiding. Maak daar eerst echte alinea's van, zodat het model geen
    # willekeurige halve regels of honderden underscores probeert te vertalen.
    tekst = re.sub(r'\r\n?', '\n', tekst)
    tekst = re.sub(r'(?m)^\s*[_=-]{15,}\s*$', '\n\n', tekst)
    ruwe_alineas = re.split(r'\n\s*\n+', tekst)
    blokken = []
    dagen_de = "|".join(DUITSE_DAGEN)
    in_synoptische_ontwikkeling = False

    for alinea in ruwe_alineas:
        # Regeleinden binnen één bronalinea zijn alleen DWD-regelafbrekingen.
        compact = ' '.join(regel.strip() for regel in alinea.split('\n') if regel.strip())
        compact = re.sub(r'\s{2,}', ' ', compact).strip()
        if not compact:
            continue

        if re.match(r'^Synoptische Entwicklung\b', compact, re.IGNORECASE):
            in_synoptische_ontwikkeling = True

        basis = re.match(r'^(Basis für Mittelfristvorhersage)\s+(.+)$', compact)
        if basis:
            blokken.extend((basis.group(1), basis.group(2)))
            continue

        # In de Mittelfrist staan maandag t/m vrijdag vaak in één bronalinea.
        # Splits op de dagovergangen, ongeacht waar de 80-tekenregel afbrak.
        delen = ([compact] if not in_synoptische_ontwikkeling else re.split(
            rf'(?<=[.!?])\s+(?=Am\s+(?:nächsten\s+|kommenden\s+)?(?:{dagen_de})\b)',
            compact,
        ))
        for deel in delen:
            deel = deel.strip()
            if not deel:
                continue
            # De eerste maandag in de Mittelfrist begint meestal midden in de
            # openingszin. Voeg daarvoor een expliciete, onvertaalde dagkop toe.
            eerste_dag = re.search(
                rf'^(?:Eingangs der Mittelfrist|Zu Beginn).*?\b({dagen_de})\b', deel, re.IGNORECASE
            )
            if eerste_dag:
                duitse_dag = eerste_dag.group(1).capitalize()
                blokken.append(f"DAG_NL:{DUITSE_DAGEN.get(duitse_dag, duitse_dag)}")
            if re.match(r'^Am Wochenende\b', deel, re.IGNORECASE):
                blokken.append("DAG_NL:Weekend")
            blokken.append(deel)

    return blokken


def splits_lang_stuk(tekst, maximum=3200):
    """Splits alleen waar nodig, bij voorkeur op een zinsgrens."""
    if len(tekst) <= maximum:
        return [tekst]
    zinnen = re.split(r'(?<=[.!?])\s+', tekst)
    stukken = []
    buffer = ""
    for zin in zinnen:
        if not buffer or len(buffer) + len(zin) + 1 <= maximum:
            buffer += (" " if buffer else "") + zin
        else:
            stukken.append(buffer)
            buffer = zin
    if buffer:
        stukken.append(buffer)
    return stukken


def _vertaal_google(tekst, sessie):
    tekst = normaliseer_duits_voor_vertaling(tekst)
    beschermd, vervangingen = bescherm_vaktermen(tekst)
    response = sessie.get(
        GOOGLE_TRANSLATE_URL,
        params={"client": "gtx", "sl": "de", "tl": "nl", "dt": "t", "q": beschermd},
        timeout=30,
        headers={"User-Agent": "Mozilla/5.0 (weerlab-dwd-guidance)"},
    )
    response.raise_for_status()
    data = response.json()
    if not data or not data[0]:
        raise ValueError("lege vertaling ontvangen")
    vertaald = "".join(deel[0] or "" for deel in data[0] if deel and deel[0])
    vertaald = herstel_vaktermen(vertaald, vervangingen)
    return corrigeer_vertaling(vertaald)


def _vertaal_met_reserve(tekst, sessie, gebruik_google=True):
    """Vertaal een alinea; probeer de online vertaler tweemaal en val terug."""
    if gebruik_google:
        laatste_fout = None
        for poging in range(2):
            try:
                return _vertaal_google(tekst, sessie), True
            except Exception as exc:
                laatste_fout = exc
                if poging == 0:
                    time.sleep(1)
        print(f"  Google Translate niet beschikbaar ({laatste_fout}); lokaal verder")

    tekst = normaliseer_duits_voor_vertaling(tekst)
    beschermd, vervangingen = bescherm_vaktermen(tekst)
    vertaald = _vertaal_marian(beschermd)
    vertaald = herstel_vaktermen(vertaald, vervangingen)
    return corrigeer_vertaling(vertaald), False


def vertaal_tekst(tekst, backend=TRANSLATION_BACKEND, sessie=None):
    """Vertaal per inhoudelijke alinea en behoud secties en dagovergangen."""
    blokken = maak_bronblokken(tekst)
    if not blokken:
        return tekst

    sessie = sessie or requests.Session()
    gebruik_google = backend == "google"
    resultaat = []

    for blok in blokken:
        if blok.startswith("DAG_NL:"):
            resultaat.append("DAG: " + blok.split(":", 1)[1])
            continue

        # WMO-code blijft staan; de gespatieerde documenttitel en uitgiftedatum
        # staan al in de paginaheader/meta en maken de vertaling alleen rommelig.
        if re.match(r'^(SXEU|DWAV|S\w{3}\d{2}|\d{6}/\d{4})', blok):
            resultaat.append(blok)
            continue
        if re.match(r'^(?:(?:S\s+Y)|SY)\s+N\s+O\s+P\s+T', blok, re.IGNORECASE):
            continue
        if re.match(r'^ausgegeben am\b', blok, re.IGNORECASE):
            continue

        gwl = re.match(r'^(GWL und markante Wettererscheinungen):\s*(.*)$', blok)
        if gwl:
            resultaat.append(
                "GWL en significante weersverschijnselen: " + gwl.group(2).strip()
            )
            continue

        vertaalde_stukken = []
        for stuk in splits_lang_stuk(blok):
            vertaald, google_ok = _vertaal_met_reserve(
                stuk, sessie, gebruik_google=gebruik_google
            )
            vertaalde_stukken.append(vertaald)
            if gebruik_google and not google_ok:
                gebruik_google = False
        resultaat.append(' '.join(vertaalde_stukken))

    return '\n\n'.join(resultaat)


# Achterwaarts compatibele functienaam voor handmatige aanroepen.
vertaal_lokaal = vertaal_tekst


def vertaal_uitgiftedatum(uitgave):
    """Zet 'Samstag, den 18.07.2026 um 08 UTC' om naar natuurlijk Nederlands."""
    match = re.search(
        r'(?P<dag>Montag|Dienstag|Mittwoch|Donnerstag|Freitag|Samstag|Sonntag),?\s+'
        r'(?:den\s+)?(?P<datum>\d{1,2}\.\d{1,2}\.\d{4})\s+um\s+'
        r'(?P<tijd>\d{1,2}(?:[.:]\d{2})?)\s*UTC',
        uitgave or "", re.IGNORECASE,
    )
    if not match:
        return uitgave
    datum = datetime.strptime(match.group("datum"), "%d.%m.%Y")
    dag_de = match.group("dag").capitalize()
    tijd = match.group("tijd").replace(":", ".")
    if "." not in tijd:
        tijd += ".00"
    return (
        f"{DUITSE_DAGEN.get(dag_de, dag_de).lower()} {datum.day} "
        f"{DUITSE_MAANDEN[datum.month]} {datum.year} om {tijd} UTC"
    )


def scrape_dwd(url):
    """Haal guidance tekst op van DWD pagina (pre-tag)."""
    r = requests.get(url, timeout=30, headers={
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)"
    })
    r.encoding = "utf-8"
    html = r.text

    # DWD zet de guidance in een <pre> tag
    pre_match = re.search(r'<pre[^>]*>(.*?)</pre>', html, re.DOTALL)
    if not pre_match:
        raise ValueError("Geen <pre> tag gevonden op DWD pagina")

    tekst = pre_match.group(1).strip()

    # HTML entities opruimen
    tekst = html_lib.unescape(tekst)
    tekst = re.sub(r'<[^>]+>', '', tekst)  # resterende tags

    # Zoek uitgiftedatum
    uitgave = ""
    uitgave_match = re.search(r'ausgegeben am\s+(.*?)(?:\n|$)', tekst, re.IGNORECASE)
    if uitgave_match:
        uitgave = uitgave_match.group(1).strip()

    return tekst[:10000], uitgave


def main():
    print(f"=== DWD Guidance === {datetime.now():%Y-%m-%d %H:%M}")
    output = {}

    for naam, url in URLS.items():
        print(f"  Ophalen: {naam}...")
        try:
            origineel, uitgave = scrape_dwd(url)
            print(f"  Origineel: {len(origineel)} tekens")

            print(f"  Vertalen via {TRANSLATION_BACKEND} (met lokale reserve)...")
            vertaald = vertaal_tekst(origineel)
            print(f"  Vertaald: {len(vertaald)} tekens")

            output[naam] = {
                "original": origineel,
                "translated": vertaald,
                "issuedAt": uitgave,
                "issuedAtNl": vertaal_uitgiftedatum(uitgave),
                "fetchedAt": datetime.now().isoformat(),
            }
        except Exception as e:
            print(f"  FOUT: {e}")
            output[naam] = {
                "original": "",
                "translated": "",
                "error": str(e),
                "fetchedAt": datetime.now().isoformat(),
            }

    output["bijgewerkt"] = datetime.now().isoformat()
    output["translation"] = {
        "backend": TRANSLATION_BACKEND,
        "fallback": "Helsinki-NLP/opus-mt-de-nl",
        "glossaryVersion": 2,
    }
    with open(OUTPUT, "w") as f:
        json.dump(output, f, ensure_ascii=False, indent=2)
    print(f"Opgeslagen: {OUTPUT}")


if __name__ == "__main__":
    main()
