/* Menuconcept v9. Catalogus uit v7; kaartfilters en routes gecontroleerd tegen index.html. */
const MENU_PRODUCTS = [
  {
    "id": "radar",
    "name": "Neerslagradar",
    "description": "Buien live, 5-min",
    "category": "nu",
    "type": "nu",
    "section": "Beeld",
    "icon": "radar",
    "href": "index.html#radar",
    "thumbnail": "thumbs/radar.webp",
    "facets": {},
    "keywords": "Neerslagradar Buien live, 5-min ",
    "restricted": false
  },
  {
    "id": "nowcast",
    "name": "Buienverwachting",
    "description": "De verwachte beweging van buien",
    "category": "nu",
    "type": "nu",
    "section": "Beeld",
    "icon": "radar",
    "href": "index.html#nowcast",
    "thumbnail": "thumbs/nowcast.webp",
    "facets": {},
    "keywords": "Nowcast 15-min Extrapolatie + 700 hPa-blend ",
    "restricted": false
  },
  {
    "id": "bliksem",
    "name": "Bliksem Benelux",
    "description": "Ontladingen, 48 u terug",
    "category": "nu",
    "type": "nu",
    "section": "Beeld",
    "icon": "bliksem",
    "href": "index.html#bliksem",
    "thumbnail": "thumbs/bliksem.webp",
    "facets": {},
    "keywords": "Bliksem Benelux Ontladingen, 48 u terug ",
    "restricted": false
  },
  {
    "id": "celltracking",
    "name": "Onweercellen volgen",
    "description": "Ontstaan, beweging en ontwikkeling",
    "category": "nu",
    "type": "nu",
    "section": "Beeld",
    "icon": "bliksem",
    "href": "index.html#celltracking",
    "thumbnail": "thumbs/celltracking.webp",
    "facets": {},
    "keywords": "Onweercellen CellWarn-tracking ",
    "restricted": false
  },
  {
    "id": "satelliet",
    "name": "Satellietbeelden",
    "description": "Wolken vanuit de ruimte · Meteosat",
    "category": "nu",
    "type": "nu",
    "section": "Beeld",
    "icon": "sat",
    "href": "index.html#satelliet",
    "thumbnail": null,
    "facets": {},
    "keywords": "Satelliet HD MTG, AI-upscale ",
    "restricted": false
  },
  {
    "id": "actueel",
    "name": "Waarnemingen",
    "description": "Stations NL en Europa",
    "category": "nu",
    "type": "nu",
    "section": "Metingen",
    "icon": "tabel",
    "href": "index.html#actueel",
    "thumbnail": "thumbs/actueel.webp",
    "facets": {},
    "keywords": "Waarnemingen Stations NL en Europa ",
    "restricted": false
  },
  {
    "id": "toplijst",
    "name": "Toplijst & kaarten",
    "description": "Warmste, koudste, natste",
    "category": "nu",
    "type": "nu",
    "section": "Metingen",
    "icon": "records",
    "href": "index.html#toplijst",
    "thumbnail": "thumbs/toplijst.webp",
    "facets": {},
    "keywords": "Toplijst & kaarten Warmste, koudste, natste ",
    "restricted": false
  },
  {
    "id": "synop",
    "name": "Weerkaart met stations",
    "description": "Metingen in een synoptische kaart",
    "category": "nu",
    "type": "nu",
    "section": "Metingen",
    "icon": "tabel",
    "href": "index.html#synop",
    "thumbnail": "thumbs/synop.webp",
    "facets": {},
    "keywords": "Synoptisch Stationsmodel-kaart ",
    "restricted": false
  },
  {
    "id": "hittekracht",
    "name": "Gevoelstemperatuur & hitte",
    "description": "De gemeten hittebelasting",
    "category": "nu",
    "type": "nu",
    "section": "Metingen",
    "icon": "temp",
    "href": "index.html#hittekracht",
    "thumbnail": null,
    "facets": {},
    "keywords": "Hittekracht Gemeten + KNMI-app ",
    "restricted": false
  },
  {
    "id": "marifoon",
    "name": "Kustdistricten",
    "description": "Marifoonbericht",
    "category": "nu",
    "type": "nu",
    "section": "Water & kust",
    "icon": "water",
    "href": "index.html#marifoon",
    "thumbnail": null,
    "facets": {},
    "keywords": "Kustdistricten Marifoonbericht ",
    "restricted": false
  },
  {
    "id": "zeetemp",
    "name": "Zeewatertemperatuur",
    "description": "Noordzee + kustbericht",
    "category": "nu",
    "type": "nu",
    "section": "Water & kust",
    "icon": "water",
    "href": "index.html#zeetemp",
    "thumbnail": "thumbs/zeetemp.webp",
    "facets": {},
    "keywords": "Zeewatertemperatuur Noordzee + kustbericht ",
    "restricted": false
  },
  {
    "id": "rijnlobith",
    "name": "Rijn bij Lobith",
    "description": "Rijnafvoer en waterstand",
    "category": "nu",
    "type": "nu",
    "section": "Water & kust",
    "icon": "water",
    "href": "index.html#rijnlobith",
    "thumbnail": "thumbs/rijnlobith.webp",
    "facets": {},
    "keywords": "Rijnafvoer Lobith Q en waterstand ",
    "restricted": false
  },
  {
    "id": "significant",
    "name": "Weer in één kaart",
    "description": "Neerslag, wolken en wind in één overzicht",
    "category": "verwachting",
    "type": "kaarten",
    "section": "",
    "icon": "neerslag",
    "href": "index.html#weerkaarten",
    "thumbnail": "thumbs/significant.webp",
    "facets": {
      "veld": [
        "significant"
      ],
      "model": [
        "harmonie",
        "icond2",
        "icond2ruc",
        "arome"
      ],
      "gebied": [
        "nl"
      ],
      "weergave": [
        "1"
      ]
    },
    "keywords": "Significant kaart HARMONIE · ICON-D2 · RUC · AROME Significant HARMONIE 43 ICON-D2 ICON-D2-RUC AROME Nederland 1 kaart HARMONIE 43 ICON-D2 ICON-D2-RUC AROME",
    "restricted": false
  },
  {
    "id": "modelkaarten",
    "name": "Weerkaarten Nederland",
    "description": "Vergelijk temperatuur, regen, wind en wolken",
    "category": "verwachting",
    "type": "kaarten",
    "section": "",
    "icon": "temp",
    "href": "index.html#weerkaarten-modelkaarten",
    "thumbnail": "thumbs/modelkaarten_temp.webp",
    "facets": {
      "veld": [
        "temp",
        "neerslag",
        "wind",
        "bewolking",
        "onweer",
        "hoogte",
        "druk"
      ],
      "model": [
        "harmonie",
        "harmonie46",
        "icond2",
        "icond2ruc",
        "ecmwf"
      ],
      "gebied": [
        "nl"
      ],
      "weergave": [
        "1"
      ]
    },
    "keywords": "Modelkaarten Nederland 7 velden × 5 modellen Temperatuur Neerslag Wind Bewolking Onweer / CAPE Hoogtevelden Druk & fronten HARMONIE 43 HARMONIE 46 ICON-D2 ICON-D2-RUC ECMWF HRES Nederland 1 kaart HARMONIE 43 HARMONIE 46 ICON-D2 ICON-D2-RUC ECMWF HRES",
    "restricted": false
  },
  {
    "id": "hires4",
    "name": "Vergelijk vier modellen",
    "description": "Vier verwachtingen naast elkaar",
    "category": "verwachting",
    "type": "kaarten",
    "section": "",
    "icon": "vierluik",
    "href": "index.html#weerkaarten-vierluik",
    "thumbnail": "thumbs/hires4.webp",
    "facets": {
      "veld": [
        "neerslag",
        "temp",
        "wind",
        "bewolking"
      ],
      "model": [
        "harmonie",
        "harmonie46",
        "icond2",
        "icond2ruc",
        "arome",
        "ecmwf",
        "gfs"
      ],
      "gebied": [
        "nl"
      ],
      "weergave": [
        "4"
      ]
    },
    "keywords": "Hoge resolutie 4-luik 4 regiomodellen naast elkaar Neerslag Temperatuur Wind Bewolking HARMONIE 43 HARMONIE 46 ICON-D2 ICON-D2-RUC AROME Nederland 4-luik HARMONIE 43 HARMONIE 46 ICON-D2 ICON-D2-RUC AROME ECMWF HRES GFS",
    "restricted": false
  },
  {
    "id": "global4",
    "name": "Vergelijk wereldmodellen",
    "description": "ECMWF, GFS en ICON naast elkaar",
    "category": "verwachting",
    "type": "kaarten",
    "section": "",
    "icon": "vierluik",
    "href": "index.html#weerkaarten-global4",
    "thumbnail": "thumbs/global4.webp",
    "facets": {
      "veld": [
        "neerslag",
        "temp",
        "wind"
      ],
      "model": [
        "ecmwf",
        "gfs",
        "iconeu"
      ],
      "gebied": [
        "nl"
      ],
      "weergave": [
        "4"
      ]
    },
    "keywords": "Globale modellen 4-luik ECMWF · GFS · ICON-EU Neerslag Temperatuur Wind ECMWF HRES GFS ICON-EU Europa 4-luik ECMWF HRES GFS ICON-EU",
    "restricted": false
  },
  {
    "id": "sigvier",
    "name": "Weeroverzicht in vier kaarten",
    "description": "Het weerbeeld volgens vier modellen",
    "category": "verwachting",
    "type": "kaarten",
    "section": "",
    "icon": "vierluik",
    "href": "index.html#weerkaarten-sigvier",
    "thumbnail": "thumbs/sigvier.webp",
    "facets": {
      "veld": [
        "significant"
      ],
      "model": [
        "harmonie",
        "icond2",
        "icond2ruc",
        "arome"
      ],
      "gebied": [
        "nl"
      ],
      "weergave": [
        "4"
      ]
    },
    "keywords": "Significant 4-luik Zelfde veld, 4 modellen Significant HARMONIE 43 ICON-D2 ICON-D2-RUC AROME Nederland 4-luik HARMONIE 43 ICON-D2 ICON-D2-RUC AROME",
    "restricted": false
  },
  {
    "id": "hres10",
    "name": "Weerkaarten Europa",
    "description": "De verwachting voor heel Europa",
    "category": "verwachting",
    "type": "kaarten",
    "section": "",
    "icon": "druk",
    "href": "index.html#weerkaarten-hres10",
    "thumbnail": null,
    "facets": {
      "veld": [
        "overzicht",
        "temp",
        "neerslag",
        "wind",
        "hoogte",
        "onweer"
      ],
      "model": [
        "ecmwf",
        "gfs",
        "iconeu"
      ],
      "gebied": [
        "eu"
      ],
      "weergave": [
        "1"
      ]
    },
    "keywords": "Modelkaarten Europa tot +384 u Overzicht Temperatuur Neerslag Wind Hoogtevelden Onweer / CAPE ECMWF HRES GFS ICON-EU Europa 1 kaart ECMWF HRES GFS ICON-EU",
    "restricted": false
  },
  {
    "id": "drukkaarten",
    "name": "Luchtdruk · 9 dagen",
    "description": "Negen dagen naast elkaar in beeld",
    "category": "verwachting",
    "type": "kaarten",
    "section": "",
    "icon": "druk",
    "href": "index.html#weerkaarten-drukkaarten",
    "thumbnail": "thumbs/drukkaarten.webp",
    "facets": {
      "veld": [
        "druk"
      ],
      "model": [
        "ecmwf"
      ],
      "gebied": [
        "eu"
      ],
      "weergave": [
        "9"
      ]
    },
    "keywords": "ECMWF 9 panel Druk, 9 dagen in beeld Druk & fronten ECMWF HRES Europa 9 panelen ECMWF HRES",
    "restricted": false
  },
  {
    "id": "fronten",
    "name": "ECMWF Fronten · 10 dagen",
    "description": "Frontanalyse",
    "category": "verwachting",
    "type": "kaarten",
    "section": "",
    "icon": "druk",
    "href": "index.html#weerkaarten-fronten",
    "thumbnail": null,
    "facets": {
      "veld": [
        "druk"
      ],
      "model": [
        "ecmwf"
      ],
      "gebied": [
        "eu"
      ],
      "weergave": [
        "1"
      ]
    },
    "keywords": "ECMWF Fronten · 10 dagen Frontanalyse Druk & fronten ECMWF HRES Europa 1 kaart ECMWF HRES",
    "restricted": false
  },
  {
    "id": "efi24",
    "name": "Uitzonderlijk weer · EFI",
    "description": "Hoe sterk wijkt de verwachting af?",
    "category": "verwachting",
    "type": "kaarten",
    "section": "",
    "icon": "records",
    "href": "index.html#weerkaarten-efi24",
    "thumbnail": null,
    "facets": {
      "veld": [
        "extremen"
      ],
      "model": [
        "eps"
      ],
      "gebied": [
        "eu"
      ],
      "weergave": [
        "1"
      ]
    },
    "keywords": "Extreme forecast index ENS-afwijking t.o.v. klimaat Extremen (EFI) ECMWF ENS Europa 1 kaart ECMWF ENS",
    "restricted": false
  },
  {
    "id": "clusters",
    "name": "Weerscenario’s",
    "description": "Groepen mogelijke ontwikkelingen · ECMWF",
    "category": "verwachting",
    "type": "kaarten",
    "section": "",
    "icon": "druk",
    "href": "index.html#weerkaarten-clusters",
    "thumbnail": "thumbs/clusters.webp",
    "facets": {
      "veld": [
        "clusters"
      ],
      "model": [
        "eps"
      ],
      "gebied": [
        "eu"
      ],
      "weergave": [
        "1"
      ]
    },
    "keywords": "ECMWF Clusters Z500 EOF + k-means Clusters ECMWF ENS Europa 1 kaart ECMWF ENS",
    "restricted": false
  },
  {
    "id": "bewolking-harmonie",
    "name": "Wolkenverdeling",
    "description": "HARMONIE, realistisch",
    "category": "verwachting",
    "type": "kaarten",
    "section": "",
    "icon": "bewolking",
    "href": "index.html#weerkaarten-bewolking-harmonie",
    "thumbnail": "thumbs/bewolking-harmonie.webp",
    "facets": {
      "veld": [
        "bewolking"
      ],
      "model": [
        "harmonie"
      ],
      "gebied": [
        "nl"
      ],
      "weergave": [
        "1"
      ]
    },
    "keywords": "Wolkenverdeling HARMONIE, realistisch Bewolking HARMONIE 43 Nederland 1 kaart HARMONIE 43",
    "restricted": false
  },
  {
    "id": "bewolking-icond2",
    "name": "Wolkenkaart",
    "description": "ICON-D2, realistisch",
    "category": "verwachting",
    "type": "kaarten",
    "section": "",
    "icon": "bewolking",
    "href": "index.html#weerkaarten-bewolking-icond2",
    "thumbnail": "thumbs/bewolking-icond2.webp",
    "facets": {
      "veld": [
        "bewolking"
      ],
      "model": [
        "icond2"
      ],
      "gebied": [
        "nl"
      ],
      "weergave": [
        "1"
      ]
    },
    "keywords": "Wolkenkaart ICON-D2, realistisch Bewolking ICON-D2 Nederland 1 kaart ICON-D2",
    "restricted": false
  },
  {
    "id": "convectietemp",
    "name": "Wanneer ontstaan stapelwolken?",
    "description": "Convectietemperatuur volgens HARMONIE",
    "category": "verwachting",
    "type": "kaarten",
    "section": "",
    "icon": "temp",
    "href": "index.html#weerkaarten-convectietemp",
    "thumbnail": "thumbs/convectietemp.webp",
    "facets": {
      "veld": [
        "onweer"
      ],
      "model": [
        "harmonie"
      ],
      "gebied": [
        "nl"
      ],
      "weergave": [
        "1"
      ]
    },
    "keywords": "Convectietemperatuur Trigger-temperatuur Onweer / CAPE HARMONIE 43 Nederland 1 kaart HARMONIE 43",
    "restricted": false
  },
  {
    "id": "pluim-viewer",
    "name": "Weerpluim per plaats",
    "description": "De verwachting én onzekerheid voor jouw plaats",
    "category": "verwachting",
    "type": "pluim",
    "section": "Pluimen",
    "icon": "pluim",
    "href": "index.html#pluim",
    "thumbnail": "thumbs/pluim-viewer.webp",
    "facets": {
      "bron": [
        "ens"
      ],
      "grootheid": [
        "temp",
        "neerslag",
        "wind"
      ],
      "plaats": [
        "debilt",
        "groningen",
        "twente",
        "maastricht",
        "denhelder",
        "vlissingen",
        "overig"
      ],
      "vorm": [
        "1"
      ]
    },
    "keywords": "Pluim viewer ENS per station, vrije plaatskeuze ENS-pluim Temperatuur Neerslag Wind De Bilt Groningen Twente Maastricht Den Helder / Schiphol Vlissingen Andere plaats Eén plaats",
    "restricted": false
  },
  {
    "id": "pluim-ens6",
    "name": "Weerpluimen · 6 plaatsen",
    "description": "Zes Nederlandse plaatsen naast elkaar",
    "category": "verwachting",
    "type": "pluim",
    "section": "Pluimen",
    "icon": "pluim6",
    "href": "index.html#pluim-ens6",
    "thumbnail": "thumbs/pluim-ens6.webp",
    "facets": {
      "bron": [
        "ens"
      ],
      "grootheid": [
        "temp",
        "neerslag"
      ],
      "plaats": [
        "debilt",
        "groningen",
        "twente",
        "maastricht",
        "denhelder",
        "vlissingen"
      ],
      "vorm": [
        "6"
      ]
    },
    "keywords": "Ensemble 6-pluim 6 kernstations in één beeld ENS-pluim Temperatuur Neerslag De Bilt Groningen Twente Maastricht Den Helder / Schiphol Vlissingen Zes plaatsen",
    "restricted": false
  },
  {
    "id": "pluim-ens6plus",
    "name": "Weerpluimen met regensom",
    "description": "Zes plaatsen, inclusief opgetelde neerslag",
    "category": "verwachting",
    "type": "pluim",
    "section": "Pluimen",
    "icon": "pluim6",
    "href": "index.html#pluim-ens6plus",
    "thumbnail": "thumbs/pluim-ens6plus.webp",
    "facets": {
      "bron": [
        "ens"
      ],
      "grootheid": [
        "temp",
        "neerslag"
      ],
      "plaats": [
        "debilt",
        "groningen",
        "twente",
        "maastricht",
        "denhelder",
        "vlissingen"
      ],
      "vorm": [
        "6"
      ]
    },
    "keywords": "Ensemble 6-pluim + Met cumulatieve neerslag ENS-pluim Temperatuur Neerslag De Bilt Groningen Twente Maastricht Den Helder / Schiphol Vlissingen Zes plaatsen",
    "restricted": false
  },
  {
    "id": "pluim-trend",
    "name": "Hoe verandert de verwachting?",
    "description": "Vergelijk de laatste zes modelberekeningen",
    "category": "verwachting",
    "type": "pluim",
    "section": "Pluimen",
    "icon": "pluimtrend",
    "href": "index.html#pluim-trend",
    "thumbnail": null,
    "facets": {
      "bron": [
        "ens"
      ],
      "grootheid": [
        "temp",
        "neerslag"
      ],
      "plaats": [
        "debilt",
        "groningen",
        "twente",
        "maastricht",
        "denhelder",
        "vlissingen"
      ],
      "vorm": [
        "trend"
      ]
    },
    "keywords": "Pluim-trend 6 runs onder elkaar (3 dagen) ENS-pluim Temperatuur Neerslag De Bilt Groningen Twente Maastricht Den Helder / Schiphol Vlissingen Runs onder elkaar",
    "restricted": false
  },
  {
    "id": "mosmix-overzicht",
    "name": "10 dagen per plaats",
    "description": "Temperatuur, regen, wind en zon · MOS/MIX",
    "category": "verwachting",
    "type": "pluim",
    "section": "MOS/MIX",
    "icon": "meteogram",
    "href": "index.html#mosmix-overzicht",
    "thumbnail": "thumbs/mosmix-overzicht.webp",
    "facets": {
      "bron": [
        "mosmix"
      ],
      "grootheid": [
        "temp",
        "neerslag",
        "wind",
        "zon"
      ],
      "plaats": [
        "debilt",
        "groningen",
        "twente",
        "maastricht",
        "denhelder",
        "vlissingen",
        "overig"
      ],
      "vorm": [
        "1"
      ]
    },
    "keywords": "MOS/MIX overzicht 10 dagen per station MOS/MIX Temperatuur Neerslag Wind Zon De Bilt Groningen Twente Maastricht Den Helder / Schiphol Vlissingen Andere plaats Eén plaats",
    "restricted": false
  },
  {
    "id": "mosmix-minikaarten",
    "name": "9-daagse weerkaarten",
    "description": "Een weerkaart voor elke dag",
    "category": "verwachting",
    "type": "pluim",
    "section": "MOS/MIX",
    "icon": "tabel",
    "href": "index.html#mosmix-minikaarten",
    "thumbnail": "thumbs/mosmix-minikaarten.webp",
    "facets": {
      "bron": [
        "mosmix"
      ],
      "grootheid": [
        "temp",
        "neerslag",
        "wind",
        "zon"
      ],
      "plaats": [
        "alle"
      ],
      "vorm": [
        "kaart"
      ]
    },
    "keywords": "9-daagse kaarten Kaartje per dag MOS/MIX Temperatuur Neerslag Wind Zon Heel Nederland Kaart",
    "restricted": false
  },
  {
    "id": "mosmix-parameter",
    "name": "Verwachting per weerelement",
    "description": "Alle stations in één tabel",
    "category": "verwachting",
    "type": "pluim",
    "section": "MOS/MIX",
    "icon": "tabel",
    "href": "index.html#mosmix-parameter",
    "thumbnail": "thumbs/mosmix-parameter.webp",
    "facets": {
      "bron": [
        "mosmix"
      ],
      "grootheid": [
        "temp",
        "neerslag",
        "wind",
        "zon"
      ],
      "plaats": [
        "alle"
      ],
      "vorm": [
        "tabel"
      ]
    },
    "keywords": "Per parameter Alle stations, één veld MOS/MIX Temperatuur Neerslag Wind Zon Heel Nederland Tabel",
    "restricted": false
  },
  {
    "id": "mosmix-trend",
    "name": "Trend per plaats",
    "description": "Vergelijk opeenvolgende verwachtingen",
    "category": "verwachting",
    "type": "pluim",
    "section": "MOS/MIX",
    "icon": "meteogram",
    "href": "index.html#mosmix-trend",
    "thumbnail": "thumbs/mosmix-trend.webp",
    "facets": {
      "bron": [
        "mosmix"
      ],
      "grootheid": [
        "temp",
        "neerslag"
      ],
      "plaats": [
        "debilt",
        "groningen",
        "twente",
        "maastricht",
        "denhelder",
        "vlissingen",
        "overig"
      ],
      "vorm": [
        "trend"
      ]
    },
    "keywords": "Trend per station Run-op-run MOS/MIX Temperatuur Neerslag De Bilt Groningen Twente Maastricht Den Helder / Schiphol Vlissingen Andere plaats Runs onder elkaar",
    "restricted": false
  },
  {
    "id": "mosmix-verificatie",
    "name": "Hoe goed was de verwachting?",
    "description": "Verwachtingen vergeleken met metingen",
    "category": "verwachting",
    "type": "pluim",
    "section": "MOS/MIX",
    "icon": "meteogram",
    "href": "index.html#mosmix-verificatie",
    "thumbnail": null,
    "facets": {
      "bron": [
        "mosmix"
      ],
      "grootheid": [
        "temp",
        "neerslag",
        "wind"
      ],
      "plaats": [
        "debilt",
        "groningen",
        "twente",
        "maastricht",
        "denhelder",
        "vlissingen",
        "overig"
      ],
      "vorm": [
        "tabel"
      ]
    },
    "keywords": "Verificatie Fout per dracht MOS/MIX Temperatuur Neerslag Wind De Bilt Groningen Twente Maastricht Den Helder / Schiphol Vlissingen Andere plaats Tabel",
    "restricted": false
  },
  {
    "id": "mosmix-eu",
    "name": "Verwachting Europa",
    "description": "MOS/MIX voor plaatsen buiten Nederland",
    "category": "verwachting",
    "type": "pluim",
    "section": "MOS/MIX",
    "icon": "tabel",
    "href": "index.html#mosmix-eu",
    "thumbnail": null,
    "facets": {
      "bron": [
        "mosmix"
      ],
      "grootheid": [
        "temp",
        "neerslag",
        "wind",
        "zon"
      ],
      "plaats": [
        "overig"
      ],
      "vorm": [
        "tabel"
      ]
    },
    "keywords": "Multi Europe MOSMIX buiten Nederland MOS/MIX Temperatuur Neerslag Wind Zon Andere plaats Tabel",
    "restricted": false
  },
  {
    "id": "pascal",
    "name": "Kansen op extreem weer",
    "description": "Neerslag, wind en temperatuur · PASCAL",
    "category": "verwachting",
    "type": "pluim",
    "section": "Kansen",
    "icon": "kansen",
    "href": "index.html#pascal",
    "thumbnail": null,
    "facets": {
      "bron": [
        "kansen"
      ],
      "grootheid": [
        "temp",
        "neerslag",
        "wind"
      ],
      "plaats": [
        "alle"
      ],
      "vorm": [
        "kaart"
      ]
    },
    "keywords": "PASCAL extreem weer Kansen per 13 gebieden Kansen (PASCAL) Temperatuur Neerslag Wind Heel Nederland Kaart",
    "restricted": false
  },
  {
    "id": "verwachting",
    "name": "KNMI weersverwachting",
    "description": "Officiële tekst",
    "category": "verwachting",
    "type": "tekst",
    "section": "",
    "icon": "tekst",
    "href": "index.html#verwachting",
    "thumbnail": null,
    "facets": {},
    "keywords": "KNMI weersverwachting Officiële tekst ",
    "restricted": false
  },
  {
    "id": "modellenbespreking",
    "name": "Modellenbespreking",
    "description": "4×/dag, Weerlab",
    "category": "verwachting",
    "type": "tekst",
    "section": "",
    "icon": "tekst",
    "href": "index.html#modellenbespreking",
    "thumbnail": null,
    "facets": {},
    "keywords": "Modellenbespreking 4×/dag, Weerlab ",
    "restricted": false
  },
  {
    "id": "guidance",
    "name": "Guidance KNMI/DWD",
    "description": "Bracknell + ECMWF",
    "category": "verwachting",
    "type": "tekst",
    "section": "",
    "icon": "tekst",
    "href": "index.html#guidance",
    "thumbnail": null,
    "facets": {},
    "keywords": "Guidance KNMI/DWD Bracknell + ECMWF ",
    "restricted": false
  },
  {
    "id": "maandbeeld",
    "name": "Maandbeeld Nederland",
    "description": "Landelijk overzicht",
    "category": "terugkijken",
    "type": "terug",
    "section": "Maand & seizoen",
    "icon": "tabel",
    "href": "index.html#maandbeeld",
    "thumbnail": null,
    "facets": {},
    "keywords": "Maandbeeld Nederland Landelijk overzicht ",
    "restricted": false
  },
  {
    "id": "maandoverzicht",
    "name": "Maandstanden per station",
    "description": "11 kaartvelden",
    "category": "terugkijken",
    "type": "terug",
    "section": "Maand & seizoen",
    "icon": "tabel",
    "href": "index.html#maandoverzicht",
    "thumbnail": null,
    "facets": {},
    "keywords": "Maandstanden per station 11 kaartvelden ",
    "restricted": false
  },
  {
    "id": "zomerstatistieken",
    "name": "Zomerstatistieken 2026",
    "description": "Seizoensbalans",
    "category": "terugkijken",
    "type": "terug",
    "section": "Maand & seizoen",
    "icon": "records",
    "href": "index.html#zomerstatistieken",
    "thumbnail": null,
    "facets": {},
    "keywords": "Zomerstatistieken 2026 Seizoensbalans ",
    "restricted": false
  },
  {
    "id": "droogte",
    "name": "Droogtemonitor",
    "description": "Neerslagtekort",
    "category": "terugkijken",
    "type": "terug",
    "section": "Neerslag & droogte",
    "icon": "meteogram",
    "href": "index.html#droogte",
    "thumbnail": "thumbs/droogte.webp",
    "facets": {},
    "keywords": "Droogtemonitor Neerslagtekort ",
    "restricted": false
  },
  {
    "id": "neerslag668",
    "name": "KNMI Neerslagstations",
    "description": "Handmatig net",
    "category": "terugkijken",
    "type": "terug",
    "section": "Neerslag & droogte",
    "icon": "tabel",
    "href": "index.html#neerslag668",
    "thumbnail": null,
    "facets": {},
    "keywords": "KNMI Neerslagstations Handmatig net ",
    "restricted": false
  },
  {
    "id": "archief",
    "name": "Archief waarnemingen",
    "description": "Uur en dag, per station",
    "category": "terugkijken",
    "type": "terug",
    "section": "Archief",
    "icon": "tabel",
    "href": "index.html#archief",
    "thumbnail": null,
    "facets": {},
    "keywords": "Archief waarnemingen Uur en dag, per station ",
    "restricted": false
  },
  {
    "id": "records",
    "name": "Weerrecords",
    "description": "De Bilt + landelijk",
    "category": "terugkijken",
    "type": "klimaat",
    "section": "",
    "icon": "records",
    "href": "index.html#records",
    "thumbnail": null,
    "facets": {},
    "keywords": "Weerrecords De Bilt + landelijk ",
    "restricted": false
  },
  {
    "id": "dagrecords",
    "name": "Dagrecords",
    "description": "Komende 6 dagen · per jaar",
    "category": "terugkijken",
    "type": "klimaat",
    "section": "",
    "icon": "records",
    "href": "index.html#dagrecords",
    "thumbnail": null,
    "facets": {},
    "keywords": "Dagrecords Komende 6 dagen · per jaar ",
    "restricted": false
  },
  {
    "id": "hittegolven",
    "name": "Hittegolven",
    "description": "Monitor + historie",
    "category": "terugkijken",
    "type": "klimaat",
    "section": "",
    "icon": "temp",
    "href": "index.html#hittegolven",
    "thumbnail": null,
    "facets": {},
    "keywords": "Hittegolven Monitor + historie ",
    "restricted": false
  },
  {
    "id": "extremen",
    "name": "Zoek weerextremen",
    "description": "Vind bijzondere metingen in het archief",
    "category": "terugkijken",
    "type": "klimaat",
    "section": "",
    "icon": "tabel",
    "href": "index.html#extremen",
    "thumbnail": null,
    "facets": {},
    "keywords": "Extremenzoeker Vrije query ",
    "restricted": false
  },
  {
    "id": "eerstelaatste",
    "name": "Eerste & laatste",
    "description": "Vorst, ijsdag, tropisch",
    "category": "terugkijken",
    "type": "klimaat",
    "section": "",
    "icon": "tabel",
    "href": "index.html#eerstelaatste",
    "thumbnail": null,
    "facets": {},
    "keywords": "Eerste & laatste Vorst, ijsdag, tropisch ",
    "restricted": false
  },
  {
    "id": "feestdagen",
    "name": "Feestdagen-weer",
    "description": "Incl. jaarwisseling 00:00",
    "category": "terugkijken",
    "type": "klimaat",
    "section": "",
    "icon": "records",
    "href": "index.html#feestdagen",
    "thumbnail": null,
    "facets": {},
    "keywords": "Feestdagen-weer Incl. jaarwisseling 00:00 ",
    "restricted": false
  },
  {
    "id": "normalen",
    "name": "Wat is normaal weer?",
    "description": "Klimaatgemiddelden van 1991–2020",
    "category": "terugkijken",
    "type": "klimaat",
    "section": "",
    "icon": "meteogram",
    "href": "index.html#normalen",
    "thumbnail": null,
    "facets": {},
    "keywords": "Klimaatnormalen 1991–2020 ",
    "restricted": false
  },
  {
    "id": "p13",
    "name": "P13 regenmeters",
    "description": "Provinciale meters",
    "category": "terugkijken",
    "type": "klimaat",
    "section": "",
    "icon": "tabel",
    "href": "index.html#p13",
    "thumbnail": null,
    "facets": {},
    "keywords": "P13 regenmeters Provinciale meters ",
    "restricted": false
  },
  {
    "id": "skewt",
    "name": "Skew-T sounding",
    "description": "HARMONIE 90 · ICON-D2",
    "category": "professioneel",
    "type": "vak",
    "section": "Analyse",
    "icon": "skewt",
    "href": "index.html#skewt",
    "thumbnail": "thumbs/skewt.webp",
    "facets": {},
    "keywords": "Skew-T sounding HARMONIE 90 · ICON-D2 ",
    "restricted": false
  },
  {
    "id": "metar",
    "name": "METAR / TAF",
    "description": "Luchthavens",
    "category": "professioneel",
    "type": "vak",
    "section": "Analyse",
    "icon": "tekst",
    "href": "index.html#metar",
    "thumbnail": null,
    "facets": {},
    "keywords": "METAR / TAF Luchthavens ",
    "restricted": false
  },
  {
    "id": "europamaxima",
    "name": "Maximumtemperatuur Europa",
    "description": "TV-kaart",
    "category": "professioneel",
    "type": "vak",
    "section": "TV / uitzending",
    "icon": "temp",
    "href": "index.html#europamaxima",
    "thumbnail": null,
    "facets": {},
    "keywords": "Maximumtemperatuur Europa TV-kaart ",
    "restricted": false
  },
  {
    "id": "fototool",
    "name": "Foto voorbereiden",
    "description": "Bijsnijden voor uitzending",
    "category": "professioneel",
    "type": "vak",
    "section": "TV / uitzending",
    "icon": "studio",
    "href": "index.html#fototool",
    "thumbnail": null,
    "facets": {},
    "keywords": "Foto voorbereiden Bijsnijden voor uitzending ",
    "restricted": false
  },
  {
    "id": "landelijkeeditor",
    "name": "Kaart landelijk",
    "description": "Kaartenstudio",
    "category": "professioneel",
    "type": "vak",
    "section": "Studio (afgeschermd)",
    "icon": "studio",
    "href": "index.html#landelijkeeditor",
    "thumbnail": null,
    "facets": {},
    "keywords": "Kaart landelijk Kaartenstudio ",
    "restricted": true
  },
  {
    "id": "landelijkemeerdaagse",
    "name": "Meerdaagse landelijk",
    "description": "Kaartenstudio",
    "category": "professioneel",
    "type": "vak",
    "section": "Studio (afgeschermd)",
    "icon": "studio",
    "href": "index.html#landelijkemeerdaagse",
    "thumbnail": null,
    "facets": {},
    "keywords": "Meerdaagse landelijk Kaartenstudio ",
    "restricted": true
  },
  {
    "id": "landelijkepluim",
    "name": "Pluim (studio)",
    "description": "Kaartenstudio, voor uitzending",
    "category": "professioneel",
    "type": "vak",
    "section": "Studio (afgeschermd)",
    "icon": "pluim",
    "href": "index.html#landelijkepluim",
    "thumbnail": null,
    "facets": {},
    "keywords": "Pluim (studio) Kaartenstudio, voor uitzending ",
    "restricted": true
  },
  {
    "id": "regiokaart",
    "name": "Kaart regio",
    "description": "Kaartenstudio",
    "category": "professioneel",
    "type": "vak",
    "section": "Studio (afgeschermd)",
    "icon": "studio",
    "href": "index.html#regiokaart",
    "thumbnail": null,
    "facets": {},
    "keywords": "Kaart regio Kaartenstudio ",
    "restricted": true
  },
  {
    "id": "knmimetingen",
    "name": "KNMI-metingen",
    "description": "Kaartenstudio",
    "category": "professioneel",
    "type": "vak",
    "section": "Studio (afgeschermd)",
    "icon": "studio",
    "href": "index.html#knmimetingen",
    "thumbnail": null,
    "facets": {},
    "keywords": "KNMI-metingen Kaartenstudio ",
    "restricted": true
  },
  {
    "id": "neerslagsom",
    "name": "Kaartenstudio NL",
    "description": "Animaties",
    "category": "professioneel",
    "type": "vak",
    "section": "Studio (afgeschermd)",
    "icon": "studio",
    "href": "index.html#neerslagsom",
    "thumbnail": null,
    "facets": {},
    "keywords": "Kaartenstudio NL Animaties ",
    "restricted": true
  },
  {
    "id": "beta",
    "name": "Beta tools",
    "description": "Experimenten",
    "category": "professioneel",
    "type": "vak",
    "section": "Studio (afgeschermd)",
    "icon": "studio",
    "href": "index.html#beta",
    "thumbnail": null,
    "facets": {},
    "keywords": "Beta tools Experimenten ",
    "restricted": true
  },
  {
    "id": "weerbewaking",
    "name": "Weerbewaking",
    "description": "Afgeschermd dossier",
    "category": "professioneel",
    "type": "vak",
    "section": "Studio (afgeschermd)",
    "icon": "studio",
    "href": "index.html#weerbewaking",
    "thumbnail": null,
    "facets": {},
    "keywords": "Weerbewaking Afgeschermd dossier ",
    "restricted": true
  }
];
const MENU_LABELS = {
  "veld": {
    "significant": "Significant",
    "temp": "Temperatuur",
    "neerslag": "Neerslag",
    "wind": "Wind",
    "bewolking": "Bewolking",
    "onweer": "Onweer / CAPE",
    "hoogte": "Hoogtevelden",
    "druk": "Druk & fronten",
    "extremen": "Extremen (EFI)",
    "clusters": "Clusters",
    "overzicht": "Overzicht"
  },
  "model": {
    "harmonie": "HARMONIE 43",
    "harmonie46": "HARMONIE 46",
    "icond2": "ICON-D2",
    "icond2ruc": "ICON-D2-RUC",
    "arome": "AROME",
    "ecmwf": "ECMWF HRES",
    "gfs": "GFS",
    "iconeu": "ICON-EU",
    "eps": "ECMWF ENS"
  },
  "gebied": {
    "nl": "Nederland",
    "eu": "Europa"
  },
  "weergave": {
    "1": "1 kaart",
    "4": "4-luik",
    "9": "9 panelen"
  },
  "vorm": {
    "1": "Eén plaats",
    "6": "Zes plaatsen",
    "trend": "Runs onder elkaar",
    "kaart": "Kaart",
    "tabel": "Tabel"
  },
  "bron": {
    "ens": "ENS-pluim",
    "mosmix": "MOS/MIX",
    "kansen": "Kansen (PASCAL)"
  },
  "grootheid": {
    "temp": "Temperatuur",
    "neerslag": "Neerslag",
    "wind": "Wind",
    "zon": "Zon"
  },
  "plaats": {
    "debilt": "De Bilt",
    "groningen": "Groningen",
    "twente": "Twente",
    "maastricht": "Maastricht",
    "denhelder": "Den Helder / Schiphol",
    "vlissingen": "Vlissingen",
    "overig": "Andere plaats",
    "alle": "Heel Nederland"
  }
};
