#!/usr/bin/env python3
"""Archiveer ECMWF IFS025-ensemble runs voor de pluim-trend pagina (#pluim6-trend).

Per station de laatste N geverifieerde runs (00, 06, 12 én 18 UTC) in één JSON:
weerlab/pluim_trend_<slug>.json. We bewaren de VOLLEDIGE 51 leden op de
native ECMWF-tijdstappen, plus neerslag, wind en bewolking, zodat de pagina echte
spaghetti-pluimen toont.

De live API levert de nieuwste beschikbare run. Daarom wordt eerst de officiële
Open-Meteo-modelmetadata gelezen en wordt alleen opgeslagen wanneer bronrun,
beschikbaarheid en de voor die cyclus geldige dekking aantoonbaar kloppen. De
00/12-hoofdruns zijn circa 15 dagen; de 06/18-tussenruns circa 6 dagen. Laat dit
script in het ochtendvenster iedere minuut pollen; iedere cyclus wordt maximaal eenmaal bewaard.

Structuur per bestand:
  { "schema":3, "station":"De Bilt", "slug":"debilt", "lat":..,"lon":..,
    "updated":"<ISO>",
    "runs":[                       # nieuwste eerst, max KEEP_RUNS
      { "run":"2026-06-30T12:00:00Z", "fetched":"<ISO>",
        "t0_ms":<epoch ms>, "times_ms":[...], "n":<aantal stappen>,
        "members":{                # per variabele [[..]x51], [0] = controle
          "temperature_2m":[..],   # °C
          "precipitation":[..],    # mm per voorafgaand native interval
          "wind_speed_10m":[..],   # km/u
          "cloud_cover":[..],      # totale bewolking in %
          ... },                   # alle overige ARCHIVE_BASES
        "temp_hres":[..],          # aparte ECMWF IFS HRES 9 km-run
        "precip_hres":[..] }       # zelfde ENS-tijdas, apart opgehaald
    ] }

Tot en met augustus 2026 stonden de zes kernvariabelen ook nog los in
`temp_members`/`precip_members`/`wind_members`/`cloud_members`/`gust_members`/
`cape_members`. Die arrays waren een exacte kopie van `members` en kostten in een
volledig dubbel bestand circa 37% van de omvang; ze worden niet meer geschreven.
Consumenten lezen `members` en houden alleen een fallback voor runs die nog uit
het oude archief komen.
"""
from __future__ import annotations
import argparse
import copy
import hashlib
import json
import math
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path

# Alle locaties uit de landelijke MOSMIX-feed: (kaartnaam, slug, lat, lon).
STATIONS = [
    ("Amsterdam", "amsterdam", 52.309, 4.781),
    ("Antwerpen", "antwerpen", 51.219, 4.405),
    ("Arcen", "arcen", 51.500, 6.196),
    ("Bocholt", "bocholt", 51.838, 6.617),
    ("Borkum", "borkum", 53.586, 6.749),
    ("Brussel", "brussel", 50.901, 4.484),
    ("De Bilt", "debilt", 52.101, 5.178),
    ("Deelen", "deelen", 52.060, 5.885),
    ("Den Helder", "denhelder", 52.928, 4.789),
    ("Dollart", "dollart", 53.230, 7.220),
    ("Groningen (Eelde)", "groningen", 53.123, 6.586),
    ("Eindhoven", "eindhoven", 51.451, 5.377),
    ("Enschede", "enschede", 52.275, 6.889),
    ("Geilenkirchen", "geilenkirchen", 50.967, 6.117),
    ("Gent", "gent", 51.054, 3.720),
    ("Gilze-Rijen", "gilzerijen", 51.567, 4.931),
    ("Hoek van Holland", "hoekvanholland", 51.978, 4.131),
    ("Hoogeveen", "hoogeveen", 52.730, 6.520),
    ("IJsselmeer", "ijsselmeer", 52.618, 5.433),
    ("Kleine Brogel", "kleinebrogel", 51.168, 5.470),
    ("Kleve", "kleve", 51.790, 6.140),
    ("Leeuwarden", "leeuwarden", 53.224, 5.774),
    ("Maastricht", "maastricht", 50.911, 5.770),
    ("Nettetal", "nettetal", 51.317, 6.276),
    ("Rotterdam", "rotterdam", 51.957, 4.437),
    ("Terschelling", "terschelling", 53.392, 5.350),
    ("Valkenburg", "valkenburg", 52.270, 4.417),
    ("Vlieland", "vlieland", 53.250, 4.920),
    ("Vlissingen", "vlissingen", 51.442, 3.596),
    ("Volkel", "volkel", 51.657, 5.707),
    ("Weeze", "weeze", 51.603, 6.141),
    ("Wielen", "wielen", 52.320, 6.450),
    ("Woensdrecht", "woensdrecht", 51.449, 4.342),
    # Vaste locaties uit de 6-luiken die niet in de landelijke MOSMIX-feed staan.
    ("Wateringen", "wateringen", 52.0244, 4.2867),
    ("Dordrecht", "dordrecht", 51.8133, 4.6900),
    ("Soestdijk", "soestdijk", 52.1797, 5.2872),
    ("Rhoon", "rhoon", 51.8650, 4.4267),
    ("Ridderkerk", "ridderkerk", 51.8722, 4.6075),
    ("Londen", "londen", 51.5074, -0.1278),
]

KEEP_RUNS = 8           # twee etmalen x 00/06/12/18
MIN_HORIZON_H = 360     # hoofdpluimen 00/12
SHORT_HORIZON_H = 144   # tussenpluimen 06/18
AVAILABILITY_GRACE_MIN = 10
MEMBER_COUNT = 51
CAPABILITY_MANIFEST_NAME = "pluim_archive_meta.json"
PUBLISHED_REVISION_STAMP = Path("/tmp/nl.edaldus.pluim-archive-published-revision")

# De site toont alle vier cycli. 00/12 zijn de 15-daagse hoofdruns; 06/18 zijn
# de kortere tussenruns tot +144 uur.
PUBLISHED_CYCLES = (0, 6, 12, 18)

CORE_BASES = (
    "temperature_2m", "precipitation", "wind_speed_10m", "cloud_cover",
)
DIRECT_CORE_BASES = CORE_BASES + (
    "wind_gusts_10m", "cape", "wind_direction_10m",
)
ARCHIVE_BASES = CORE_BASES + (
    "wind_gusts_10m", "cape", "wind_direction_10m", "temperature_850hPa",
    "temperature_500hPa", "geopotential_height_500hPa", "dew_point_2m",
    "relative_humidity_2m", "snowfall", "lifted_index", "weather_code",
)
# Open-Meteo exposeert momenteel wel 51 lifted-index-reeksen, maar vult ze voor
# IFS ENS volledig met null. Zo'n sleutel is geen capability en mag ook niet
# iedere minuut een nieuwe verrijkingspoging uitlokken. CAPE blijft wel direct
# beschikbaar; LI kan later weer aan deze set worden toegevoegd zodra de bron
# aantoonbaar eindige waarden levert.
ENRICHMENT_BASES = tuple(base for base in ARCHIVE_BASES if base != "lifted_index")

