import json
import math
import sys
import tempfile
import unittest
from datetime import date, timedelta
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

import maak_toplijst as toplijst  # noqa: E402


def dekking(station_id="0-20000-0-06260"):
    tijden = [
        "2026-08-08T00:10:00Z",
        "2026-08-08T00:20:00Z",
        "2026-08-08T00:30:00Z",
        "2026-08-08T00:40:00Z",
        "2026-08-08T00:50:00Z",
        "2026-08-08T01:00:00Z",
    ]
    waarden = {
        "ta": [10, 11, 12, 13, 14, 15],
        "tx": [None, None, None, None, None, 15.2],
        "tn": [9.8, None, None, None, None, None],
        "fx": [2, 3, 4, 5, 6, 7],
        "ff": [1, 2, 3, 4, 5, 6],
        "dd": [270, 270, 270, 270, 270, 270],
        "tgn": [8, 7, 6, 5, 4, 3],
        "qg": [0, 119, 120, 121, 200, 0],
        "rg": [0, 0.6, 1.2, 0, 0, 0],
    }
    return {
        "type": "Coverage",
        "eumetnet:locationId": station_id,
        "domain": {"axes": {"t": {"values": tijden}}},
        "ranges": {naam: {"values": reeks} for naam, reeks in waarden.items()},
    }


class ToplijstBerekeningTest(unittest.TestCase):
    def test_daguitersten_merge_behoudt_alle_stations(self):
        oud = [[30.0, "A", "14:00"], [28.0, "B", "13:00"]]
        nieuw = [[31.0, "A", "15:00"], [27.0, "B", "15:00"], [29.0, "C", "15:00"]]

        resultaat = toplijst.voeg_daguitersten_samen(oud, nieuw, "max")

        self.assertEqual([rij[1] for rij in resultaat], ["A", "C", "B"])
        self.assertEqual(resultaat[0], [31.0, "A", "15:00"])
        self.assertEqual(resultaat[-1], [28.0, "B", "13:00"])

    def test_rollende_reeks_vervangt_verse_en_vult_ontbrekende_aan(self):
        oud = [[5.0, "A", "12:00"], [4.0, "B", "12:00"]]
        nieuw = [[1.0, "A", "16:00"]]

        resultaat = toplijst.voeg_ontbrekende_stations_toe(oud, nieuw, "max")

        self.assertEqual({rij[1]: rij[0] for rij in resultaat}, {"A": 1.0, "B": 4.0})

    def test_dekking_wordt_eenmalig_voor_alle_metrics_gebruikt(self):
        cov = dekking()

        temp_wind = toplijst.haal_temp_wind_uit_dekking(cov)
        anker = toplijst.hoogste_anker_uur_uit_dekking(cov)
        t10n, _ = toplijst.haal_t10n_uit_dekking(cov)
        zon, _ = toplijst.haal_zon_uit_dekking(cov)
        regen, _ = toplijst.haal_neerslag_uit_dekking(cov)

        self.assertEqual(temp_wind["tx"], 15.2)
        self.assertEqual(temp_wind["tn"], 9.8)
        self.assertEqual(temp_wind["fx"], 7.0)
        self.assertTrue(math.isclose(anker["ff"], 3.5))
        self.assertEqual(anker["dd"], 270)
        self.assertEqual(t10n, 3.0)
        self.assertEqual(zon, 0.5)
        self.assertEqual(regen, 0.3)

    def test_bulk_opvraag_batcht_alle_stations(self):
        aanroepen = []

        class Antwoord:
            status_code = 200

            def __init__(self, ids):
                self.ids = ids

            def raise_for_status(self):
                return None

            def json(self):
                return {"type": "CoverageCollection", "coverages": [dekking(i) for i in self.ids]}

        def nep_knmi_get(url, params=None, timeout=None):
            ids = url.rsplit("/locations/", 1)[1].split(",")
            aanroepen.append((ids, params, timeout))
            return Antwoord(ids)

        echt_knmi_get = toplijst.knmi_get
        try:
            toplijst.knmi_get = nep_knmi_get
            resultaat = toplijst.haal_bulk_dekkingen("2026-08-08T00:00:00Z/2026-08-08T01:00:00Z")
        finally:
            toplijst.knmi_get = echt_knmi_get

        self.assertEqual(len(resultaat), len(toplijst.STATIONS))
        self.assertEqual(len(aanroepen), math.ceil(len(toplijst.STATIONS) / toplijst.BULK_BATCH_SIZE))
        self.assertTrue(all(call[1]["parameter-name"] == toplijst.BULK_PARAMETERS for call in aanroepen))

    def test_bulk_behoudt_eerdere_batches_bij_late_fout(self):
        aanroepen = 0

        class Antwoord:
            status_code = 200

            def __init__(self, ids):
                self.ids = ids

            def raise_for_status(self):
                return None

            def json(self):
                return {"type": "CoverageCollection", "coverages": [dekking(i) for i in self.ids]}

        def nep_knmi_get(url, params=None, timeout=None):
            nonlocal aanroepen
            aanroepen += 1
            if aanroepen == 3:
                raise RuntimeError("tijdelijke batchfout")
            ids = url.rsplit("/locations/", 1)[1].split(",")
            return Antwoord(ids)

        echt_knmi_get = toplijst.knmi_get
        try:
            toplijst.knmi_get = nep_knmi_get
            resultaat = toplijst.haal_bulk_dekkingen(
                "2026-08-08T00:00:00Z/2026-08-08T01:00:00Z"
            )
        finally:
            toplijst.knmi_get = echt_knmi_get

        self.assertEqual(aanroepen, 3)
        self.assertEqual(len(resultaat), 2 * toplijst.BULK_BATCH_SIZE)

    def test_eerste_degraded_dagrun_schrijft_niet(self):
        with tempfile.TemporaryDirectory() as tmp:
            pad = Path(tmp) / "toplijst.json"
            gisteren = (date.today() - timedelta(days=1)).isoformat()
            bestaand = {
                gisteren: {
                    "status": "definitief",
                    "max": [[20.0, "De Bilt", "14:00"]],
                }
            }
            oorspronkelijke_bytes = json.dumps(
                bestaand, indent=2, ensure_ascii=False
            ).encode("utf-8")
            # Geldige JSON met bewust herkenbare formattering; main() mag het
            # bestand bij een gedegradeerde eerste dagrun niet herschrijven.
            pad.write_bytes(oorspronkelijke_bytes)

            echt_pad = toplijst.JSON_PATH
            echte_start = toplijst.HISTORIE_START
            echte_haal_dag = toplijst.haal_dag
            try:
                toplijst.JSON_PATH = str(pad)
                toplijst.HISTORIE_START = date.today()
                toplijst.haal_dag = lambda dag: {
                    "datum": dag.isoformat(),
                    "status": "voorlopig",
                    "bronstatus": "degraded",
                    "max": [],
                }
                resultaat = toplijst.main()
            finally:
                toplijst.JSON_PATH = echt_pad
                toplijst.HISTORIE_START = echte_start
                toplijst.haal_dag = echte_haal_dag

            self.assertEqual(resultaat, 2)
            self.assertEqual(pad.read_bytes(), oorspronkelijke_bytes)


if __name__ == "__main__":
    unittest.main()
