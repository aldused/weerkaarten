"""Wereldweer-bronnenregister: één lijst met alle nieuwsbronnen van de nieuwsstroom.

Elke bron: id → dict met
  naam, land (ISO2 of None = internationaal), soort (instituut|organisatie|omroep|vakmedia|aggregator|rampen),
  url, taal, interval (minuten tussen controles), betrouwbaarheid (0–1), filter (True = algemene nieuwsfeed,
  alleen berichten die op weer lijken), en optioneel 'gebied' (hint voor de triage: Google News-editie per land).

Alle URL's hieronder zijn op 6 nov 2026 met de hand geprobeerd (RSS/Atom gaf geldige, actuele items).
Niet werkend of zonder feed (en dus NIET opgenomen): KNMI, KMI, DWD-pers, Met Office-pers/blog, MeteoSwiss,
GeoSphere, MET Norway, SMHI, DMI, FMI, IMO, ČHMÚ, SHMÚ, HungaroMet, ARSO, HNMS (certificaatfout), MGM, WMO,
Copernicus EMS, NASA Earth Observatory (ongeldige XML), AccuWeather (403), The Weather Channel (404).
Hun nieuws komt binnen via de Google News-editie van hun land (zoekterm met de naam van het instituut) en hun
waarschuwingen via Meteoalarm.
"""
import re
import urllib.parse

GN = 'https://news.google.com/rss/search?q={q}&hl={hl}&gl={gl}&ceid={ceid}'


def gn(q, hl, gl, ceid, dagen=1):
    return GN.format(q=urllib.parse.quote(f'{q} when:{dagen}d'), hl=hl, gl=gl, ceid=ceid)


BRONNEN = {}


def bron(id_, naam, url, soort, land=None, taal='en', interval=30, betrouwbaarheid=0.75, filter=False, gebied=None):
    BRONNEN[id_] = {'naam': naam, 'url': url, 'soort': soort, 'land': land, 'taal': taal, 'interval': interval,
                    'betrouwbaarheid': betrouwbaarheid, 'filter': filter, 'gebied': gebied or land}


# ---------------------------------------------------------------- officiële meteorologische instituten (Europa)
bron('aemet', 'AEMET (Spanje)', 'https://www.aemet.es/es/rss/noticias.rss', 'instituut', 'ES', 'es', 30, 1.0)
bron('ipma', 'IPMA (Portugal) – communiqués', 'https://www.ipma.pt/resources.www/rss/comunicados.xml', 'instituut',
     'PT', 'pt', 15, 1.0)
bron('met_eireann', 'Met Éireann – waarschuwingen', 'https://www.met.ie/warningsxml/rss.xml', 'instituut', 'IE',
     'en', 15, 1.0)
bron('imgw', 'IMGW-PIB (Polen)', 'https://imgw.pl/feed/', 'instituut', 'PL', 'pl', 30, 1.0, filter=True)
bron('dhmz', 'DHMZ (Kroatië)', 'https://meteo.hr/rss.xml', 'instituut', 'HR', 'hr', 60, 1.0, filter=True)
bron('anm_ro', 'ANM (Roemenië) – waarschuwingen', 'https://www.meteoromania.ro/avertizari-rss.php', 'instituut',
     'RO', 'ro', 15, 1.0)
bron('lhmt', 'LHMT (Litouwen)', 'https://www.meteo.lt/feed/', 'instituut', 'LT', 'lt', 60, 1.0)

