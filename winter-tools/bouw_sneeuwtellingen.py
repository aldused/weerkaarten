"""Tel sneeuwdagen uit de openbare KNMI-stationarchieven per uurvak (UTC)."""

import argparse
from collections import defaultdict
from datetime import date
from functools import lru_cache
import gzip
import hashlib
from html import unescape
import json
from pathlib import Path
import re
from zipfile import ZipFile

from sneeuwcodes import (
    AUTOMATIC, HAIL_AUTOMATIC, HAIL_VISUAL, SNOW_AUTOMATIC, SNOW_VISUAL,
    VISUAL, WINTRY_AUTOMATIC, WINTRY_VISUAL,
)

SOURCE = "https://www.knmi.nl/nederland-nu/klimatologie/uurgegevens"
OUT = Path(__file__).resolve().parents[1] / "winter-data" / "sneeuw-v2"
ZIP_NAME = re.compile(r"uurgeg_(\d{3})_(\d{4})-(\d{4})\.zip$")
STATION_NAME = re.compile(r">\s*(\d{3})\s+-\s+([^<>]+)</th>")
FIELDS = ("STN", "YYYYMMDD", "HH", "S", "WW", "IX", "T", "TD", "RH", "R", "DR", "T10N", "U", "O")
OFFSHORE = {"201", "203", "204", "205", "206", "207", "208", "209", "211", "212", "213",
            "214", "216", "218", "239", "252", "285", "312", "313", "316", "317", "320", "321"}
MODE_KEYS = ("s", "extended", "validated", "wintry", "codeOnly")
LEGACY_VISUAL_SNOW = {22, 23, 26, 68, 69, 70, 71, 72, 73, 74, 75, 77, 83, 84, 85, 86}


def number(value):
    return int(value) if value.strip() else None


def archive_rows(archive_path, station):
    with ZipFile(archive_path) as archive:
        member, = (name for name in archive.namelist() if name.lower().endswith(".txt"))
        with archive.open(member) as source:
            for line in source:
                if re.match(rb"^#\s*STN\s*,", line):
                    columns = line[1:].decode("ascii").strip().split(",")
                    positions = {column.strip(): i for i, column in enumerate(columns)}
                    indices = tuple(positions[field] for field in FIELDS)
                    break
            else:
                raise ValueError(f"Kolomkop ontbreekt in {archive_path}")
            for line in source:
                if not line.lstrip()[:1].isdigit():
                    continue
                cells = line.rstrip(b"\r\n").split(b",")
                if len(cells) != len(columns):
                    raise ValueError(f"Verkeerd aantal kolommen in {archive_path}: {line!r}")
                actual = cells[indices[0]].strip().decode("ascii")
                if actual != station:
                    raise ValueError(f"Onverwacht station {actual} in {archive_path}")
                day = cells[indices[1]].strip().decode("ascii")
                yield day, *(number(cells[i]) for i in indices[2:6]), tuple(cells[i] for i in indices[6:])


def code_method(historical, ww, ix):
    if ix == 1:
        return "Visuele WW (bemand)", "visual"
    if ix == 4:
        return "Visuele WW-tabel (automatisch)", "visual"
    if ix == 7:
        return "Automatische WaWa", "automatic"
    if ix is None and ww is not None and historical:
        return "Historische WW (IX ontbreekt, visuele tabel)", "visual"
    return "Onbekend" if ix is None else f"Weercode weggelaten (IX {ix})", None


