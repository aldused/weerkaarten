import importlib.util
import json
import sys
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch


ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location(
    "weerlab_ecmwf_pluim_direct",
    ROOT / "shell" / "ecmwf_pluim_direct.py",
)
DIRECT = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = DIRECT
SPEC.loader.exec_module(DIRECT)


def utc(day, hour):
    return datetime(2026, 8, day, hour, tzinfo=timezone.utc)


class FakeResponse:
    def __init__(self, status_code, headers=None):
        self.status_code = status_code
        self.headers = headers or {}


class FakeSession:
    def __init__(self, responses):
        self.responses = responses
        self.calls = []

    def head(self, url, **_kwargs):
        self.calls.append(url)
        response = self.responses[url]
        if isinstance(response, Exception):
            raise response
        return response


class FakeClient:
    verify = True

    def __init__(self, responses):
        self.session = FakeSession(responses)


def ready_responses(run, enfo_status=200, oper_status=200):
    return {
        DIRECT.final_index_url(run, "enfo", "ef"): FakeResponse(
            enfo_status,
            {"Last-Modified": "Mon, 10 Aug 2026 13:04:00 GMT"},
        ),
        DIRECT.final_index_url(run, "oper", "fc"): FakeResponse(
            oper_status,
            {"Last-Modified": "Mon, 10 Aug 2026 12:27:00 GMT"},
        ),
    }