META_URL = "https://ensemble-api.open-meteo.com/data/ecmwf_ifs025_ensemble/static/meta.json"

ENS_URL = (
    "https://om.weerlab.nl/om/ensemble"
    "?latitude={lat}&longitude={lon}"
    "&hourly={hourly}"
    "&models=ecmwf_ifs025"
    "&start_hour={start}&end_hour={end}&timezone=GMT&wind_speed_unit=kmh"
    "&temporal_resolution=native"
)

HRES_URL = (
    "https://single-runs-api.open-meteo.com/v1/forecast"
    "?latitude={lat}&longitude={lon}"
    "&hourly=temperature_2m,precipitation"
    "&models=ecmwf_ifs"
    "&run={run}&forecast_days=16&timezone=GMT"
)

# Nieuwe runs dragen hun ensembledata alleen nog in `members`. De legacy-sleutels
# blijven hier staan omdat update_digest() ook draait op archiefruns die nog uit
# het oude formaat komen (enrich_run_hres); zonder die sleutels zou hun digest
# over lege data worden berekend. Voor nieuwe runs leveren ze simpelweg None.
DIGEST_KEYS = (
    "run", "times_ms", "temp_members", "temp_hres",
    "precip_members", "precip_hres", "wind_members", "cloud_members", "members",
)


def fetch_with_retry(url: str, tries: int = 4) -> dict:
    last_err: Exception | None = None
    for i in range(tries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "weerlab-pluimtrend/1.0"})
            with urllib.request.urlopen(req, timeout=60) as resp:
                return json.load(resp)
        except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError) as e:
            last_err = e
            time.sleep(1.5 * (i + 1))
    raise RuntimeError(f"Open-Meteo fetch faalde na {tries} pogingen: {last_err}")


def utc_from_epoch(value: object, field: str) -> datetime:
    try:
        return datetime.fromtimestamp(int(value), tz=timezone.utc)
    except (TypeError, ValueError, OSError) as exc:
        raise RuntimeError(f"Ongeldige Open-Meteo-metadata: {field}") from exc


def iso_z(dt: datetime) -> str:
    return dt.strftime("%Y-%m-%dT%H:%M:%SZ")


def parse_utc(iso: str) -> datetime:
    dt = datetime.fromisoformat(str(iso).replace("Z", "+00:00"))
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def epoch_ms(iso: str) -> int:
    dt = parse_utc(iso)
    return int(dt.timestamp() * 1000)


def member_keys(hourly: dict, base: str) -> list[str]:
    keys = [k for k in hourly.keys() if k == base or k.startswith(base + "_member")]
    # control (base) eerst, dan member01..N
    keys.sort(key=lambda k: -1 if k == base else int(k.rsplit("member", 1)[1]))
    return keys


def is_finite_number(value: object) -> bool:
    """True for JSON numbers that can safely be published as plume data."""
    return (
        isinstance(value, (int, float))
        and not isinstance(value, bool)
        and math.isfinite(value)
    )


def is_complete_matrix(matrix: object, n: int) -> bool:
    """Validate one 51-member matrix against an exact forecast-time count."""
    return (
        n >= 2
        and isinstance(matrix, list)
        and len(matrix) == MEMBER_COUNT
        and all(
            isinstance(row, list)
            and len(row) == n
            and all(is_finite_number(value) for value in row)
            for row in matrix
        )
    )


def minimum_horizon_hours(cycle: datetime) -> int:
    return MIN_HORIZON_H if cycle.hour in (0, 12) else min(MIN_HORIZON_H, SHORT_HORIZON_H)


def validate_hourly(hourly: dict, cycle: datetime) -> tuple[list[str], dict[str, list[str]]]:
    raw_times = hourly.get("time")
    if not isinstance(raw_times, list) or len(raw_times) < 2:
        raise RuntimeError("ENS-respons bevat geen geldige tijdas")
    candidate_keys = {base: member_keys(hourly, base) for base in ARCHIVE_BASES}
    missing_core = [base for base in CORE_BASES if len(candidate_keys[base]) != MEMBER_COUNT]
    if missing_core:
        raise RuntimeError(f"ENS-respons mist kernvariabelen: {', '.join(missing_core)}")

    core_lengths: set[int] = set()
    for base in CORE_BASES:
        keys = candidate_keys[base]
        for key in keys:
            if not isinstance(hourly.get(key), list):
                raise RuntimeError(f"{key}: onvolledige reeks")
            core_lengths.add(len(hourly[key]))
            if not all(is_finite_number(value) for value in hourly[key]):
                raise RuntimeError(f"{key}: bevat ontbrekende of niet-eindige kernwaarden")
    if len(core_lengths) != 1:
        raise RuntimeError(f"ENS-kernvariabelen hebben verschillende lengtes: {sorted(core_lengths)}")
    value_count = core_lengths.pop()
    if value_count < 2:
        raise RuntimeError("ENS-kernvariabelen bevatten te weinig tijdstappen")
    if len(raw_times) < value_count:
        raise RuntimeError("ENS-tijdas is korter dan de gegevensreeksen")
    # Bij native output geeft Open-Meteo soms ook de exclusieve rechtergrens in
    # `time`; de variabelen bepalen het werkelijk geldige aantal tijdstappen.
    times = raw_times[:value_count]
    hourly["time"] = times
    parsed = [parse_utc(value) for value in times]
    if parsed[0] != cycle:
        raise RuntimeError(f"ENS-respons start op {iso_z(parsed[0])}, verwacht {iso_z(cycle)}")
    if any(right <= left for left, right in zip(parsed, parsed[1:])):
        raise RuntimeError("ENS-tijdas is niet strikt oplopend")
    min_horizon = minimum_horizon_hours(cycle)
    if (parsed[-1] - cycle).total_seconds() < min_horizon * 3600:
        raise RuntimeError(f"ENS-horizon is slechts {(parsed[-1] - cycle).total_seconds()/3600:.0f} uur")

    # Specialistische velden zijn optioneel. Alleen een exact 51 x N matrix
    # met uitsluitend eindige waarden wordt meegenomen. Dit laat bijvoorbeeld
    # de door Open-Meteo volledig met null gevulde lifted_index bewust weg,
    # zonder een verder geldige run af te keuren.
    keys_by_base: dict[str, list[str]] = {}
    for base, keys in candidate_keys.items():
        valid = (
            len(keys) == MEMBER_COUNT
            and all(
                isinstance(hourly.get(key), list)
                and len(hourly[key]) == value_count
                and all(is_finite_number(value) for value in hourly[key])
                for key in keys
            )
        )
        if valid:
            keys_by_base[base] = keys
        elif base in CORE_BASES:
            # De eerdere controles horen iedere ongeldige kernmatrix al met een
            # preciezere fout af te vangen; deze guard houdt dat contract hard.
            raise RuntimeError(f"{base}: onvolledige kernmatrix")
    return times, keys_by_base