@lru_cache(maxsize=2048)
def classify_code(historical, snow, ww, ix):
    method, table = code_method(historical, ww, ix)
    visual = table == "visual"
    descriptions = VISUAL if visual else AUTOMATIC
    code_known = table is not None and ww is not None and 0 <= ww <= 99
    confirmed = code_known and ww in (SNOW_VISUAL if visual else SNOW_AUTOMATIC)
    wider = code_known and ww in (WINTRY_VISUAL if visual else WINTRY_AUTOMATIC)
    flagged = snow == 1
    extended = flagged or confirmed
    bits = flagged | (extended << 1) | (extended << 2) | ((extended or wider) << 3) | (confirmed << 4)
    if not bits:
        return bits, code_known or ix in (2, 5), "", "", "", method
    description = descriptions.get(ww, "Overige weercode") if code_known else ("Code zonder toepasbare tabel" if ww is not None else "")
    reason = "; ".join(part for condition, part in (
        (flagged, "KNMI heeft S = 1 geregistreerd"),
        (confirmed, "Weercode duidt op sneeuwval"),
        (wider and not confirmed, "Weercode duidt op winterse neerslag of een mogelijk sneeuwmengsel"),
    ) if condition)
    warning = "De weercode duidt op sneeuw bij S = 0." if confirmed and snow == 0 else ""
    if flagged and not confirmed:
        if not code_known:
            warning = "Geen bruikbare weercode om de sneeuwmelding te toetsen."
        elif ww in (HAIL_VISUAL if visual else HAIL_AUTOMATIC):
            warning = "De code meldt hagel of een hagelvariant. De sneeuwindicator blijft als bronmelding zichtbaar."
        else:
            warning = "De weercode bevestigt de sneeuwmelding niet afzonderlijk."
    return bits, code_known or ix in (2, 5), description, reason, warning, method


def classify(day, snow, ww, ix, correction=None):
    bits, covered, description, reason, warning, method = classify_code(day < "19940101", snow, ww, ix)
    if correction:
        if not bits & 2:
            raise ValueError(f"Correctie zonder sneeuwmelding: {correction}")
        bits &= ~(4 | 8)
        reason += "; correctie voor de gevalideerde telling"
        warning = f"{correction['reason']} Bron: {correction['source']}"
    return bits, covered, description, reason, warning, method


def iso(day):
    return f"{day[:4]}-{day[4:6]}-{day[6:]}"


def periods(day):
    year, month = int(day[:4]), int(day[4:6])
    yield "years", str(year)
    yield "months", f"{year}-{month:02}"
    if month >= 10 or month <= 3:
        yield "winters", str(year + (month >= 10))


def period_days(kind, key):
    year = int(key[:4])
    if kind == "years":
        start, stop = date(year, 1, 1), date(year + 1, 1, 1)
    elif kind == "winters":
        start, stop = date(year - 1, 10, 1), date(year, 4, 1)
    else:
        month = int(key[-2:])
        start, stop = date(year, month, 1), date(year + (month == 12), month % 12 + 1, 1)
    return (stop - start).days


def summarize(daily, kind, key):
    span_days = period_days(kind, key)
    hours = [sum(m[i].bit_count() for m in daily) for i in (0, 1)]
    days = [sum(bool(m[i]) for m in daily) for i in (0, 1)]
    base = (hours[0], sum(hours), sum(hours), sum(hours), hours[1])
    return {
        **{mode: sum(bool(m[2] & (1 << i)) for m in daily) if base[i] else None
           for i, mode in enumerate(MODE_KEYS)},
        "coverage": {key: [count, span_days * 24] for key, count in zip(("s", "codes"), hours)},
        "coverageDays": {key: [count, span_days] for key, count in zip(("s", "codes"), days)},
    }


def load_corrections(path):
    if path is None:
        return {}
    corrections = {}
    for entry in json.loads(path.read_text(encoding="utf-8")):
        key = entry["station"], date.fromisoformat(entry["date"]).strftime("%Y%m%d"), entry["hh"]
        if key in corrections or not 1 <= key[2] <= 24 or not entry["reason"].strip() or not entry["source"].startswith("https://"):
            raise ValueError(f"Correctieregel vereist een uniek uurvak en een gedocumenteerde bron: {entry}")
        corrections[key] = entry
    return corrections