# ---------------------------------------------------------------- Europese en internationale organisaties
bron('ecmwf', 'ECMWF – nieuws', 'https://www.ecmwf.int/rss.xml', 'organisatie', None, 'en', 180, 0.95)
bron('eumetsat', 'EUMETSAT – nieuws', 'https://www.eumetsat.int/rss.xml', 'organisatie', None, 'en', 180, 0.95)
bron('copernicus', 'Copernicus C3S', 'https://climate.copernicus.eu/rss.xml', 'organisatie', None, 'en', 180, 0.95)
bron('efas', 'EFAS (Copernicus overstromingen)', 'https://www.efas.eu/en/rss.xml', 'organisatie', None, 'en', 180, 0.95)
bron('essl', 'ESSL', 'https://www.essl.org/cms/feed/', 'organisatie', None, 'en', 180, 0.95)
bron('noaa', 'NOAA – nieuws', 'https://www.noaa.gov/rss.xml', 'organisatie', 'US', 'en', 120, 0.95)
bron('nhc_atl', 'NHC Atlantische Oceaan', 'https://www.nhc.noaa.gov/index-at.xml', 'organisatie', 'XA', 'en', 15, 1.0)
bron('nhc_epac', 'NHC oostelijke Grote Oceaan', 'https://www.nhc.noaa.gov/index-ep.xml', 'organisatie', 'XP', 'en', 15, 1.0)
bron('jtwc', 'JTWC', 'https://www.metoc.navy.mil/jtwc/rss/jtwc.rss', 'organisatie', 'XP', 'en', 15, 0.95)
bron('reliefweb_eu', 'ReliefWeb Europa', 'https://reliefweb.int/updates/rss.xml?advanced-search=%28PC.EUR%29',
     'rampen', None, 'en', 60, 0.85, filter=True)
bron('reliefweb', 'ReliefWeb rampen', 'https://reliefweb.int/disasters/rss.xml', 'rampen', None, 'en', 60, 0.85)
bron('floodlist', 'FloodList', 'https://floodlist.com/feed', 'rampen', None, 'en', 60, 0.8)

# ---------------------------------------------------------------- meteorologische vakmedia
bron('severe_weather_eu', 'Severe Weather Europe', 'https://www.severe-weather.eu/feed/', 'vakmedia', None, 'en', 30, 0.8)
bron('meteoweb', 'MeteoWeb (Italië)', 'https://www.meteoweb.eu/category/meteo/feed/', 'vakmedia', 'IT', 'it', 20, 0.7)
bron('meteo_paris', 'Météo-Paris / La Météo', 'https://www.meteo-paris.com/rss', 'vakmedia', 'FR', 'fr', 30, 0.7)
bron('guardian_extreem', 'The Guardian – extreem weer', 'https://www.theguardian.com/world/extreme-weather/rss',
     'omroep', None, 'en', 30, 0.85)

# ---------------------------------------------------------------- omroepen en persbureaus (algemene feed → weerfilter)
for id_, naam, url, land, taal in (
        ('nos_buitenland', 'NOS Buitenland', 'https://feeds.nos.nl/nosnieuwsbuitenland', 'NL', 'nl'),
        ('nos_binnenland', 'NOS Binnenland', 'https://feeds.nos.nl/nosnieuwsbinnenland', 'NL', 'nl'),
        ('vrt', 'VRT NWS', 'https://www.vrt.be/vrtnws/nl.rss.articles.xml', 'BE', 'nl'),
        ('tagesschau', 'tagesschau', 'https://www.tagesschau.de/infoservices/alle-meldungen-100~rss2.xml', 'DE', 'de'),
        ('srf', 'SRF News', 'https://www.srf.ch/news/bnf/rss/1646', 'CH', 'de'),
        ('yle', 'Yle Uutiset', 'https://feeds.yle.fi/uutiset/v1/majorHeadlines/YLE_UUTISET.rss', 'FI', 'fi'),
        ('svt', 'SVT Nyheter', 'https://www.svt.se/nyheter/rss.xml', 'SE', 'sv'),
        ('nrk', 'NRK', 'https://www.nrk.no/toppsaker.rss', 'NO', 'no'),
        ('dr', 'DR Nyheder', 'https://www.dr.dk/nyheder/service/feeds/allenyheder', 'DK', 'da'),
        ('rte', 'RTÉ News', 'https://www.rte.ie/feeds/rss/?index=/news/', 'IE', 'en'),
        ('ansa', 'ANSA Cronaca', 'https://www.ansa.it/sito/notizie/cronaca/cronaca_rss.xml', 'IT', 'it'),
        ('bbc_europa', 'BBC News Europe', 'https://feeds.bbci.co.uk/news/world/europe/rss.xml', None, 'en'),
        ('euronews', 'Euronews', 'https://www.euronews.com/rss', None, 'en'),
):
    bron(id_, naam, url, 'omroep', land, taal, 20, 0.85, filter=True)

