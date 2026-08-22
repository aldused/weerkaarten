#!/usr/bin/env python3
"""
maak_landelijk_maand.py
Bouwt een compact landelijk maandoverzicht-JSON (De Bilt-statistiek,
karakteristieke dagen, landelijke extremen, kaartpunten) uit de
per-station maanddata_*.json bestanden.

Gebruik:
    python maak_landelijk_maand.py 2026 7 [--src DIR] [--out FILE]

Definities (gelijk aan KNMI/weercijfers waar mogelijk):
  - Zonneschijn landelijk = L5: De Kooy(235), De Bilt(260), Eelde(280),
    Vlissingen(310), Maastricht(380). Empirisch geverifieerd tegen
    weercijfers mei 2026 (258.4 u exact).
  - Zonneschijnpercentage = som(sq) / som(astronomische daglengte).
  - Zonne-energie = globale straling Q (J/cm2), L5-gemiddelde maandsom.
  - Neerslag landelijk = gemiddelde over alle AWS (weercijfers gebruikt
    het aparte neerslagstation-net L13 — bewust niet gerepliceerd).
  - Lopende maand: vandaag wordt bijgemengd uit vandaag_stations.json
    (geschreven door lopend_patch.py, EDR 10-min), indien vers.

Normalen (1991-2020 en 1996-2025) worden live uit de dagreeksen berekend.
"""
import os, sys, json, argparse, calendar, math
from datetime import date, datetime
from collections import defaultdict

# 44 KNMI-hoofdstations: nr -> (naam, lat, lon)  (coords uit wmo_stations_eu + 2 handmatig)
STATIONS = {
    260:("De Bilt",52.100,5.183), 344:("Rotterdam",51.962,4.447), 330:("Hoek van Holland",51.992,4.122),
    235:("De Kooy",52.928,4.781), 240:("Schiphol",52.309,4.764), 270:("Leeuwarden",53.224,5.752),
    280:("Eelde",53.125,6.585), 290:("Twenthe",52.274,6.891), 310:("Vlissingen",51.442,3.596),
    380:("Maastricht",50.906,5.762), 210:("Valkenburg",52.171,4.430), 215:("Voorschoten",52.121,4.437),
    225:("IJmuiden",52.463,4.555), 229:("Texelhors",53.224,4.921), 242:("Vlieland",53.241,4.921),
    248:("Wijdenes",52.634,5.174), 249:("Berkhout",52.644,4.979), 251:("Terschelling",53.392,5.346),
    257:("Wijk aan Zee",52.506,4.603), 258:("Houtribdijk",52.649,5.401), 265:("Soesterberg",52.130,5.274),
    267:("Stavoren",52.898,5.384), 269:("Lelystad",52.458,5.520), 273:("Marknesse",52.703,5.888),
    275:("Deelen",52.061,5.873), 277:("Lauwersoog",53.413,6.200), 278:("Heino",52.435,6.259),
    279:("Hoogeveen",52.750,6.574), 283:("Hupsel",52.069,6.657), 286:("Nieuw Beerta",53.196,7.150),
    319:("Westdorpe",51.226,3.861), 323:("Wilhelminadorp",51.527,3.884), 324:("Stavenisse",51.596,4.003),
    331:("Tholen",51.480,4.193), 340:("Woensdrecht",51.449,4.342), 343:("Rotterdam Geulhaven",51.893,4.313),
    348:("Cabauw",51.970,4.926), 350:("Gilze-Rijen",51.566,4.936), 356:("Herwijnen",51.859,5.146),
    370:("Eindhoven",51.451,5.377), 375:("Volkel",51.659,5.707), 377:("Ell",51.198,5.763),
    391:("Arcen",51.498,6.197), 392:("Horst",51.440,6.200),
}
L5 = [235, 260, 280, 310, 380]   # KNMI landelijk zonneschijn

MND_NL = ["","januari","februari","maart","april","mei","juni",
          "juli","augustus","september","oktober","november","december"]

VANDAAG_FILE = "vandaag_stations.json"

_CACHE = {}
def laad_station(src, nr):
    key = (src, nr)
    if key in _CACHE:
        return _CACHE[key]
    res = None
    for cand in (os.path.join(src, f"maanddata_{nr}.json"),
                 f"maanddata_{nr}.json"):
        if os.path.exists(cand):
            with open(cand) as f:
                res = json.load(f)
            break
    _CACHE[key] = res
    return res

def mean(a): return sum(a)/len(a) if a else None
def som(a):  return sum(a) if a else None

