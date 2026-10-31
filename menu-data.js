/* Weerlab productcatalogus. Kaartfilters en routes gecontroleerd tegen index.html; het modellenvierluik heeft één ingang. */
const MENU_PRODUCTS = [
  {id:'stormen-windstoten',name:'Stormen en windstoten',description:'Zoek historische stormen en vergelijk de zwaarste windstoten.',category:'terugkijken',type:'terug',section:'Records & extremen',icon:'wind',href:'index.html#stormen-windstoten',src:'beta_stormdagen.html?v=20261024-live',thumbnail:null,facets:{},keywords:'storm stormen stormenarchief stormarchief stormdagen wind windstoten zware storm orkaan Beaufort KNMI historisch historische meten zoeken vergelijken',restricted:false},
  {id:'mosmix-werkstation',name:'MOS/MIX · weer in ontwikkeling',description:'Alle onderdelen in één omgeving · zes kaarten, grote kaart en 9-daagse minikaarten',category:'verwachting',type:'kaarten',alsoTypes:['pluim'],section:'Nederland · MOS/MIX',icon:'map',href:'index.html#mosmix-werkstation',src:'mosmix-werkstation.html?v=20261021-5',thumbnail:null,facets:{model:['mosmix'],gebied:['nl','be','eu'],bron:['mosmix'],grootheid:['wind','neerslag','temperatuur'],vorm:['kaart']},keywords:'MOSMIX MOS/MIX wind windrichting Beaufort windstoten ontwikkeling dagdelen nacht zes kaarten grote kaart uren instellingen modellen',restricted:false},
  {id:"wolkenbasis-actueel",name:"Actuele wolkenbasis · Benelux",description:"Gemeten wolkenhoogten bij KNMI-stations en luchthavens",category:"nu",type:"nu",section:"Metingen",icon:"tabel",href:"index.html#wolkenbasis-actueel",src:"wolkenbasis_actueel.html?v=20261007-1",thumbnail:null,facets:{grootheid:["bewolking"]},keywords:"wolkenhoogte wolkenbasis actueel waarnemingen Benelux KNMI METAR mist ceiling",restricted:false},
  {id:'daglengte',name:"Daglicht & seizoenen",description:"Vergelijk daglengte, zonsopkomst en zonsondergang in De Bilt.",category:'terugkijken',type:'klimaat',section:'Zon & seizoenen',icon:'tabel',href:'index.html#daglengte',src:'daglengte.html?v=20261003-redactie6',thumbnail:null,facets:{},keywords:'daglengte daglicht zon zonsopkomst zonsondergang voorjaar najaar herfst lente seizoenen KNMI',restricted:false},

  {id:'pluim-mist',name:'Mistkans · DWD-MOSMIX',description:'Officiële uurlijkse mistkansen van DWD-MOSMIX in staafjes',category:'verwachting',type:'pluim',section:'Pluimen',icon:'pluim6',href:'index.html#pluim-mist',thumbnail:null,facets:{bron:['ens'],grootheid:['bewolking']},keywords:'mist mistkans DWD MOSMIX uurkansen ICON ECMWF',restricted:false},
  {id:'waarschuwingen',name:'KNMI-waarschuwingen',description:'Actuele KNMI-waarschuwingen op de kaart, met gebied, geldigheid en toelichting.',category:'nu',type:'nu',section:'Waarschuwingen',icon:'warning',href:'index.html#waarschuwingen',thumbnail:null,facets:{},keywords:'code geel oranje rood gevaarlijk weer waarschuwing onweer windstoten hitte gladheid KNMI',restricted:false},
  {id:'wereldweer',name:'Wereldweer',description:'Het belangrijkste weer- en klimaatnieuws ter wereld, elke dag om 05:00, met tussentijds nieuws en eigen ECMWF- en satellietkaarten.',category:'nu',type:'nu',section:'Wereldweer',icon:'wereld',href:'index.html#wereldweer',src:'wereldweer.html?v=20261029-sociaal',thumbnail:null,facets:{},keywords:'wereld wereldweer weernieuws extreem weer orkaan tyfoon cycloon overstroming sneeuwstorm hagel tornado hitte droogte bosbrand klimaat klimaatnieuws gletsjer WMO internationaal buitenland',restricted:false},
  {id:'nieuws',name:'Wat is nieuw',description:'Nieuwe onderdelen en verbeteringen van Weerlab.',category:'start',type:'nieuws',section:'Over Weerlab',icon:'tekst',href:'index.html#nieuws',thumbnail:null,facets:{},keywords:'nieuw nieuws updates wijzigingen verbeteringen',restricted:false},
  {
    "id": "mosmix-neerslagkans",
    "name": "MOS/MIX · neerslagkansen",
    "description": "Nederland · uurkansen op neerslag per drempel",
    "category": "verwachting", "type": "kaarten", "alsoTypes": ["pluim"],
    "section": "Nederland · MOS/MIX", "icon": "neerslag",
    "href": "index.html#mosmix-neerslagkans",
    "src": "mosmix-werkstation.html?v=20261021-5&product=rain", "thumbnail": null,
    "facets": {"veld":["neerslag"],"model":["mosmix"],"gebied":["nl"],"bron":["mosmix"],"grootheid":["neerslag"],"vorm":["kaart"]},
    "keywords": "MOSMIX MOS/MIX Nederland regen kans kansen kaarten uurkans", "restricted": false
  },
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
    "id": "neerslagaccumulatie",
    "name": "Neerslagaccumulatie",
    "description": "Hoeveel neerslag er viel · KNMI-radar per km, elk tijdvak",
    "category": "nu",
    "type": "nu",
    "section": "Beeld",
    "icon": "radar",
    "href": "index.html#neerslagaccumulatie",
    "src": "neerslagaccumulatie.html?v=20261026-11",
    "thumbnail": null,
    "facets": {},
    "keywords": "Neerslagaccumulatie neerslagsom regensom hoeveel regen gevallen radar KNMI RTCOR RFCOR regenmeters bijgesteld etmaal week maand provincie Rijnmond kaartarchief",
    "restricted": true
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
    "src": "nowcast.html?v=20261027-native3",
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
    "description": "Beste dag- en nachtbeeld · wolken, radar en timelapse",
    "category": "nu",
    "type": "nu",
    "section": "Beeld",
    "icon": "sat",
    "href": "index.html#satelliet",
    "src": "satelliet.html?v=20260912-1",
    "thumbnail": null,
    "facets": {},
    "keywords": "Satelliet Meteosat MTG wolken dag nacht mist GeoColour True Colour infrarood bronbeeld radar timelapse regio",
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
    "name": "Hittekracht · KNMI-app",
    "description": "Verwachte hittebelasting vandaag, morgen en overmorgen",
    "category": "verwachting",
    "type": "kaarten",
    "section": "Nederland · modelkaarten",
    "icon": "temp",
    "href": "index.html#hittekracht",
    "thumbnail": null,
    "facets": {"veld":["temp"],"model":["knmi-app"],"gebied":["nl"]},
    "keywords": "Hittekracht KNMI app hitte verwachte hittebelasting vandaag morgen overmorgen ",
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
    "description": "Zeewatertemperatuur Europa en Noordzee · NOAA-daganalyse",
    "category": "nu",
    "type": "nu",
    "section": "Water & kust",
    "icon": "water",
    "href": "index.html#zeetemp",
    "src": "zeetemp_kaart.html?v=20261031-noaa",
    "thumbnail": "thumbs/zeetemp.webp",
    "facets": {},
    "keywords": "Zeewatertemperatuur Europa Noordzee golven Hollandse kust ",
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
        "icond2ruc"],
      "gebied": [
        "nl"
      ],
      "weergave": [
        "1"
      ]
    },
    "keywords": "Significant kaart HARMONIE · ICON-D2 · RUC Significant HARMONIE 43 ICON-D2 ICON-D2-RUC Nederland 1 kaart HARMONIE 43 ICON-D2 ICON-D2-RUC",
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
    "name": "Vergelijk modellen & runs · 4-/6-luik",
    "description": "Vergelijk modellen of zes eerdere runs voor hetzelfde tijdstip: neerslag, windkracht en windstoten",
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
        "ukv",
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
    "keywords": "UKMO UKV 2 km Met Office AROME HD Météo-France Hoge resolutie 4-luik 4 regiomodellen naast elkaar Neerslag Temperatuur Wind Bewolking HARMONIE 43 HARMONIE 46 ICON-D2 ICON-D2-RUC Nederland 4-luik HARMONIE 43 HARMONIE 46 ICON-D2 ICON-D2-RUC ECMWF HRES GFS Vergelijk wereldmodellen Globale modellen 4-luik ECMWF · GFS Neerslag Temperatuur Wind ECMWF HRES GFS Europa 4-luik ECMWF HRES GFS",
    "restricted": false
  },
  {
    "id": "sigvier",
    "name": "Significant weer · vierluik",
    "description": "Vergelijk het complete weerbeeld van vier modellen",
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
        "icond2ruc"],
      "gebied": [
        "nl"
      ],
      "weergave": [
        "4"
      ]
    },
    "keywords": "Significant 4-luik Zelfde veld, 4 modellen Significant HARMONIE 43 ICON-D2 ICON-D2-RUC Nederland 4-luik HARMONIE 43 ICON-D2 ICON-D2-RUC",
    "restricted": false
  },
  {
    "id": "hres10",
    "name": "Weerkaarten Europa",
    "description": "ECMWF en GFS, met straalstroom en eigen CAMS-kaarten voor Saharastof",
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
        "gfs"
      ],
      "gebied": [
        "eu"
      ],
      "weergave": [
        "1"
      ]
    },
    "keywords": "Modelkaarten Europa tot +384 u Overzicht Temperatuur Neerslag Wind Straalstroom Jetstream 300 hPa Saharastof CAMS aerosol AOD stof Sahara Hoogtevelden Onweer / CAPE ECMWF HRES GFS Europa 1 kaart ECMWF HRES GFS",
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
    "restricted": true
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
    "description": "Eén locatie, vijf modellen en één grote grafiek · inclusief HARMONIE",
    "category": "verwachting",
    "type": "pluim",
    "section": "Pluimen",
    "icon": "pluim",
    "href": "index.html#pluim",
    "src": "pluim_interactief.html?v=20261021-workstation1",
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
    "name": "ECMWF overzicht",
    "description": "Temperatuur, wind en neerslag voor één plaats",
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
    "src": "pluim_6_plus.html?lock=1&station=De%20Bilt&v=20260923-pluimnav",
    "name": "ECMWF uitgebreid",
    "description": "Bewolking, windrichting en extra modelvelden",
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
{id:'pluim-aifs',name:'ECMWF vs ECMWF AIFS',description:'Temperatuur, neerslag en wind naast elkaar met gelijke assen',category:'verwachting',type:'pluim',section:'Pluimen',icon:'pluim6',href:'index.html#pluim-aifs',thumbnail:null,facets:{bron:['ens'],grootheid:['temp','neerslag','wind'],vorm:['6']},keywords:'ECMWF IFS AIFS ensemble AI modelvergelijking zesluik',restricted:false},
{
  "id": "pluim-modellenweer",
  "name": "ECMWF vs GFS en ICON",
  "description": "ECMWF, GFS en ICON: temperatuur en neerslag in één zesluik",
  "category": "verwachting",
  "type": "pluim",
  "section": "Pluimen",
  "icon": "pluim6",
  "href": "index.html#pluim-modellenweer",
  "thumbnail": null,
  "facets": {
    "bron": [
      "ens"
    ],
    "grootheid": [
      "temp",
      "neerslag"
    ],
    "vorm": [
      "6"
    ]
  },
  "keywords": "ECMWF GFS ICON ensemble modelvergelijking zesluik",
  "restricted": false
},
{
  "id": "pluim-modellenwind",
  "name": "Modelvergelijking · wind & windstoten",
  "description": "ECMWF, GFS en ICON: wind in Bft en windstoten in km/u",
  "category": "verwachting",
  "type": "pluim",
  "section": "Pluimen",
  "icon": "pluim6",
  "href": "index.html#pluim-modellenwind",
  "thumbnail": null,
  "facets": {
    "bron": [
      "ens"
    ],
    "grootheid": [
      "wind"
    ],
    "vorm": [
      "6"
    ]
  },
  "keywords": "ECMWF GFS ICON ensemble modelvergelijking zesluik",
  "restricted": false
},
{
  "id": "pluim-winter",
  "name": "Winterpluim",
  "description": "ECMWF-kansen op sneeuw, sneeuwdek, ijsdagen en vorst",
  "category": "verwachting",
  "type": "pluim",
  "section": "Pluimen",
  "icon": "pluim6",
  "href": "index.html#pluim-winter",
  "thumbnail": null,
  "facets": {
    "bron": [
      "ens"
    ],
    "grootheid": [
      "temp",
      "neerslag"
    ],
    "vorm": [
      "6"
    ]
  },
  "keywords": "winter sneeuw sneeuwdek ijsdag vorst ensemble kans",
  "restricted": false
},
{
  "id": "pluim-wolken",
  "name": "Bewolking · modelvergelijking",
  "description": "Hoge, middelbare en lage bewolking van ECMWF, GFS en ICON",
  "category": "verwachting",
  "type": "pluim",
  "section": "Pluimen",
  "icon": "pluim6",
  "href": "index.html#pluim-wolken",
  "thumbnail": null,
  "facets": {
    "bron": [
      "ens"
    ],
    "grootheid": [
      "bewolking"
    ],
    "vorm": [
      "9"
    ]
  },
  "keywords": "wolken hoge middelbare lage bewolking sluierbewolking ECMWF GFS ICON ensemble",
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
    "src": "mosmix-werkstation.html?v=20261021-5&product=overview",
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
    "name": "MOS/MIX · 9-daagse kaarten",
    "description": "Nederland · temperatuur en wind, ook per dagdeel",
    "category": "verwachting",
    "type": "kaarten",
    "section": "Nederland · MOS/MIX",
    "icon": "map",
    "href": "index.html#mosmix-minikaarten",
    "src": "mosmix_9dag.html?v=20261021-suite1",
    "thumbnail": "thumbs/mosmix-minikaarten.webp",
    "facets": {
      "bron": [
        "mosmix"
      ],
      "grootheid": [
        "temp",
        "wind"
      ],
      "plaats": [
        "alle"
      ],
      "vorm": [
        "kaart"
      ],
      "veld": [
        "temp",
        "wind"
      ],
      "model": [
        "mosmix"
      ],
      "gebied": [
        "nl"
      ]
    },
    "keywords": "MOSMIX MOS/MIX Nederland kaarten Nederland · temperatuur en wind, ook per dagdeel",
    "restricted": false,
    "alsoTypes": [
      "pluim"
    ]
  },
  {
    "id": "mosmix-parameter",
    "name": "MOS/MIX · kaarten per element",
    "description": "Nederland · temperatuur, neerslag, wind, wolken en zon",
    "category": "verwachting",
    "type": "kaarten",
    "section": "Nederland · MOS/MIX",
    "icon": "map",
    "href": "index.html#mosmix-parameter",
    "src": "mosmix-werkstation.html?v=20261021-5&product=elements",
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
        "kaart"
      ],
      "veld": [
        "temp",
        "wind",
        "neerslag",
        "bewolking",
        "onweer",
        "zon"
      ],
      "model": [
        "mosmix"
      ],
      "gebied": [
        "nl"
      ]
    },
    "keywords": "MOSMIX MOS/MIX Nederland kaarten Nederland · temperatuur, neerslag, wind, wolken en zon",
    "restricted": false,
    "alsoTypes": [
      "pluim"
    ]
  },
  {
    "id": "mosmix-trend",
    "name": "Trend per plaats",
    "description": "Temperatuur, neerslag en wind per plaats voor de komende tien dagen",
    "category": "verwachting",
    "type": "pluim",
    "section": "MOS/MIX",
    "icon": "meteogram",
    "href": "index.html#mosmix-trend",
    "src": "mosmix-werkstation.html?v=20261021-5&product=trend",
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
        "vergelijk"
      ]
    },
    "keywords": "Trend per station MOS/MIX Temperatuur Neerslag Wind Tien dagen Plaatsen vergelijken",
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
    "src": "mosmix-werkstation.html?v=20261021-5&product=verification",
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
    "src": "mosmix-werkstation.html?v=20261021-5&product=europe",
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
    "description": "Weerbeeld, modelverschillen en bronkaarten per dag.",
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
    "name": "Maandkaarten Nederland",
    "description": "Temperatuur, zon en neerslag van een gekozen maand op 11 kaarten.",
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
    "name": "Maandgegevens per station",
    "description": "Dagmetingen, maandtotalen en grafieken voor één meetstation.",
    "category": "terugkijken",
    "type": "terug",
    "section": "Maand & seizoen",
    "icon": "tabel",
    "href": "index.html#maandoverzicht",
    "thumbnail": null,
    "facets": {},
    "keywords": "Maandstanden per station dagwaarden maandtotalen grafiek ",
    "restricted": false
  },
  {
    "id": "zomerstatistieken",
    "name": "Zomerbalans",
    "description": "Warme dagen en warmtegetal van april tot en met oktober.",
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
    "name": "Droogte & neerslagtekort",
    "description": "Volg de droogte dit seizoen en vergelijk met eerdere jaren.",
    "category": "terugkijken",
    "type": "terug",
    "section": "Neerslag & droogte",
    "icon": "meteogram",
    "href": "index.html#droogte",
    "thumbnail": null,
    "facets": {},
    "keywords": "Droogtemonitor Neerslagtekort ",
    "restricted": false
  },
  {
    "id": "neerslag668",
    "name": "Neerslagrecords per meetstation",
    "description": "Zoek de natste en droogste perioden in het KNMI-neerslagarchief.",
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
    "name": "Weer op een datum · dagkaarten",
    "description": "Temperatuur, neerslag, wind en andere metingen op een historische kaart.",
    "category": "terugkijken",
    "type": "terug",
    "section": "Archief",
    "icon": "tabel",
    "href": "index.html#archief",
    "thumbnail": null,
    "facets": {},
    "keywords": "Archief waarnemingen historische dagkaarten windstoten km/u ",
    "restricted": false
  },
  {id:'klimatologie',name:'Klimatologie · temperatuur & neerslag',description:'Ontdek de jaarcyclus, maandgrafieken en de snelste afkoeling met klimaatdata 1991–2020.',category:'terugkijken',type:'klimaat',section:'Zon & seizoenen',icon:'tabel',href:'index.html#klimatologie',src:'klimatologie.html?v=20261031',thumbnail:null,facets:{},keywords:'klimatologie klimaat normaal temperatuurtrend november opwarming afkoeling decade maand jaar neerslag 1991 2020',restricted:false},
  {id:'klimaatarchief',name:'Klimaatarchief',description:'Vergelijk maanden, seizoenen en jaren met historische metingen.',category:'terugkijken',type:'klimaat',section:'Archief',icon:'tabel',href:'index.html#klimaatarchief',src:'demo_winterstatistieken.html?v=20261015-1',thumbnail:null,facets:{},keywords:'klimaatarchief maand seizoen jaar winter statistieken temperatuur neerslag zon',restricted:false},
  {
    "id": "records",
    "name": "Records & dagen tellen",
    "description": "Records zoeken, warme of koude dagen tellen en maanden of jaren vergelijken.",
    "category": "terugkijken",
    "type": "klimaat",
    "section": "Records & extremen",
    "icon": "records",
    "href": "index.html#records",
    "src": "records_debilt.html?v=20261013-1",
    "thumbnail": null,
    "facets": {},
    "keywords": "Weerrecords De Bilt + landelijk  warme dagen zomerse tropische koude dagen vorst ijsdagen tellen aantal station jaar Rotterdam Airport",
    "restricted": false
  },
  {
    "id": "dagrecords",
    "name": "Dagrecords op kaarten",
    "description": "Temperatuurrecords voor kalenderdagen, zichtbaar op de kaart.",
    "category": "terugkijken",
    "type": "klimaat",
    "section": "Records & extremen",
    "icon": "records",
    "href": "index.html#dagrecords",
    "thumbnail": null,
    "facets": {},
    "keywords": "Dagrecords Komende 6 dagen · per jaar ",
    "restricted": false
  },
  {
    "id": "hittegolven",
    "name": "Hittegolven per station",
    "description": "Bekijk lopende hittegolven en hittegolven uit eerdere jaren.",
    "category": "terugkijken",
    "type": "klimaat",
    "section": "Seizoenen & bijzondere dagen",
    "icon": "temp",
    "href": "index.html#hittegolven",
    "thumbnail": null,
    "facets": {},
    "keywords": "Hittegolven Monitor + historie ",
    "restricted": false
  },
  {
    "id": "extremen",
    "name": "Bijzondere metingen zoeken",
    "description": "Zoek hoge of lage meetwaarden binnen een station en tijdvak.",
    "category": "terugkijken",
    "type": "klimaat",
    "section": "Records & extremen",
    "icon": "tabel",
    "href": "index.html#extremen",
    "thumbnail": null,
    "facets": {},
    "keywords": "Extremenzoeker Vrije query ",
    "restricted": false
  },
  {
    "id": "eerstelaatste",
    "name": "Eerste en laatste warme of koude dag",
    "description": "Wanneer begon of eindigde de periode met vorst, zomerse of tropische dagen?",
    "category": "terugkijken",
    "type": "klimaat",
    "section": "Seizoenen & bijzondere dagen",
    "icon": "tabel",
    "href": "index.html#eerstelaatste",
    "thumbnail": null,
    "facets": {},
    "keywords": "Eerste & laatste Vorst, ijsdag, tropisch ",
    "restricted": false
  },
  {
    "id": "feestdagen",
    "name": "Weer op feestdagen",
    "description": "Temperatuur, neerslag en zon op Kerstmis, Pasen en andere feestdagen.",
    "category": "terugkijken",
    "type": "klimaat",
    "section": "Seizoenen & bijzondere dagen",
    "icon": "records",
    "href": "index.html#feestdagen",
    "thumbnail": null,
    "facets": {},
    "keywords": "Feestdagen-weer Incl. jaarwisseling 00:00 ",
    "restricted": false
  },
  {
    "id": "klimaattabellen",
    "name": "KNMI-klimaattabellen · alle cijfers & PDF’s",
    "description": "Kies uit 27 stations en 2 landelijke gemiddelden. Bekijk alle cijfers per maand, seizoen en jaar, of download de PDF en CSV.",
    "category": "terugkijken",
    "type": "klimaat",
    "section": "Gemiddelden & neerslag",
    "icon": "tabel",
    "href": "index.html#klimaattabellen",
    "src": "knmi_klimaattabellen.html?v=20261015",
    "thumbnail": null,
    "facets": {},
    "keywords": "KNMI klimaatnormalen 1991–2020 PDF download stations Rotterdam grondvorst wind mist sneeuw langjarige gemiddelden CSV",
    "restricted": false
  },
  {
    "id": "normalen",
    "name": "Klimaatgemiddelden · wat is normaal?",
    "description": "Gemiddelde temperatuur, neerslag en zon in de referentieperiode 1991–2020.",
    "category": "terugkijken",
    "type": "klimaat",
    "section": "Gemiddelden & neerslag",
    "icon": "meteogram",
    "href": "index.html#normalen",
    "thumbnail": null,
    "facets": {},
    "keywords": "Klimaatnormalen 1991–2020 ",
    "restricted": false
  },
  {
    "id": "p13",
    "name": "Landelijke neerslag · 13 stations",
    "description": "Neerslaggemiddelde voor Nederland op basis van 13 meetstations.",
    "category": "terugkijken",
    "type": "klimaat",
    "section": "Gemiddelden & neerslag",
    "icon": "tabel",
    "href": "index.html#p13",
    "thumbnail": null,
    "facets": {},
    "keywords": "P13 regenmeters Landelijk gemiddelde 13 neerslagstations ",
    "restricted": false
  },
  {
    "id": "weerkaart",
    "name": "Weerkaart",
    "description": "ECMWF 0,1° · neerslag, bewolking, temperatuur en luchtdruk · 15 uitsneden, tot 15 dagen vooruit",
    "category": "verwachting",
    "type": "kaarten",
    "section": "Analyse",
    "icon": "map",
    "href": "index.html#weerkaart",
    "src": "ecmwf_overview/",
    "thumbnail": null,
    "facets": {},
    "keywords": "Weerkaart Overview ECMWF HRES 0,1 neerslag bewolking temperatuur luchtdruk isobaren Europa Benelux Nederland run",
    "restricted": false
  },
  {
    "id": "weerkaart-europa",
    "name": "Weerkaart Europa · HARMONIE",
    "description": "ECMWF · KNMI en DMI HARMONIE Europa · HARMONIE 43 en 46 Benelux",
    "category": "verwachting",
    "type": "kaarten",
    "section": "Analyse",
    "icon": "map",
    "href": "index.html#weerkaart-europa",
    "src": "ecmwf_weerradar/",
    "thumbnail": null,
    "facets": {},
    "keywords": "Weerkaart Europa ECMWF KNMI DMI HARMONIE 43 46 Benelux bewolking neerslag temperatuur wind Bft windstoten mist weerradar",
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
    "section": "Experimenten",
    "icon": "studio",
    "href": "index.html#beta",
    "src": "beta.html?v=20261025-native-ecmwf",
    "thumbnail": null,
    "facets": {},
    "keywords": "Beta tools Experimenten ",
    "restricted": false
  },
  {
    "id": "sneeuw-kans",
    "name": "Sneeuwkans",
    "description": "Kans op sneeuwval in 1–48 uur · ICON-D2-EPS, ECMWF ENS, HarmonEPS",
    "category": "professioneel",
    "type": "vak",
    "section": "Sneeuwverwachting Nederland (bèta)",
    "icon": "kansen",
    "href": "index.html#sneeuw-kans",
    "src": "sneeuw.html?v=20261028-6&product=sneeuwval_kans",
    "thumbnail": null,
    "facets": {},
    "keywords": "sneeuw sneeuwkans sneeuwval kans ensemble ICON-D2-EPS ECMWF ENS HarmonEPS winter",
    "restricted": false
  },
  {
    "id": "sneeuw-dek",
    "name": "Kans op sneeuwdek",
    "description": "Kans op ≥ 1, 3, 5, 10 of 15 cm sneeuwdek · ICON-D2-EPS, ECMWF ENS",
    "category": "professioneel",
    "type": "vak",
    "section": "Sneeuwverwachting Nederland (bèta)",
    "icon": "kansen",
    "href": "index.html#sneeuw-dek",
    "src": "sneeuw.html?v=20261028-6&product=sneeuwdek_kans",
    "thumbnail": null,
    "facets": {},
    "keywords": "sneeuw sneeuwdek sneeuwhoogte kans liggende sneeuw centimeter winter",
    "restricted": false
  },
  {
    "id": "sneeuw-hoogte",
    "name": "Verwachte sneeuwhoogte",
    "description": "Mediaan, P10–P90 en maximum · ICON-D2-EPS, ECMWF ENS, HARMONIE",
    "category": "professioneel",
    "type": "vak",
    "section": "Sneeuwverwachting Nederland (bèta)",
    "icon": "map",
    "href": "index.html#sneeuw-hoogte",
    "src": "sneeuw.html?v=20261028-6&product=sneeuwhoogte",
    "thumbnail": null,
    "facets": {},
    "keywords": "sneeuw sneeuwhoogte sneeuwdek centimeter mediaan percentiel HARMONIE winter",
    "restricted": false
  },
  {
    "id": "sneeuw-nieuw",
    "name": "Nieuwe sneeuw",
    "description": "Sneeuwval in mm en toename sneeuwdek per 1–48 uur · HARMONIE",
    "category": "professioneel",
    "type": "vak",
    "section": "Sneeuwverwachting Nederland (bèta)",
    "icon": "map",
    "href": "index.html#sneeuw-nieuw",
    "src": "sneeuw.html?v=20261028-6&product=nieuwe_sneeuw&model=harmoniep1",
    "thumbnail": null,
    "facets": {},
    "keywords": "sneeuw nieuwe sneeuw verse sneeuw sneeuwval accumulatie HARMONIE winter",
    "restricted": false
  },
  {
    "id": "sneeuw-soort",
    "name": "Neerslagsoort",
    "description": "Regen, natte sneeuw, sneeuw, ijzel, ijskorrels, korrelhagel · ECMWF ENS, HARMONIE",
    "category": "professioneel",
    "type": "vak",
    "section": "Sneeuwverwachting Nederland (bèta)",
    "icon": "neerslag",
    "href": "index.html#sneeuw-soort",
    "src": "sneeuw.html?v=20261028-6&product=neerslagsoort&model=ecmwfens",
    "thumbnail": null,
    "facets": {},
    "keywords": "neerslagsoort ijzel ijsregen ijskorrels natte sneeuw korrelhagel graupel ptype winter",
    "restricted": false
  },
  {
    "id": "sneeuw-toename",
    "name": "Kans op 1–15 cm erbij",
    "description": "Kans op ≥ 1, 3, 5, 10 of 15 cm toename in 6, 12 of 24 uur · ICON-D2-EPS, ECMWF ENS",
    "category": "professioneel",
    "type": "vak",
    "section": "Sneeuwverwachting Nederland (bèta)",
    "icon": "kansen",
    "href": "index.html#sneeuw-toename",
    "src": "sneeuw.html?v=20261028-6&product=sneeuwtoename_kans",
    "thumbnail": null,
    "facets": {},
    "keywords": "sneeuw nieuwe sneeuw toename centimeter kans 6 12 24 uur significante sneeuwval winter",
    "restricted": false
  },
  {
    "id": "sneeuw-onzekerheid",
    "name": "Sneeuw · onzekerheid",
    "description": "Eensgezindheid van de leden en spreiding van de sneeuwhoogte",
    "category": "professioneel",
    "type": "vak",
    "section": "Sneeuwverwachting Nederland (bèta)",
    "icon": "kansen",
    "href": "index.html#sneeuw-onzekerheid",
    "src": "sneeuw.html?v=20261028-6&product=spreiding",
    "thumbnail": null,
    "facets": {},
    "keywords": "sneeuw onzekerheid spreiding eensgezindheid ensemble leden P90 P10 winter",
    "restricted": false
  },
  {
    "id": "sneeuw-vergelijk",
    "name": "Sneeuw · modelvergelijking",
    "description": "Alle sneeuwmodellen naast elkaar op hetzelfde tijdstip",
    "category": "professioneel",
    "type": "vak",
    "section": "Sneeuwverwachting Nederland (bèta)",
    "icon": "vierluik",
    "href": "index.html#sneeuw-vergelijk",
    "src": "sneeuw.html?v=20261028-6&vergelijk=1",
    "thumbnail": null,
    "facets": {},
    "keywords": "sneeuw modelvergelijking modellen naast elkaar ICON ECMWF HARMONIE HarmonEPS winter",
    "restricted": false
  },
  {
    "id": "krantenredactie",
    "name": "Krantenredactie",
    "description": "Weerberichten per krant schrijven en controleren",
    "category": "professioneel",
    "type": "vak",
    "section": "Studio",
    "icon": "tekst",
    "href": "index.html#krantenredactie",
    "src": "demo_kranten.html?v=20260921-open1",
    "thumbnail": null,
    "facets": {},
    "keywords": "Kranten krant redactie weerbericht Volkskrant Trouw Parool AD concepten teksten tekenlimiet",
    "restricted": false
  }
];
const MENU_LABELS = {
  "veld": {
    "zon": "Zon",
    "significant": "Significant",
    "temp": "Temperatuur",
    "neerslag": "Neerslag",
    "wind": "Wind",
    "bewolking": "Bewolking",
    "onweer": "Onweer / CAPE",
    "hoogte": "Hoogtevelden",
    "druk": "Druk & fronten",
    "extremen": "Extremen (EFI)",
    "overzicht": "Overzicht"
  },
  "model": {
    "knmi-app": "KNMI-app",
    "mosmix": "DWD MOS/MIX",
    "harmonie": "HARMONIE 43",
    "harmonie46": "HARMONIE 46",
    "icond2": "ICON-D2",
    "icond2ruc": "ICON-D2-RUC",
    "arome": "AROME HD",
    "ukv": "UKMO UKV 2 km",
    "ecmwf": "ECMWF HRES",
    "gfs": "GFS",
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
    "9": "9 panelen",
    "1": "Eén plaats",
    "6": "Zes plaatsen",
    "trend": "Runs onder elkaar",
    "vergelijk": "Plaatsen vergelijken",
    "kaart": "Kaart",
    "tabel": "Tabel"
  },
  "bron": {
    "ens": "ENS-pluim",
    "mosmix": "MOS/MIX",
    "kansen": "Kansen (PASCAL)"
  },
  "grootheid": {
    "bewolking": "Bewolking",
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
