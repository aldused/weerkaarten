#!/usr/local/bin/python3
"""
marathon_ophalen.py - daggegevens via etmgeg ZIP + uurgegevens via lokale result*.txt
Gebruik: python3 marathon_ophalen.py
"""
import requests, json, io, os, sys, zipfile, glob
from datetime import datetime

DATUMS = {"1981":"1981-04-11","1982":"1982-04-18","1983":"1983-04-10","1984":"1984-04-14","1985":"1985-04-13","1986":"1986-04-19","1987":"1987-04-25","1988":"1988-04-24","1989":"1989-04-23","1990":"1990-04-22","1991":"1991-04-21","1992":"1992-04-12","1993":"1993-04-25","1994":"1994-04-24","1995":"1995-04-23","1996":"1996-04-21","1997":"1997-04-20","1998":"1998-04-19","1999":"1999-04-18","2000":"2000-04-09","2001":"2001-04-08","2002":"2002-04-21","2003":"2003-04-13","2004":"2004-04-04","2005":"2005-04-10","2006":"2006-04-09","2007":"2007-04-15","2008":"2008-04-13","2009":"2009-04-05","2010":"2010-04-11","2011":"2011-04-10","2012":"2012-04-15","2013":"2013-04-14","2014":"2014-04-13","2015":"2015-04-12","2016":"2016-04-10","2017":"2017-04-09","2018":"2018-04-08","2019":"2019-04-07","2020":"2020-04-05","2021":"2021-10-24","2022":"2022-04-10","2023":"2023-04-16","2024":"2024-04-14","2025":"2025-04-13"}

MARATHON_SET = set(d.replace("-","") for d in DATUMS.values())
KOLOMMEN = "STN,YYYYMMDD,HH,DD,FH,FF,FX,T,T10N,TD,SQ,Q,DR,RH,P,VV,N,U,WW,IX,M,R,S,O,Y".split(',')
STATIONS_DAG = [(344,"Rotterdam The Hague Airport"),(330,"Hoek van Holland"),(260,"De Bilt")]
script_dir = os.path.dirname(os.path.abspath(__file__))

def parse_etmgeg(tekst):
    header = None
    res = {}
    for r in tekst.splitlines():
        r = r.strip()
        if not r: continue
        if r.startswith("# STN") or (header is None and r.startswith("STN")):
            header = [k.strip() for k in r.lstrip("# ").split(",")]; continue
        if header is None or r.startswith("#"): continue
        v = [x.strip() for x in r.split(",")]
        if len(v) < len(header): continue
        rij = dict(zip(header, v))
        def g(k): v2=rij.get(k,""); return None if v2=="" else (int(v2) if v2.lstrip('-').isdigit() else None)
        d = rij.get("YYYYMMDD","")
        if not d: continue
        res[d] = {"TX":g("TX"),"TN":g("TN"),"TG":g("TG"),"RH":g("RH"),"SQ":g("SQ"),"FXX":g("FXX"),"PG":g("PG"),"UG":g("UG"),"DDVEC":g("DDVEC")}
    return res

def parse_uurgeg(pad):
    res = {}
    with open(pad, encoding='latin-1') as f:
        for r in f:
            if r.strip().startswith('#'): continue
            v = [x.strip() for x in r.split(',')]
            if len(v) < 18: continue
            rij = dict(zip(KOLOMMEN, v))
            d = rij.get('YYYYMMDD','').strip()
            if d not in MARATHON_SET: continue
            hh = rij.get('HH','').strip()
            if not hh: continue
            try: hh = int(hh)
            except: continue
            def g(k): v2=rij.get(k,'').strip(); return None if v2=="" else (int(v2) if v2.lstrip('-').isdigit() else None)
            res.setdefault(d,{})[hh] = {"T":g("T"),"FH":g("FH"),"FF":g("FF"),"FX":g("FX"),"DD":g("DD"),"RH":g("RH"),"U":g("U"),"SQ":g("SQ"),"P":g("P"),"N":g("N"),"Q":g("Q"),"TD":g("TD")}
    return res

def haal_zip(url):
    try:
        r = requests.get(url, timeout=120); r.raise_for_status()
        with zipfile.ZipFile(io.BytesIO(r.content)) as z:
            return z.read(z.namelist()[0]).decode("latin-1")
    except Exception as e:
        print(f"  x {e}", file=sys.stderr); return None

# 1. Daggegevens
print("── Daggegevens ───────────────────────────")
dag_data = {}
for nr, naam in STATIONS_DAG:
    print(f"→ {naam} ({nr}) …", flush=True)
    t = haal_zip(f"https://cdn.knmi.nl/knmi/map/page/klimatologie/gegevens/daggegevens/etmgeg_{nr}.zip")
    if t:
        d = parse_etmgeg(t); dag_data[nr] = (naam, d)
        print(f"  ✓ {len(d)} dagen")

# 2. Uurgegevens uit lokale CSV's
print("\n── Uurgegevens (lokale result*.txt) ──────")
uur_data = {}
csvs = sorted(glob.glob(os.path.join(script_dir, "result*.txt")))
if not csvs:
    print("  ⚠ Geen result*.txt gevonden naast dit script")
    print("    Download via daggegevens.knmi.nl/klimatologie/uurgegevens (stn 344)")
else:
    for pad in csvs:
        gevonden = parse_uurgeg(pad)
        nieuw = sum(1 for d in gevonden if d not in uur_data)
        uur_data.update({d:v for d,v in gevonden.items() if d not in uur_data})
        print(f"  ✓ {os.path.basename(pad)}: {len(gevonden)} datums ({nieuw} nieuw)")
print(f"  Totaal: {len(uur_data)}/{len(DATUMS)} edities met uurdata")

# 3. Koppelen
print("\n── Koppelen ──────────────────────────────")
edities = []
for jaar, datum in sorted(DATUMS.items()):
    yyyymmdd = datum.replace("-","")
    ed = {"jaar":int(jaar),"datum":datum}
    for nr,(naam,data) in dag_data.items():
        if yyyymmdd in data:
            d = data[yyyymmdd]
            ed.update({"station":naam,"TX":d["TX"],"TN":d["TN"],"TG":d["TG"],"RH":d["RH"],"SQ":d["SQ"],"FXX":d["FXX"],"PG":d["PG"],"UG":d["UG"],"DDVEC":d["DDVEC"]}); break
    else:
        ed.update({"station":None,"TX":None,"TN":None,"TG":None,"RH":None,"SQ":None,"FXX":None,"PG":None,"UG":None,"DDVEC":None})
    if yyyymmdd in uur_data:
        ed["uren"] = [uur_data[yyyymmdd].get(hh) for hh in range(1,25)]
        print(f"  ✓ {jaar}: dag + {len(uur_data[yyyymmdd])} uurwaarden")
    else:
        ed["uren"] = None
        print(f"  - {jaar}: alleen dagdata")
    edities.append(ed)

# 4. Opslaan
pad = os.path.join(script_dir, "marathon_data.js")
json_str = json.dumps({"gegenereerd":datetime.now().isoformat(),"edities":edities}, ensure_ascii=False, separators=(",",":"))
with open(pad,"w",encoding="utf-8") as f:
    f.write(f"const MARATHON_DATA = {json_str};")
print(f"\n✓ {pad} ({os.path.getsize(pad)//1024} KB) · {sum(1 for e in edities if e['uren'])} edities met uurdata")