def align_hres_to_ens(hourly: dict, cycle: datetime, ens_times: list[str]) -> tuple[list[object], list[object]]:
    """Lijn een echte deterministische IFS-reeks exact uit op de ENS-tijdas.

    Temperatuur is een momentwaarde en wordt exact op het ENS-tijdstip
    gesampled. Single Runs levert neerslag per voorafgaand uur; voor iedere
    ENS-stap (3 of 6 uur) worden daarom alle uren sinds de vorige ENS-stap
    gesommeerd. Eén ontbrekend uur maakt de HRES-opvraag onvolledig.
    """
    raw_times = hourly.get("time")
    temperature = hourly.get("temperature_2m")
    precipitation = hourly.get("precipitation")
    if not isinstance(raw_times, list) or not isinstance(temperature, list) or not isinstance(precipitation, list):
        raise RuntimeError("HRES-respons bevat geen geldige tijdas/variabelen")
    if len(temperature) != len(precipitation) or len(temperature) < 2:
        raise RuntimeError("HRES-variabelen hebben verschillende of ongeldige lengtes")
    if len(raw_times) < len(temperature):
        raise RuntimeError("HRES-tijdas is korter dan de gegevensreeksen")

    source_times = raw_times[:len(temperature)]
    parsed = [parse_utc(value) for value in source_times]
    if parsed[0] != cycle:
        raise RuntimeError(f"HRES-respons start op {iso_z(parsed[0])}, verwacht {iso_z(cycle)}")
    if any(right <= left for left, right in zip(parsed, parsed[1:])):
        raise RuntimeError("HRES-tijdas is niet strikt oplopend")
    min_horizon = minimum_horizon_hours(cycle)
    if (parsed[-1] - cycle).total_seconds() < min_horizon * 3600:
        raise RuntimeError(f"HRES-horizon is slechts {(parsed[-1] - cycle).total_seconds()/3600:.0f} uur")

    target_ms = [epoch_ms(value) for value in ens_times]
    last_target_ms = target_ms[-1]
    relevant_times = [
        value for value in parsed
        if int(value.timestamp() * 1000) <= last_target_ms
    ]
    if any(right - left != timedelta(hours=1) for left, right in zip(relevant_times, relevant_times[1:])):
        raise RuntimeError("HRES-tijdas bevat ontbrekende uurstappen")

    source_index = {int(value.timestamp() * 1000): i for i, value in enumerate(parsed)}
    missing = [value for value in target_ms if value not in source_index]
    if missing:
        raise RuntimeError(f"HRES mist {len(missing)} van {len(target_ms)} ENS-tijdstappen")

    temp_aligned = [temperature[source_index[value]] for value in target_ms]
    # Temperatuur is een toestand en mag exact op de ENS-tijd worden
    # bemonsterd. Neerslag is daarentegen de som over het *voorafgaande*
    # HRES-uurinterval. IFS HRES levert hier uurlijkse stappen, terwijl de
    # ENS-as 3-uurlijks en later 6-uurlijks is. Som daarom alle complete
    # tussenliggende HRES-intervallen; alleen de eindwaarde pakken zou 2/3 tot
    # 5/6 van de neerslag verliezen.
    initial_precip = precipitation[source_index[target_ms[0]]]
    if initial_precip is not None and not math.isfinite(initial_precip):
        raise RuntimeError("HRES-neerslag op initialisatie is ongeldig")
    precip_aligned: list[object] = [initial_precip]
    for left_ms, right_ms in zip(target_ms, target_ms[1:]):
        hour_ms = 3_600_000
        if right_ms <= left_ms or (right_ms - left_ms) % hour_ms:
            raise RuntimeError("ENS-tijdas bevat een niet-geheel uurinterval")
        interval_times = range(left_ms + hour_ms, right_ms + hour_ms, hour_ms)
        missing_hours = [value for value in interval_times if value not in source_index]
        if missing_hours:
            raise RuntimeError(
                f"HRES-neerslag mist {len(missing_hours)} uurwaarden in een ENS-interval"
            )
        values = [precipitation[source_index[value]] for value in interval_times]
        if any(value is None or not math.isfinite(value) for value in values):
            raise RuntimeError("HRES-neerslag bevat ontbrekende uurwaarden")
        precip_aligned.append(sum(values))
    if any(value is None or not math.isfinite(value) for value in temp_aligned):
        raise RuntimeError("HRES-temperatuur bevat ontbrekende waarden op de ENS-tijdas")
    return temp_aligned, precip_aligned


def update_digest(payload: dict) -> None:
    digest_data = {key: payload.get(key) for key in DIGEST_KEYS}
    payload["data_sha256"] = hashlib.sha256(
        json.dumps(digest_data, separators=(",", ":")).encode()
    ).hexdigest()


def has_verified_hres(run: dict) -> bool:
    """Alleen een apart opgehaalde, volledig uitgelijnde IFS HRES telt mee."""
    try:
        n = int(run.get("n", 0))
    except (TypeError, ValueError):
        return False
    source = run.get("source") if isinstance(run.get("source"), dict) else {}
    hres_source = source.get("hres") if isinstance(source.get("hres"), dict) else {}
    precipitation_alignment = hres_source.get("precipitation_alignment")
    return (
        n > 0
        and hres_source.get("status") == "available"
        and hres_source.get("model") == "ecmwf_ifs"
        and precipitation_alignment in {
            "sum_preceding_hourly_intervals",
            "deaccumulated_native_intervals",
        }
        and len(run.get("temp_hres") or []) == n
        and len(run.get("precip_hres") or []) == n
    )


def degrade_hres(payload: dict, reason: str) -> None:
    """Behoud de geldige ENS-run, maar publiceer geen mogelijk gemengde HRES."""
    payload["temp_hres"] = []
    payload["precip_hres"] = []
    source = payload.setdefault("source", {})
    source["hres"] = {"status": "unavailable", "reason": reason}
    update_digest(payload)


