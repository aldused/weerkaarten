import copy
import json
import sys
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "shell"))

import ecmwf_pluim_early as early  # noqa: E402
import pluim_trend_cache as trend  # noqa: E402


def native_times(cycle: datetime) -> list[datetime]:
    return (
        [cycle + timedelta(hours=hour) for hour in range(0, 91)]
        + [cycle + timedelta(hours=hour) for hour in range(93, 145, 3)]
        + [cycle + timedelta(hours=hour) for hour in range(150, 361, 6)]
    )


def meta_document(cycle: datetime) -> dict:
    return {
        "created_at": trend.iso_z(cycle + timedelta(hours=7, minutes=3)),
        "reference_time": trend.iso_z(cycle),
        "temporal_resolution_seconds": 3600,
        "valid_times": [value.strftime("%Y-%m-%dT%H:%MZ") for value in native_times(cycle)],
        "variables": sorted(early.REQUIRED_NATIVE_VARIABLES),
    }


def point_response(cycle: datetime, member_count: int = 51) -> dict:
    times = [cycle + timedelta(hours=hour) for hour in range(361)]
    hourly = {"time": [trend.iso_z(value) for value in times]}
    for base in early.EARLY_FIELDS:
        for member in range(member_count):
            key = base if member == 0 else f"{base}_member{member:02d}"
            if base == "precipitation":
                values = [None] + [1.0 + member / 100] * 360
            elif base == "snowfall":
                values = [None] + [0.1] * 360
            elif base == "wind_gusts_10m":
                values = [None] + [20.0 + member / 10] * 360
            else:
                values = [10.0 + member / 10 + hour / 1000 for hour in range(361)]
            hourly[key] = values
    return {
        "latitude": 52.1,
        "longitude": 5.2,
        "elevation": 12,
        "hourly_units": copy.deepcopy(early.EXPECTED_UNITS),
        "hourly": hourly,
    }


class EarlyEcmwfPlumeTest(unittest.TestCase):
    def setUp(self):
        self.cycle = datetime(2026, 8, 11, tzinfo=timezone.utc)
        self.meta = meta_document(self.cycle)

    def test_meta_eist_exacte_native_00z_horizon(self):
        cycle, created, times = early.validate_early_meta(self.meta)

        self.assertEqual(cycle, self.cycle)
        self.assertEqual(created, self.cycle + timedelta(hours=7, minutes=3))
        self.assertEqual(len(times), 145)
        self.assertEqual(times[-1], self.cycle + timedelta(hours=360))

        broken = copy.deepcopy(self.meta)
        broken["valid_times"].pop()
        with self.assertRaisesRegex(RuntimeError, "nog niet compleet"):
            early.validate_early_meta(broken)

    def test_uurlijkse_api_wordt_zonder_neerslagverlies_native(self):
        times = native_times(self.cycle)
        hourly = early.native_hourly(point_response(self.cycle), times)

        self.assertEqual(len(hourly["time"]), 145)
        # Index 90 is +90, index 91 is +93: drie voorafgaande uurvakken.
        self.assertEqual(hourly["precipitation"][90], 1.0)
        self.assertEqual(hourly["precipitation"][91], 3.0)
        # Eerste 6-uursinterval is +144 -> +150.
        index_150 = times.index(self.cycle + timedelta(hours=150))
        self.assertEqual(hourly["precipitation"][index_150], 6.0)
        self.assertAlmostEqual(hourly["snowfall"][index_150], 0.6)
        self.assertEqual(hourly["wind_gusts_10m"][0], 0.0)

    def test_run_is_51_leden_9km_en_verzint_geen_cape(self):
        times = native_times(self.cycle)
        hourly = early.native_hourly(point_response(self.cycle), times)
        run = early._build_early_run(
            hourly,
            self.cycle,
            self.cycle + timedelta(hours=7, minutes=3),
            times,
            {"latitude": 52.1, "longitude": 5.2, "elevation": 12},
        )

        self.assertEqual(run["n"], 145)
        self.assertEqual(run["step_hours"], [1.0, 3.0, 6.0])
        self.assertEqual(run["source"]["access"], "ecmwf_prescheduled_point_api")
        self.assertEqual(len(run["members"]["temperature_2m"]), 51)
        self.assertNotIn("cape", run["members"])
        self.assertTrue(trend.has_verified_hres(run))

    def test_all_station_batch_is_all_or_none(self):
        stations = [
            ("Een", "een", 52.1, 5.2),
            ("Twee", "twee", 51.9, 4.5),
        ]
        responses = [point_response(self.cycle), point_response(self.cycle)]

        def fetch(url):
            if "/v1/ensemble?" in url:
                return responses
            return copy.deepcopy(self.meta)

        with tempfile.TemporaryDirectory() as directory:
            written = early.try_early_run(
                Path(directory), stations=stations, fetch=fetch
            )
            self.assertEqual(len(written), 2)
            for _name, slug, _lat, _lon in stations:
                document = json.loads(
                    (Path(directory) / f"pluim_trend_{slug}.json").read_text()
                )
                self.assertEqual(document["runs"][0]["run"], trend.iso_z(self.cycle))

        responses[1] = point_response(self.cycle, member_count=50)
        with tempfile.TemporaryDirectory() as directory:
            with self.assertRaisesRegex(RuntimeError, "verwacht 51"):
                early.try_early_run(Path(directory), stations=stations, fetch=fetch)
            self.assertEqual(list(Path(directory).glob("pluim_trend_*.json")), [])


if __name__ == "__main__":
    unittest.main()
