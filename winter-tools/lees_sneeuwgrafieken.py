"""Digitaliseer de twee aangeleverde PNG-grafieken (Pillow vereist)."""
import csv
import sys
from pathlib import Path
from PIL import Image

OUT = Path(__file__).resolve().parents[1] / "winter-data" / "sneeuwdagen.csv"
YEARS = range(1951, 2027)

def series(path, tick_y, tick_value, places):
    image = Image.open(path).convert("RGB")
    if image.size != (4125, 2126):
        raise ValueError(f"Onverwacht afbeeldingsformaat: {path}")
    px = image.load()
    zero = 1878
    dy = (zero - tick_y) / tick_value
    bars = []
    for year in YEARS:
        x = round(302 + (year - 1951) * (3847 - 302) / 75)
        # Neem de bovenste gekleurde pixel in de kern van de kolom, ook als
        # een gele referentiestip over het midden van de staaf ligt.
        top = next(y for y in range(460, zero) if sum(
            px[col, y] == (68, 114, 196) for col in range(x-6, x+7)
        ) >= 4)
        bars.append(round((zero - top) / dy, places))
    return bars

def main():
    average = series(sys.argv[1], 679, 60, 1)
    total = series(sys.argv[2], 544, 120, 0)
    with OUT.open("w", newline="") as f:
        w = csv.writer(f, lineterminator="\n")
        w.writerow(["eindjaar","gemiddeld_per_station","ergens_in_nederland"])
        w.writerows(zip(YEARS, average, total))

if __name__ == "__main__":
    main()