def enrich_run_hres(run: dict, hres_response: dict) -> dict:
    """Voeg een exact gekozen HRES-run toe aan een al geverifieerde ENS-run.

    Deze route is bewust onafhankelijk van de *nieuwste* ENS-metadata. Daardoor
    kan een opgeslagen 00/12-run ook tijdens een latere 06/18-poll worden
    verrijkt, zonder de ensembledata opnieuw op te halen of cycli te mengen.
    """
    if not run.get("data_sha256"):
        raise RuntimeError("ENS-run mist verificatie-digest")
    try:
        n = int(run.get("n", 0))
        times_ms = [int(value) for value in run.get("times_ms", [])]
    except (TypeError, ValueError) as exc:
        raise RuntimeError("ENS-run bevat een ongeldige tijdas") from exc
    if n < 2 or len(times_ms) != n:
        raise RuntimeError("ENS-run bevat geen volledige tijdas")

    cycle = parse_utc(run.get("run", ""))
    ens_times = [
        iso_z(datetime.fromtimestamp(value / 1000, tz=timezone.utc))
        for value in times_ms
    ]
    temp_raw, precip_raw = align_hres_to_ens(
        hres_response.get("hourly", {}), cycle, ens_times
    )

    def r1(value: object) -> float | None:
        return None if value is None or not math.isfinite(value) else round(value, 1)

    def p3(value: object) -> float | None:
        return None if value is None or not math.isfinite(value) else round(max(0, value), 3)

    enriched = copy.deepcopy(run)
    enriched["temp_hres"] = [r1(value) for value in temp_raw]
    enriched["precip_hres"] = [p3(value) for value in precip_raw]
    source = enriched.setdefault("source", {})
    source["hres"] = {
        "status": "available",
        "model": "ecmwf_ifs",
        "product": "IFS HRES 9 km",
        "endpoint": "single-runs-api",
        "precipitation_alignment": "sum_preceding_hourly_intervals",
        "run_initialisation": iso_z(cycle),
        "fetched": iso_z(datetime.now(timezone.utc)),
        "grid_latitude": hres_response.get("latitude"),
        "grid_longitude": hres_response.get("longitude"),
        "grid_elevation": hres_response.get("elevation"),
    }
    update_digest(enriched)
    if not has_verified_hres(enriched):
        raise RuntimeError("HRES-verrijking is na validatie onvolledig")
    return enriched


def enrich_existing_hres(out_dir: Path, selected_slugs: set[str]) -> list[str]:
    """Verrijk per station maximaal de nieuwste nog missende archiefrun."""
    written: list[str] = []
    for name, slug, lat, lon in STATIONS:
        if selected_slugs and slug not in selected_slugs:
            continue
        path = out_dir / f"pluim_trend_{slug}.json"
        if not path.exists():
            continue
        try:
            doc = json.loads(path.read_text())
        except Exception as exc:
            print(f"  FOUT {name}: archief kan niet worden gelezen: {exc}", file=sys.stderr)
            continue
        runs = doc.get("runs") if isinstance(doc.get("runs"), list) else []
        missing_index = next(
            (
                index for index, run in enumerate(runs)
                if isinstance(run, dict)
                and run.get("data_sha256")
                and not has_verified_hres(run)
            ),
            None,
        )
        if missing_index is None:
            continue
        run = runs[missing_index]
        try:
            cycle = parse_utc(run.get("run", ""))
            # Single Runs levert IFS HRES voor alle vier de cycli; build_run()
            # haalt hem daar ook voor 06/18 op. Een cyclusfilter zou een
            # tussenrun blijvend onverrijkbaar maken en daarmee iedere latere
            # run in dit bestand blokkeren.
            if cycle.hour not in (0, 6, 12, 18) or cycle.minute != 0:
                raise RuntimeError("archiefrun heeft geen geldige ECMWF-cyclus")
            hres = fetch_with_retry(
                HRES_URL.format(
                    lat=lat,
                    lon=lon,
                    run=cycle.strftime("%Y-%m-%dT%H:%M"),
                )
            )
            runs[missing_index] = enrich_run_hres(run, hres)
        except Exception as exc:
            print(f"  WAARSCHUWING {name}: HRES-verrijking faalde: {exc}", file=sys.stderr)
            continue

        doc["schema"] = 3
        doc["updated"] = iso_z(datetime.now(timezone.utc))
        tmp_path = path.with_suffix(path.suffix + ".tmp")
        tmp_path.write_text(json.dumps(doc, separators=(",", ":")))
        tmp_path.replace(path)
        written.append(str(path))
        print(f"  OK {name}: {run['run']} verrijkt met aparte IFS HRES 9 km")
    return written


def rounded_members(hourly: dict, keys_by_base: dict[str, list[str]]) -> dict[str, list[list[float]]]:
    """Convert validated Open-Meteo series to the compact archive precision."""
    members: dict[str, list[list[float]]] = {}
    for base, keys in keys_by_base.items():
        if base in ("precipitation", "snowfall"):
            members[base] = [
                [round(max(0, value), 3) for value in hourly[key]]
                for key in keys
            ]
        elif base in ("cloud_cover", "relative_humidity_2m"):
            members[base] = [
                [round(max(0, min(100, value)), 1) for value in hourly[key]]
                for key in keys
            ]
        else:
            members[base] = [
                [round(value, 1) for value in hourly[key]]
                for key in keys
            ]
    return members


LEGACY_MEMBER_FIELDS = {
    "temperature_2m": "temp_members",
    "precipitation": "precip_members",
    "wind_speed_10m": "wind_members",
    "cloud_cover": "cloud_members",
    "wind_gusts_10m": "gust_members",
    "cape": "cape_members",
}


def matrix_for_run(run: dict, base: str) -> object:
    members = run.get("members") if isinstance(run.get("members"), dict) else {}
    if base in members:
        return members[base]
    legacy = LEGACY_MEMBER_FIELDS.get(base)
    return run.get(legacy) if legacy else None


def run_time_axis(run: dict) -> list[int] | None:
    """Return a strictly increasing, internally consistent archive time axis."""
    raw_times = run.get("times_ms")
    try:
        n = int(run.get("n", 0))
    except (TypeError, ValueError):
        return None
    if (
        n < 2
        or not isinstance(raw_times, list)
        or len(raw_times) != n
        or any(isinstance(value, bool) for value in raw_times)
    ):
        return None
    try:
        times = [int(value) for value in raw_times]
    except (TypeError, ValueError, OverflowError):
        return None
    if any(right <= left for left, right in zip(times, times[1:])):
        return None
    return times


def complete_run_fields(run: dict) -> list[str]:
    """Capabilities backed by a complete finite 51 x N matrix in this run."""
    times = run_time_axis(run)
    if times is None:
        return []
    return [
        base for base in ARCHIVE_BASES
        if is_complete_matrix(matrix_for_run(run, base), len(times))
    ]


def is_all_null_matrix(matrix: object, n: int) -> bool:
    return (
        n >= 2
        and isinstance(matrix, list)
        and len(matrix) == MEMBER_COUNT
        and all(
            isinstance(row, list)
            and len(row) == n
            and all(value is None for value in row)
            for row in matrix
        )
    )


