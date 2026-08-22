#!/usr/bin/env python3
"""
Maak een compact databestand met regionale en landelijke hittegolven.

Definitie KNMI: minstens 5 aaneengesloten dagen met TX >= 25,0 graden,
waarvan minstens 3 dagen met TX >= 30,0 graden. De landelijke reeks is
station De Bilt; dezelfde definitie wordt per station toegepast voor
regionale hittegolven.
"""
import csv
import json
import os
from collections import Counter, defaultdict
from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo

os.chdir(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))

LOCAL_TZ = ZoneInfo("Europe/Amsterdam")
KNMI_LANDELIJKE_HITTEGOLVEN_URL = "https://www.knmi.nl/nederland-nu/klimatologie/lijsten/hittegolven"
TOPLIJST_PATH = "toplijst.json"

STATIONS = [
    (260, "De Bilt"), (20, "Winterswijk"), (130, "Epen"), (170, "Oost-Maarland"),
    (344, "Rotterdam Airport"), (330, "Hoek van Holland"),
    (235, "Den Helder"), (240, "Schiphol"), (270, "Leeuwarden"),
    (280, "Eelde"), (290, "Twenthe"), (310, "Vlissingen"), (380, "Maastricht"),
    (210, "Valkenburg"), (215, "Voorschoten"), (225, "IJmuiden"),
    (229, "Texelhors"), (242, "Vlieland"), (248, "Wijdenes"), (249, "Berkhout"),
    (251, "Terschelling"), (257, "Wijk aan Zee"), (258, "Houtribdijk"),
    (265, "Soesterberg"), (267, "Stavoren"), (269, "Lelystad"),
    (273, "Marknesse"), (275, "Deelen"), (277, "Lauwersoog"),
    (278, "Heino"), (279, "Hoogeveen"), (283, "Hupsel"), (286, "Nieuw Beerta"),
    (319, "Westdorpe"), (323, "Wilhelminadorp"), (324, "Stavenisse"),
    (331, "Tholen"), (340, "Woensdrecht"), (343, "Rotterdam Geulhaven"),
    (348, "Cabauw"), (350, "Gilze-Rijen"), (356, "Herwijnen"),
    (370, "Eindhoven"), (375, "Volkel"), (377, "Ell"),
    (391, "Arcen"), (392, "Horst"),
]

HISTORICAL_CSV_STATIONS = {
    20: {"type": "historisch", "bronnen": [("Winterswijk_20_G_18940101_19701209.csv", None)]},
    130: {"type": "termijn", "bronnen": [("Epen_OostMaarland.csv", "130_H"), ("Epen_OostMaarlant_feb_1990.csv", "168_H")]},
    170: {"type": "termijn", "bronnen": [("Epen_OostMaarland.csv", "170_H"), ("Epen_OostMaarlant_feb_1990.csv", "170_H")]},
}

MONTH_NAMES = {
    1: "januari", 2: "februari", 3: "maart", 4: "april",
    5: "mei", 6: "juni", 7: "juli", 8: "augustus",
    9: "september", 10: "oktober", 11: "november", 12: "december",
}

SEASONS = {
    "winter": (12, 1, 2),
    "lente": (3, 4, 5),
    "zomer": (6, 7, 8),
    "herfst": (9, 10, 11),
}


def parse_key(value):
    return date(int(value[:4]), int(value[4:6]), int(value[6:8]))


def iso(day):
    return day.isoformat()


def season_name(month):
    for name, months in SEASONS.items():
        if month in months:
            return name
    return "onbekend"


def months_between(start, end):
    return [{
        "nr": start.month,
        "naam": MONTH_NAMES[start.month],
        "jaar": start.year,
        "key": f"{start.year}-{start.month:02d}",
    }]


def seasons_between(start, end):
    name = season_name(start.month)
    season_year = start.year + 1 if start.month == 12 else start.year
    return [{"key": f"{season_year}-{name}", "naam": name, "jaar": season_year}]


def years_between(start, end):
    return list(range(start.year, end.year + 1))


def station_data_file(station_nr):
    if station_nr in HISTORICAL_CSV_STATIONS:
        return " + ".join(source for source, _ in HISTORICAL_CSV_STATIONS[station_nr]["bronnen"])
    return f"dagdata_{station_nr}.json"