class DirectRunSelectionTests(unittest.TestCase):
    def test_explicit_06_remains_selectable_over_local_00(self):
        run06 = utc(10, 6)
        run00 = utc(10, 0)
        client = FakeClient(ready_responses(run06))
        candidates = [(run06, 6), (run00, 0), (utc(9, 18), 18)]

        with patch.object(DIRECT, "candidate_runs", return_value=candidates):
            selected = DIRECT.choose_run(
                client,
                6,
                None,
                minimum_run=run00,
                minimum_ready_at=utc(10, 7),
            )

        self.assertEqual(selected.run, run06)
        self.assertEqual(selected.cycle, 6)
        self.assertEqual(selected.source_ready_at, utc(10, 13).replace(minute=4))
        self.assertEqual(len(client.session.calls), 2)
        self.assertTrue(all(url.endswith(".index") for url in client.session.calls))

    def test_default_direct_cycles_select_18_then_12_only(self):
        run18 = utc(10, 18)
        run12 = utc(10, 12)
        responses = ready_responses(run18, enfo_status=404)
        responses.update(ready_responses(run12))
        client = FakeClient(responses)

        def candidates(cycles):
            self.assertEqual(tuple(cycles), DIRECT.DEFAULT_DIRECT_CYCLES)
            return [(run18, 18), (run12, 12)]

        with patch.object(DIRECT, "candidate_runs", side_effect=candidates):
            selected = DIRECT.choose_run(client, None, None)

        self.assertEqual(selected.run, run12)
        self.assertEqual(selected.cycle, 12)
        self.assertEqual(
            client.session.calls,
            [
                DIRECT.final_index_url(run18, "enfo", "ef"),
                DIRECT.final_index_url(run12, "enfo", "ef"),
                DIRECT.final_index_url(run12, "oper", "fc"),
            ],
        )

    def test_real_404_returns_local_floor_without_probing_older_runs(self):
        run06 = utc(10, 6)
        run00 = utc(10, 0)
        responses = ready_responses(run06, enfo_status=404)
        client = FakeClient(responses)
        candidates = [(run06, 6), (run00, 0), (utc(9, 18), 18)]

        with patch.object(DIRECT, "candidate_runs", return_value=candidates):
            selected = DIRECT.choose_run(
                client,
                None,
                None,
                minimum_run=run00,
                minimum_ready_at=utc(10, 7),
            )

        self.assertEqual(selected.run, run00)
        self.assertEqual(client.session.calls, [DIRECT.final_index_url(run06, "enfo", "ef")])

    def test_legacy_floor_is_reprobed_for_exact_source_time(self):
        run06 = utc(10, 6)
        run00 = utc(10, 0)
        responses = ready_responses(run06, enfo_status=404)
        responses.update(ready_responses(run00))
        client = FakeClient(responses)

        with patch.object(DIRECT, "candidate_runs", return_value=[(run06, 6), (run00, 0)]):
            selected = DIRECT.choose_run(
                client, None, None, minimum_run=run00, minimum_ready_at=None
            )

        self.assertEqual(selected.run, run00)
        self.assertTrue(selected.source_ready_verified)
        self.assertEqual(selected.source_ready_at, utc(10, 13).replace(minute=4))
        self.assertEqual(len(client.session.calls), 3)

    def test_rate_limit_aborts_instead_of_downgrading(self):
        run06 = utc(10, 6)
        run00 = utc(10, 0)
        responses = ready_responses(run06, enfo_status=429)
        client = FakeClient(responses)
        candidates = [(run06, 6), (run00, 0), (utc(9, 18), 18)]

        with patch.object(DIRECT, "candidate_runs", return_value=candidates):
            with self.assertRaisesRegex(RuntimeError, "HTTP 429"):
                DIRECT.choose_run(client, None, None, minimum_run=run00)

        self.assertEqual(client.session.calls, [DIRECT.final_index_url(run06, "enfo", "ef")])

    def test_timeout_aborts_instead_of_downgrading(self):
        run06 = utc(10, 6)
        run00 = utc(10, 0)
        responses = ready_responses(run06)
        responses[DIRECT.final_index_url(run06, "enfo", "ef")] = TimeoutError("probe timeout")
        client = FakeClient(responses)

        with patch.object(DIRECT, "candidate_runs", return_value=[(run06, 6), (run00, 0)]):
            with self.assertRaisesRegex(RuntimeError, "readiness check failed"):
                DIRECT.choose_run(client, None, None, minimum_run=run00)

        self.assertEqual(len(client.session.calls), 1)

    def test_requested_cycle_never_falls_below_newer_local_floor(self):
        run06 = utc(10, 6)
        floor00 = utc(10, 0)
        old06 = utc(9, 6)
        client = FakeClient(ready_responses(run06, enfo_status=404))

        with patch.object(DIRECT, "candidate_runs", return_value=[(run06, 6), (old06, 6)]):
            with self.assertRaisesRegex(RuntimeError, "no complete"):
                DIRECT.choose_run(client, 6, None, minimum_run=floor00)

        self.assertEqual(len(client.session.calls), 1)

    def test_published_state_is_part_of_monotonic_floor(self):
        def meta(run):
            return {
                "complete": True,
                "run": DIRECT.iso_z(run),
                "field_set": "core",
                "fields": list(DIRECT.OUTPUT_FIELDS["core"]),
                "station_count": 39,
                "member_count": 51,
                "last_run_source_ready_time": int((run.replace(hour=13)).timestamp()),
            }

        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            local = root / "local.json"
            published = root / "published.json"
            local.write_text(json.dumps(meta(utc(10, 0))))
            published.write_text(json.dumps(meta(utc(10, 6))))
            floor, _ready = DIRECT.newest_complete_floor(
                (local, published), "core", 39
            )

        self.assertEqual(floor, utc(10, 6))

    def test_temporal_floor_survives_future_schema_change(self):
        future = {
            "complete": True,
            "run": DIRECT.iso_z(utc(10, 6)),
            "field_set": "future-expanded",
            "fields": ["different"],
            "station_count": 80,
            "member_count": 101,
            "last_run_source_ready_time": int(utc(10, 13).timestamp()),
        }
        incomplete = {"complete": False, "run": DIRECT.iso_z(utc(10, 12))}

        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            future_path = root / "future.json"
            incomplete_path = root / "incomplete.json"
            future_path.write_text(json.dumps(future))
            incomplete_path.write_text(json.dumps(incomplete))
            floor, _ready = DIRECT.newest_complete_floor(
                (future_path, incomplete_path), "core", 39
            )

        self.assertEqual(floor, utc(10, 6))

    def test_client_index_gets_are_bounded(self):
        calls = []

        class Session:
            def get(self, url, *args, **kwargs):
                calls.append((url, args, kwargs))
                return "ok"

        class Client:
            session = Session()

        client = Client()
        DIRECT.configure_client_timeouts(client)
        self.assertEqual(client.session.get("https://example.test/index", verify=True), "ok")
        self.assertEqual(calls[0][2]["timeout"], 60)

        DIRECT.use_safe_multipart_chunk_size()
        self.assertTrue(
            getattr(DIRECT.ecmwf_client_module.robust, "_weerlab_bounded", False)
        )

    def test_write_guard_rejects_older_explicit_run(self):
        with self.assertRaisesRegex(RuntimeError, "refusing direct-plume rollback"):
            DIRECT.assert_not_rollback(utc(9, 18), utc(10, 0), no_write=False)
        DIRECT.assert_not_rollback(utc(9, 18), utc(10, 0), no_write=True)