# ---------------------------------------------------------------- Google News per Europees land, in de eigen taal
# Zoektermen = weerverschijnselen + naam van het nationale instituut (vangt KNMI/DWD/SMHI-nieuws zonder eigen feed).
GN_EUROPA = [
    ('NL', 'nl', 'NL', 'NL:nl', 'KNMI OR "code oranje" OR "code rood" OR storm OR wateroverlast OR hagel OR sneeuw OR gladheid OR hittegolf OR windstoten OR noodweer'),
    ('BE', 'nl', 'BE', 'BE:nl', 'KMI OR "code oranje" OR "code rood" OR storm OR wateroverlast OR noodweer OR sneeuw OR overstromingen OR rukwinden OR hagel'),
    ('DE', 'de', 'DE', 'DE:de', 'Unwetter OR "DWD warnt" OR Unwetterwarnung OR Orkanböen OR Starkregen OR Glatteis OR Schneefall OR Hochwasser OR Sturmflut OR Tornado OR Hagel'),
    ('AT', 'de', 'AT', 'AT:de', 'GeoSphere OR Unwetter OR Sturm OR Schneefall OR Lawine OR Hochwasser OR Hagel OR Mure OR Glätte OR Föhn'),
    ('CH', 'de', 'CH', 'CH:de', 'MeteoSchweiz OR Unwetter OR Sturm OR Schneefall OR Lawine OR Hochwasser OR Hagel OR Föhn OR Murgang'),
    ('FR', 'fr', 'FR', 'FR:fr', '"Météo-France" OR "vigilance orange" OR "vigilance rouge" OR tempête OR crue OR inondations OR orages OR neige OR grêle OR "épisode méditerranéen"'),
    ('GB', 'en-GB', 'GB', 'GB:en', '"Met Office" OR "amber warning" OR "yellow warning" OR "red warning" OR storm OR flooding OR snow OR gales OR "heavy rain"'),
    ('IE', 'en-IE', 'IE', 'IE:en', '"Met Éireann" OR "status orange" OR "status red" OR "status yellow" OR storm OR flooding OR snow OR gales'),
    ('ES', 'es', 'ES', 'ES:es', 'AEMET OR "aviso rojo" OR "aviso naranja" OR DANA OR temporal OR nevada OR inundaciones OR granizo OR borrasca'),
    ('PT', 'pt-PT', 'PT', 'PT:pt-150', 'IPMA OR "aviso vermelho" OR "aviso laranja" OR depressão OR tempestade OR "chuva forte" OR inundações OR neve OR agitação marítima'),
    ('IT', 'it', 'IT', 'IT:it', '"allerta meteo" OR "allerta rossa" OR "allerta arancione" OR maltempo OR nubifragio OR alluvione OR neve OR grandinata OR "tromba d\'aria"'),
    ('SE', 'sv', 'SE', 'SE:sv', 'SMHI OR storm OR snöoväder OR skyfall OR översvämning OR snöfall OR ovädret OR "orange varning" OR "röd varning"'),
    ('NO', 'no', 'NO', 'NO:no', 'Meteorologisk OR farevarsel OR uvær OR storm OR snøfall OR flom OR ekstremvær OR "oransje farevarsel" OR "rødt farevarsel"'),
    ('DK', 'da', 'DK', 'DK:da', 'DMI OR storm OR stormflod OR skybrud OR snestorm OR oversvømmelse OR snefald OR "farligt vejr"'),
    ('FI', 'fi', 'FI', 'FI:fi', '"Ilmatieteen laitos" OR myrsky OR lumimyräkkä OR tulva OR rankkasade OR pakkanen OR helle OR lumipyry'),
    ('PL', 'pl', 'PL', 'PL:pl', 'IMGW OR ostrzeżenie OR wichura OR ulewa OR śnieżyca OR powódź OR gołoledź OR nawałnica OR gradobicie'),
    ('CZ', 'cs', 'CZ', 'CZ:cs', 'ČHMÚ OR výstraha OR povodně OR počasí OR mráz OR vichřice OR sněžení OR bouřky OR kroupy OR ledovka OR náledí'),
    ('SK', 'sk', 'SK', 'SK:sk', 'SHMÚ OR výstraha OR povodne OR počasie OR mráz OR víchrica OR sneženie OR búrky OR krupobitie OR poľadovica'),
    ('HU', 'hu', 'HU', 'HU:hu', 'HungaroMet OR figyelmeztetés OR "viharos szél" OR havazás OR árvíz OR felhőszakadás OR jégeső OR "ónos eső"'),
    ('RO', 'ro', 'RO', 'RO:ro', 'ANM OR "cod roșu" OR "cod portocaliu" OR ninsori OR viscol OR inundații OR furtună OR caniculă OR grindină'),
    ('BG', 'bg', 'BG', 'BG:bg', 'НИМХ OR "оранжев код" OR "червен код" OR наводнение OR снеговалеж OR буря OR градушка OR поледици'),
    ('SI', 'sl', 'SI', 'SI:sl', 'ARSO OR opozorilo OR neurje OR poplave OR sneg OR toča OR burja OR žled'),
    ('RS', 'sr', 'RS', 'RS:sr', 'RHMZ OR upozorenje OR nevreme OR poplave OR sneg OR grad OR oluja OR "olujni vetar"'),
    ('HR', 'hr', 'HR', 'HR:hr', 'DHMZ OR nevrijeme OR "meteoalarm" OR kiša OR vjetar OR poplave OR "olujni vjetar" OR bura OR snijeg OR tuča'),
    ('LT', 'lt', 'LT', 'LT:lt', 'LHMT OR audra OR liūtis OR potvynis OR pūga OR sniegas OR plikledis'),
    ('LV', 'lv', 'LV', 'LV:lv', 'LVĢMC OR brīdinājums OR vētra OR plūdi OR sniegs OR putenis OR lietusgāze OR apledojums'),
    ('GR', 'el', 'GR', 'GR:el', 'ΕΜΥ OR κακοκαιρία OR πλημμύρες OR καταιγίδα OR χιονόπτωση OR χαλάζι OR θυελλώδεις'),
    ('TR', 'tr', 'TR', 'TR:tr', 'Meteoroloji OR sel OR fırtına OR "kuvvetli yağış" OR "kar yağışı" OR hortum OR dolu OR çığ'),
    ('UA', 'uk', 'UA', 'UA:uk', 'Укргідрометцентр OR негода OR снігопад OR злива OR ожеледь OR буревій OR заметіль OR повінь'),
    ('RU', 'ru', 'RU', 'RU:ru', 'Росгидромет OR снегопад OR метель OR ураган OR ливень OR наводнение OR "аномальный холод" OR "аномальная жара"'),
]
for iso, hl, gl, ceid, q in GN_EUROPA:
    bron('gn_' + iso.lower(), f'Google News {iso}', gn(q, hl, gl, ceid), 'aggregator', iso, hl.split('-')[0], 20, 0.7,
         gebied=iso)