def sanitize_null_lifted_index_archives(
    out_dir: Path,
    selected_slugs: set[str],
) -> list[str]:
    """Remove legacy 51 x N all-null LI matrices without an OM request."""
    candidates: list[tuple[Path, dict, str, int]] = []
    for name, slug, _lat, _lon in STATIONS:
        if selected_slugs and slug not in selected_slugs:
            continue
        path = out_dir / f"pluim_trend_{slug}.json"
        if not path.exists():
            continue
        try:
            document = json.loads(path.read_text())
        except (OSError, ValueError, TypeError) as exc:
            print(f"  WAARSCHUWING {name}: LI-opschoning kon archief niet lezen: {exc}", file=sys.stderr)
            continue
        # Schema 1/2-runs zijn nooit door deze archiefvalidator ondertekend en
        # mogen door een cosmetische LI-opruiming niet alsnog schema 3 of een
        # verificatie-digest krijgen. Ook een unsigned schema-3-run blijft
        # bewust onaangeroerd.
        if not isinstance(document, dict) or document.get("schema") != 3:
            continue
        runs = document.get("runs") if isinstance(document.get("runs"), list) else []
        cleaned = 0
        for run in runs:
            if not isinstance(run, dict) or not is_sha256(run.get("data_sha256")):
                continue
            times = run_time_axis(run)
            members = run.get("members") if isinstance(run.get("members"), dict) else {}
            if (
                times is not None
                and "lifted_index" in members
                and is_all_null_matrix(members["lifted_index"], len(times))
            ):
                del members["lifted_index"]
                update_digest(run)
                cleaned += 1
        if cleaned:
            document["updated"] = iso_z(datetime.now(timezone.utc))
            candidates.append((path, document, name, cleaned))

    written: list[str] = []
    for path, document, name, cleaned in candidates:
        tmp_path = path.with_suffix(path.suffix + ".tmp")
        tmp_path.write_text(json.dumps(document, separators=(",", ":"), allow_nan=False))
        tmp_path.replace(path)
        written.append(str(path))
        print(f"  OK {name}: volledig-null lifted_index uit {cleaned} run(s) verwijderd")
    return written


def run_needs_ensemble_enrichment(run: dict) -> bool:
    fields = set(complete_run_fields(run))
    return not set(ENRICHMENT_BASES).issubset(fields)


def enrich_run_ensemble(
    run: dict,
    hourly_ens: dict,
    run_iso: str,
    grid_meta: dict,
) -> tuple[dict, list[str]]:
    """Merge only missing same-cycle OM matrices onto the existing time axis.

    Existing complete matrices are never replaced. This is important for the
    direct ECMWF core: Open-Meteo is an eventual, same-run enrichment source,
    not a new authority for values already published from ECMWF Open Data.
    """
    if not run.get("data_sha256"):
        raise RuntimeError("archiefrun mist verificatie-digest")
    try:
        if parse_utc(run.get("run", "")) != parse_utc(run_iso):
            raise RuntimeError("OM-verrijking hoort bij een andere bronrun")
    except (TypeError, ValueError) as exc:
        raise RuntimeError("archiefrun heeft een ongeldige bronrun") from exc

    target_times = run_time_axis(run)
    if target_times is None:
        raise RuntimeError("archiefrun bevat geen volledige tijdas")
    if target_times[0] != epoch_ms(run_iso):
        raise RuntimeError("archiefrun start niet op zijn initialisatietijd")
    existing_source = run.get("source") if isinstance(run.get("source"), dict) else {}
    is_direct_ecmwf = (
        existing_source.get("provider") == "ECMWF Open Data"
        or existing_source.get("endpoint") == "data.ecmwf.int"
        or existing_source.get("access") == "direct_grib2_range_requests"
    )
    required_existing = DIRECT_CORE_BASES if is_direct_ecmwf else CORE_BASES
    missing_core = [
        base for base in required_existing
        if not is_complete_matrix(matrix_for_run(run, base), len(target_times))
    ]
    if missing_core:
        raise RuntimeError(
            "archiefrun mist een geldige kernmatrix: " + ", ".join(missing_core)
        )

    source_times, keys_by_base = validate_hourly(hourly_ens, parse_utc(run_iso))
    source_times_ms = [epoch_ms(value) for value in source_times]
    source_index = {value: index for index, value in enumerate(source_times_ms)}
    if len(source_index) != len(source_times_ms):
        raise RuntimeError("OM-verrijking bevat dubbele tijdstappen")
    missing_times = [value for value in target_times if value not in source_index]
    if missing_times:
        raise RuntimeError(
            f"OM-verrijking mist {len(missing_times)} bestaande archieftijdstappen"
        )
    indices = [source_index[value] for value in target_times]
    source_members = rounded_members(hourly_ens, keys_by_base)

    enriched = copy.deepcopy(run)
    members = enriched.get("members")
    if not isinstance(members, dict):
        members = {}
        enriched["members"] = members

    added: list[str] = []
    for base in ENRICHMENT_BASES:
        # Never overwrite a complete direct or previously enriched matrix.
        if is_complete_matrix(matrix_for_run(enriched, base), len(target_times)):
            continue
        source_matrix = source_members.get(base)
        if not is_complete_matrix(source_matrix, len(source_times_ms)):
            continue
        aligned = [[row[index] for index in indices] for row in source_matrix]
        if not is_complete_matrix(aligned, len(target_times)):
            raise RuntimeError(f"{base}: uitgelijnde OM-matrix is onvolledig")
        members[base] = aligned
        added.append(base)

    # Older OM archives may contain a 51 x N lifted-index matrix consisting
    # entirely of nulls. It must not masquerade as a capability or survive a
    # same-run rewrite.
    removed_lifted_index = (
        "lifted_index" in members
        and not is_complete_matrix(members.get("lifted_index"), len(target_times))
    )
    if removed_lifted_index:
        del members["lifted_index"]

    if added:
        source = enriched.get("source")
        if not isinstance(source, dict):
            source = {}
            enriched["source"] = source
        previous_enrichment = (
            source.get("enrichment")
            if isinstance(source.get("enrichment"), dict)
            else {}
        )
        previous_fields = previous_enrichment.get("fields_added")
        previous_field_set = {
            field for field in previous_fields
            if isinstance(field, str)
        } if isinstance(previous_fields, list) else set()
        merged_fields = [
            base for base in ENRICHMENT_BASES
            if base in previous_field_set or base in added
        ]
        source["enrichment"] = {
            "status": "available",
            "provider": "Open-Meteo",
            "model": "ecmwf_ifs025_ensemble",
            "endpoint": "om.weerlab.nl/om/ensemble",
            "run_initialisation": run_iso,
            "aligned_to_existing_times": True,
            "fields_added": merged_fields,
            "fetched": iso_z(datetime.now(timezone.utc)),
            "grid_latitude": grid_meta.get("latitude"),
            "grid_longitude": grid_meta.get("longitude"),
            "grid_elevation": grid_meta.get("elevation"),
        }

    if added or removed_lifted_index:
        update_digest(enriched)
    return enriched, added