# ── astronomische daglengte (uren) ─────────────────────────────────────────
def daglengte(lat_deg, d):
    """Astronomische daglengte in uren voor breedtegraad + datum."""
    n = d.timetuple().tm_yday
    decl = math.radians(23.45) * math.sin(math.radians(360.0*(284+n)/365.0))
    lat = math.radians(lat_deg)
    x = -math.tan(lat)*math.tan(decl)
    x = max(-1.0, min(1.0, x))
    return 2.0/15.0 * math.degrees(math.acos(x))

def daglengte_tot_nu(lat_deg, d, nu_uur_lokaal):
    """Verstreken daglicht (uren) van vandaag tot nu (benadering: zon op
    12u - L/2 zonnetijd ≈ lokale klok; ±20 min is hier ruim voldoende)."""
    L = daglengte(lat_deg, d)
    zon_op = 12.0 - L/2.0
    return max(0.0, min(L, nu_uur_lokaal - zon_op))

# ── vandaag (EDR 10-min, geschreven door lopend_patch.py) ──────────────────
def laad_vandaag(src, jaar, maand):
    """Geeft (dagnr, {stn:{tx,tn,tg,rr,sq,...}}, uur_lokaal) of None.
    Alleen gebruikt als het bestand van vandaag is én de gevraagde maand
    de lopende maand is."""
    for cand in (os.path.join(src, VANDAAG_FILE), VANDAAG_FILE):
        if not os.path.exists(cand):
            continue
        try:
            with open(cand) as f:
                v = json.load(f)
        except Exception:
            return None
        vd = v.get("datum", "")
        if vd != date.today().isoformat() or not vd.startswith(f"{jaar}-{maand:02d}-"):
            return None
        stations = {}
        for stn, w in (v.get("stations") or {}).items():
            rec = {"tx": w.get("tx"), "tn": w.get("tn"), "tg": w.get("tg"),
                   "rr": w.get("rh"), "sq": w.get("sq"), "q": None, "t10n": None}
            if any(rec[k] is not None for k in ("tx","tn","tg","rr","sq")):
                stations[int(stn)] = rec
        if not stations:
            return None
        return int(vd[8:10]), stations, datetime.now().hour + datetime.now().minute/60.0
    return None

def maand_dagen(data, jaar, maand):
    pre = f"{jaar}-{maand:02d}-"
    return {k:v for k,v in data.items() if k.startswith(pre)}

def periode_normaal(data, maand, j0, j1, lat=None):
    """Maandnormalen over jaren [j0,j1]: tg/tx/tn gemiddeld, rr/sq/q als
    som-gemiddelde; sp = zonpercentage (som sq / som daglengte)."""
    ms = f"{maand:02d}"
    per_jaar = defaultdict(lambda: defaultdict(list))
    for k, v in data.items():
        if k[5:7] != ms: continue
        j = int(k[:4])
        if j < j0 or j > j1: continue
        for f in ("tx","tn","tg","rr","sq","q"):
            if v.get(f) is not None:
                per_jaar[j][f].append(v[f])
        if v.get("sq") is not None and lat is not None:
            per_jaar[j]["dl"].append(daglengte(lat, date.fromisoformat(k)))
    agg = defaultdict(list)
    for j, d in per_jaar.items():
        if d["tg"]: agg["tg"].append(mean(d["tg"]))
        if d["tx"]: agg["tx"].append(mean(d["tx"]))
        if d["tn"]: agg["tn"].append(mean(d["tn"]))
        if d["rr"]: agg["rr"].append(sum(d["rr"]))
        if d["sq"]: agg["sq"].append(sum(d["sq"]))
        if d["q"] and len(d["q"]) >= 25: agg["q"].append(sum(d["q"]))
        if d["sq"] and d["dl"]: agg["sp"].append(100.0*sum(d["sq"])/sum(d["dl"]))
    r = lambda k, n=1: round(mean(agg[k]), n) if agg[k] else None
    return {"tg":r("tg"),"tx":r("tx"),"tn":r("tn"),"rr":r("rr"),
            "sq":r("sq"),"q":r("q",0),"sp":r("sp",0)}

# karakteristieke dagen
DAGSOORTEN = [
    ("tropisch",  "tx", lambda v: v>=30.0),
    ("zomers",    "tx", lambda v: v>=25.0),
    ("warm",      "tx", lambda v: v>=20.0),
    ("ijs",       "tx", lambda v: v<0.0),
    ("vorst",     "tn", lambda v: v<0.0),
    ("matig",     "tn", lambda v: v<=-5.0),
    ("streng",    "tn", lambda v: v<=-10.0),
    ("zeerstreng","tn", lambda v: v<=-15.0),
]

