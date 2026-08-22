import contextlib
import io
import json
import sys
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path
from unittest import mock


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "shell"))

import pluim_trend_cache as trend  # noqa: E402


class PluimTrendHresTest(unittest.TestCase):
    @staticmethod
    def ensemble_hourly():
        times = [
            "2026-08-08T00:00", "2026-08-08T03:00",
            "2026-08-08T06:00", "2026-08-08T12:00",
        ]
        hourly = {"time": times}
        for base in ("temperature_2m", "precipitation", "wind_speed_10m", "cloud_cover"):
            hourly[base] = [10, 11, 12, 13]
            for member in range(1, 51):
                hourly[f"{base}_member{member:02d}"] = [10 + member / 10] * len(times)
        return hourly

    @staticmethod
    def hres_hourly():
        return {
            "latitude": 52.0,
            "longitude": 5.25,
            "elevation": 6,
            "hourly": {
                "time": [f"2026-08-08T{hour:02d}:00" for hour in range(13)],
                "temperature_2m": [20 + hour for hour in range(13)],
                "precipitation": [None] + [hour / 10 for hour in range(1, 13)],
            },
        }

    @classmethod
    def enriched_ensemble_hourly(cls):
        times = [
            "2026-08-08T00:00", "2026-08-08T03:00",
            "2026-08-08T06:00", "2026-08-08T09:00",
            "2026-08-08T12:00",
        ]
        hourly = {"time": times}
        bases = (
            "temperature_2m", "precipitation", "wind_speed_10m",
            "cloud_cover", "temperature_850hPa", "snowfall",
        )
        for base in bases:
            hourly[base] = [10 + index for index in range(len(times))]
            for member in range(1, 51):
                hourly[f"{base}_member{member:02d}"] = [
                    10 + member / 10 + index for index in range(len(times))
                ]
        # Open-Meteo exposeerde LI als 51 reeksen, maar zonder één bruikbare
        # waarde. Dit mag de rest van de verrijking niet ongeldig maken.
        hourly["lifted_index"] = [None] * len(times)
        for member in range(1, 51):
            hourly[f"lifted_index_member{member:02d}"] = [None] * len(times)
        return hourly

    def test_hres_wordt_op_utc_tijd_en_niet_op_index_uitgelijnd(self):
        cycle = datetime(2026, 8, 8, tzinfo=timezone.utc)
        hourly = self.hres_hourly()["hourly"]
        ens_times = [
            "2026-08-08T00:00", "2026-08-08T03:00",
            "2026-08-08T06:00", "2026-08-08T12:00",
        ]

        with mock.patch.object(trend, "MIN_HORIZON_H", 12):
            temperature, precipitation = trend.align_hres_to_ens(hourly, cycle, ens_times)

        self.assertEqual(temperature, [20, 23, 26, 32])
        self.assertEqual(precipitation[0], None)
        self.assertAlmostEqual(precipitation[1], 0.6)
        self.assertAlmostEqual(precipitation[2], 1.5)
        self.assertAlmostEqual(precipitation[3], 5.7)

    def test_hres_neerslag_somt_alle_uren_binnen_het_ens_interval(self):
        cycle = datetime(2026, 8, 8, tzinfo=timezone.utc)
        hourly = {
            "time": [
                "2026-08-08T00:00", "2026-08-08T01:00", "2026-08-08T02:00",
                "2026-08-08T03:00", "2026-08-08T04:00", "2026-08-08T05:00",
                "2026-08-08T06:00",
            ],
            "temperature_2m": [10, 11, 12, 13, 14, 15, 16],
            "precipitation": [None, 1, 2, 3, 4, 5, 6],
        }

        with mock.patch.object(trend, "MIN_HORIZON_H", 6):
            temperature, precipitation = trend.align_hres_to_ens(
                hourly,
                cycle,
                ["2026-08-08T00:00", "2026-08-08T03:00", "2026-08-08T06:00"],
            )

        self.assertEqual(temperature, [10, 13, 16])
        self.assertEqual(precipitation, [None, 6, 15])

    def test_onvolledige_hres_wordt_afgekeurd(self):
        cycle = datetime(2026, 8, 8, tzinfo=timezone.utc)
        hourly = {
            "time": [
                "2026-08-08T00:00", "2026-08-08T01:00", "2026-08-08T03:00",
                "2026-08-08T04:00", "2026-08-08T05:00", "2026-08-08T06:00",
            ],
            "temperature_2m": [10, 11, 13, 14, 15, 16],
            "precipitation": [None, 0.1, 0.3, 0.4, 0.5, 0.6],
        }

        with mock.patch.object(trend, "MIN_HORIZON_H", 6):
            with self.assertRaisesRegex(RuntimeError, "ontbrekende uurstappen"):
                trend.align_hres_to_ens(
                    hourly,
                    cycle,
                    ["2026-08-08T00:00", "2026-08-08T03:00", "2026-08-08T06:00"],
                )

    def test_control_zonder_hres_provenance_telt_niet_als_hres(self):
        verkeerd = {
            "n": 2,
            "temp_hres": [10, 11],
            "precip_hres": [0, 1],
            "source": {"hres": {"status": "available", "model": "ecmwf_ifs025_ensemble"}},
        }
        echt = {
            **verkeerd,
            "source": {"hres": {
                "status": "available",
                "model": "ecmwf_ifs",
                "precipitation_alignment": "sum_preceding_hourly_intervals",
            }},
        }

        self.assertFalse(trend.has_verified_hres(verkeerd))
        self.assertTrue(trend.has_verified_hres(echt))

    def test_hres_url_selecteert_een_exacte_9km_run(self):
        self.assertIn("single-runs-api.open-meteo.com", trend.HRES_URL)
        self.assertIn("models=ecmwf_ifs", trend.HRES_URL)
        self.assertIn("run={run}", trend.HRES_URL)
        self.assertNotIn("models=ecmwf_ifs025", trend.HRES_URL)
        self.assertNotIn("temporal_resolution=native", trend.HRES_URL)

    def test_hoofd_en_tussenruns_hebben_een_eigen_minimumhorizon(self):
        self.assertEqual(
            trend.minimum_horizon_hours(datetime(2026, 8, 9, 0, tzinfo=timezone.utc)),
            360,
        )
        self.assertEqual(
            trend.minimum_horizon_hours(datetime(2026, 8, 9, 6, tzinfo=timezone.utc)),
            144,
        )
        self.assertEqual(
            trend.minimum_horizon_hours(datetime(2026, 8, 9, 18, tzinfo=timezone.utc)),
            144,
        )
        self.assertIn("om.weerlab.nl/om/ensemble", trend.ENS_URL)

    def test_archief_vraagt_alle_pluimvariabelen_op(self):
        for variable in (
            "wind_gusts_10m", "cape", "wind_direction_10m",
            "temperature_850hPa", "temperature_500hPa", "dew_point_2m",
        ):
            self.assertIn(variable, trend.ARCHIVE_BASES)

    def test_build_run_bewaart_hres_apart_en_veilig_degradeert(self):
        source_meta = {
            "last_run_availability_time": 1786150800,
            "data_end_time": 1786204800,
        }
        hres = self.hres_hourly()
        with mock.patch.object(trend, "MIN_HORIZON_H", 12):
            run = trend.build_run(
                self.ensemble_hourly(),
                "2026-08-08T00:00:00Z",
                source_meta,
                {"latitude": 52.1, "longitude": 5.2, "elevation": 5},
                hres_response=hres,
            )

        self.assertEqual(run["temp_hres"], [20, 23, 26, 32])
        self.assertEqual(run["precip_hres"], [None, 0.6, 1.5, 5.7])
        self.assertEqual(run["members"]["temperature_2m"][0], [10, 11, 12, 13])
        self.assertTrue(trend.has_verified_hres(run))

        trend.degrade_hres(run, "teststoring")
        self.assertEqual(run["temp_hres"], [])
        self.assertEqual(run["precip_hres"], [])
        self.assertFalse(trend.has_verified_hres(run))

    def test_opgeslagen_run_kan_tijdens_latere_cyclus_met_hres_worden_verrijkt(self):
        source_meta = {
            "last_run_availability_time": 1786150800,
            "data_end_time": 1786204800,
        }
        with mock.patch.object(trend, "MIN_HORIZON_H", 12):
            run = trend.build_run(
                self.ensemble_hourly(),
                "2026-08-08T00:00:00Z",
                source_meta,
                {"latitude": 52.1, "longitude": 5.2, "elevation": 5},
                hres_error="nog niet beschikbaar",
            )
            old_digest = run["data_sha256"]
            enriched = trend.enrich_run_hres(
                run,
                self.hres_hourly(),
            )

        self.assertEqual(run["temp_hres"], [])
        self.assertEqual(enriched["temp_hres"], [20, 23, 26, 32])
        self.assertEqual(enriched["precip_hres"], [None, 0.6, 1.5, 5.7])
        self.assertNotEqual(enriched["data_sha256"], old_digest)
        self.assertTrue(trend.has_verified_hres(enriched))

    def test_build_run_schrijft_de_leden_alleen_nog_in_members(self):
        source_meta = {
            "last_run_availability_time": 1786150800,
            "data_end_time": 1786204800,
        }
        with mock.patch.object(trend, "MIN_HORIZON_H", 12):
            run = trend.build_run(
                self.ensemble_hourly(),
                "2026-08-08T00:00:00Z",
                source_meta,
                {"latitude": 52.1, "longitude": 5.2, "elevation": 5},
                hres_error="nog niet beschikbaar",
            )

        for legacy in (
            "temp_members", "precip_members", "wind_members",
            "cloud_members", "gust_members", "cape_members",
        ):
            self.assertNotIn(legacy, run)
        for base in ("temperature_2m", "precipitation", "wind_speed_10m", "cloud_cover"):
            self.assertEqual(len(run["members"][base]), 51)

    def test_volledig_null_specialistveld_wordt_weggelaten(self):
        source_meta = {
            "last_run_availability_time": 1786150800,
            "data_end_time": 1786204800,
        }
        with mock.patch.object(trend, "MIN_HORIZON_H", 12):
            run = trend.build_run(
                self.enriched_ensemble_hourly(),
                "2026-08-08T00:00:00Z",
                source_meta,
                {"latitude": 52.1, "longitude": 5.2, "elevation": 5},
                hres_error="test",
            )

        self.assertIn("temperature_850hPa", run["members"])
        self.assertIn("snowfall", run["members"])
        self.assertNotIn("lifted_index", run["members"])

    def test_historische_volledig_null_li_wordt_zonder_netwerk_opgeschoond(self):
        run = {
            "run": "2026-08-08T00:00:00Z",
            "n": 2,
            "times_ms": [1786147200000, 1786158000000],
            "members": {
                **{
                    base: [[1, 2] for _ in range(51)]
                    for base in trend.CORE_BASES
                },
                "lifted_index": [[None, None] for _ in range(51)],
            },
            "data_sha256": "a" * 64,
        }
        with tempfile.TemporaryDirectory() as tmp:
            out_dir = Path(tmp)
            path = out_dir / "pluim_trend_een.json"
            path.write_text(json.dumps({
                "schema": 3,
                "station": "Een",
                "slug": "een",
                "runs": [run],
            }))
            stations = [("Een", "een", 52.0, 5.0)]
            with mock.patch.object(trend, "STATIONS", stations):
                written = trend.sanitize_null_lifted_index_archives(out_dir, set())

            self.assertEqual(written, [str(path)])
            cleaned = json.loads(path.read_text())["runs"][0]
            self.assertNotIn("lifted_index", cleaned["members"])
            self.assertNotEqual(cleaned["data_sha256"], "a" * 64)

    def test_unsigned_legacy_li_blijft_byte_en_schema_ongewijzigd(self):
        legacy = {
            "schema": 2,
            "station": "Een",
            "slug": "een",
            "runs": [{
                "run": "2026-08-08T00:00:00Z",
                "n": 2,
                "times_ms": [1786147200000, 1786158000000],
                "members": {
                    "lifted_index": [[None, None] for _ in range(51)],
                },
            }],
        }
        with tempfile.TemporaryDirectory() as tmp:
            out_dir = Path(tmp)
            path = out_dir / "pluim_trend_een.json"
            path.write_text(json.dumps(legacy, separators=(",", ":")))
            before = path.read_bytes()
            stations = [("Een", "een", 52.0, 5.0)]
            with mock.patch.object(trend, "STATIONS", stations):
                written = trend.sanitize_null_lifted_index_archives(out_dir, set())

            self.assertEqual(written, [])
            self.assertEqual(path.read_bytes(), before)
            unchanged = json.loads(path.read_text())
            self.assertEqual(unchanged["schema"], 2)
            self.assertNotIn("data_sha256", unchanged["runs"][0])
            self.assertIn("lifted_index", unchanged["runs"][0]["members"])

    def test_same_run_merge_behoudt_directe_kern_en_lijnt_op_bestaande_tijden(self):
        source_meta = {
            "last_run_availability_time": 1786150800,
            "data_end_time": 1786204800,
        }
        with mock.patch.object(trend, "MIN_HORIZON_H", 12):
            direct = trend.build_run(
                self.ensemble_hourly(),
                "2026-08-08T00:00:00Z",
                source_meta,
                {"latitude": 52.1, "longitude": 5.2, "elevation": 5},
                hres_error="test",
            )
            direct["source"]["model"] = "ecmwf_open_data_direct"
            trend.update_digest(direct)
            old_digest = direct["data_sha256"]
            old_core = json.loads(json.dumps(direct["members"]))
            enriched, added = trend.enrich_run_ensemble(
                direct,
                self.enriched_ensemble_hourly(),
                "2026-08-08T00:00:00Z",
                {"latitude": 52.125, "longitude": 5.25, "elevation": 4},
            )

        for base in trend.CORE_BASES:
            self.assertEqual(enriched["members"][base], old_core[base])
        self.assertEqual(enriched["source"]["model"], "ecmwf_open_data_direct")
        self.assertEqual(
            enriched["members"]["temperature_850hPa"][0],
            [10.0, 11.0, 12.0, 14.0],
        )
        self.assertIn("temperature_850hPa", added)
        self.assertIn("snowfall", added)
        self.assertNotIn("lifted_index", enriched["members"])
        self.assertNotEqual(enriched["data_sha256"], old_digest)
        self.assertEqual(
            enriched["source"]["enrichment"]["run_initialisation"],
            direct["run"],
        )

    def test_same_run_merge_weigert_runmixing_en_ontbrekende_tijdstap(self):
        source_meta = {
            "last_run_availability_time": 1786150800,
            "data_end_time": 1786204800,
        }
        with mock.patch.object(trend, "MIN_HORIZON_H", 12):
            direct = trend.build_run(
                self.ensemble_hourly(),
                "2026-08-08T00:00:00Z",
                source_meta,
                {},
                hres_error="test",
            )
            with self.assertRaisesRegex(RuntimeError, "andere bronrun"):
                trend.enrich_run_ensemble(
                    direct,
                    self.enriched_ensemble_hourly(),
                    "2026-08-08T12:00:00Z",
                    {},
                )
            missing = self.enriched_ensemble_hourly()
            keep = [0, 1, 3, 4]
            for key, values in list(missing.items()):
                if isinstance(values, list):
                    missing[key] = [values[index] for index in keep]
            with self.assertRaisesRegex(RuntimeError, "mist 1 bestaande"):
                trend.enrich_run_ensemble(
                    direct,
                    missing,
                    "2026-08-08T00:00:00Z",
                    {},
                )

    def test_capability_manifest_is_volledig_eindig_en_deterministisch(self):
        stations = [
            ("Een", "een", 52.0, 5.0),
            ("Twee", "twee", 52.1, 5.1),
        ]
        run_iso = "2026-08-08T00:00:00Z"
        times_ms = [1786147200000, 1786158000000]

        def matrix(value):
            return [[value, value + 1] for _ in range(51)]

        def station_doc(name, slug, digest, bad_specialist=False):
            members = {base: matrix(1) for base in trend.CORE_BASES}
            members["temperature_850hPa"] = matrix(5)
            if bad_specialist:
                members["temperature_850hPa"][3][1] = None
            members["lifted_index"] = [[None, None] for _ in range(51)]
            return {
                "schema": 3,
                "station": name,
                "slug": slug,
                "runs": [{
                    "run": run_iso,
                    "n": 2,
                    "times_ms": times_ms,
                    "members": members,
                    "data_sha256": digest,
                }],
            }

        with tempfile.TemporaryDirectory() as tmp:
            out_dir = Path(tmp)
            (out_dir / "pluim_trend_een.json").write_text(json.dumps(
                station_doc("Een", "een", "a" * 64)
            ))
            (out_dir / "pluim_trend_twee.json").write_text(json.dumps(
                station_doc("Twee", "twee", "b" * 64, bad_specialist=True)
            ))

            first = trend.write_capability_manifest(out_dir, stations=stations)
            self.assertEqual(first, out_dir / trend.CAPABILITY_MANIFEST_NAME)
            manifest = json.loads(first.read_text())
            self.assertTrue(manifest["complete"])
            self.assertEqual(manifest["station_count"], 2)
            self.assertEqual(manifest["member_count"], 51)
            self.assertTrue(manifest["runs"][0]["complete"])
            self.assertNotIn("temperature_850hPa", manifest["runs"][0]["fields"])
            self.assertNotIn("lifted_index", manifest["runs"][0]["fields"])
            first_revision = manifest["revision"]
            first_text = first.read_text()

            self.assertIsNone(
                trend.write_capability_manifest(out_dir, stations=stations)
            )
            self.assertEqual(first.read_text(), first_text)

            changed = station_doc("Twee", "twee", "c" * 64)
            (out_dir / "pluim_trend_twee.json").write_text(json.dumps(changed))
            self.assertEqual(
                trend.write_capability_manifest(out_dir, stations=stations),
                first,
            )
            updated = json.loads(first.read_text())
            self.assertNotEqual(updated["revision"], first_revision)
            self.assertIn("temperature_850hPa", updated["runs"][0]["fields"])

    def test_shell_publiceert_manifest_explicit_als_laatste(self):
        shell = (ROOT / "shell" / "pluim_trend_cache.sh").read_text()
        station_call = (
            'R2_CACHE_CONTROL="public, max-age=600" '
            '"$REPO_DIR/shell/r2_publish.sh" "${station_uploads[@]}"'
        )
        manifest_call = (
            'R2_CACHE_CONTROL="public, max-age=60" '
            '"$REPO_DIR/shell/r2_publish.sh" "$manifest_path"'
        )
        self.assertIn("Stationarchieven gewijzigd zonder capability-manifest", shell)
        self.assertIn(station_call, shell)
        self.assertIn(manifest_call, shell)
        self.assertLess(shell.index(station_call), shell.index(manifest_call))
        stamp_call = 'mv -f "$publish_stamp_tmp" "$PUBLISHED_REVISION_STAMP"'
        self.assertIn(stamp_call, shell)
        # `set -e` prevents this stamp when either R2 call fails.
        self.assertLess(shell.index(manifest_call), shell.index(stamp_call))

    def test_revisionwijziging_herstelt_eerdere_halve_batch_via_alle_stations(self):
        stations = [
            ("Een", "een", 52.0, 5.0),
            ("Twee", "twee", 52.1, 5.1),
        ]
        run_iso = "2026-08-08T00:00:00Z"
        times_ms = [1786147200000, 1786158000000]

        def doc(name, slug, digest):
            return {
                "schema": 3,
                "station": name,
                "slug": slug,
                "runs": [{
                    "run": run_iso,
                    "n": 2,
                    "times_ms": times_ms,
                    "members": {
                        base: [[1, 2] for _ in range(51)]
                        for base in trend.CORE_BASES
                    },
                    "data_sha256": digest,
                }],
            }

        with tempfile.TemporaryDirectory() as tmp:
            out_dir = Path(tmp)
            paths = [out_dir / "pluim_trend_een.json", out_dir / "pluim_trend_twee.json"]
            paths[0].write_text(json.dumps(doc("Een", "een", "a" * 64)))
            paths[1].write_text(json.dumps(doc("Twee", "twee", "b" * 64)))
            old_manifest_path = trend.write_capability_manifest(out_dir, stations=stations)
            self.assertIsNotNone(old_manifest_path)
            old_revision = json.loads(old_manifest_path.read_text())["revision"]
            stamp_path = out_dir / "published-revision"
            stamp_path.write_text(old_revision)

            # Simuleer een vorige crash: één lokaal archief is al vervangen,
            # maar geen stationpad heeft ooit WRITTEN/R2 bereikt.
            paths[0].write_text(json.dumps(doc("Een", "een", "c" * 64)))
            stdout = io.StringIO()
            with (
                mock.patch.object(trend, "STATIONS", stations),
                contextlib.redirect_stdout(stdout),
            ):
                self.assertEqual(
                    trend.finish_with_manifest(
                        out_dir, [], published_revision_path=stamp_path
                    ),
                    0,
                )

            written_line = next(
                line for line in stdout.getvalue().splitlines()
                if line.startswith("WRITTEN:")
            )
            written = written_line.removeprefix("WRITTEN:").split()
            self.assertEqual(written[:-1], [str(path) for path in paths])
            self.assertEqual(
                written[-1],
                str(out_dir / trend.CAPABILITY_MANIFEST_NAME),
            )
            new_revision = json.loads(
                (out_dir / trend.CAPABILITY_MANIFEST_NAME).read_text()
            )["revision"]
            self.assertNotEqual(new_revision, old_revision)

            # Een mislukte R2-upload laat de oude stamp staan en forceert ook
            # bij een lokaal al geschreven manifest dezelfde veilige retry.
            retry_stdout = io.StringIO()
            with (
                mock.patch.object(trend, "STATIONS", stations),
                contextlib.redirect_stdout(retry_stdout),
            ):
                self.assertEqual(
                    trend.finish_with_manifest(
                        out_dir, [], published_revision_path=stamp_path
                    ),
                    0,
                )
            self.assertIn("WRITTEN:", retry_stdout.getvalue())

            # Alleen de shell zet deze stamp, ná de geslaagde manifestupload.
            stamp_path.write_text(new_revision)
            done_stdout = io.StringIO()
            with (
                mock.patch.object(trend, "STATIONS", stations),
                contextlib.redirect_stdout(done_stdout),
            ):
                self.assertEqual(
                    trend.finish_with_manifest(
                        out_dir, [], published_revision_path=stamp_path
                    ),
                    0,
                )
            self.assertIn("Niets geschreven.", done_stdout.getvalue())

    def test_volledige_skip_bouwt_manifest_eenmalig(self):
        stations = [
            ("Een", "een", 52.0, 5.0),
            ("Twee", "twee", 52.1, 5.1),
        ]
        cycle = datetime(2026, 8, 10, 18, tzinfo=timezone.utc)
        run_iso = "2026-08-10T18:00:00Z"
        times_ms = [int(cycle.timestamp() * 1000), int(cycle.timestamp() * 1000) + 10_800_000]
        members = {
            base: [[1, 2] for _ in range(51)]
            for base in trend.ENRICHMENT_BASES
        }

        def station_doc(name, slug, digest):
            return {
                "schema": 3,
                "station": name,
                "slug": slug,
                "runs": [{
                    "run": run_iso,
                    "n": 2,
                    "times_ms": times_ms,
                    "members": members,
                    "data_sha256": digest,
                }],
            }

        meta = {
            "last_run_initialisation_time": int(cycle.timestamp()),
            "last_run_availability_time": int((cycle.replace(minute=30)).timestamp()),
            "data_end_time": int((cycle.timestamp() + 144 * 3600)),
        }
        with tempfile.TemporaryDirectory() as tmp:
            out_dir = Path(tmp)
            stamp_path = out_dir / "published-revision"
            for (name, slug, _lat, _lon), digest in zip(stations, ("a" * 64, "b" * 64)):
                (out_dir / f"pluim_trend_{slug}.json").write_text(
                    json.dumps(station_doc(name, slug, digest))
                )
            with (
                mock.patch.object(trend, "STATIONS", stations),
                mock.patch.object(trend, "PUBLISHED_REVISION_STAMP", stamp_path),
                mock.patch.object(trend, "fetch_with_retry", return_value=meta),
                mock.patch.object(trend, "enrich_existing_hres", return_value=[]),
            ):
                first_stdout = io.StringIO()
                with contextlib.redirect_stdout(first_stdout):
                    self.assertEqual(trend.main(["--dir", tmp]), 0)
                manifest = json.loads(
                    (out_dir / trend.CAPABILITY_MANIFEST_NAME).read_text()
                )
                stamp_path.write_text(manifest["revision"])
                second_stdout = io.StringIO()
                with contextlib.redirect_stdout(second_stdout):
                    self.assertEqual(trend.main(["--dir", tmp]), 0)

            self.assertIn("WRITTEN:", first_stdout.getvalue())
            self.assertIn(trend.CAPABILITY_MANIFEST_NAME, first_stdout.getvalue())
            self.assertIn("Niets geschreven.", second_stdout.getvalue())

    def test_mislukte_enrichmentbatch_schrijft_geen_enkel_station(self):
        stations = [
            ("Een", "een", 52.0, 5.0),
            ("Twee", "twee", 52.1, 5.1),
        ]
        cycle = datetime(2026, 8, 8, 0, tzinfo=timezone.utc)
        run_iso = "2026-08-08T00:00:00Z"
        meta = {
            "last_run_initialisation_time": int(cycle.timestamp()),
            "last_run_availability_time": int(cycle.timestamp()),
            "data_end_time": int(cycle.timestamp() + 12 * 3600),
        }
        with mock.patch.object(trend, "MIN_HORIZON_H", 12):
            direct = trend.build_run(
                self.ensemble_hourly(),
                run_iso,
                meta,
                {},
                hres_error="test",
            )

        def fetch(url):
            if url == trend.META_URL:
                return meta
            if "latitude=52.0" in url:
                return {
                    "latitude": 52.0,
                    "longitude": 5.0,
                    "hourly": self.enriched_ensemble_hourly(),
                }
            raise RuntimeError("gesimuleerde tweede-stationfout")

        with tempfile.TemporaryDirectory() as tmp:
            out_dir = Path(tmp)
            originals = {}
            for (name, slug, lat, lon), digest in zip(stations, ("a" * 64, "b" * 64)):
                station_run = json.loads(json.dumps(direct))
                station_run["data_sha256"] = digest
                doc = {
                    "schema": 3,
                    "station": name,
                    "slug": slug,
                    "lat": lat,
                    "lon": lon,
                    "runs": [station_run],
                }
                path = out_dir / f"pluim_trend_{slug}.json"
                path.write_text(json.dumps(doc, separators=(",", ":")))
                originals[slug] = path.read_text()

            with (
                mock.patch.object(trend, "STATIONS", stations),
                mock.patch.object(trend, "MIN_HORIZON_H", 12),
                mock.patch.object(trend, "fetch_with_retry", side_effect=fetch),
                mock.patch.object(trend, "enrich_existing_hres", return_value=[]),
                contextlib.redirect_stdout(io.StringIO()),
                contextlib.redirect_stderr(io.StringIO()),
            ):
                self.assertEqual(trend.main(["--dir", tmp]), 0)

            for _name, slug, _lat, _lon in stations:
                self.assertEqual(
                    (out_dir / f"pluim_trend_{slug}.json").read_text(),
                    originals[slug],
                )

    def test_om_enrichment_faalt_dicht_zonder_metadata_hercontrole(self):
        stations = [("Een", "een", 52.0, 5.0)]
        cycle = datetime(2026, 8, 8, 0, tzinfo=timezone.utc)
        run_iso = "2026-08-08T00:00:00Z"
        meta = {
            "last_run_initialisation_time": int(cycle.timestamp()),
            "last_run_availability_time": int(cycle.timestamp()),
            "data_end_time": int(cycle.timestamp() + 12 * 3600),
        }
        with mock.patch.object(trend, "MIN_HORIZON_H", 12):
            direct = trend.build_run(
                self.ensemble_hourly(), run_iso, meta, {}, hres_error="test"
            )

        meta_calls = 0

        def fetch(url):
            nonlocal meta_calls
            if url == trend.META_URL:
                meta_calls += 1
                if meta_calls == 1:
                    return meta
                raise RuntimeError("metadata tijdelijk onbereikbaar")
            return {
                "latitude": 52.0,
                "longitude": 5.0,
                "hourly": self.enriched_ensemble_hourly(),
            }

        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "pluim_trend_een.json"
            path.write_text(json.dumps({
                "schema": 3,
                "station": "Een",
                "slug": "een",
                "runs": [direct],
            }, separators=(",", ":")))
            before = path.read_text()
            with (
                mock.patch.object(trend, "STATIONS", stations),
                mock.patch.object(trend, "MIN_HORIZON_H", 12),
                mock.patch.object(trend, "fetch_with_retry", side_effect=fetch),
                contextlib.redirect_stdout(io.StringIO()),
                contextlib.redirect_stderr(io.StringIO()),
            ):
                self.assertEqual(trend.main(["--dir", tmp]), 1)
            self.assertEqual(path.read_text(), before)
            self.assertEqual(meta_calls, 2)

    def test_consumenten_lezen_members_met_fallback_op_oud_archief(self):
        # Runs die al gearchiveerd zijn hebben alleen de legacy-arrays; die
        # fallback moet blijven bestaan zolang zulke runs meegeleverd worden.
        switcher = (ROOT / "pluim_run_switcher_032667819e3a.js").read_text()
        self.assertIn("run.members && run.members[canonical]", switcher)
        self.assertIn("run[legacyFields[canonical]]", switcher)

        for page in ("demo_pluim6_trend.html", "demo_pluim6_trend_v3.html"):
            html = (ROOT / page).read_text()
            self.assertIn("membersOf(raw,'temperature_2m','temp_members')", html, page)
            self.assertIn("membersOf(raw,'precipitation','precip_members')", html, page)
            self.assertNotIn("raw.temp_members.map", html)

    def test_trendpagina_tekent_aparte_hres_ook_bij_neerslag(self):
        html = (ROOT / "demo_pluim6_trend.html").read_text()

        self.assertIn("raw.precip_hres", html)
        self.assertIn("pathArr(times,pHres,yr)", html)
        self.assertIn("Oper. (HRES)", html)


if __name__ == "__main__":
    unittest.main()
