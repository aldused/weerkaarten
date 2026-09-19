"""Exercise the actual adapter functions on small member/space/time fixtures.

Extract function definitions to avoid invoking network/production file I/O in
legacy script entry points. The functions tested are the production definitions.
"""
import ast
import unittest
import sys
from pathlib import Path
from datetime import datetime, timedelta, timezone, date
import numpy as np
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from probability import complete_day_indices, event_probability, cumulative_windows, hourly_windows
ROOT=Path(__file__).resolve().parents[1]


def functions(filename, names, env):
    tree=ast.parse((ROOT/filename).read_text())
    nodes=[n for n in ast.walk(tree) if isinstance(n,ast.FunctionDef) and n.name in names]
    exec(compile(ast.Module(body=nodes,type_ignores=[]),filename,'exec'),env)
    return env


class AdapterTests(unittest.TestCase):
    def test_harmonie_parameter_identity(self):
        import os
        os.environ.setdefault('KNMI_API_KEY','test-placeholder')
        import fetch_harmoneps as h
        self.assertEqual(h.PARAM_MAP[(209,'entireAtmosphere',0)],'lightning')
        self.assertEqual(h.PARAM_MAP[(186,'entireAtmosphere',0)],'cloudbase')
        self.assertNotIn('cape',h.WANT_KEYS)
        from unittest.mock import patch
        keys=dict(indicatorOfParameter=181,typeOfLevel='heightAboveGround',level=0,timeRangeIndicator=0)
        with patch.object(h.ec,'codes_get',side_effect=lambda gid,key,*args:keys[key]):
            self.assertIsNone(h.parse_grib_message(None))

if __name__=='__main__':unittest.main()