def tel_dagsoorten(dagen):
    return {lbl: sum(1 for v in dagen.values()
                     if v.get(veld) is not None and test(v[veld]))
            for lbl, veld, test in DAGSOORTEN}

def dagsoort_normaal(data, maand, j0, j1):
    ms = f"{maand:02d}"
    per_jaar = defaultdict(list)
    for k, v in data.items():
        if k[5:7] != ms: continue
        j = int(k[:4])
        if j0 <= j <= j1: per_jaar[j].append(v)
    tel = {lbl: [] for lbl,_,_ in DAGSOORTEN}
    for j, recs in per_jaar.items():
        c = tel_dagsoorten({i:r for i,r in enumerate(recs)})
        for lbl in tel: tel[lbl].append(c[lbl])
    return {lbl: round(mean(v)) if v else None for lbl, v in tel.items()}

def bouw(jaar, maand, src):
    r1 = lambda x, n=1: round(x, n) if x is not None else None
    vandaag = laad_vandaag(src, jaar, maand)
    vd_dag, vd_stations, vd_uur = vandaag if vandaag else (None, {}, None)

    def station_maand(nr):
        """Maanddagen voor station incl. eventuele vandaag-merge."""
        st = laad_station(src, nr)
        if not st: return None
        sd = dict(maand_dagen(st["data"], jaar, maand))
        if vd_dag and nr in vd_stations:
            k = f"{jaar}-{maand:02d}-{vd_dag:02d}"
            if k not in sd:           # EDR-daggegevens winnen als al aanwezig
                sd[k] = vd_stations[nr]
        return sd

    debilt = laad_station(src, 260)
    if not debilt: sys.exit("De Bilt (260) ontbreekt")
    dd = debilt["data"]

    # ── De Bilt maandstatistiek ──
    dbm = station_maand(260)
    kolom = lambda f: [r[f] for r in dbm.values() if r.get(f) is not None]
    n9120 = periode_normaal(dd, maand, 1991, 2020)
    n9625 = periode_normaal(dd, maand, 1996, 2025)
    debilt_stat = {
        "tg":{"waarde":r1(mean(kolom("tg"))),"n9120":n9120["tg"],"n9625":n9625["tg"]},
        "tx":{"waarde":r1(mean(kolom("tx"))),"n9120":n9120["tx"],"n9625":n9625["tx"]},
        "tn":{"waarde":r1(mean(kolom("tn"))),"n9120":n9120["tn"],"n9625":n9625["tn"]},
        "sq":{"waarde":r1(som(kolom("sq"))),"n9120":n9120["sq"],"n9625":n9625["sq"]},
        "rr":{"waarde":r1(som(kolom("rr"))),"n9120":n9120["rr"],"n9625":n9625["rr"]},
    }
    d_now  = tel_dagsoorten(dbm)
    d_9120 = dagsoort_normaal(dd, maand, 1991, 2020)
    d_9625 = dagsoort_normaal(dd, maand, 1996, 2025)
    dagen_blok = {lbl:{"waarde":d_now[lbl],"n9120":d_9120[lbl],"n9625":d_9625[lbl]}
                  for lbl,_,_ in DAGSOORTEN}

    # ── Alle stations: kaartpunten, keuzelijst en temp-extremen ──
    kaart=[]
    stations_detail=[]
    ext = {"htx":(-99,None,None),"ltx":(99,None,None),
           "htn":(-99,None,None),"ltn":(99,None,None),"lt10n":(99,None,None)}
    zon_stat=[]; sp_stat=[]; neer_stat=[]
    for nr,(naam,lat,lon) in STATIONS.items():
        sd = station_maand(nr)
        if not sd: continue
        station = laad_station(src, nr)
        station_data = station["data"]
        col = lambda f: [r[f] for r in sd.values() if r.get(f) is not None]
        stx,stn_,stg,srr,ssq = col("tx"),col("tn"),col("tg"),col("rr"),col("sq")
        normaal_9120 = periode_normaal(station_data, maand, 1991, 2020)
        normaal_9625 = periode_normaal(station_data, maand, 1996, 2025)
        dag_now = tel_dagsoorten(sd)
        dag_9120 = dagsoort_normaal(station_data, maand, 1991, 2020)
        dag_9625 = dagsoort_normaal(station_data, maand, 1996, 2025)
        stations_detail.append({
            "nr":nr,"naam":naam,"lat":lat,"lon":lon,"ndagen":len(sd),
            "temperatuur":{
                "tg":{"waarde":r1(mean(stg)),"n9120":normaal_9120["tg"],"n9625":normaal_9625["tg"]},
                "tx":{"waarde":r1(mean(stx)),"n9120":normaal_9120["tx"],"n9625":normaal_9625["tx"]},
                "tn":{"waarde":r1(mean(stn_)),"n9120":normaal_9120["tn"],"n9625":normaal_9625["tn"]},
            },
            "dagen":{lbl:{"waarde":dag_now[lbl],"n9120":dag_9120[lbl],"n9625":dag_9625[lbl]}
                      for lbl,_,_ in DAGSOORTEN},
        })
        # zonpercentage per station: som sq / som daglengte (vandaag pro rata)
        sp = None
        if ssq:
            dl = 0.0
            for k, r in sd.items():
                if r.get("sq") is None: continue
                dk = date.fromisoformat(k)
                dl += (daglengte_tot_nu(lat, dk, vd_uur)
                       if (vd_dag and dk.day == vd_dag and vd_uur is not None)
                       else daglengte(lat, dk))
            if dl > 0: sp = round(100.0*sum(ssq)/dl)
        # dag-extremen binnen de maand per station (voor kaartvelden)
        def dagext(f, hoogste):
            vals = [r[f] for r in sd.values() if r.get(f) is not None]
            if not vals: return None
            return round((max if hoogste else min)(vals), 1)
        kaart.append({"nr":nr,"naam":naam,"lat":lat,"lon":lon,
            "tg":r1(mean(stg)),"tx":r1(mean(stx)),"tn":r1(mean(stn_)),
            "rr":r1(som(srr)),"sq":r1(som(ssq)),"sp":sp,
            "htx":dagext("tx",True),"ltx":dagext("tx",False),
            "htn":dagext("tn",True),"ltn":dagext("tn",False),
            "t10n":dagext("t10n",False),
            "ndagen":len(sd)})
        for dag,r in sd.items():
            if r.get("tx") is not None:
                if r["tx"]>ext["htx"][0]: ext["htx"]=(r["tx"],naam,dag)
                if r["tx"]<ext["ltx"][0]: ext["ltx"]=(r["tx"],naam,dag)
            if r.get("tn") is not None:
                if r["tn"]>ext["htn"][0]: ext["htn"]=(r["tn"],naam,dag)
                if r["tn"]<ext["ltn"][0]: ext["ltn"]=(r["tn"],naam,dag)
            if r.get("t10n") is not None and r["t10n"]<ext["lt10n"][0]:
                ext["lt10n"]=(r["t10n"],naam,dag)
        if ssq: zon_stat.append((som(ssq),naam))
        if sp is not None: sp_stat.append((sp,naam))
        if srr: neer_stat.append((som(srr),naam))

    def ex(t): return {"waarde":round(t[0],1),"station":t[1],"datum":t[2]} if t[1] else None
    extremen_temp = {"hoogste_tx":ex(ext["htx"]),"laagste_tx":ex(ext["ltx"]),
                     "hoogste_tn":ex(ext["htn"]),"laagste_tn":ex(ext["ltn"]),
                     "laagste_t10n":ex(ext["lt10n"])}
    zon_stat.sort(reverse=True); sp_stat.sort(reverse=True); neer_stat.sort(reverse=True)

    # ── Zonneschijn landelijk = L5 (duur, percentage, energie) ──
    l5_sq=[]; l5_q=[]; l5_sqsum=0.0; l5_dlsum=0.0
    for nr in L5:
        sd = station_maand(nr)
        if not sd: continue
        lat = STATIONS[nr][1]
        ssq=[(k,r["sq"]) for k,r in sd.items() if r.get("sq") is not None]
        sq_=[v for _,v in ssq]
        qq=[r["q"] for r in sd.values() if r.get("q") is not None]
        if sq_:
            l5_sq.append(sum(sq_))
            for k,_ in ssq:
                dk = date.fromisoformat(k)
                l5_dlsum += (daglengte_tot_nu(lat, dk, vd_uur)
                             if (vd_dag and dk.day == vd_dag and vd_uur is not None)
                             else daglengte(lat, dk))
            l5_sqsum += sum(sq_)
        if qq: l5_q.append(sum(qq))
    def l5_norm(veld, j0, j1):
        vals=[]
        for nr in L5:
            st=laad_station(src, nr)
            if not st: continue
            pn=periode_normaal(st["data"], maand, j0, j1, lat=STATIONS[nr][1])[veld]
            if pn is not None: vals.append(pn)
        return round(mean(vals), 0 if veld in ("q","sp") else 1) if vals else None
    landelijk_zon = {
        "def":"L5",
        "gem": r1(mean(l5_sq)),
        "n9120": l5_norm("sq",1991,2020), "n9625": l5_norm("sq",1996,2025),
        "pct": round(100.0*l5_sqsum/l5_dlsum) if l5_dlsum>0 else None,
        "pct_n9120": l5_norm("sp",1991,2020), "pct_n9625": l5_norm("sp",1996,2025),
        "q": r1(mean(l5_q),0),
        "q_n9120": l5_norm("q",1991,2020), "q_n9625": l5_norm("q",1996,2025),
        "hoogste":{"waarde":round(zon_stat[0][0],1),"station":zon_stat[0][1]} if zon_stat else None,
        "laagste":{"waarde":round(zon_stat[-1][0],1),"station":zon_stat[-1][1]} if zon_stat else None,
        "hoogste_pct":{"waarde":sp_stat[0][0],"station":sp_stat[0][1]} if sp_stat else None,
        "laagste_pct":{"waarde":sp_stat[-1][0],"station":sp_stat[-1][1]} if sp_stat else None,
    }

    # ── Neerslag landelijk = gemiddelde alle AWS ──
    def land_norm(veld, j0, j1):
        vals=[]
        for nr in STATIONS:
            s=laad_station(src, nr)
            if not s: continue
            pn=periode_normaal(s["data"], maand, j0, j1)[veld]
            if pn is not None: vals.append(pn)
        return round(mean(vals),1) if vals else None
    landelijk_neer = {
        "def":"AWS",
        "gem": r1(mean([n[0] for n in neer_stat])) if neer_stat else None,
        "n9120": land_norm("rr",1991,2020), "n9625": land_norm("rr",1996,2025),
        "hoogste":{"waarde":round(neer_stat[0][0],1),"station":neer_stat[0][1]} if neer_stat else None,
        "laagste":{"waarde":round(neer_stat[-1][0],1),"station":neer_stat[-1][1]} if neer_stat else None,
    }

    dim = calendar.monthrange(jaar, maand)[1]
    ndagen = max([int(k[8:10]) for k in dbm], default=0)
    return {
        "jaar":jaar,"maand":maand,"maand_naam":MND_NL[maand],
        "bijgewerkt":debilt.get("bijgewerkt",""),
        "n_stations":len(kaart),
        "ndagen":ndagen,"dim":dim,"volledig":ndagen>=dim,
        "vandaag_in":bool(vd_dag),
        "debilt":debilt_stat,"dagen":dagen_blok,
        "stations":sorted(stations_detail,key=lambda x:x["nr"]),
        "extremen_temp":extremen_temp,
        "zon":landelijk_zon,"neerslag":landelijk_neer,
        "kaart":sorted(kaart,key=lambda x:x["nr"]),
    }

