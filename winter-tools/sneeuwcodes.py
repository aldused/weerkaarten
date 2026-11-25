"""Nederlandse beschrijvingen en telregels voor KNMI WW en WaWa."""

# WW (WMO 4677): KNMI, Handleiding voor de 7wwW1W2 en 960ww (1992), pp. 24–35.
# https://cdn.knmi.nl/knmi/pdf/bibliotheek/knmipubmetnummer/knmipub181.pdf
# WMO-codetabel 4677, met voetnoten over korrelsneeuw, korrelhagel en hagel.
# https://www.nodc.noaa.gov/archive/arc0021/0002199/1.1/data/0-data/HTML/WMO-CODE/WMO4677.HTM
# WaWa (WMO 4680): KNMI, Handboek Waarnemingen, hoofdstuk 14, pp. 14-4–14-5.
# https://cdn.knmi.nl/knmi/pdf/bibliotheek/knmipubDIV/handboekwaarnemingen.pdf
# Beide tabellen staan ook in KNMI Technical Report 297, bijlage B.
# https://cdn.knmi.nl/knmi/pdf/bibliotheek/knmipubTR/TR297.pdf

_SNOW_VISUAL = {
    22: "Sneeuw in het voorafgaande uur (de KNMI-handleiding vermeldt ook ijsnaalden en poolsneeuw)",
    26: "Sneeuwbuien of buien met regen en sneeuw in het voorafgaande uur",
    68: "Regen of motregen gemengd met sneeuw, licht",
    69: "Regen of motregen gemengd met sneeuw, matig of zwaar",
    70: "Af en toe sneeuwvlokken, licht",
    71: "Aanhoudend sneeuwvlokken, licht",
    72: "Af en toe sneeuwvlokken, matig",
    73: "Aanhoudend sneeuwvlokken, matig",
    74: "Af en toe sneeuwvlokken, zwaar",
    75: "Aanhoudend sneeuwvlokken, zwaar",
    77: "Motsneeuw, met of zonder mist",
    78: "Poolsneeuw (stervormige sneeuwkristallen), met of zonder mist",
    83: "Buien met regen en sneeuw, licht",
    84: "Buien met regen en sneeuw, matig of zwaar",
    85: "Sneeuwbuien, licht",
    86: "Sneeuwbuien, matig of zwaar",
}

_SNOW_AUTOMATIC = {
    24: "Sneeuw in het voorafgaande uur",
    67: "Regen of motregen gemengd met sneeuw, licht",
    68: "Regen of motregen gemengd met sneeuw, matig of zwaar",
    70: "Sneeuw, sterkte onbekend",
    71: "Sneeuw, licht",
    72: "Sneeuw, matig",
    73: "Sneeuw, zwaar",
    77: "Motsneeuw",
    85: "Sneeuwbuien of sneeuw van tijd tot tijd, licht",
    86: "Sneeuwbuien of sneeuw van tijd tot tijd, matig",
    87: "Sneeuwbuien of sneeuw van tijd tot tijd, zwaar",
}

# Deze codes dragen bij aan winterse neerslag. Een keuze tussen sneeuw, hagel,
# andere ijskorrels of onderkoelde neerslag is uit sommige codes niet af te leiden.
_WINTRY_VISUAL = {
    20: "Motregen of motsneeuw in het voorafgaande uur",
    23: "Regen en sneeuw of ijsregen in het voorafgaande uur",
    24: "Onderkoelde regen of motregen in het voorafgaande uur",
    27: "Buien met hagel, korrelhagel of korrelsneeuw, eventueel met regen, in het voorafgaande uur",
    56: "Onderkoelde motregen, licht",
    57: "Onderkoelde motregen, matig of zwaar",
    66: "Onderkoelde regen, licht",
    67: "Onderkoelde regen, matig of zwaar",
    76: "IJsnaalden of ijsplaatjes, met of zonder mist",
    79: "IJsregen (bevroren regendruppels)",
    87: "Lichte buien met korrelsneeuw of korrelhagel, eventueel met regen of regen en sneeuw gemengd",
    88: "Matige of zware buien met korrelsneeuw of korrelhagel, eventueel met regen of regen en sneeuw gemengd",
    89: "Lichte hagelbuien, eventueel met regen of regen en sneeuw gemengd",
    90: "Matige of zware hagelbuien, eventueel met regen of regen en sneeuw gemengd",
    93: "Onweer in het voorafgaande uur, nu lichte sneeuw, regen met sneeuw of hagelvormen",
    94: "Onweer in het voorafgaande uur, nu matige of zware sneeuw, regen met sneeuw of hagelvormen",
}

