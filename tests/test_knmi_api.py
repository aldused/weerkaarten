import json
import sys
import tempfile
import time
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

import knmi_api  # noqa: E402


class Antwoord:
    def __init__(self, status_code, text="", headers=None):
        self.status_code = status_code
        self.text = text
        self.headers = headers or {}


class KnmiApiTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.echt_pad = knmi_api._CIRCUIT_PATH
        self.echte_get = knmi_api.requests.get
        self.echte_sleep = knmi_api.time.sleep
        self.echte_idx = knmi_api._actieve_key_idx
        knmi_api._CIRCUIT_PATH = str(Path(self.tmp.name) / "circuit.json")
        knmi_api._actieve_key_idx = 0

    def tearDown(self):
        knmi_api._CIRCUIT_PATH = self.echt_pad
        knmi_api.requests.get = self.echte_get
        knmi_api.time.sleep = self.echte_sleep
        knmi_api._actieve_key_idx = self.echte_idx
        self.tmp.cleanup()

    def test_alle_quota_opent_gedeeld_circuit(self):
        aanroepen = []

        def quota(*args, **kwargs):
            aanroepen.append(1)
            return Antwoord(403, '{"error":"Quota exceeded"}', {"Retry-After": "17"})

        knmi_api.requests.get = quota
        with self.assertRaises(knmi_api.KnmiQuotaError):
            knmi_api.knmi_get("https://api.dataplatform.knmi.nl/edr/v1/collections/test")

        self.assertEqual(len(aanroepen), len(knmi_api.KNMI_KEYS))
        status = json.loads(Path(knmi_api._CIRCUIT_PATH).read_text())
        self.assertGreater(status["blocked_until"], time.time() + 15)

        # Een volgende logische aanvraag wordt zonder vijf nieuwe HTTP-calls gestopt.
        with self.assertRaises(knmi_api.KnmiQuotaError):
            knmi_api.knmi_get("https://api.dataplatform.knmi.nl/edr/v1/collections/test")
        self.assertEqual(len(aanroepen), len(knmi_api.KNMI_KEYS))

    def test_5xx_krijgt_begrensde_backoff(self):
        antwoorden = [Antwoord(503), Antwoord(200)]
        wachttijden = []
        knmi_api.requests.get = lambda *args, **kwargs: antwoorden.pop(0)
        knmi_api.time.sleep = wachttijden.append

        antwoord = knmi_api.knmi_get("https://api.dataplatform.knmi.nl/edr/v1/collections/test")

        self.assertEqual(antwoord.status_code, 200)
        self.assertEqual(wachttijden, [0.5])

    def test_niet_quota_403_roteert_naar_volgende_key(self):
        antwoorden = [Antwoord(403, "forbidden"), Antwoord(200)]
        knmi_api.requests.get = lambda *args, **kwargs: antwoorden.pop(0)

        antwoord = knmi_api.knmi_get("https://api.dataplatform.knmi.nl/edr/v1/collections/test")

        self.assertEqual(antwoord.status_code, 200)
        self.assertEqual(knmi_api._actieve_key_idx, 1)

    def test_gemengde_quota_en_403_opent_circuit(self):
        antwoorden = [Antwoord(403, "invalid key")] + [
            Antwoord(403, '{"error":"Quota exceeded"}', {"Retry-After": "17"})
            for _ in range(len(knmi_api.KNMI_KEYS) - 1)
        ]
        aanroepen = []

        def antwoord(*args, **kwargs):
            aanroepen.append(1)
            return antwoorden.pop(0)

        knmi_api.requests.get = antwoord

        with self.assertRaises(knmi_api.KnmiQuotaError):
            knmi_api.knmi_get("https://api.dataplatform.knmi.nl/edr/v1/collections/test")

        self.assertEqual(len(aanroepen), len(knmi_api.KNMI_KEYS))
        status = json.loads(Path(knmi_api._CIRCUIT_PATH).read_text())
        self.assertGreater(status["blocked_until"], time.time() + 15)

    def test_edr_circuit_blokkeert_open_data_api_niet(self):
        Path(knmi_api._CIRCUIT_PATH).write_text(
            json.dumps({"blocked_until": time.time() + 300, "reason": "test"})
        )
        knmi_api.requests.get = lambda *args, **kwargs: Antwoord(200)

        antwoord = knmi_api.knmi_get(
            "https://api.dataplatform.knmi.nl/open-data/v1/datasets/test"
        )

        self.assertEqual(antwoord.status_code, 200)


if __name__ == "__main__":
    unittest.main()