def load_edr_codes(folder):
    """Optional validated WW/IX supplement. Never replace the published S field."""
    codes = defaultdict(dict)
    if folder is None:
        return codes
    for path in sorted(folder.glob("*.txt.gz")):
        with gzip.open(path, "rt", encoding="utf-8") as source:
            for line in source:
                if line.startswith("# STN,YYYYMMDD,HH,"):
                    header = [v.strip() for v in line[1:].split(",")]
                    break
            else:
                raise ValueError(f"EDR-kolomkop ontbreekt in {path}")
            ww_index, ix_index = header.index("WW"), header.index("IX")
            for line in source:
                cells = line.strip().split(",")
                station, day, hh = cells[:3]
                ww, ix = number(cells[ww_index]), number(cells[ix_index])
                if ww is None and ix is None:
                    continue
                key = day, int(hh)
                if key in codes[station]:
                    raise ValueError(f"Dubbel EDR-uur: {station}, {key}")
                codes[station][key] = ww, ix
    return codes


def write_json(path, value):
    tmp = path.with_suffix(".part")
    with tmp.open("w", encoding="utf-8") as target:
        json.dump(value, target, ensure_ascii=False, separators=(",", ":"))
        target.write("\n")
    tmp.replace(path)


def build(raw, out, corrections_path=None, edr_cache=None):
    page = (raw / "index.html").read_text(encoding="utf-8")
    sources = sorted({"https:" + match for match in re.findall(
        r"//cdn\.knmi\.nl/[^\s'\"<>]*?uurgeg_\d{3}_\d{4}-\d{4}\.zip", page)})
    if not sources:
        raise ValueError("Geen stationarchieven gevonden in de KNMI-index")
    station_names = {sid: unescape(name.strip()) for sid, name in STATION_NAME.findall(page)}
    files = defaultdict(list)
    for url in sources:
        name = url.rsplit("/", 1)[1]
        station, first_year, last_year = ZIP_NAME.fullmatch(name).groups()
        files[station].append((raw / name, url, int(first_year), int(last_year)))

    corrections = load_corrections(corrections_path)
    used_corrections = set()
    supplements = load_edr_codes(edr_cache)
    summary = {kind: defaultdict(dict) for kind in ("years", "winters", "months")}
    national_daily = defaultdict(lambda: [0, 0, 0])
    events = defaultdict(lambda: defaultdict(dict))
    manifest = []
    invalid_indicators = []
    source_first, source_last = "99999999", "00000000"
    benchmark = defaultdict(lambda: [0, 0, 0, 0, 0, 0])
    for station, archives in files.items():
        station_supplements = supplements[station]
        station_daily = defaultdict(lambda: [0, 0, 0])
        previous = "", 0
        legacy_days = set()
        for path, url, first_year, last_year in archives:
            count = 0
            first = None
            for day, hh, snow, ww, ix, context in archive_rows(path, station):
                if day != previous[0]:
                    date.fromisoformat(iso(day))
                if (day, hh) <= previous or not 1 <= hh <= 24 or not first_year <= int(day[:4]) <= last_year:
                    raise ValueError(f"Dubbel, ongesorteerd of ongeldig KNMI-uur in {path}: {day} {hh}")
                unusual_s = snow not in (None, 0, 1)
                if unusual_s:
                    invalid_indicators.append({"station": station, "date": iso(day), "hh": hh, "s": snow, "archive": path.name})
                previous = day, hh
                count += 1
                if first is None:
                    first = day
                key = station, day, hh
                original_ww, original_ix = ww, ix
                edr = ww is None and ix is None and (day, hh) in station_supplements
                if edr:
                    ww, ix = station_supplements[day, hh]
                correction = corrections.get(key)
                if correction:
                    used_corrections.add(key)
                bits, code_covered, description, reason, warning, method = classify(day, snow, ww, ix, correction)
                daily = station_daily[day]
                slot = 1 << (hh - 1)
                if snow in (0, 1):
                    daily[0] |= slot
                if code_covered:
                    daily[1] |= slot
                if bits:
                    temp, td, rh, rain, dr, t10n, humidity, thunder = map(number, context)
                    if unusual_s:
                        warning = f"{warning} Ongedocumenteerde S-waarde: {snow}.".strip()
                    daily[2] |= bits
                    day_entries = events[day[:4]][iso(day)]
                    entry = day_entries.setdefault(station, {"m": 0, "h": []})
                    entry["m"] |= bits
                    entry["h"].append([hh, snow, ww, ix, temp, td, rh, description, reason, warning,
                                       method, bits, rain, dr, t10n, humidity, thunder,
                                       "KNMI EDR" if edr else "KNMI-uurarchief", original_ww, original_ix])
                if station == "260" and "19510101" <= day <= "19801231":
                    if (day < "19710101" and ww in LEGACY_VISUAL_SNOW and ix in (None, 1, 4)) or (day >= "19710101" and snow == 1):
                        legacy_days.add(day)
            if count:
                source_first = min(source_first, first)
                source_last = max(source_last, previous[0])
            with path.open("rb") as source:
                sha256 = hashlib.file_digest(source, "sha256").hexdigest()
            manifest.append({"url": url, "file": path.name, "sha256": sha256, "rows": count,
                             "firstDay": iso(first) if first else None, "lastDay": iso(previous[0]) if count else None})

        groups = defaultdict(list)
        for day, masks in station_daily.items():
            for period in periods(day):
                groups[period].append(masks)
            if station not in OFFSHORE:
                national = national_daily[day]
                for i, mask in enumerate(masks):
                    national[i] |= mask
            if station == "260" and "19510101" <= day <= "19801231":
                for mode in range(5):
                    benchmark[day[:4]][mode] += bool(masks[2] & (1 << mode))
                benchmark[day[:4]][5] += day in legacy_days
        for (kind, key), daily in groups.items():
            summary[kind][key][station] = summarize(daily, kind, key)
        print(f"{station} · {len(archives)} archieven · {len(station_daily)} etmalen", flush=True)

    if unused := corrections.keys() - used_corrections:
        raise ValueError(f"Correctieregels zonder bijbehorende waarneming: {sorted(unused)}")
    groups = defaultdict(list)
    for day, masks in national_daily.items():
        for period in periods(day):
            groups[period].append(masks)
    for (kind, key), daily in groups.items():
        summary[kind][key]["all"] = summarize(daily, kind, key)

    out.mkdir(parents=True, exist_ok=True)
    for year in sorted(summary["years"]):
        write_json(out / f"{year}.json", {"days": events[year]})
    write_json(out / "bronnen.json", {"index": SOURCE, "archives": manifest,
                                      "edr": sorted(p.name for p in edr_cache.glob("*.txt.gz")) if edr_cache else [],
                                      "corrections": list(corrections.values()), "invalidIndicators": invalid_indicators})
    write_json(out / "index.json", {"from": iso(source_first), "through": iso(source_last),
        "stations": {sid: station_names.get(sid, f"KNMI-station {sid}") for sid in files},
        "offshoreExcludedFromAll": sorted(OFFSHORE & files.keys()),
        **{kind: dict(sorted(entries.items())) for kind, entries in summary.items()},
        "benchmark260": {"fields": [*MODE_KEYS, "legacy"], "years": dict(sorted(benchmark.items()))}})


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("raw", type=Path, help="Map met officiële KNMI-zipbestanden en de KNMI-index als index.html")
    parser.add_argument("--out", type=Path, default=OUT)
    parser.add_argument("--corrections", type=Path, help="Gecontroleerde correcties met per uurvak een bron en motivering")
    parser.add_argument("--edr-cache", type=Path, help="Optionele maandbestanden van haal_knmi_edr.py voor aanvullende WW/IX")
    args = parser.parse_args()
    build(args.raw, args.out, args.corrections, args.edr_cache)


if __name__ == "__main__":
    main()