bron('gn_europa_en', 'Google News Europa (Engels)',
     gn('Europe (storm OR floods OR snow OR heatwave OR wildfire OR "extreme weather" OR avalanche)', 'en', 'US', 'US:en'),
     'aggregator', None, 'en', 20, 0.7, gebied='XE')
bron('gn_ijsland', 'Google News IJsland (Engels)',
     gn('Iceland (storm OR snow OR "weather warning" OR eruption OR flood OR "Met Office" OR vedur)', 'en', 'US', 'US:en'),
     'aggregator', 'IS', 'en', 60, 0.7, gebied='IS')
bron('gn_balkan_en', 'Google News Balkan (Engels)',
     gn('(Bosnia OR Montenegro OR Albania OR "North Macedonia" OR Kosovo OR Moldova OR Estonia) (storm OR floods OR snow OR heatwave OR wildfire)',
        'en', 'US', 'US:en'), 'aggregator', None, 'en', 60, 0.7, gebied='XE')

# ---------------------------------------------------------------- wereld (overgenomen uit de dagelijkse editie)
GN_US = 'https://news.google.com/rss/search?hl=en&gl=US&ceid=US:en&q='
for id_, q in (
        ('gn_tropisch', '(typhoon OR hurricane OR cyclone OR "tropical storm")'),
        ('gn_storm', '(flooding OR "flash floods" OR snowstorm OR blizzard OR tornado OR hailstorm)'),
        ('gn_hitte', '(heatwave OR "record temperature" OR drought OR wildfire)'),
        ('gn_winter', '(blizzard OR "heavy snow" OR "record snow" OR "ice storm" OR "cold wave" OR "record cold" OR "polar vortex")'),
        ('gn_extreem', '("giant hail" OR derecho OR "dust storm" OR "killed by lightning" OR cloudburst OR mudslide OR "extreme weather")'),
        ('gn_klimaat', '(climate OR "global warming") (record OR study OR report)'),
        ('gn_reuters', 'site:reuters.com (weather OR storm OR floods OR climate)'),
):
    bron(id_, 'Google News wereld – ' + id_[3:], gn(q, 'en', 'US', 'US:en'), 'aggregator', None, 'en', 30, 0.7, gebied='XW')
