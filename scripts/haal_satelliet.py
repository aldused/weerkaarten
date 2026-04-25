#!/usr/bin/env python3
"""
haal_satelliet.py
Download satellietbeelden van MET Norway (EUMETSAT Meteosat).
Output: sat_visible.png, sat_infrared.png, sat_waterdamp.png
"""

import io
import os
import requests
from datetime import datetime
from PIL import Image, ImageDraw, ImageFont

os.chdir(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))

BASE = "https://api.met.no/weatherapi/geosatellite/1.4/"
HEADERS = {"User-Agent": "EdAldusWM/1.0 github.com/aldused/weerkaarten"}
BRON = "Bron: MET Norway / EUMETSAT Meteosat"
CREDIT = "\u00a9 Ed Aldus / Weerlab"

BEELDEN = [
    ("visible",  "sat_visible.png",  "Satelliet zichtbaar"),
    ("infrared", "sat_infrared.png", "Satelliet infrarood"),
]

def laad_font(size, bold=False):
    namen = [
        "/System/Library/Fonts/Supplemental/Arial Bold.ttf" if bold else "/System/Library/Fonts/Supplemental/Arial.ttf",
        "/Library/Fonts/Arial Bold.ttf" if bold else "/Library/Fonts/Arial.ttf",
        "/System/Library/Fonts/Helvetica.ttc",
    ]
    for naam in namen:
        try:
            return ImageFont.truetype(naam, size)
        except Exception:
            pass
    return ImageFont.load_default()

def tekstbreedte(draw, tekst, font):
    bbox = draw.textbbox((0, 0), tekst, font=font)
    return bbox[2] - bbox[0], bbox[3] - bbox[1]

def voeg_credit_toe(bytes_data, titel, opgehaald):
    img = Image.open(io.BytesIO(bytes_data)).convert("RGBA")
    w, h = img.size
    schaal = max(1, min(w, h) / 900)
    marge = int(14 * schaal)
    balk_h = int(64 * schaal)
    titel_font = laad_font(max(14, int(18 * schaal)), bold=True)
    sub_font = laad_font(max(11, int(14 * schaal)))

    overlay = Image.new("RGBA", img.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)
    draw.rectangle((0, h - balk_h, w, h), fill=(0, 20, 45, 225))

    links_boven = f"{titel} - {opgehaald}"
    links_onder = BRON
    rechts = CREDIT
    draw.text((marge, h - balk_h + int(9 * schaal)), links_boven, font=titel_font, fill=(255, 255, 255, 245))
    draw.text((marge, h - balk_h + int(36 * schaal)), links_onder, font=sub_font, fill=(220, 235, 250, 235))

    rw, rh = tekstbreedte(draw, rechts, sub_font)
    draw.text((w - marge - rw, h - balk_h + int(12 * schaal)), rechts, font=sub_font, fill=(255, 255, 255, 245))

    return Image.alpha_composite(img, overlay).convert("RGB")

print(f"=== Satellietbeelden === {datetime.now():%Y-%m-%d %H:%M}")
opgehaald = datetime.now().strftime("%d-%m-%Y %H:%M LT")
for type_naam, bestand, titel in BEELDEN:
    try:
        url = f"{BASE}?area=europe&type={type_naam}"
        r = requests.get(url, headers=HEADERS, timeout=30)
        if r.status_code == 200:
            img = voeg_credit_toe(r.content, titel, opgehaald)
            img.save(bestand, "PNG", optimize=True)
            print(f"  OK: {bestand} ({len(r.content)//1024} KB)")
        else:
            print(f"  FOUT {r.status_code}: {type_naam}")
    except Exception as e:
        print(f"  FOUT {type_naam}: {e}")