class DirectManifestSafetyTests(unittest.TestCase):
    RUN_ISO = "2026-08-10T00:00:00Z"
    CORE_FIELDS = list(DIRECT.OUTPUT_FIELDS["core"])
    SPECIALIST_FIELDS = ["dew_point_2m", "relative_humidity_2m", "snowfall"]

    @staticmethod
    def station_document(name, slug, digest, fields, times_ms=None, access=None):
        times_ms = times_ms or [1786310400000, 1786321200000]
        archived_run = {
            "run": DirectManifestSafetyTests.RUN_ISO,
            "n": len(times_ms),
            "times_ms": times_ms,
            "members": {
                field: [[1.0 for _ in times_ms] for _ in range(51)]
                for field in fields
            },
            "data_sha256": digest,
        }
        if access is not None:
            archived_run["source"] = {"access": access}
        return {
            "schema": 3,
            "station": name,
            "slug": slug,
            "lat": 52.0,
            "lon": 5.0,
            "updated": "2026-08-10T09:05:00Z",
            "runs": [archived_run],
        }

    def test_same_run_replacement_removes_stale_specialist_certification(self):
        trend = DIRECT.load_trend_cache_module(ROOT)
        stations = [
            ("Een", "een", 52.0, 5.0),
            ("Twee", "twee", 52.1, 5.1),
        ]
        early_fields = self.CORE_FIELDS + self.SPECIALIST_FIELDS

        with tempfile.TemporaryDirectory() as directory:
            out_dir = Path(directory)
            station_paths = [
                out_dir / "pluim_trend_een.json",
                out_dir / "pluim_trend_twee.json",
            ]
            for path, station, digest in zip(
                station_paths,
                stations,
                ("a" * 64, "b" * 64),
            ):
                path.write_text(json.dumps(
                    self.station_document(station[0], station[1], digest, early_fields)
                ))

            meta_path = out_dir / "pluim_direct_meta.json"
            meta_path.write_text(json.dumps({
                "complete": True,
                "run": self.RUN_ISO,
                "field_set": "core",
                "fields": self.CORE_FIELDS,
                "station_count": 2,
                "member_count": 51,
            }))

            with patch.object(trend, "STATIONS", stations):
                manifest_path = trend.write_capability_manifest(out_dir)
                early_manifest = json.loads(manifest_path.read_text())
                self.assertTrue(set(self.SPECIALIST_FIELDS).issubset(
                    early_manifest["runs"][0]["fields"]
                ))
                early_revision = early_manifest["revision"]

                for path, station, digest in zip(
                    station_paths,
                    stations,
                    ("c" * 64, "d" * 64),
                ):
                    path.write_text(json.dumps(
                        self.station_document(
                            station[0], station[1], digest, self.CORE_FIELDS
                        )
                    ))

                with patch.object(DIRECT, "load_trend_cache_module", return_value=trend):
                    written = DIRECT.attach_capability_manifest(
                        (*station_paths, meta_path), ROOT, out_dir, meta_path
                    )

            direct_manifest = json.loads(manifest_path.read_text())
            self.assertNotEqual(direct_manifest["revision"], early_revision)
            self.assertEqual(
                set(direct_manifest["runs"][0]["fields"]), set(self.CORE_FIELDS)
            )
            self.assertTrue(all(
                field not in direct_manifest["runs"][0]["fields"]
                for field in self.SPECIALIST_FIELDS
            ))
            self.assertEqual(written, [*station_paths, manifest_path, meta_path])

    def test_publisher_orders_stations_archive_manifest_and_direct_meta(self):
        shell = (ROOT / "shell" / "pluim_direct_cache.sh").read_text()
        station_call = 'run_publisher "public, max-age=600" "${station_files[@]}"'
        archive_call = 'run_publisher "public, max-age=60" "$ARCHIVE_MANIFEST"'
        direct_call = 'run_publisher "public, max-age=60" "$meta"'
        stamp_call = '/bin/mv -f "$archive_stamp_tmp" "$PUBLISHED_REVISION_STAMP"'

        self.assertIn("Directe pluimbatch mist het capability-manifest", shell)
        self.assertLess(shell.index(station_call), shell.index(archive_call))
        self.assertLess(shell.index(archive_call), shell.index(stamp_call))
        self.assertLess(shell.index(stamp_call), shell.index(direct_call))

    def test_complete_prescheduled_run_skips_direct_and_removes_checkpoint(self):
        trend = DIRECT.load_trend_cache_module(ROOT)
        station_tuples = [
            ("Een", "een", 52.0, 5.0),
            ("Twee", "twee", 52.1, 5.1),
        ]
        stations = [DIRECT.Station(*station) for station in station_tuples]
        run = utc(10, 0)
        steps = (
            list(range(0, 91))
            + list(range(93, 145, 3))
            + list(range(150, 361, 6))
        )
        times_ms = [
            int((run + DIRECT.timedelta(hours=step)).timestamp() * 1000)
            for step in steps
        ]

        with tempfile.TemporaryDirectory() as directory:
            out_dir = Path(directory)
            paths = [
                out_dir / "pluim_trend_een.json",
                out_dir / "pluim_trend_twee.json",
            ]
            for path, station, digest in zip(
                paths,
                station_tuples,
                ("a" * 64, "b" * 64),
            ):
                path.write_text(json.dumps(self.station_document(
                    station[0],
                    station[1],
                    digest,
                    list(DIRECT.PRESCHEDULED_FIELDS),
                    times_ms=times_ms,
                    access="ecmwf_prescheduled_point_api",
                )))

            checkpoint = out_dir / "partial-checkpoint.npz"
            checkpoint.write_bytes(b"partial direct download")
            with (
                patch.object(trend, "STATIONS", station_tuples),
                patch.object(DIRECT, "load_trend_cache_module", return_value=trend),
            ):
                skipped = DIRECT.skip_complete_prescheduled_run(
                    out_dir, ROOT, stations, run, checkpoint
                )
            self.assertTrue(skipped)
            self.assertFalse(checkpoint.exists())

            incomplete = self.station_document(
                "Twee",
                "twee",
                "c" * 64,
                [
                    field
                    for field in DIRECT.PRESCHEDULED_FIELDS
                    if field != "snowfall"
                ],
                times_ms=times_ms,
                access="ecmwf_prescheduled_point_api",
            )
            paths[1].write_text(json.dumps(incomplete))
            checkpoint.write_bytes(b"keep me")
            with (
                patch.object(trend, "STATIONS", station_tuples),
                patch.object(DIRECT, "load_trend_cache_module", return_value=trend),
            ):
                skipped = DIRECT.skip_complete_prescheduled_run(
                    out_dir, ROOT, stations, run, checkpoint
                )
            self.assertFalse(skipped)
            self.assertTrue(checkpoint.exists())

    def test_explicit_00_precheck_returns_before_ecmwf_client_probe(self):
        run = utc(10, 0)
        args = SimpleNamespace(
            repo_dir=ROOT,
            out_dir=ROOT,
            slug=[],
            fields="core",
            published_state=None,
            cycle=0,
            date=None,
            no_write=False,
            probe_only=False,
        )
        station = DIRECT.Station("Een", "een", 52.0, 5.0)
        with (
            patch.object(DIRECT, "parse_args", return_value=args),
            patch.object(DIRECT, "install_signal_handlers"),
            patch.object(DIRECT, "use_safe_multipart_chunk_size"),
            patch.object(DIRECT, "load_stations", return_value=[station]),
            patch.object(DIRECT, "load_meta_document", return_value={}),
            patch.object(DIRECT, "newest_complete_floor", return_value=(None, None)),
            patch.object(DIRECT, "candidate_runs", return_value=[(run, 0)]),
            patch.object(DIRECT, "prune_stale_runtime"),
            patch.object(DIRECT, "skip_complete_prescheduled_run", return_value=True) as skip,
            patch.object(
                DIRECT,
                "Client",
                side_effect=AssertionError("ECMWF Client mag niet worden gemaakt"),
            ),
        ):
            self.assertEqual(DIRECT.main([]), 0)
        skip.assert_called_once()

    def test_default_0853_cleans_early_checkpoint_without_client(self):
        floor18 = utc(10, 18)
        args = SimpleNamespace(
            repo_dir=ROOT,
            out_dir=ROOT,
            slug=[],
            fields="core",
            published_state=None,
            cycle=None,
            date=None,
            no_write=False,
            probe_only=False,
        )
        station = DIRECT.Station("Een", "een", 52.0, 5.0)

        with tempfile.TemporaryDirectory() as directory:
            temp_root = Path(directory)
            early00 = (
                temp_root
                / "weerlab_ecmwf_pluim_checkpoint_20260811_00_core.npz"
            )
            early06 = (
                temp_root
                / "weerlab_ecmwf_pluim_checkpoint_20260810_06_basic.npz"
            )
            direct12 = (
                temp_root
                / "weerlab_ecmwf_pluim_checkpoint_20260810_12_core.npz"
            )
            malformed = (
                temp_root
                / "weerlab_ecmwf_pluim_checkpoint_notadate_00_core.npz"
            )
            for path in (early00, early06, direct12, malformed):
                path.write_bytes(b"checkpoint")

            prune_impl = DIRECT.prune_prescheduled_checkpoints

            def prune_test_root():
                return prune_impl(temp_root)

            with (
                patch.object(DIRECT, "parse_args", return_value=args),
                patch.object(DIRECT, "install_signal_handlers"),
                patch.object(DIRECT, "use_safe_multipart_chunk_size"),
                patch.object(DIRECT, "load_stations", return_value=[station]),
                patch.object(DIRECT, "load_meta_document", return_value={}),
                patch.object(
                    DIRECT,
                    "newest_complete_floor",
                    return_value=(floor18, utc(11, 1)),
                ),
                patch.object(
                    DIRECT,
                    "candidate_runs",
                    return_value=[(floor18, 18)],
                ) as candidates,
                patch.object(
                    DIRECT,
                    "prune_prescheduled_checkpoints",
                    side_effect=prune_test_root,
                ),
                patch.object(
                    DIRECT,
                    "Client",
                    side_effect=AssertionError("default mag geen ECMWF Client starten"),
                ),
            ):
                self.assertEqual(DIRECT.main([]), 0)

            candidates.assert_called_once_with(DIRECT.DEFAULT_DIRECT_CYCLES)
            self.assertFalse(early00.exists())
            self.assertFalse(early06.exists())
            self.assertTrue(direct12.exists())
            self.assertTrue(malformed.exists())


if __name__ == "__main__":
    unittest.main()
