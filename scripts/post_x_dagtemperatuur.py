"""
post_x_dagtemperatuur.py
Dagelijks om 18:00 posten op X: landelijk hoogste temperatuur + kaart.
Vereist: pip install tweepy
Config: ~/.x_api_keys.json met consumer_key, consumer_secret, access_token, access_token_secret
"""

import os, json, sys
from datetime import date, datetime
from pathlib import Path
from zoneinfo import ZoneInfo

os.chdir(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))

LOCAL_TZ   = ZoneInfo("Europe/Amsterdam")
CONFIG_PATH = Path.home() / ".x_api_keys.json"
TOPLIJST   = "toplijst.json"
RECORD_RDAM = "records_344.json"   # Rotterdam Airport records voor datum-uitersten
KAART_TX   = "kaart_top_tx_vandaag.png"

NL_MAANDEN = ["","januari","februari","maart","april","mei","juni",
               "juli","augustus","september","oktober","november","december"]
NL_DAGEN   = ["maandag","dinsdag","woensdag","donderdag","vrijdag","zaterdag","zondag"]


def laad_config() -> dict:
    if not CONFIG_PATH.exists():
        sys.exit(
            f"X API keys niet gevonden in {CONFIG_PATH}\n"
            "Maak dat bestand aan met:\n"
            '{\n'
            '  "consumer_key": "...",\n'
            '  "consumer_secret": "...",\n'
            '  "access_token": "...",\n'
            '  "access_token_secret": "..."\n'
            '}'
        )
    with open(CONFIG_PATH) as f:
        return json.load(f)


def haal_vandaag_data(toplijst: dict, dag: date) -> dict:
    key = dag.isoformat()
    if key not in toplijst:
        sys.exit(f"Geen toplijst-data voor {key}")
    return toplijst[key]


def haal_datum_records(records: dict, dag: date) -> dict:
    """Haal tx_hoog en tx_laag op voor deze kalenderdag (Rotterdam Airport)."""
    maand = str(dag.month)
    dagn  = str(dag.day)
    try:
        return records["dag"][maand][dagn]
    except KeyError:
        return {}


def formatteer_temperatuur(val: float) -> str:
    """1 decimaal, maar geen '.0' bij ronde getallen: 23.0 → '23', 23.3 → '23,3'"""
    if val == int(val):
        return str(int(val))
    return f"{val:.1f}".replace(".", ",")


def stel_tekst_samen(dag: date, dag_data: dict, datum_records: dict,
                     mijn_station: str = "Rotterdam Airport") -> str:
    max_lijst = dag_data.get("max", [])
    if not max_lijst:
        sys.exit("Geen max-temperatuurdata beschikbaar.")

    # Landelijk hoogste
    top = max_lijst[0]
    top_val, top_naam, top_t = top[0], top[1], top[2] if len(top) > 2 else None

    # Eigen station
    eigen = next((x for x in max_lijst if x[1] == mijn_station), None)

    dag_str = f"{NL_DAGEN[dag.weekday()]} {dag.day} {NL_MAANDEN[dag.month]}"

    regels = []
    regels.append(f"🌡️ Temperatuur {dag_str}")
    regels.append("")

    top_tekst = f"Landelijk hoogste: {formatteer_temperatuur(top_val)}°C in {top_naam}"
    if top_t:
        top_tekst += f" (om {top_t})"
    regels.append(top_tekst)

    if eigen:
        eigen_val = eigen[0]
        eigen_t   = eigen[2] if len(eigen) > 2 else None
        eigen_tekst = f"{mijn_station}: {formatteer_temperatuur(eigen_val)}°C"
        if eigen_t:
            eigen_tekst += f" om {eigen_t}"
        regels.append(eigen_tekst)

    # Datum-uitersten Rotterdam Airport
    tx_hoog = datum_records.get("tx_hoog", [])
    tx_laag = datum_records.get("tx_laag", [])
    if tx_hoog or tx_laag:
        regels.append("")
        regels.append(f"Uitersten {dag.day} {NL_MAANDEN[dag.month]} (Rdam Airport):")
        if tx_hoog:
            hoog_val, hoog_jaar = tx_hoog[0][0], tx_hoog[0][1][:4]
            regels.append(f"  Hoogste TX ooit: {formatteer_temperatuur(hoog_val)}°C ({hoog_jaar})")
        if tx_laag:
            laag_val, laag_jaar = tx_laag[0][0], tx_laag[0][1][:4]
            regels.append(f"  Laagste TX ooit:  {formatteer_temperatuur(laag_val)}°C ({laag_jaar})")

    regels.append("")
    regels.append("#weer #Nederland #KNMI")

    return "\n".join(regels)


def post_naar_x(tekst: str, afbeelding: str, config: dict, droog: bool = False) -> None:
    try:
        import tweepy
    except ImportError:
        sys.exit("tweepy niet geïnstalleerd. Voer uit: pip install tweepy")

    print("=== Tweet tekst ===")
    print(tekst)
    print("==================")

    if droog:
        print("[DRY-RUN] Niet gepost.")
        return

    client = tweepy.Client(
        consumer_key=config["consumer_key"],
        consumer_secret=config["consumer_secret"],
        access_token=config["access_token"],
        access_token_secret=config["access_token_secret"],
    )
    # Media upload vereist v1.1 API
    auth = tweepy.OAuth1UserHandler(
        config["consumer_key"], config["consumer_secret"],
        config["access_token"], config["access_token_secret"]
    )
    api_v1 = tweepy.API(auth)

    if os.path.exists(afbeelding):
        media = api_v1.media_upload(filename=afbeelding)
        response = client.create_tweet(text=tekst, media_ids=[media.media_id])
    else:
        print(f"Waarschuwing: kaart niet gevonden ({afbeelding}), posten zonder afbeelding")
        response = client.create_tweet(text=tekst)

    print(f"Gepost! Tweet ID: {response.data['id']}")


# ── Main ──────────────────────────────────────────────────────────────────────

import argparse
parser = argparse.ArgumentParser()
parser.add_argument("--dry-run", action="store_true", help="Toon tweet zonder te posten")
parser.add_argument("--station", default="Rotterdam Airport", help="Eigen station in de tweet")
args = parser.parse_args()

dag = date.today()

with open(TOPLIJST) as f:
    toplijst = json.load(f)

with open(RECORD_RDAM) as f:
    records = json.load(f)

dag_data      = haal_vandaag_data(toplijst, dag)
datum_records = haal_datum_records(records, dag)
tekst         = stel_tekst_samen(dag, dag_data, datum_records, mijn_station=args.station)
config        = laad_config()

post_naar_x(tekst, KAART_TX, config, droog=args.dry_run)
