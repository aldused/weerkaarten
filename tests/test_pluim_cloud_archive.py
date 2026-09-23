"""Cloud-layer archive ingestion, exact same-run alignment and capabilities."""
import copy
import contextlib
import io
import json
import sys
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "shell"))
import pluim_trend_cache as trend


class CloudArchiveTest(unittest.TestCase):
    run_id = "2026-09-20T00:00:00Z"
    cycle = datetime(2026, 9, 20, tzinfo=timezone.utc)

    def hourly(self):
        times = [trend.iso_z(self.cycle + timedelta(hours=i)) for i in (0, 3, 6, 9, 12)]
        result = {"time": times}
        for field in trend.CORE_BASES + trend.CLOUD_LAYER_BASES:
            for member in range(51):
                key = field + (f"_member{member:02d}" if member else "")
                result[key] = [0, 20, 40, 80, 100]
        return result

    def early(self):
        times = [int((self.cycle + timedelta(hours=i)).timestamp() * 1000) for i in range(13)]
        result = {
            "run": self.run_id, "n": len(times), "times_ms": times,
            "source": {"access": "ecmwf_prescheduled_point_api", "model": "ecmwf_ifs_europe_ensemble"},
            "members": {field: [[30] * len(times) for _ in range(51)] for field in trend.CORE_BASES},
        }
        trend.update_digest(result)
        return result

    def merge(self, original=None, hourly=None, run=None):
        with mock.patch.object(trend, "MIN_HORIZON_H", 12):
            return trend.enrich_run_ensemble(original or self.early(), hourly or self.hourly(), run or self.run_id, {})

    def test_cloud_layers_requested_and_optional(self):
        self.assertTrue(set(trend.CLOUD_LAYER_BASES).issubset(trend.ENRICHMENT_BASES))
        self.assertTrue(set(trend.CLOUD_LAYER_BASES).isdisjoint(trend.CORE_BASES))
        hourly = self.hourly()
        for key in list(hourly):
            if key.startswith(trend.CLOUD_LAYER_BASES):
                del hourly[key]
        merged, added = self.merge(hourly=hourly)
        self.assertEqual(added, [])
        self.assertNotIn("cloud_cover_low", merged["members"])

    def test_early_run_gets_native_layers_without_interpolation_or_core_replacement(self):
        original = self.early()
        merged, added = self.merge(original)
        self.assertEqual(set(added), set(trend.CLOUD_LAYER_BASES))
        for field in trend.CORE_BASES:
            self.assertEqual(merged["members"][field], original["members"][field])
        for field in trend.CLOUD_LAYER_BASES:
            self.assertEqual(merged["members"][field][0], [0, None, None, 20, None, None, 40, None, None, 80, None, None, 100])
        self.assertEqual(merged["source"]["enrichment"]["run_initialisation"], self.run_id)
        self.assertEqual(merged["source"]["enrichment"]["model"], "ecmwf_ifs025_ensemble")
        self.assertNotEqual(merged["data_sha256"], original["data_sha256"])
        self.assertEqual(self.merge(merged)[0]["data_sha256"], merged["data_sha256"])

    def test_missing_members_remain_null_and_do_not_shift(self):
        hourly = self.hourly()
        hourly["cloud_cover_low_member17"] = [None] * 5
        hourly["cloud_cover_mid_member18"][1] = None
        merged, _ = self.merge(hourly=hourly)
        self.assertEqual(merged["members"]["cloud_cover_low"][17], [None] * 13)
        self.assertEqual(merged["members"]["cloud_cover_low"][18][3], 20)
        self.assertIsNone(merged["members"]["cloud_cover_mid"][18][3])

    def test_invalid_and_all_null_layers_are_not_capabilities(self):
        for invalid in (-1, 101, float("nan"), True, "20"):
            hourly = self.hourly()
            hourly["cloud_cover_low"][1] = invalid
            merged, added = self.merge(hourly=hourly)
            self.assertNotIn("cloud_cover_low", added)
            self.assertNotIn("cloud_cover_low", merged["members"])
        hourly = self.hourly()
        for key in hourly:
            if key.startswith("cloud_cover_low"):
                hourly[key] = [None] * 5
        self.assertNotIn("cloud_cover_low", self.merge(hourly=hourly)[1])

    def test_wrong_member_identity_is_rejected(self):
        hourly = self.hourly()
        hourly["cloud_cover_low_member51"] = hourly.pop("cloud_cover_low_member17")
        self.assertNotIn("cloud_cover_low", self.merge(hourly=hourly)[1])

    def test_other_run_cannot_fill_gaps(self):
        with self.assertRaisesRegex(RuntimeError, "andere bronrun"):
            self.merge(run="2026-09-19T18:00:00Z")

    def test_manifest_advertises_only_real_layers_for_all_locations(self):
        stations = [("Een", "een", 52, 5), ("Twee", "twee", 53, 6)]
        merged, _ = self.merge()
        with tempfile.TemporaryDirectory() as tmp:
            for name, slug, lat, lon in stations:
                Path(tmp, f"pluim_trend_{slug}.json").write_text(json.dumps({"schema": 3, "slug": slug, "runs": [merged]}))
            manifest = trend.build_capability_payload(Path(tmp), stations)
            self.assertTrue(set(trend.CLOUD_LAYER_BASES).issubset(manifest["runs"][0]["fields"]))
            other = copy.deepcopy(merged)
            del other["members"]["cloud_cover_mid"]
            trend.update_digest(other)
            Path(tmp, "pluim_trend_twee.json").write_text(json.dumps({"schema": 3, "slug": "twee", "runs": [other]}))
            changed = trend.build_capability_payload(Path(tmp), stations)
            self.assertNotIn("cloud_cover_mid", changed["runs"][0]["fields"])
            self.assertNotEqual(changed["revision"], manifest["revision"])

    def test_early_run_gets_sparse_pressure_levels_as_separate_capability(self):
        hourly = self.hourly()
        for field in trend.SPARSE_EARLY_BASES:
            for member in range(51):
                hourly[field + (f"_member{member:02d}" if member else "")] = [5, 6, 7, 8, 9]
        merged, added = self.merge(hourly=hourly)
        self.assertTrue(set(trend.SPARSE_EARLY_BASES).issubset(added))
        self.assertEqual(merged["members"]["temperature_850hPa"][0],
                         [5, None, None, 6, None, None, 7, None, None, 8, None, None, 9])
        self.assertNotIn("temperature_850hPa", trend.complete_run_fields(merged))
        self.assertEqual(set(trend.sparse_run_fields(merged)), set(trend.SPARSE_EARLY_BASES))
        self.assertEqual(self.merge(merged, hourly=hourly)[0]["data_sha256"], merged["data_sha256"])
        # Een ontbrekend lid in de bron maakt het hele veld ongeschikt.
        partial = copy.deepcopy(hourly)
        partial["temperature_500hPa_member17"][2] = None
        self.assertNotIn("temperature_500hPa", self.merge(hourly=partial)[1])
        stations = [("Een", "een", 52, 5), ("Twee", "twee", 53, 6)]
        with tempfile.TemporaryDirectory() as tmp:
            for name, slug, lat, lon in stations:
                Path(tmp, f"pluim_trend_{slug}.json").write_text(json.dumps({"schema": 3, "slug": slug, "runs": [merged]}))
            entry = trend.build_capability_payload(Path(tmp), stations)["runs"][0]
            self.assertTrue(set(trend.SPARSE_EARLY_BASES).isdisjoint(entry["fields"]))
            self.assertEqual(entry["sparse_fields"], list(trend.SPARSE_EARLY_BASES))

    def test_sparse_matrix_rejects_partial_time_columns(self):
        full = [[1.0, None, 2.0] for _ in range(51)]
        self.assertTrue(trend.is_sparse_column_matrix(full, 3))
        broken = copy.deepcopy(full)
        broken[4][1] = 3.0
        self.assertFalse(trend.is_sparse_column_matrix(broken, 3))
        self.assertFalse(trend.is_sparse_column_matrix([[1.0, None, None] for _ in range(51)], 3))

    def test_no_change_at_one_station_does_not_block_other_cloud_updates(self):
        self.check_batch(None)

    def test_source_modification_during_batch_prevents_all_writes(self):
        self.check_batch("last_run_modification_time")

    def test_source_run_change_during_batch_prevents_all_writes(self):
        self.check_batch("last_run_initialisation_time")

    def check_batch(self, changed_key):
        stations = [("Een", "een", 52, 5), ("Twee", "twee", 53, 6)]
        meta = {"last_run_initialisation_time": int(self.cycle.timestamp()),
                "last_run_availability_time": int(self.cycle.timestamp()),
                "last_run_modification_time": int(self.cycle.timestamp()),
                "data_end_time": int(self.cycle.timestamp()) + 12 * 3600}
        calls = 0

        def fetch(url):
            nonlocal calls
            if url == trend.META_URL:
                calls += 1
                result = dict(meta)
                if calls > 1 and changed_key:
                    result[changed_key] += 3600
                return result
            return {"hourly": self.hourly()}

        with tempfile.TemporaryDirectory() as tmp:
            paths = [Path(tmp, f"pluim_trend_{slug}.json") for _, slug, _, _ in stations]
            for index, path in enumerate(paths):
                path.write_text(json.dumps({"schema": 3, "slug": stations[index][1],
                    "runs": [self.merge()[0] if index == 0 else self.early()]}))
            before = [path.read_text() for path in paths]
            with (mock.patch.object(trend, "STATIONS", stations),
                  mock.patch.object(trend, "MIN_HORIZON_H", 12),
                  mock.patch.object(trend, "fetch_with_retry", side_effect=fetch),
                  mock.patch.object(trend, "enrich_existing_hres", return_value=[]),
                  mock.patch.object(trend, "finish_with_manifest", return_value=0),
                  contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO())):
                result = trend.main(["--dir", tmp, "--slug", "een", "--slug", "twee"])
            self.assertEqual(result, 1 if changed_key else 0)
            self.assertEqual(calls, 2)
            self.assertEqual(paths[0].read_text(), before[0])
            if changed_key:
                self.assertEqual(paths[1].read_text(), before[1])
            else:
                updated = json.loads(paths[1].read_text())["runs"][0]
                self.assertIn("cloud_cover_low", updated["members"])
                self.assertIn("cloud_cover_mid", updated["members"])


if __name__ == "__main__":
    unittest.main()
