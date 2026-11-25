import csv
import io
import json
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest
from zipfile import ZipFile

from bouw_sneeuwtellingen import FIELDS, archive_rows, build, classify, period_days, summarize


class ClassificationTests(unittest.TestCase):
    def bits(self, s, ww=None, ix=None, day="19610712"):
        return classify(day, s, ww, ix)[0]

    def test_indicator_fully_independent(self):
        self.assertEqual(self.bits(1, 95), 0b01111)
        self.assertEqual(self.bits(None, 95), 0)
        self.assertEqual(self.bits(1, 89, 7, day="20260215"), 0b01111)

    def test_preceding_hour_and_mixed_snow(self):
        for code in (22, 26, 68, 69, 72, 77, 78, 84):
            self.assertEqual(self.bits(0, code), 0b11110)
        self.assertEqual(self.bits(None, 67, 7, day="20260215"), 0b11110)

    def test_hail_grains_and_drifts(self):
        self.assertEqual(self.bits(0, 89, 7), 0)
        self.assertEqual(self.bits(0, 87, 1), 0b01000)
        self.assertEqual(self.bits(0, 87, 7), 0b11110)
        self.assertEqual(self.bits(0, 27, 7), 0)
        self.assertEqual(self.bits(0, 27, 1), 0b01000)
        self.assertEqual(self.bits(0, 36, 1), 0)

    def test_ix_mapping_and_coverage(self):
        self.assertEqual(self.bits(0, 24, 1), 0b01000)
        self.assertEqual(self.bits(0, 24, 7), 0b11110)
        self.assertEqual(self.bits(0, 24, 4), 0b01000)
        self.assertEqual(self.bits(0, 24, 5), 0)
        self.assertTrue(classify("20010101", None, None, 5)[1])
        self.assertFalse(classify("20010101", None, None, 6)[1])
        self.assertEqual(self.bits(0, 70, day="20010101"), 0)

    def test_corrections_only_affect_validated_and_wintry(self):
        evidence = {"reason": "Bevestigde correctie bij dit uurvak", "source": "https://www.knmi.nl/"}
        corrected = classify("19610712", 1, 95, None, evidence)
        self.assertEqual(corrected[0], 0b00011)
        self.assertIn(evidence["source"], corrected[4])
        with self.assertRaisesRegex(ValueError, "zonder sneeuwmelding"):
            classify("19610712", 0, 95, None, evidence)

    def test_missing_is_not_zero_and_leap_day_is_expected(self):
        no_data = summarize([[0, 0, 0]], "months", "2024-02")
        self.assertIsNone(no_data["s"])
        self.assertIsNone(no_data["extended"])
        self.assertEqual(no_data["coverage"]["s"], [0, 696])
        self.assertEqual(summarize([[1, 0, 0]], "months", "2024-02")["s"], 0)
        self.assertEqual(period_days("winters", "2024"), 183)


def make_archive(path, station, rows):
    fields = ("STN", "T", *FIELDS[1:6], *FIELDS[7:])  # The real parser maps by column name.
    text = io.StringIO()
    writer = csv.writer(text)
    text.write("# " + ", ".join(fields) + "\n")
    for row in rows:
        writer.writerow([station if key == "STN" else row.get(key) for key in fields])
    with ZipFile(path, "w") as archive:
        archive.writestr("bron.txt", text.getvalue())


class ArchiveTests(unittest.TestCase):
    def setUp(self):
        self.work = TemporaryDirectory()
        self.addCleanup(self.work.cleanup)
        self.raw = Path(self.work.name)
        rows = []
        for station in ("209", "260", "280"):
            rows.append(f"<th>{station} - Station {station}</th><a href='//cdn.knmi.nl/uurgeg_{station}_2021-2030.zip'>")
        (self.raw / "index.html").write_text("\n".join(rows))

    def path(self, station):
        return self.raw / f"uurgeg_{station}_2021-2030.zip"

    def test_aggregation_with_independent_snow_signals(self):
        make_archive(self.path("260"), "260", [
            {"YYYYMMDD": "20241231", "HH": 22, "S": 1, "T": 38, "RH": 0},
            {"YYYYMMDD": "20241231", "HH": 24, "S": 1, "T": 39, "RH": -1},
            {"YYYYMMDD": "20250101", "HH": 1, "S": 0, "WW": 67, "IX": 7, "T": 27, "RH": 0},
        ])
        make_archive(self.path("280"), "280", [
            {"YYYYMMDD": "20241231", "HH": 22, "S": 1},
            {"YYYYMMDD": "20250101", "HH": 24, "S": 0, "WW": 87, "IX": 1},
        ])
        make_archive(self.path("209"), "209", [{"YYYYMMDD": "20250101", "HH": 1, "S": 1}])
        out = self.raw / "out"
        build(self.raw, out)
        index = json.loads((out / "index.json").read_text())
        details = json.loads((out / "2024.json").read_text())["days"]
        self.assertEqual(index["years"]["2024"]["all"]["s"], 1)
        self.assertEqual(index["years"]["2025"]["all"]["s"], 0)
        self.assertEqual(index["years"]["2025"]["all"]["extended"], 1)
        self.assertEqual(index["years"]["2025"]["280"]["extended"], 0)
        self.assertEqual(index["years"]["2025"]["280"]["wintry"], 1)
        self.assertEqual(index["winters"]["2025"]["all"]["extended"], 2)
        self.assertEqual(index["months"]["2024-12"]["all"]["coverage"]["s"], [2, 744])
        self.assertEqual(index["offshoreExcludedFromAll"], ["209"])
        first, last = details["2024-12-31"]["260"]["h"]
        self.assertEqual((first[4], first[6]), (38, 0))
        self.assertEqual((last[0], last[6]), (24, -1))

    def test_malformed_source_is_detected(self):
        with ZipFile(self.path("260"), "w") as archive:
            archive.writestr("bron.txt", "# " + ",".join(FIELDS) + "\n260,20250101,1\n")
        with self.assertRaisesRegex(ValueError, "Verkeerd aantal kolommen"):
            list(archive_rows(self.path("260"), "260"))

    def test_duplicate_source_hours_are_detected(self):
        hour = {"YYYYMMDD": "20250101", "HH": 1, "S": 1}
        make_archive(self.path("209"), "209", [hour, hour])
        with self.assertRaisesRegex(ValueError, "Dubbel"):
            build(self.raw, self.raw / "out")


if __name__ == "__main__":
    unittest.main()