for taal, (hl, gl, ceid, q) in {
    'zh': ('zh-CN', 'CN', 'CN:zh-Hans', '台风 OR 暴雨 OR 洪水 OR 暴雪 OR 高温 OR 龙卷风 OR 寒潮 OR 冰雹'),
    'ja': ('ja', 'JP', 'JP:ja', '台風 OR 大雨 OR 洪水 OR 大雪 OR 猛暑 OR 竜巻 OR 寒波 OR 暴風雪'),
    'ko': ('ko', 'KR', 'KR:ko', '태풍 OR 폭우 OR 홍수 OR 폭설 OR 폭염 OR 한파'),
    'hi': ('hi', 'IN', 'IN:hi', 'चक्रवात OR बाढ़ OR भारी बारिश OR लू OR शीतलहर'),
    'id': ('id', 'ID', 'ID:id', 'banjir OR siklon OR cuaca ekstrem OR longsor OR puting beliung'),
    'vi': ('vi', 'VN', 'VN:vi', 'bão OR lũ lụt OR mưa lớn OR sạt lở OR rét đậm'),
    'en-PH': ('en', 'PH', 'PH:en', 'PAGASA OR typhoon OR flooding OR landslide'),
    'en-AU': ('en-AU', 'AU', 'AU:en', 'BOM warning OR flooding OR bushfire OR severe storm OR cyclone OR heatwave'),
    'en-ZA': ('en', 'ZA', 'ZA:en', 'flooding OR severe weather OR storm OR snow OR heatwave'),
    'en-IN': ('en', 'IN', 'IN:en', 'IMD alert OR flooding OR cyclone OR heatwave OR cloudburst OR cold wave'),
    'ar': ('ar', 'EG', 'EG:ar', 'فيضانات OR عاصفة OR سيول OR موجة حر'),
    'es-419': ('es-419', 'MX', 'MX:es-419', 'huracán OR inundaciones OR tormenta tropical OR lluvias intensas OR frente frío'),
    'pt-BR': ('pt-BR', 'BR', 'BR:pt-419', 'enchentes OR temporal OR ciclone OR chuva forte OR onda de calor OR granizo'),
    'en-CA': ('en-CA', 'CA', 'CA:en', 'Environment Canada warning OR blizzard OR flooding OR wildfire OR freezing rain OR tornado'),
    'en-US': ('en', 'US', 'US:en', 'National Weather Service warning OR tornado OR blizzard OR flash flood emergency'),
}.items():
    bron('gnw_' + taal.lower(), f'Google News {gl}', gn(q, hl, gl, ceid), 'aggregator', gl, taal.split('-')[0], 30, 0.7,
         gebied=gl)
for id_, naam, url in (
        ('carbonbrief', 'Carbon Brief', 'https://www.carbonbrief.org/feed/'),
        ('guardian_klimaat', 'The Guardian – klimaat', 'https://www.theguardian.com/environment/climate-crisis/rss'),
        ('bbc_wetenschap', 'BBC Science & Environment', 'https://feeds.bbci.co.uk/news/science_and_environment/rss.xml'),
        ('yale_climate', 'Yale Climate Connections', 'https://yaleclimateconnections.org/feed/'),
        ('phys_earth', 'Phys.org Earth', 'https://phys.org/rss-feed/earth-news/environment/'),
):
    bron(id_, naam, url, 'vakmedia', None, 'en', 180, 0.8)

# Uitgevers met een sterke redactie: als zo'n medium via Google News binnenkomt telt het als 'omroep/persbureau'
STERKE_MEDIA = re.compile(r'reuters|associated press|\bap news|bbc|deutsche welle|\bdw\b|the guardian|le monde|'
                          r'el pa[ií]s|corriere|repubblica|ansa|tagesschau|zdf|ard|spiegel|faz|süddeutsche|nos\b|'
                          r'vrt|rtbf|rt[ée]|irish times|sky news|france ?24|france ?info|euronews|afp|efe|lusa|'
                          r'yle|svt|nrk|\bdr\b|orf|srf|rai|financial times|new york times|washington post|cnn|'
                          r'meteoweb|severe weather europe|met office|knmi|dwd|aemet|ipma|imgw|smhi|dmi', re.I)