def build_run(
    hourly_ens: dict,
    run_iso: str,
    source_meta: dict,
    grid_meta: dict,
    hres_response: dict | None = None,
    hres_error: str | None = None,
) -> dict:
    cycle = parse_utc(run_iso)
    times, keys_by_base = validate_hourly(hourly_ens, cycle)
    times = hourly_ens["time"]
    n = len(times)

    # leden eerst = controle (base key), zodat index 0 = controle/ongestoord
    members = rounded_members(hourly_ens, keys_by_base)

    temp_hres: list[object] = []
    precip_hres: list[object] = []
    if hres_response is not None:
        hres_temp_raw, hres_precip_raw = align_hres_to_ens(hres_response.get("hourly", {}), cycle, times)
        temp_hres = [None if value is None else round(value, 1) for value in hres_temp_raw]
        precip_hres = [None if value is None else round(max(0, value), 3) for value in hres_precip_raw]

    times_ms = [epoch_ms(value) for value in times]
    steps_h = sorted({round((right - left) / 3_600_000, 6) for left, right in zip(times_ms, times_ms[1:])})
    payload = {
        "run": run_iso,
        "fetched": iso_z(datetime.now(timezone.utc)),
        "t0_ms": times_ms[0],
        "times_ms": times_ms,
        "n": n,
        "step_h": steps_h[0] if len(steps_h) == 1 else None,
        "step_hours": steps_h,
        "temp_hres": temp_hres,        # apart deterministisch IFS025-traject
        "precip_hres": precip_hres,
        "members": members,            # per variabele [0] = controle
        "source": {
            "model": "ecmwf_ifs025_ensemble",
            "run_initialisation": run_iso,
            "availability": iso_z(utc_from_epoch(source_meta.get("last_run_availability_time"), "last_run_availability_time")),
            "data_end": iso_z(utc_from_epoch(source_meta.get("data_end_time"), "data_end_time")),
            "grid_latitude": grid_meta.get("latitude"),
            "grid_longitude": grid_meta.get("longitude"),
            "grid_elevation": grid_meta.get("elevation"),
            "hres": (
                {
                    "status": "available",
                    "model": "ecmwf_ifs",
                    "product": "IFS HRES 9 km",
                    "endpoint": "single-runs-api",
                    "precipitation_alignment": "sum_preceding_hourly_intervals",
                    "run_initialisation": run_iso,
                    "grid_latitude": hres_response.get("latitude"),
                    "grid_longitude": hres_response.get("longitude"),
                    "grid_elevation": hres_response.get("elevation"),
                }
                if hres_response is not None
                else {"status": "unavailable", "reason": hres_error or "HRES niet opgehaald"}
            ),
        },
    }
    update_digest(payload)
    return payload


def is_sha256(value: object) -> bool:
    return (
        isinstance(value, str)
        and len(value) == 64
        and all(char in "0123456789abcdef" for char in value.lower())
    )


def canonical_sha256(value: object) -> str:
    return hashlib.sha256(
        json.dumps(value, sort_keys=True, separators=(",", ":")).encode()
    ).hexdigest()


def build_capability_payload(
    out_dir: Path,
    stations: list[tuple[str, str, float, float]] | None = None,
) -> dict:
    """Derive archive capabilities from every locally complete station file."""
    expected_stations = STATIONS if stations is None else stations
    station_docs: dict[str, dict] = {}
    for _name, slug, _lat, _lon in expected_stations:
        path = out_dir / f"pluim_trend_{slug}.json"
        try:
            doc = json.loads(path.read_text())
        except (OSError, ValueError, TypeError):
            continue
        if (
            not isinstance(doc, dict)
            or doc.get("schema") != 3
            or doc.get("slug") != slug
            or not isinstance(doc.get("runs"), list)
        ):
            continue
        station_docs[slug] = doc

    expected_count = len(expected_stations)
    station_count = len(station_docs)
    runs_out: list[dict] = []
    if station_count == expected_count and expected_count:
        runs_by_station: dict[str, dict[str, dict]] = {}
        for slug, doc in station_docs.items():
            valid_runs: dict[str, dict] = {}
            for run in doc["runs"]:
                if not isinstance(run, dict) or not is_sha256(run.get("data_sha256")):
                    continue
                try:
                    run_iso = iso_z(parse_utc(run.get("run", "")))
                except (TypeError, ValueError):
                    continue
                if run_iso != run.get("run") or run_iso in valid_runs:
                    continue
                valid_runs[run_iso] = run
            runs_by_station[slug] = valid_runs

        common_runs = set.intersection(
            *(set(runs) for runs in runs_by_station.values())
        ) if runs_by_station else set()
        for run_iso in sorted(common_runs, key=parse_utc, reverse=True):
            station_runs = [runs_by_station[slug][run_iso] for slug in sorted(runs_by_station)]
            time_axes = [run_time_axis(run) for run in station_runs]
            same_times = (
                all(times is not None for times in time_axes)
                and all(times == time_axes[0] for times in time_axes[1:])
            )
            field_sets = [set(complete_run_fields(run)) for run in station_runs]
            fields = [
                base for base in ARCHIVE_BASES
                if all(base in station_fields for station_fields in field_sets)
            ]
            complete = (
                same_times
                and set(CORE_BASES).issubset(fields)
                and len(station_runs) == expected_count
            )
            digests = {
                slug: runs_by_station[slug][run_iso]["data_sha256"]
                for slug in sorted(runs_by_station)
            }
            runs_out.append({
                "run": run_iso,
                "fields": fields,
                "complete": complete,
                "station_count": len(station_runs),
                "member_count": MEMBER_COUNT,
                "data_sha256": canonical_sha256(digests),
            })

    semantic = {
        "schema": 1,
        "complete": (
            station_count == expected_count
            and any(run["complete"] for run in runs_out)
        ),
        "station_count": station_count,
        "member_count": MEMBER_COUNT,
        "runs": runs_out,
    }
    semantic["revision"] = canonical_sha256(semantic)
    return semantic


def write_capability_manifest(
    out_dir: Path,
    stations: list[tuple[str, str, float, float]] | None = None,
) -> Path | None:
    """Atomically write a changed manifest; unchanged content is a no-op."""
    semantic = build_capability_payload(out_dir, stations=stations)
    path = out_dir / CAPABILITY_MANIFEST_NAME
    existing: dict | None = None
    try:
        candidate = json.loads(path.read_text())
        if isinstance(candidate, dict):
            existing = candidate
    except (OSError, ValueError, TypeError):
        pass

    if existing is not None:
        existing_semantic = {
            key: existing.get(key)
            for key in ("schema", "complete", "station_count", "member_count", "runs")
        }
        existing_revision = canonical_sha256(existing_semantic)
        try:
            updated_is_valid = (
                isinstance(existing.get("updated"), str)
                and iso_z(parse_utc(existing["updated"])) == existing["updated"]
            )
        except (TypeError, ValueError):
            updated_is_valid = False
        if (
            updated_is_valid
            and existing.get("revision") == semantic["revision"]
            and existing_revision == semantic["revision"]
        ):
            return None

    manifest = {
        "schema": semantic["schema"],
        "complete": semantic["complete"],
        "station_count": semantic["station_count"],
        "member_count": semantic["member_count"],
        "updated": iso_z(datetime.now(timezone.utc)),
        "revision": semantic["revision"],
        "runs": semantic["runs"],
    }
    tmp_path = path.with_suffix(path.suffix + ".tmp")
    tmp_path.write_text(json.dumps(manifest, separators=(",", ":")))
    tmp_path.replace(path)
    return path