_WINTRY_AUTOMATIC = {
    22: "Motregen of motsneeuw in het voorafgaande uur",
    25: "Onderkoelde regen of motregen in het voorafgaande uur",
    45: "Vaste neerslag, soort onbekend, licht of matig",
    46: "Vaste neerslag, soort onbekend, zwaar",
    47: "Onderkoelde neerslag, licht of matig",
    48: "Onderkoelde neerslag, zwaar",
    54: "Onderkoelde motregen, licht",
    55: "Onderkoelde motregen, matig",
    56: "Onderkoelde motregen, zwaar",
    64: "Onderkoelde regen, licht",
    65: "Onderkoelde regen, matig",
    66: "Onderkoelde regen, zwaar",
    74: "IJsregen (bevroren regendruppels), licht",
    75: "IJsregen (bevroren regendruppels), matig",
    76: "IJsregen (bevroren regendruppels), zwaar",
    78: "IJskristallen, soort onbekend",
}

# WaWa onderscheidt hier hagel. WW96 en WW99 omvatten volgens de voetnoot ook
# korrelhagel en korrelsneeuw. Die visuele codes bewijzen geen zuivere hagel.
_HAIL_VISUAL = {
    96: "Licht of matig onweer met hagel, korrelhagel of korrelsneeuw",
    99: "Zwaar onweer met hagel, korrelhagel of korrelsneeuw",
}

_HAIL_AUTOMATIC = {
    89: "Hagel",
    93: "Licht of matig onweer met hagel",
    96: "Zwaar onweer met hagel",
}

SNOW_VISUAL = frozenset(_SNOW_VISUAL)
SNOW_AUTOMATIC = frozenset(_SNOW_AUTOMATIC)
WINTRY_VISUAL = frozenset(_WINTRY_VISUAL)
WINTRY_AUTOMATIC = frozenset(_WINTRY_AUTOMATIC)
HAIL_VISUAL = frozenset(_HAIL_VISUAL)
HAIL_AUTOMATIC = frozenset(_HAIL_AUTOMATIC)

# Houd omschrijvingen voor context bij S=1 beschikbaar. Onweer met regen en/of
# sneeuw kan uitsluitend regen zijn. Opwaaiende sneeuw bewijst geen verse val.
VISUAL = {
    **_SNOW_VISUAL,
    **_WINTRY_VISUAL,
    **_HAIL_VISUAL,
    0: "Geen waarneembare wolkenontwikkeling",
    1: "Afnemende bewolking",
    2: "Onveranderde bewolking",
    3: "Toenemende bewolking",
    4: "Zicht verminderd door rook of vulkanische as",
    5: "Heiigheid",
    6: "Zwevend stof",
    7: "Opwaaiend stof of zand bij het station",
    8: "Stof- of zandhozen bij het station",
    9: "Stof- of zandstorm in zicht of in het voorafgaande uur bij het station",
    10: "Nevel",
    11: "Banken van lage mist of ijsmist",
    12: "Min of meer aaneengesloten lage mist of ijsmist",
    13: "Bliksem gezien, geen donder gehoord",
    14: "Neerslag in zicht die de grond niet bereikt",
    15: "Neerslag op afstand",
    16: "Neerslag dichtbij, buiten het station",
    17: "Onweer, geen neerslag tijdens de waarneming",
    18: "Plotselinge zware windstoten",
    19: "Windhoos of waterhoos",
    21: "Regen in het voorafgaande uur",
    25: "Regenbuien in het voorafgaande uur",
    28: "Mist of ijsmist in het voorafgaande uur",
    29: "Onweer, met of zonder neerslag, in het voorafgaande uur",
    30: "Lichte of matige stof- of zandstorm, afgenomen",
    31: "Lichte of matige stof- of zandstorm, onveranderd",
    32: "Lichte of matige stof- of zandstorm, begonnen of toegenomen",
    33: "Zware stof- of zandstorm, afgenomen",
    34: "Zware stof- of zandstorm, onveranderd",
    35: "Zware stof- of zandstorm, begonnen of toegenomen",
    36: "Lage driftsneeuw, licht of matig",
    37: "Lage driftsneeuw, zwaar",
    38: "Hoge driftsneeuw, licht of matig",
    39: "Hoge driftsneeuw, zwaar",
    40: "Mist op afstand",
    41: "Mistbanken",
    42: "Dunner wordende mist, hemel zichtbaar",
    43: "Dunner wordende mist, hemel onzichtbaar",
    44: "Onveranderde mist, hemel zichtbaar",
    45: "Onveranderde mist, hemel onzichtbaar",
    46: "Opgekomen of dichter wordende mist, hemel zichtbaar",
    47: "Opgekomen of dichter wordende mist, hemel onzichtbaar",
    48: "Mist met rijpafzetting, hemel zichtbaar",
    49: "Mist met rijpafzetting, hemel onzichtbaar",
    50: "Af en toe motregen, licht",
    51: "Aanhoudende motregen, licht",
    52: "Af en toe motregen, matig",
    53: "Aanhoudende motregen, matig",
    54: "Af en toe motregen, zwaar",
    55: "Aanhoudende motregen, zwaar",
    58: "Regen en motregen, licht",
    59: "Regen en motregen, matig of zwaar",
    60: "Af en toe regen, licht",
    61: "Aanhoudende regen, licht",
    62: "Af en toe regen, matig",
    63: "Aanhoudende regen, matig",
    64: "Af en toe regen, zwaar",
    65: "Aanhoudende regen, zwaar",
    80: "Regenbuien, licht",
    81: "Regenbuien, matig of zwaar",
    82: "Zeer zware regenbuien",
    91: "Onweer in het voorafgaande uur, nu lichte regen",
    92: "Onweer in het voorafgaande uur, nu matige of zware regen",
    95: "Licht of matig onweer met regen en/of sneeuw, zonder hagelvormen",
    97: "Zwaar onweer met regen en/of sneeuw, zonder hagelvormen",
    98: "Onweer met stof- of zandstorm",
}

