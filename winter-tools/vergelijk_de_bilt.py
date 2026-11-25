"""Exporteer de De Bilt-datums met S=1 en de extra positieve uurvakken (1951–1980)."""

import argparse
from collections import defaultdict
import csv
from pathlib import Path

from bouw_sneeuwtellingen import LEGACY_VISUAL_SNOW, archive_rows, classify, iso, number


def exports(raw, out):
    snow_hours = defaultdict(list)
    code_days = defaultdict(set)
    legacy_days = set()
    for first in (1951, 1961, 1971):
        path = raw / f"uurgeg_260_{first}-{first + 9}.zip"
        for day, hh, snow, ww, ix, context in archive_rows(path, "260"):
            flags, _, description, _, warning, method = classify(day, snow, ww, ix)
            if flags & 16:
                code_days[day].add(ww)
            if (day < "19710101" and ww in LEGACY_VISUAL_SNOW and ix in (None, 1, 4)) or (day >= "19710101" and snow == 1):
                legacy_days.add(day)
            if snow == 1:
                snow_hours[day].append((hh, ww, ix, *map(number, context), description, warning, method))

    out.mkdir(parents=True, exist_ok=True)
    with (out / "De-Bilt-sneeuwmeldingen-1951-1980.csv").open("w", encoding="utf-8-sig", newline="") as target:
        rows = csv.writer(target, delimiter=";")
        rows.writerow(["Datum UTC", "KNMI-station", "Uurvakken met S=1 (einduur UTC)", "WW per S=1-uurvak",
                       "Expliciete sneeuwcodes ergens op de dag", "Telt mee volgens oude Weerlab-regel",
                       "Onweer in minstens één S=1-uurvak"])
        for day, hours in sorted(snow_hours.items()):
            rows.writerow([iso(day), "260", ", ".join(f"{h[0]:02d}" for h in hours),
                           ", ".join(f"{h[1]:02d}" if h[1] is not None else "leeg" for h in hours),
                           ", ".join(f"{code:02d}" for code in sorted(code_days[day])),
                           "ja" if day in legacy_days else "nee", "ja" if any(h[10] == 1 for h in hours) else "nee"])

    with (out / "De-Bilt-verschil-428-datums-uurgegevens.csv").open("w", encoding="utf-8-sig", newline="") as target:
        rows = csv.writer(target, delimiter=";")
        rows.writerow(["Datum UTC", "KNMI-station", "Uurvak (einduur UTC)", "S", "WW", "IX", "Temperatuur (0,1 °C)",
                       "Dauwpunt (0,1 °C)", "Neerslag (0,1 mm)", "R", "Neerslagduur (0,1 uur)",
                       "Temperatuur 10 cm (0,1 °C)", "Relatieve vochtigheid (%)", "O",
                       "Nederlandse weercode", "Kwaliteitsnotitie", "Waarnemingsmethode"])
        for day in sorted(snow_hours.keys() - legacy_days):
            for hh, ww, ix, *context in snow_hours[day]:
                rows.writerow([iso(day), "260", hh, 1, ww, ix, *context])


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("raw", type=Path, help="Map met de drie KNMI-ZIP-bestanden van De Bilt")
    parser.add_argument("--out", type=Path, default=Path(__file__).resolve().parents[1])
    args = parser.parse_args()
    exports(args.raw, args.out)