def finish_with_manifest(
    out_dir: Path,
    written: list[str],
    published_revision_path: Path | None = None,
) -> int:
    """Emit changed archive paths with the atomic capability manifest last."""
    try:
        manifest_path = write_capability_manifest(out_dir)
    except Exception as exc:
        print(f"Capability-manifest kon niet worden gebouwd: {exc}", file=sys.stderr)
        return 1
    local_manifest_path = out_dir / CAPABILITY_MANIFEST_NAME
    stamp_path = published_revision_path or PUBLISHED_REVISION_STAMP
    try:
        local_manifest = json.loads(local_manifest_path.read_text())
        local_revision = local_manifest.get("revision")
        if not is_sha256(local_revision):
            raise ValueError("ongeldige lokale manifestrevision")
    except (OSError, ValueError, TypeError, AttributeError) as exc:
        print(f"Capability-manifest kan niet worden gepubliceerd: {exc}", file=sys.stderr)
        return 1
    try:
        published_revision = stamp_path.read_text().strip()
    except OSError:
        published_revision = ""
    # Een lokaal ongewijzigd manifest is pas echt een no-op als de shell die
    # revision na een geslaagde R2-upload heeft afgestempeld. Bij een crash of
    # uploadfout blijft de stamp oud/afwezig en wordt de hele veilige batch
    # opnieuw aangeboden.
    if manifest_path is None and published_revision != local_revision:
        manifest_path = local_manifest_path
    if manifest_path is not None:
        manifest = str(manifest_path)
        # Een revision change kan ook een crash uit de vorige poll herstellen:
        # enkele lokale stationfiles kunnen toen al vervangen zijn zonder ooit
        # in een WRITTEN-regel/R2-upload te belanden. Publiceer daarom bij elke
        # gewijzigde revision conservatief alle bestaande stationarchieven en
        # pas daarna het manifest. Bij ongewijzigde inhoud is dit pad een no-op.
        all_station_paths = [
            str(path)
            for _name, slug, _lat, _lon in STATIONS
            for path in (out_dir / f"pluim_trend_{slug}.json",)
            if path.exists()
        ]
        ordered = all_station_paths + [path for path in written if path != manifest]
        written = list(dict.fromkeys(ordered))
        written.append(manifest)
    if written:
        print("WRITTEN:" + " ".join(written))
    else:
        print("Niets geschreven.")
    return 0