def parse_historical_csv_rows(path):
    obs = defaultdict(lambda: {"tx2400": None, "tx6": []})
    header = None
    with open(path, encoding="latin-1") as handle:
        for line in handle:
            line = line.strip()
            if not line:
                continue
            if line.startswith("DATUM,"):
                header = [name.strip() for name in line.split(",")]
                continue
            if header is None or line.startswith("#") or line[0].isalpha():
                continue
            parts = line.split(",")
            row = dict(zip(header, parts))
            key = row.get("DATUM", "").strip()
            if len(key) != 8 or not key.isdigit():
                continue

            def value(column):
                raw = row.get(column, "").strip()
                quality = row.get("Q_" + column, "").strip()
                if not raw or quality in ("7", "9"):
                    return None
                return round(float(raw) / 10, 1)

            if row.get("tijd", "").strip() == "2400":
                obs[key]["tx2400"] = value("TX")
            else:
                tx6 = value("TX6")
                if tx6 is not None:
                    obs[key]["tx6"].append(tx6)

    rows = []
    for key, values in sorted(obs.items()):
        tx = values["tx2400"]
        if tx is None and values["tx6"]:
            tx = round(max(values["tx6"]), 1)
        rows.append({"date": parse_key(key), "key": key, "tx": tx})
    return rows


def cleaned_csv_lines(path):
    with open(path, encoding="utf-8-sig") as handle:
        for line in handle:
            line = line.rstrip("\r\n")
            if line.startswith('"') and line.endswith('"') and ',""' in line:
                line = line[1:-1].replace('""', '"')
            yield line


def parse_termijn_csv_rows(path, station_code):
    rows = []
    reader = csv.DictReader(cleaned_csv_lines(path), delimiter=",")
    for raw in reader:
        if raw.get("DS_CODE") != station_code:
            continue
        key = str(raw.get("IT_DATETIME", ""))[:8]
        if len(key) != 8 or not key.isdigit():
            continue
        quality = str(raw.get("REH1.Q_TX", "")).strip()
        tx_raw = str(raw.get("REH1.TX", "")).strip()
        if not tx_raw or quality in ("7", "9"):
            tx = None
        else:
            try:
                tx = round(float(tx_raw), 1)
            except ValueError:
                tx = None
        rows.append({"date": parse_key(key), "key": key, "tx": tx})
    return rows


def load_historical_rows(station_nr):
    config = HISTORICAL_CSV_STATIONS[station_nr]
    rows_by_key = {}
    for path, station_code in config["bronnen"]:
        if not os.path.exists(path):
            continue
        rows = parse_historical_csv_rows(path) if config["type"] == "historisch" else parse_termijn_csv_rows(path, station_code)
        for row in rows:
            current = rows_by_key.get(row["key"])
            if current is None or (current["tx"] is None and row["tx"] is not None):
                rows_by_key[row["key"]] = row
    return sorted(rows_by_key.values(), key=lambda row: row["date"])


def load_station_rows(station_nr):
    if station_nr in HISTORICAL_CSV_STATIONS:
        rows = load_historical_rows(station_nr)
        if not rows:
            return None
        return rows

    path = station_data_file(station_nr)
    if not os.path.exists(path):
        return None
    with open(path) as handle:
        payload = json.load(handle)
    columns = {name: idx for idx, name in enumerate(payload.get("kolommen", []))}
    if "YYYYMMDD" not in columns or "TX" not in columns:
        return None
    rows = []
    for raw in payload.get("data", []):
        key = str(raw[columns["YYYYMMDD"]])
        tx_raw = raw[columns["TX"]]
        tx = None if tx_raw is None else round(float(tx_raw) / 10, 1)
        rows.append({"date": parse_key(key), "key": key, "tx": tx})
    rows.sort(key=lambda row: row["date"])
    return rows


def load_toplist_days():
    """Alle toplijst-dagen oplopend gesorteerd, met TX per stationnummer.

    Nodig om het gat te vullen tussen de gevalideerde dagdata (loopt ~1 dag
    achter) en vandaag: tussenliggende dagen staan al definitief in de
    toplijst maar nog niet in dagdata_<nr>.json.
    """
    if not os.path.exists(TOPLIJST_PATH):
        return []
    with open(TOPLIJST_PATH) as handle:
        payload = json.load(handle)
    if not payload:
        return []
    station_numbers = {name: nr for nr, name in STATIONS}
    days = []
    for key in sorted(payload):
        entry = payload[key]
        values = {}
        for item in entry.get("max", []):
            if len(item) < 2:
                continue
            tx, station_name = item[0], item[1]
            station_nr = station_numbers.get(station_name)
            if station_nr is None or tx is None:
                continue
            values[station_nr] = {
                "tx": round(float(tx), 1),
                "tijd": item[2] if len(item) > 2 else None,
                "stationNaam": station_name,
            }
        days.append({
            "datum": key,
            "update": entry.get("update"),
            "status": entry.get("status"),
            "waarden": values,
        })
    return days


def load_current_toplist(toplist_days=None):
    days = load_toplist_days() if toplist_days is None else toplist_days
    if not days:
        return None
    return days[-1]