if __name__=="__main__":
    ap=argparse.ArgumentParser()
    ap.add_argument("jaar",type=int); ap.add_argument("maand",type=int)
    ap.add_argument("--src",default=".")
    ap.add_argument("--out",default=None)
    a=ap.parse_args()
    res=bouw(a.jaar,a.maand,a.src)
    out=a.out or f"landelijk_maand_{a.jaar}_{a.maand:02d}.json"
    with open(out,"w") as f: json.dump(res,f,ensure_ascii=False,separators=(",",":"))
    print("geschreven:",out)
    print(f"  De Bilt TG {res['debilt']['tg']['waarde']}° (norm {res['debilt']['tg']['n9120']}/{res['debilt']['tg']['n9625']})  dagen t/m {res['ndagen']}/{res['dim']}  vandaag_in={res['vandaag_in']}")
    z=res['zon']
    print(f"  zon L5 {z['gem']}u (norm {z['n9120']}/{z['n9625']})  {z['pct']}% (norm {z['pct_n9120']}/{z['pct_n9625']})  Q {z['q']} J/cm2 (norm {z['q_n9120']}/{z['q_n9625']})")
    print(f"  neerslag AWS {res['neerslag']['gem']}mm  extreem tx {res['extremen_temp']['hoogste_tx']}")
