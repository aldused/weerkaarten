import os, json, requests, zipfile, io, xml.etree.ElementTree as ET, re
from datetime import datetime, timedelta

os.chdir(os.path.dirname(os.path.abspath(__file__)))

STATIONS = [
    ("06260", "De Bilt",          52.10,  5.18),
    ("06330", "Hoek van Holland", 51.978, 4.131),
    ("06344", "Rotterdam",        51.957, 4.437),
    ("06290", "Enschede",         52.275, 6.889),
    ("06280", "Eelde",            53.123, 6.586),
    ("06380", "Maastricht",       50.911, 5.770),
    ("06250", "Terschelling",     53.392, 5.350),
    ("06310", "Vlissingen",       51.442, 3.596),
    ("06275", "Deelen",           52.060, 5.885),
    ("06350", "Gilze-Rijen",      51.567, 4.931),
]

UTC_OFFSET = timedelta(hours=1)

def strip_namespaces(xml_string):
    xml_string = re.sub(r'<(/?)\w+:', r'<\1', xml_string)
    xml_string = re.sub(r'\b\w+:(\w+=)', r'\1', xml_string)
    xml_string = re.sub(r'\s+xmlns(?::\w+)?="[^"]*"', '', xml_string)
    return xml_string

def download_kmz(station):
    url = (f"https://opendata.dwd.de/weather/local_forecasts/mos/MOSMIX_L/"
           f"single_stations/{station}/kml/MOSMIX_L_LATEST_{station}.kmz")
    r = requests.get(url, timeout=30); r.raise_for_status()
    z = zipfile.ZipFile(io.BytesIO(r.content))
    kml = strip_namespaces(z.read(z.namelist()[0]).decode("utf-8"))
    return ET.fromstring(kml)

def get_times(root):
    times = []
    for ts in root.findall('.//ForecastTimeSteps/TimeStep'):
        try: times.append(datetime.strptime((ts.text or '').strip()[:19], "%Y-%m-%dT%H:%M:%S"))
        except: pass
    return times

def parse_values(root, element_name):
    for fc in root.findall('.//Forecast'):
        if fc.get('elementName') == element_name:
            val = fc.find('value')
            if val is not None and val.text:
                res = []
                for t in val.text.strip().split():
                    if t == '-': res.append(None)
                    else:
                        try: res.append(float(t))
                        except: res.append(None)
                return res
    return []

alle_stations = []

for code, naam, lat, lon in STATIONS:
    print(f"MOSMIX ophalen: {naam} ({code})...")
    try:
        root   = download_kmz(code)
        times  = get_times(root)
        tx_raw = parse_values(root, 'TX')
        tn_raw = parse_values(root, 'TN')
        rr_raw = parse_values(root, 'RR1c')

        daily = {}
        for i, dt in enumerate(times):
            loc = dt + UTC_OFFSET
            d   = loc.date().isoformat()
            if d not in daily: daily[d] = {"tx": [], "tn": [], "rr": 0.0}
            if i < len(tx_raw) and tx_raw[i] is not None:
                daily[d]["tx"].append(tx_raw[i] - 273.15)
            if i < len(tn_raw) and tn_raw[i] is not None:
                daily[d]["tn"].append(tn_raw[i] - 273.15)
            if i < len(rr_raw) and rr_raw[i] is not None and rr_raw[i] >= 0:
                daily[d]["rr"] += rr_raw[i]

        result = []
        for d in sorted(daily.keys())[:4]:
            tx_v = daily[d]["tx"]; tn_v = daily[d]["tn"]
            result.append({
                "datum": d,
                "tx":    round(max(tx_v), 1) if tx_v else None,
                "tn":    round(min(tn_v), 1) if tn_v else None,
                "rr":    round(daily[d]["rr"], 1),
            })

        alle_stations.append({
            "code": code, "naam": naam, "lat": lat, "lon": lon, "data": result,
        })
        for r in result:
            print(f"  {r['datum']}: TX={r['tx']} TN={r['tn']} RR={r['rr']}")

    except Exception as e:
        print(f"  FOUT: {e}")

output = {
    "gegenereerd": datetime.now().strftime("%Y-%m-%d %H:%M"),
    "stations": alle_stations,
}

with open("beta_debilt.json", "w") as f:
    json.dump(output, f)

print(f"\nbeta_debilt.json opgeslagen ({len(alle_stations)} stations)")