def append_toplist_rows(rows, station_nr, toplist_days):
    """Vul alle toplijst-dagen na de laatste dagdata-dag aan.

    Voorheen werd alleen de laatste toplijst-dag toegevoegd, waardoor een
    al definitieve dag in het gat (bijv. gisteren) verloren ging en een net
    voltooide regionale hittegolf onzichtbaar bleef.
    """
    if not toplist_days:
        return rows
    last_date = rows[-1]["date"] if rows else None
    extra = []
    for day in toplist_days:
        value = day["waarden"].get(station_nr)
        if value is None:
            continue
        current_day = date.fromisoformat(day["datum"])
        if last_date is not None and current_day <= last_date:
            continue
        extra.append({
            "date": current_day,
            "key": current_day.strftime("%Y%m%d"),
            "tx": value["tx"],
            "voorlopig": day["status"] != "definitief",
            "tijd": value["tijd"],
            "bron": "toplijst",
        })
    if not extra:
        return rows
    return [*rows, *extra]


def trailing_warm_streak(rows, day):
    if not rows or rows[-1]["date"] != day:
        return []
    streak = []
    expected = day
    for row in reversed(rows):
        if row["date"] != expected or row["tx"] is None or row["tx"] < 25:
            break
        streak.insert(0, row)
        expected = expected - timedelta(days=1)
    return streak


def current_candidate(station_nr, station_name, rows, current):
    if not current:
        return None
    current_day = date.fromisoformat(current["datum"])
    if not rows or rows[-1]["date"] != current_day or not rows[-1].get("voorlopig"):
        return None
    streak = trailing_warm_streak(rows, current_day)
    if len(streak) < 3:
        return None
    tropical = [row for row in streak if row["tx"] >= 30]
    max_day = max(streak, key=lambda row: row["tx"])
    return {
        "station": str(station_nr),
        "stationNaam": station_name,
        "landelijk": station_nr == 260,
        "start": iso(streak[0]["date"]),
        "eind": iso(streak[-1]["date"]),
        "duur": len(streak),
        "tropischeDagen": len(tropical),
        "zomerseNodig": max(0, 5 - len(streak)),
        "tropischeNodig": max(0, 3 - len(tropical)),
        "status": "hittegolf" if len(streak) >= 5 and len(tropical) >= 3 else "kandidaat",
        "txMax": max_day["tx"],
        "txMaxDatum": iso(max_day["date"]),
        "voorlopig": True,
        "laatsteTijd": rows[-1].get("tijd"),
        "dagen": [{"datum": iso(row["date"]), "tx": row["tx"], "voorlopig": bool(row.get("voorlopig"))} for row in streak],
    }


def finalize_wave(station_nr, station_name, serial, streak):
    if len(streak) < 5:
        return None
    tropical = [row for row in streak if row["tx"] >= 30]
    if len(tropical) < 3:
        return None

    start = streak[0]["date"]
    end = streak[-1]["date"]
    duration = len(streak)
    max_day = max(streak, key=lambda row: row["tx"])
    avg_tx = round(sum(row["tx"] for row in streak) / duration, 1)
    tropical_sum = sum(row["tx"] - 30 for row in streak if row["tx"] >= 30)
    heat_sum = sum(row["tx"] - 25 for row in streak)

    return {
        "id": f"{station_nr}-{serial}",
        "station": str(station_nr),
        "stationNaam": station_name,
        "landelijk": station_nr == 260,
        "start": iso(start),
        "eind": iso(end),
        "jaar": start.year,
        "jaren": years_between(start, end),
        "maanden": months_between(start, end),
        "seizoenen": seasons_between(start, end),
        "duur": duration,
        "tropischeDagen": len(tropical),
        "zomerseDagen": duration,
        "txMax": max_day["tx"],
        "txMaxDatum": iso(max_day["date"]),
        "txGem": avg_tx,
        "tropischeSom": round(tropical_sum, 1),
        "hitteSom": round(heat_sum, 1),
        "hittegolfGetal": round(heat_sum, 1),
        "voorlopig": any(row.get("voorlopig") for row in streak),
        "dagen": [{"datum": iso(row["date"]), "tx": row["tx"], "voorlopig": bool(row.get("voorlopig"))} for row in streak],
    }


def calculate_heatwaves(station_nr, station_name, rows):
    waves = []
    streak = []
    previous_day = None
    serial = 1

    for row in rows:
        tx = row["tx"]
        day = row["date"]
        consecutive = previous_day is not None and day == previous_day + timedelta(days=1)
        if tx is not None and tx >= 25:
            if streak and not consecutive:
                wave = finalize_wave(station_nr, station_name, serial, streak)
                if wave:
                    waves.append(wave)
                    serial += 1
                streak = []
            streak.append(row)
        else:
            if streak:
                wave = finalize_wave(station_nr, station_name, serial, streak)
                if wave:
                    waves.append(wave)
                    serial += 1
                streak = []
        previous_day = day

    if streak:
        wave = finalize_wave(station_nr, station_name, serial, streak)
        if wave:
            waves.append(wave)
    return waves