def main(argv: list[str]) -> int:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--dir", default="/Users/aldus/KNMI_Project/weerlab")
    p.add_argument("--keep", type=int, default=KEEP_RUNS)
    p.add_argument("--force", action="store_true", help="ook ophalen als run al gearchiveerd is")
    p.add_argument("--slug", action="append", help="beperk handmatige run tot één of meer plaats-slugs")
    args = p.parse_args(argv)
    out_dir = Path(args.dir)
    selected_slugs = set(args.slug or [])

    # De native Europese IFS-ENS-run komt via ECMWF pre-scheduled delivery
    # doorgaans ruim vóór de publieke 0,25°-distributie binnen. Publiceer die
    # exact gepinde 00Z/06Z-run eerst; de latere directe GRIB2-run mag hetzelfde
    # run-id daarna atomair vervangen. Handmatige --slug-runs slaan dit
    # all-stationspad over, omdat een capabilitymanifest altijd 39/39 vereist.
    if not selected_slugs:
        try:
            from ecmwf_pluim_early import try_early_run

            early_written = try_early_run(out_dir, keep=args.keep)
        except Exception as exc:
            # Een tijdelijke vroege-bronfout mag de bestaande 0,25°-poller niet
            # blokkeren. De early-producent schrijft vóór deze catch niets als
            # één locatie, lid, veld of runmeta de validatie niet doorstaat.
            print(f"Vroege ECMWF-pluim nog niet bruikbaar: {exc}", file=sys.stderr)
        else:
            if early_written:
                print(
                    f"Vroege ECMWF-run atomair voorbereid voor "
                    f"{len(early_written)} stations"
                )
                return finish_with_manifest(out_dir, early_written)

    now = datetime.now(timezone.utc)
    try:
        source_meta = fetch_with_retry(META_URL)
        cycle = utc_from_epoch(source_meta.get("last_run_initialisation_time"), "last_run_initialisation_time")
        availability = utc_from_epoch(source_meta.get("last_run_availability_time"), "last_run_availability_time")
        data_end = utc_from_epoch(source_meta.get("data_end_time"), "data_end_time")
    except Exception as exc:
        print(f"Metadatafout: {exc}", file=sys.stderr)
        return 1
    if cycle.hour not in (0, 6, 12, 18) or cycle.minute != 0:
        print(f"[{iso_z(now)}] ongeldige ECMWF-cyclus {iso_z(cycle)}", file=sys.stderr)
        return 1
    if cycle.hour not in PUBLISHED_CYCLES:
        # Staat de bron op een tussenrun, dan valt er niets te archiveren. Alleen
        # een al opgeslagen run waarvan de losse HRES-lijn nog ontbrak wordt
        # bijgewerkt; dat kost één kleine opvraag per station.
        print(f"[{iso_z(now)}] bronrun {iso_z(cycle)} is een 06/18-tussenrun — niet gearchiveerd")
        repaired = enrich_existing_hres(out_dir, selected_slugs)
        return finish_with_manifest(out_dir, repaired)
    if now < availability + timedelta(minutes=AVAILABILITY_GRACE_MIN):
        print(f"[{iso_z(now)}] bronrun {iso_z(cycle)} is nog niet 10 minuten stabiel — later opnieuw")
        return 0
    min_horizon = minimum_horizon_hours(cycle)
    if (data_end - cycle).total_seconds() < min_horizon * 3600:
        print(f"[{iso_z(now)}] bronrun {iso_z(cycle)} is nog onvolledig ({(data_end-cycle).total_seconds()/3600:.0f} uur) — later opnieuw")
        return 0
    run_iso = iso_z(cycle)
    start = cycle.strftime("%Y-%m-%dT%H:%M")
    end = data_end.strftime("%Y-%m-%dT%H:%M")
    print(f"[{iso_z(now)}] pluim_trend_cache: geverifieerde bronrun {run_iso}")

    # HRES komt uit de Single Runs API. De run-parameter selecteert exact
    # dezelfde cyclus als ENS; zo kan een nieuwere HRES nooit per
    # ongeluk in een oudere ensemblepluim terechtkomen.
    hres_run = cycle.strftime("%Y-%m-%dT%H:%M")

    written = []
    candidates = []
    ensemble_batch_needed = 0
    ensemble_batch_completed = 0
    for name, slug, lat, lon in STATIONS:
        if selected_slugs and slug not in selected_slugs:
            continue
        path = out_dir / f"pluim_trend_{slug}.json"
        doc = {}
        if path.exists():
            try:
                doc = json.loads(path.read_text())
            except Exception:
                doc = {}
        # Schema 1/2-runs werden op een gegokte cyclus geplakt en kunnen data
        # van verschillende bronruns bevatten. Neem uitsluitend eerder door
        # deze validator ondertekende runs mee in het nieuwe archief.
        runs = [
            run for run in doc.get("runs", [])
            if isinstance(run, dict) and run.get("data_sha256")
        ]

        existing_run = next((run for run in runs if run.get("run") == run_iso), None)

        needs_ensemble = (
            existing_run is not None
            and run_needs_ensemble_enrichment(existing_run)
        )
        if existing_run is not None and not needs_ensemble:
            if has_verified_hres(existing_run):
                print(f"  {name}: run {run_iso} volledig verrijkt — skip")
            else:
                print(f"  {name}: ensemble compleet; alleen HRES-verrijking nodig")
            continue
        ensemble_batch_needed += 1
        try:
            ens = fetch_with_retry(ENS_URL.format(
                lat=lat, lon=lon, start=start, end=end,
                hourly=",".join(ENRICHMENT_BASES),
            ))
        except Exception as e:
            print(f"  FOUT {name}: {e}", file=sys.stderr)
            continue
        h_ens = ens.get("hourly", {})
        if not h_ens.get("time"):
            print(f"  Geen ENS-data {name}", file=sys.stderr)
            continue
        ntemp = len([k for k in h_ens if k == "temperature_2m" or k.startswith("temperature_2m_member")])

        if existing_run is not None:
            try:
                run_obj, added_fields = enrich_run_ensemble(
                    existing_run,
                    h_ens,
                    run_iso,
                    ens,
                )
            except Exception as exc:
                print(f"  FOUT {name}: same-run OM-verrijking mislukt: {exc}", file=sys.stderr)
                continue
            if run_obj.get("data_sha256") == existing_run.get("data_sha256"):
                print(f"  {name}: OM heeft nog geen nieuwe volledige specialistmatrices")
                continue
            runs = [r for r in runs if r.get("run") != run_iso]
            runs.insert(0, run_obj)
            runs = runs[: args.keep]
            out = {
                "schema": 3, "station": name, "slug": slug, "lat": lat, "lon": lon,
                "updated": iso_z(datetime.now(timezone.utc)), "runs": runs,
            }
            candidates.append((path, out, name, ntemp, run_obj, added_fields))
            ensemble_batch_completed += 1
            continue

        hres = None
        station_hres_error = None
        try:
            hres = fetch_with_retry(HRES_URL.format(lat=lat,lon=lon,run=hres_run))
            if not hres.get("hourly", {}).get("time"):
                raise RuntimeError("HRES-respons bevat geen tijdas")
        except Exception as exc:
            station_hres_error = str(exc)
            hres = None
            print(f"  WAARSCHUWING {name}: HRES-opvraag faalde: {exc}", file=sys.stderr)

        try:
            run_obj = build_run(
                h_ens,
                run_iso,
                source_meta,
                ens,
                hres_response=hres,
                hres_error=station_hres_error,
            )
        except Exception as exc:
            if hres is not None:
                # Een onvolledige of verkeerd uitgelijnde HRES mag nooit als
                # operationele lijn verschijnen. Archiveer de ENS wel en laat
                # een volgende poll dezelfde run opnieuw proberen te verrijken.
                print(f"  WAARSCHUWING {name}: HRES-validatie faalde: {exc}", file=sys.stderr)
                try:
                    run_obj = build_run(
                        h_ens,
                        run_iso,
                        source_meta,
                        ens,
                        hres_error=str(exc),
                    )
                except Exception as ens_exc:
                    print(f"  FOUT {name}: ENS-validatie mislukt: {ens_exc}", file=sys.stderr)
                    continue
            else:
                print(f"  FOUT {name}: ENS-validatie mislukt: {exc}", file=sys.stderr)
                continue
        # nieuwste vooraan, dedup op run, trim
        runs = [r for r in runs if r.get("run") != run_iso]
        runs.insert(0, run_obj)
        runs = runs[: args.keep]

        out = {
            "schema": 3, "station": name, "slug": slug, "lat": lat, "lon": lon,
            "updated": iso_z(datetime.now(timezone.utc)), "runs": runs,
        }
        candidates.append((path, out, name, ntemp, run_obj, []))
        ensemble_batch_completed += 1

    if ensemble_batch_completed != ensemble_batch_needed:
        if candidates:
            print(
                "ENS/OM-batch niet volledig; geen enkel stationarchief vervangen "
                f"({ensemble_batch_completed}/{ensemble_batch_needed})",
                file=sys.stderr,
            )
        candidates = []

    if candidates:
        # Eén metadata-hercontrole na de hele batch voorkomt tientallen extra
        # metadatarequests (en daarmee 429's), terwijl nog geen enkel bestand
        # is vervangen als de bronrun tijdens de downloads wisselde.
        try:
            meta_after = fetch_with_retry(META_URL)
        except Exception as exc:
            # De OM-response noemt geen initialisatie-id; start_hour is alleen
            # een geldige tijd. Zonder deze afsluitende metadata-bracket kan een
            # bronwissel tijdens de batch daarom niet worden uitgesloten. Fail
            # closed: de volgende poll kan exact dezelfde verrijking herhalen.
            print(f"Batch afgekeurd: metadata-hercontrole faalde ({exc})", file=sys.stderr)
            return 1
        else:
            if meta_after.get("last_run_initialisation_time") != source_meta.get("last_run_initialisation_time"):
                print("Batch afgekeurd: bronrun wisselde tijdens de download", file=sys.stderr)
                return 1

    for path, out, name, ntemp, run_obj, added_fields in candidates:
        tmp_path = path.with_suffix(path.suffix + ".tmp")
        tmp_path.write_text(json.dumps(out, separators=(",", ":")))
        tmp_path.replace(path)
        written.append(str(path))
        hres_label = "HRES uitgelijnd" if has_verified_hres(run_obj) else "zonder HRES"
        enrichment_label = (
            f", OM same-run +{len(added_fields)} velden"
            if added_fields else ""
        )
        print(f"  OK {name}: {ntemp} leden, {run_obj['n']} native stappen, {hres_label}{enrichment_label}, {len(out['runs'])} runs, {path.stat().st_size//1024} KB")

    # Runs die al in het archief staan maar nog zonder losse HRES-lijn worden
    # met één kleine Single-Runs-opvraag per station bijgewerkt; de ensembledata
    # blijven ongemoeid. Zo herstelt een tijdelijk uitgevallen HRES zichzelf
    # zonder de volledige ENS-batch opnieuw te downloaden.
    for path_str in enrich_existing_hres(out_dir, selected_slugs):
        if path_str not in written:
            written.append(path_str)

    # Historische Open-Meteo-runs bevatten soms een syntactisch volledige maar
    # inhoudelijk waardeloze LI-matrix met uitsluitend null. Verwijder die ook
    # als de actuele run verder al volledig is en de netwerkmerge dus skipt.
    for path_str in sanitize_null_lifted_index_archives(out_dir, selected_slugs):
        if path_str not in written:
            written.append(path_str)

    # Ook wanneer iedere stationrun al compleet was, wordt een ontbrekend of
    # verouderd capability-manifest uit de bestaande 39 archieven opgebouwd.
    # Een inhoudelijk ongewijzigd manifest is een no-op en wordt dus niet elke
    # minuut opnieuw geüpload.
    return finish_with_manifest(out_dir, written)


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