INSTITUUT_NAAM = re.compile(r'\b(KNMI|KMI|IRM|DWD|Deutscher Wetterdienst|Met Office|Met [ÉE]ireann|AEMET|IPMA|'
                            r'MeteoSwiss|MeteoSchweiz|GeoSphere|SMHI|DMI|FMI|Ilmatieteen laitos|IMGW|ČHMÚ|SHMÚ|'
                            r'HungaroMet|DHMZ|ARSO|HNMS|ΕΜΥ|MGM|ANM|NIMH|Météo-France|Meteoalarm|ECMWF|Copernicus|'
                            r'NHC|National Hurricane Center|JTWC|PAGASA|JMA|IMD|NWS|National Weather Service)\b')

# Weerfilter voor algemene nieuwsfeeds (alle talen van de bronnen hierboven). Ruim: de triage beslist.
WEER_RE = re.compile(
    r'\b(storm\w*|orkaan|orkan\w*|hurricane|typhoon|tyfoon|cyclon\w*|zykl\w*|tornado\w*|windhoos|trombe?|'
    r'unwetter|gewitter|onweer|thunder\w*|orage\w*|temporal\w*|temporale|tempête|tempesta|tempestade|burza|bouřk\w*|'
    r'regen\w*|rain\w*|pluie|pioggi\w*|lluvia\w*|chuva|ulew\w*|starkregen|nubifragi\w*|aguacer\w*|skyfall|skybrud|'
    r'flood\w*|überschw\w*|hochwasser|overstrom\w*|wateroverlast|inond\w*|crue\w*|alluvion\w*|inundac\w*|'
    r'inunda\w*|powód\w*|povod\w*|flom|tulva\w*|översvämn\w*|oversvømm\w*|'
    r'snow\w*|sneeuw\w*|schnee\w*|neige\w*|neve|nevad\w*|nieve|śnieg\w*|sníh|sněž\w*|snö\w*|snø\w*|sne(fald|storm)\w*|lumi(sade|myräkkä|pyry)\w*|'
    r'blizzard|lawin\w*|avalanch\w*|valang\w*|alud|glätte|glatteis|gladheid|ijzel|verglas|gelo|frost|vorst|'
    r'hitze\w*|hittegolf|heatwave|heat wave|canicul\w*|ola de calor|onda de calor|helle|värmebölja|'
    r'koudegolf|kou\b|cold (wave|snap|spell)|kälte\w*|frío|frio|freddo|froid|mróz\w*|pakkanen|'
    r'droogte|drought|dürre|sécheresse|siccità|sequía|seca|'
    r'wildfire|bosbrand|waldbrand|incendi\w*|feu de forêt|skogsbrand|skogbrann|metsäpalo|'
    r'hagel\w*|hail\w*|grêle|grandin\w*|granizo|gradobic\w*|kroupy|'
    r'wetter|weerbericht|weersverwachting|noodweer|weather|météo|meteo\w*|pogoda|počasí|väder|vær|vejr|'
    r'klimaat|klima\w*|climat\w*|clima|'
    r'windsto\w*|windböe\w*|sturmböe\w*|orkanböe\w*|rukwind\w*|gales?|vento forte|viento fuerte|wichur\w*|vichřic\w*|'
    r'code (oranje|rood)|vigilance|allerta|aviso|varning|farevarsel|ostrzeżen\w*|výstrah\w*|warnung|warning)\b',
    re.I)
RUIS_RE = re.compile(r'\b(Sturm Graz|Brainstorm|shitstorm|storm(ing)? the|stormt? (het|de) (podium|stadion)|'
                     r'Champions League|Eredivisie|Bundesliga|Serie A|La Liga|Premier League|NBA|NFL|NHL|'
                     r'Formel 1|Formula 1|Wetten, dass|weerwolf|weerbaar\w*|weerstand|weerspiegel\w*|'
                     r'weerzien|weerlegd|klimaatdoel\w*|klimaatbeleid|klimaatakkoord|COP\d+)\b', re.I)


def lijkt_weer(tekst):
    return bool(WEER_RE.search(tekst or '')) and not RUIS_RE.search(tekst or '')
