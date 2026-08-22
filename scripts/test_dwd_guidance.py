#!/usr/bin/env python3
"""Gerichte regressietests voor de DWD-vertaling en dagindeling."""

import importlib.util
import json
import pathlib
import re
import unittest


MODULE_PATH = pathlib.Path(__file__).with_name("haal_dwd_guidance.py")
SPEC = importlib.util.spec_from_file_location("haal_dwd_guidance", MODULE_PATH)
DWD = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(DWD)


class FakeResponse:
    def __init__(self, vertaald):
        self.vertaald = vertaald

    def raise_for_status(self):
        return None

    def json(self):
        return [[[self.vertaald, "bron"]], None, "de"]


class FakeSession:
    def __init__(self, vertaal=None):
        self.vertaal = vertaal or (lambda tekst: tekst)
        self.queries = []

    def get(self, _url, *, params, **_kwargs):
        self.queries.append(params["q"])
        return FakeResponse(self.vertaal(params["q"]))


class DwdGuidanceTests(unittest.TestCase):
    def test_mittelfrist_wordt_per_dag_gesplitst(self):
        bron = (
            "Synoptische Entwicklung bis Freitag 24 UTC\n\n"
            "Eingangs der Mittelfrist am nächsten Montag bleibt es trocken. "
            "Am Dienstag kommt Regen. Am Mittwoch folgen Schauer."
        )
        blokken = DWD.maak_bronblokken(bron)
        self.assertIn("DAG_NL:Maandag", blokken)
        self.assertTrue(any(blok.startswith("Am Dienstag") for blok in blokken))
        self.assertTrue(any(blok.startswith("Am Mittwoch") for blok in blokken))

    def test_vaktermen_overleven_de_vertaler(self):
        sessie = FakeSession(lambda tekst: tekst.replace(" mit ", " met "))
        vertaald = DWD._vertaal_google("Höhentrog mit Starkregen", sessie)
        self.assertEqual(vertaald, "Hoogtetrog met zware regenval")
        self.assertIn("METEO000WX", sessie.queries[0])
        self.assertIn("METEO001WX", sessie.queries[0])

    def test_bekende_missers_worden_opgeruimd(self):
        tekst = "Hoge droesem met zware krabben en rookvlekken."
        self.assertEqual(
            DWD.corrigeer_vertaling(tekst),
            "Hoogtetrog met zware regenval en pluimen.",
        )

    def test_uitgiftedatum_wordt_nederlands(self):
        self.assertEqual(
            DWD.vertaal_uitgiftedatum("Samstag, den 18.07.2026 um 08 UTC"),
            "zaterdag 18 juli 2026 om 08.00 UTC",
        )

    def test_documentkop_verdwijnt_en_dagmarker_blijft(self):
        bron = (
            "S Y N O P T I S C H E   Ü B E R S I C H T   M I T T E L F R I S T\n\n"
            "ausgegeben am Freitag, den 17.07.2026 um 10.30 UTC\n\n"
            "Eingangs der Mittelfrist am nächsten Montag bleibt es trocken."
        )
        vertaald = DWD.vertaal_tekst(bron, sessie=FakeSession())
        self.assertNotIn("S Y N O", vertaald)
        self.assertNotIn("ausgegeben", vertaald)
        self.assertTrue(vertaald.startswith("DAG: Maandag\n\n"))

    def test_huidige_json_bevat_geen_bekende_missers(self):
        data = json.loads((MODULE_PATH.parent.parent / "dwd_guidance.json").read_text())
        tekst = "\n".join(
            data[termijn]["translated"] for termijn in ("kurzfrist", "mittelfrist")
        )
        foutpatroon = re.compile(
            r"zware krabben|hoge droesem|rookvlekken|dieplopers|stormboeien|"
            r"stormbogen|schurende regen|METEO\d+WX|DAG_NL",
            re.IGNORECASE,
        )
        self.assertIsNone(foutpatroon.search(tekst))
        self.assertIn("DAG: Dinsdag", data["mittelfrist"]["translated"])


if __name__ == "__main__":
    unittest.main()
