"""
haal_knmi_verwachting.py
Scrapt de KNMI weersverwachting pagina en slaat op als JSON.
Bron: https://www.knmi.nl/nederland-nu/weer/verwachtingen
"""
import json, os, re, sys
import requests
from bs4 import BeautifulSoup
from datetime import datetime

os.chdir(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))

URL = "https://www.knmi.nl/nederland-nu/weer/verwachtingen"
HEADERS = {"User-Agent": "weerlab.nl/1.0 (contact@weerlab.nl)"}
OUTPUT = "knmi_verwachting.json"


def scrape():
    print(f"KNMI verwachting ophalen van {URL}...")
    r = requests.get(URL, headers=HEADERS, timeout=20)
    r.raise_for_status()
    soup = BeautifulSoup(r.text, "html.parser")

    sections = soup.find_all("div", class_="filled-main-content")
    data = {"opgehaald": datetime.now().strftime("%Y-%m-%dT%H:%M")}

    # ── 1. Vandaag & morgen (tekstverwachting) ───────────────────────────
    sec0 = sections[0]
    highlight = sec0.find("div", class_="filled-main-content__highlight")
    paragraphs = highlight.find_all("p")

    titel = ""
    tekst_blokken = []
    meta_tijd = ""

    for p in paragraphs:
        cls = p.get("class", [])
        text = p.get_text(" ", strip=True)
        if "intro" in cls:
            titel = text
        elif "meta" in cls:
            meta_tijd = text
        elif text:
            tekst_blokken.append(text)

    data["vandaag_morgen"] = {
        "titel": titel,
        "tekst": tekst_blokken,
        "tijd": meta_tijd,
    }

    # ── 2. Kaartjes ──────────────────────────────────────────────────────
    kaartjes = []
    map_container = highlight.find_all("img")
    for img in map_container:
        src = img.get("src", "")
        if "kaart_verwachtingen" in src:
            # Bepaal label uit bestandsnaam
            naam = src.split("/")[-1].split("?")[0]
            label = naam.replace("kaart_verwachtingen_", "").replace(".gif", "")
            label = label.replace("_", " ")
            kaartjes.append({"label": label, "url": src})

    data["kaartjes"] = kaartjes

    # ── 3. 7-daagse dagverwachting ───────────────────────────────────────
    sec3 = sections[3]
    table = sec3.find("div", class_="weather-forecast__table")
    dagen = []

    if table:
        for day_div in table.find_all("div", class_="weather-forecast__day"):
            dag = {}

            weekday = day_div.find(class_="weather-forecast__weekday")
            date = day_div.find(class_="weather-forecast__date")
            dag["dag"] = weekday.get_text(strip=True) if weekday else ""
            dag["datum"] = date.get_text(strip=True) if date else ""

            # Icoon
            icon = day_div.find("img", class_="weather-forecast__weather-icon")
            if icon:
                dag["icoon_url"] = "https://www.knmi.nl" + icon["src"] if icon["src"].startswith("/") else icon["src"]
                dag["icoon_alt"] = icon.get("alt", "")

            # Temperaturen
            temps = day_div.find_all("div", class_="weather-forecast__temperature")
            for t in temps:
                label = t.find(class_="weather-forecast__temperature-label")
                value = t.find(class_="weather-forecast__temperature-range")
                if label and value:
                    key = "tmax" if "Max" in label.get_text() else "tmin"
                    dag[key] = value.get_text(strip=True)

            # Details (neerslag, wind, zon)
            for stat in day_div.find_all("div", class_="weather-forecast__stats"):
                name_el = stat.find(class_="weather-forecast__stats-name")
                val_el = stat.find(class_="weather-forecast__stats-value")
                if name_el and val_el:
                    name = name_el.get_text(strip=True).lower()
                    val = val_el.get_text(strip=True)
                    if "neerslagkans" in name:
                        dag["neerslagkans"] = val
                    elif "neerslag" in name:
                        dag["neerslag"] = val
                    elif "wind" in name:
                        dag["wind"] = val
                        # Windrichting icoon
                        wind_dir_img = stat.find("img", alt=lambda x: x and "wind" not in x.lower() if x else False)
                        dir_img = stat.find("img", src=lambda x: x and "direction" in x if x else False)
                        if dir_img:
                            src = dir_img["src"]
                            m = re.search(r"wind-direction-(\w+)", src)
                            if m:
                                dag["windrichting"] = m.group(1)
                    elif "zonneschijn" in name:
                        dag["zon"] = val
                    elif "zonkracht" in name:
                        dag["zonkracht"] = val

            dagen.append(dag)

    data["dagen"] = dagen

    # ── 4. Vooruitzichten ────────────────────────────────────────────────
    sec1 = sections[1]
    vh = sec1.find("div", class_="filled-main-content__highlight")
    vp = vh.find_all("p") if vh else []
    vooruitzicht_tekst = ""
    vooruitzicht_tijd = ""
    for p in vp:
        if "meta" in p.get("class", []):
            vooruitzicht_tijd = p.get_text(strip=True)
        else:
            t = p.get_text(" ", strip=True)
            if t:
                vooruitzicht_tekst = t

    data["vooruitzichten"] = {
        "tekst": vooruitzicht_tekst,
        "tijd": vooruitzicht_tijd,
    }

    # ── 5. Lange termijn ─────────────────────────────────────────────────
    sec4 = sections[4]
    lt_ps = sec4.find_all("p")
    lt_tekst = ""
    lt_tijd = ""
    for p in lt_ps:
        if "meta" in p.get("class", []):
            lt_tijd = p.get_text(strip=True)
        else:
            t = p.get_text(" ", strip=True)
            if t:
                lt_tekst += t + " "

    data["lange_termijn"] = {
        "tekst": lt_tekst.strip(),
        "tijd": lt_tijd,
    }

    # ── Opslaan ──────────────────────────────────────────────────────────
    with open(OUTPUT, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)

    print(f"Opgeslagen: {OUTPUT}")
    print(f"  Tekst: {len(tekst_blokken)} alinea's")
    print(f"  Kaartjes: {len(kaartjes)}")
    print(f"  Dagen: {len(dagen)}")
    return data


if __name__ == "__main__":
    scrape()