AUTOMATIC = {
    **_SNOW_AUTOMATIC,
    **_WINTRY_AUTOMATIC,
    **_HAIL_AUTOMATIC,
    0: "Geen weer van betekenis vastgesteld door de sensoren",
    1: "Afnemende bewolking",
    2: "Onveranderde bewolking",
    3: "Toenemende bewolking",
    4: "Heiigheid, rook of zwevend stof, zicht minstens 1 km",
    5: "Heiigheid, rook of zwevend stof, zicht minder dan 1 km",
    10: "Nevel",
    11: "IJsnaalden of ijsplaatjes",
    12: "Elektrische ontlading op afstand",
    18: "Langdurige zware windstoten",
    20: "Mist in het voorafgaande uur",
    21: "Neerslag van onbekende soort in het voorafgaande uur",
    23: "Regen in het voorafgaande uur",
    26: "Onweer, met of zonder neerslag, in het voorafgaande uur",
    27: "Driftsneeuw of opwaaiend zand",
    28: "Driftsneeuw of opwaaiend zand, zicht minstens 1 km",
    29: "Driftsneeuw of opwaaiend zand, zicht minder dan 1 km",
    30: "Mist",
    31: "Plaatselijke mist of ijsmist",
    32: "Dunner wordende mist of ijsmist",
    33: "Onveranderde mist of ijsmist",
    34: "Opgekomen of dichter wordende mist of ijsmist",
    35: "Mist met rijpafzetting",
    40: "Neerslag, soort onbekend",
    41: "Neerslag, soort onbekend, licht of matig",
    42: "Neerslag, soort onbekend, zwaar",
    43: "Vloeibare neerslag, licht of matig",
    44: "Vloeibare neerslag, zwaar",
    50: "Motregen",
    51: "Motregen, licht",
    52: "Motregen, matig",
    53: "Motregen, zwaar",
    57: "Regen en motregen, licht",
    58: "Regen en motregen, matig of zwaar",
    60: "Regen",
    61: "Regen, licht",
    62: "Regen, matig",
    63: "Regen, zwaar",
    80: "Buiige neerslag of neerslag van tijd tot tijd, soort onbekend",
    81: "Regenbuien of regen van tijd tot tijd, licht",
    82: "Regenbuien of regen van tijd tot tijd, matig",
    83: "Regenbuien of regen van tijd tot tijd, zwaar",
    84: "Zeer zware regenbuien of zeer zware regen van tijd tot tijd",
    90: "Onweer",
    91: "Licht of matig onweer zonder neerslag",
    92: "Licht of matig onweer met regen- en/of sneeuwbuien",
    94: "Zwaar onweer zonder neerslag",
    95: "Zwaar onweer met regen- en/of sneeuwbuien",
    99: "Tornado",
}