def station_stats(rows, waves):
    valid_tx = [row for row in rows if row["tx"] is not None]
    year_counts = Counter(wave["jaar"] for wave in waves)
    if not valid_tx:
        return {
            "van": None, "tm": None, "aantal": 0, "dagen": 0,
            "langste": None, "heetste": None, "perJaar": {},
        }
    longest = max(waves, key=lambda wave: (wave["duur"], wave["tropischeDagen"], wave["txMax"]), default=None)
    hottest = max(waves, key=lambda wave: (wave["txMax"], wave["duur"]), default=None)
    return {
        "van": iso(valid_tx[0]["date"]),
        "tm": iso(valid_tx[-1]["date"]),
        "aantal": len(waves),
        "dagen": sum(wave["duur"] for wave in waves),
        "langste": longest["id"] if longest else None,
        "heetste": hottest["id"] if hottest else None,
        "perJaar": dict(sorted(year_counts.items())),
    }


def build_summary(stations):
    all_waves = [wave for station in stations for wave in station["hittegolven"]]
    years = Counter()
    regional_stations_by_year = {}
    for wave in all_waves:
        for year in wave["jaren"]:
            years[year] += 1
            regional_stations_by_year.setdefault(year, set()).add(wave["station"])

    longest = max(all_waves, key=lambda wave: (wave["duur"], wave["tropischeDagen"], wave["txMax"]), default=None)
    hottest = max(all_waves, key=lambda wave: (wave["txMax"], wave["duur"]), default=None)
    debilt = next((station for station in stations if station["station"] == "260"), None)

    return {
        "stations": len(stations),
        "hittegolven": len(all_waves),
        "regionaleHittegolven": len([wave for wave in all_waves if not wave["landelijk"]]),
        "landelijkeHittegolven": len(debilt["hittegolven"]) if debilt else 0,
        "langste": longest["id"] if longest else None,
        "heetste": hottest["id"] if hottest else None,
        "jaren": {
            str(year): {
                "hittegolven": years[year],
                "stations": len(regional_stations_by_year.get(year, set())),
            }
            for year in sorted(years)
        },
    }


def main():
    station_outputs = []
    toplist_days = load_toplist_days()
    current = load_current_toplist(toplist_days)
    candidates = []
    for station_nr, station_name in STATIONS:
        rows = load_station_rows(station_nr)
        if rows is None:
            print(f"{station_nr} {station_name}: geen dagdata")
            continue
        rows = append_toplist_rows(rows, station_nr, toplist_days)
        candidate = current_candidate(station_nr, station_name, rows, current)
        if candidate:
            candidates.append(candidate)
        waves = calculate_heatwaves(station_nr, station_name, rows)
        station_outputs.append({
            "station": str(station_nr),
            "naam": station_name,
            "bestand": station_data_file(station_nr),
            "hittegolven": waves,
            "stats": station_stats(rows, waves),
        })
        print(f"{station_nr} {station_name}: {len(waves)} hittegolven")

    output = {
        "gegenereerd": datetime.now(LOCAL_TZ).strftime("%Y-%m-%d %H:%M"),
        "definitie": "Minstens 5 aaneengesloten dagen TX >= 25,0 graden, waarvan minstens 3 dagen TX >= 30,0 graden.",
        "bron": "Weerlab dagdata gebaseerd op KNMI daggegevens per station.",
        "bronnen": {
            "regionaal": "Weerlab dagdata gebaseerd op KNMI daggegevens per station.",
            "landelijk": {
                "naam": "KNMI Hittegolven sinds 1901",
                "url": KNMI_LANDELIJKE_HITTEGOLVEN_URL,
                "tijdvak": "1 januari 1901 tot en met 24 mei 2026",
                "aantal": 39,
            },
        },
        "stations": station_outputs,
        "samenvatting": build_summary(station_outputs),
        "actueel": {
            "datum": current["datum"] if current else None,
            "update": current["update"] if current else None,
            "status": current["status"] if current else None,
            "voorlopig": bool(current),
            "kandidaten": sorted(
                candidates,
                key=lambda item: (
                    item["zomerseNodig"] + item["tropischeNodig"],
                    item["zomerseNodig"],
                    item["tropischeNodig"],
                    -item["duur"],
                    -item["txMax"],
                    item["stationNaam"],
                ),
            ),
        },
    }

    with open("hittegolven.json", "w") as handle:
        json.dump(output, handle, ensure_ascii=False, separators=(",", ":"))
    print(f"Opgeslagen: hittegolven.json ({output['samenvatting']['hittegolven']} hittegolven)")


if __name__ == "__main__":
    main()
