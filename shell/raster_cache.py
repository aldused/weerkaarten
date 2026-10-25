#!/usr/bin/env python3
"""
Data voor weerbewaking_raster.html (het weekraster): ruwe WeatherPro-feed per plaats + officiële KNMI-waarschuwingen.

De WeatherPro-feed heeft geen CORS-headers, dus een browser kan hem niet direct ophalen. Dit script haalt hem
server-side op (zelfde plaatsen als weatherpro_feed_cache.py) en schrijft:
  weatherpro_raster.json  {generated, cities:[{slug,name,lid,lat,lon,region,xml}]}   (xml = ongewijzigde feed)
  knmi_warnings.json      {generated, warnings:[{id,level,type,area,onset,expires,text}]}  (Meteoalarm, code geel+)
Alleen standaardbibliotheek. Raakt weatherpro_uur.json NIET aan.
"""
import argparse, json, os, sys, urllib.request
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import weatherpro_feed_cache as wfc   # alleen CITIES en _get (draait niet bij import)

FEED = "https://weatherpro.consumer.meteogroup.com/weatherpro/WeatherServiceFeed.php?lid={lid}&mode=premium&format=xml"
METEOALARM = "https://feeds.meteoalarm.org/api/v1/warnings/feeds-netherlands"

# slug -> provincie (areaDesc in de Meteoalarm-feed)
REGION = {
    "rotterdam": "Zuid-Holland", "dordrecht": "Zuid-Holland", "soestdijk": "Utrecht", "ridderkerk": "Zuid-Holland", "rhoon": "Zuid-Holland",
    "valkenburg_zh": "Zuid-Holland", "denhelder": "Noord-Holland", "schiphol": "Noord-Holland", "debilt": "Utrecht", "lelystad": "Flevoland",
    "leeuwarden": "Friesland", "deelen": "Gelderland", "eelde": "Drenthe", "enschede": "Overijssel", "vlissingen": "Zeeland",
    "hoekvanholland": "Zuid-Holland", "gilzerijen": "Noord-Brabant", "eindhoven": "Noord-Brabant", "volkel": "Noord-Brabant",
    "maastricht": "Limburg", "hoogeveen": "Drenthe", "terschelling": "Friesland", "vlieland": "Friesland",
}

def now_iso():
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

def build_raster():
    cities = []
    for slug, name, lid, lat, lon in wfc.CITIES:
        try:
            xml = wfc._get(FEED.format(lid=lid)).decode("utf-8")
            if "<hour " not in xml or "<day " not in xml:
                raise ValueError("feed zonder uren/dagen")
        except Exception as e:                       # één plaats mag falen, de rest blijft staan
            print(f"WAARSCHUWING {name} ({lid}): {e}", file=sys.stderr); continue
        cities.append({"slug": slug, "name": name, "lid": lid, "lat": lat, "lon": lon, "region": REGION.get(slug, ""), "xml": xml})
    if len(cities) < len(wfc.CITIES) // 2:
        raise SystemExit("te weinig plaatsen opgehaald; niets geschreven")
    return {"generated": now_iso(), "cities": cities}

def build_warnings():
    d = json.loads(wfc._get(METEOALARM))
    out, now = [], datetime.now(timezone.utc)
    for w in d.get("warnings", []):
        alert = w.get("alert", {})
        for info in alert.get("info", []):
            if info.get("language") != "nl-NL": continue
            params = {p.get("valueName"): p.get("value") for p in info.get("parameter", [])}
            try:
                level = int(str(params.get("awareness_level", "")).split(";")[0])
                typ = int(str(params.get("awareness_type", "")).split(";")[0])
            except ValueError:
                continue
            if level < 2: continue
            try: expires = datetime.fromisoformat(info["expires"])
            except Exception: continue
            if expires <= now: continue
            for a in info.get("area", []):
                out.append({"id": f'{alert.get("identifier")}|{a.get("areaDesc")}', "level": level, "type": typ, "area": a.get("areaDesc"),
                            "onset": info.get("onset"), "expires": info.get("expires"), "text": info.get("description") or info.get("headline") or ""})
    return {"generated": now_iso(), "warnings": out}

def write_atomic(path, obj):
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f: json.dump(obj, f, ensure_ascii=False, separators=(",", ":"))
    os.replace(tmp, path)

def main():
    ap = argparse.ArgumentParser(); ap.add_argument("--dir", default=".")
    ap.add_argument("--only", choices=["raster", "warnings"], help="alleen dit deel")
    a = ap.parse_args()
    if a.only in (None, "raster"):
        r = build_raster(); write_atomic(os.path.join(a.dir, "weatherpro_raster.json"), r)
        print(f"weatherpro_raster.json: {len(r['cities'])} plaatsen")
    if a.only in (None, "warnings"):
        try:
            w = build_warnings(); write_atomic(os.path.join(a.dir, "knmi_warnings.json"), w)
            print(f"knmi_warnings.json: {len(w['warnings'])} waarschuwingen (geel of hoger)")
        except Exception as e:
            print(f"WAARSCHUWING: KNMI-waarschuwingen niet opgehaald: {e}", file=sys.stderr)

if __name__ == "__main__":
    main()
