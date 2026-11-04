"""Bronadapter ECMWF Open Data, ensembles (IFS-ENS en AIFS-ENS), 0,25°: ensemblegemiddelde voor het overzicht.

Zelfde interface als ecmwf_opendata, als object per ensemble (IFS_ENS, AIFS_ENS). Open data heeft
geen kant-en-klaar gemiddelde op de gewone stappen (alleen kansproducten op +240/+360), dus per stap
alle leden ophalen (HTTP Range, aangrenzende berichten in één verzoek) en zelf middelen:

- msl, 2t, tcc: gemiddelde over de leden
- neerslag: gemiddelde intensiteit; per lid regen of sneeuw (IFS: ptype, AIFS: sneeuwdeel van de
  6-uurssom), zodat rain + snow samen het ensemblegemiddelde zijn
- isobaren uit het gemiddelde msl: gladder dan één lid, dat is de bedoeling

IFS-ENS: 50 verstoorde leden (`pf`; de controle zit sinds cycle 50r1 niet meer in enfo), stappen
0..144/3 en 150..360/6 bij 00/12 UTC. AIFS-ENS: controle + 50 leden, 0..360/6, staat stap voor stap
online zodra gerekend (00z: +0 om 06:40 UTC), IFS-ENS pas in één keer om 07:40 UTC.
Per stap ±150 MB (IFS) of ±110 MB (AIFS). Land-zeemasker en reliëf uit AIFS Single stap 0.
"""
import json
import re
from concurrent.futures import ThreadPoolExecutor

import numpy as np

from config import PTYPE_FROZEN
from sources import ecmwf_opendata as ifs
from sources import aifs_opendata as aifs

PARALLEL = 12          # gelijktijdige Range-verzoeken per stap
MAX_GAP = 64 * 1024    # berichten die zo dicht bij elkaar liggen in één verzoek


class Ensemble:
    def __init__(self, kind):
        self.kind = kind                        # 'ifs' of 'aifs'
        self.files = ('ef',) if kind == 'ifs' else ('cf', 'pf')
        self.params = ('msl', '2t', 'tcc', 'tprate', 'ptype') if kind == 'ifs' else ('msl', '2t', 'tcc', 'tp', 'sf')
        self.list_runs = ifs.list_runs

    def expected_steps(self, cycle):
        if self.kind == 'aifs':
            return list(range(0, 361, 6))
        return list(range(0, 144, 3)) + list(range(144, 361, 6)) if cycle in (0, 12) else list(range(0, 145, 3))

    def _dir(self, run):
        sub = 'ifs/0p25/enfo' if self.kind == 'ifs' else 'aifs-ens/0p25/enfo'
        return f"{ifs.BASE}/{run:%Y%m%d}/{run:%H}z/{sub}/"

    def _file(self, run, step, f):
        return f"{self._dir(run)}{run:%Y%m%d%H}0000-{step}h-enfo-{f}"

    def available_steps(self, run, res=None):
        r = ifs._get(self._dir(run))
        if r is None:
            return []
        found = [{int(s) for s in re.findall(rf'-(\d+)h-enfo-{f}\.index', r.text)} for f in self.files]
        return sorted(set.intersection(*found))     # AIFS: controle én leden binnen

    def _members(self, run, step, params, domain):
        """{param: {lid: 2D-veld}} voor alle leden van deze stap."""
        jobs = []
        for f in self.files:
            r = ifs._get(self._file(run, step, f) + '.index')
            if r is None:
                return None
            ents = sorted((e for e in map(json.loads, r.text.splitlines())
                           if e.get('levtype') == 'sfc' and e.get('param') in params), key=lambda e: e['_offset'])
            blocks = []
            for e in ents:
                if blocks and e['_offset'] - blocks[-1][1] <= MAX_GAP:
                    blocks[-1][1] = e['_offset'] + e['_length']; blocks[-1][2].append(e)
                else:
                    blocks.append([e['_offset'], e['_offset'] + e['_length'], [e]])
            jobs += [(self._file(run, step, f) + '.grib2', b) for b in blocks]

        def get(job):
            url, (a, b, ents) = job
            r = ifs._get(url, headers={'Range': f'bytes={a}-{b - 1}'})
            if r is None or len(r.content) != b - a:
                return []
            out = []
            for e in ents:
                msg = r.content[e['_offset'] - a:e['_offset'] - a + e['_length']]
                out.append((e['param'], e.get('number', '0'), _decode(msg, domain)))
            return out

        fields = {p: {} for p in params}
        with ThreadPoolExecutor(PARALLEL) as ex:
            for res in ex.map(get, jobs):
                for p, n, v in res:
                    fields[p][n] = v
        return fields

    def fetch_step(self, run, step, domain, res='0p25'):
        m = self._members(run, step, self.params, domain)
        if m is None:
            return None
        out, missing = {}, []
        mean = lambda p: np.mean(np.stack(list(m[p].values())), axis=0) if m[p] else None
        if m['msl']:
            out['msl'] = mean('msl') / 100.0
        if m['2t']:
            out['t2m'] = mean('2t') - 273.15
        if m['tcc']:
            out['tcc'] = np.clip(mean('tcc') * (100.0 if self.kind == 'ifs' else 1.0), 0, 100)
        rate = frozen = None
        if self.kind == 'ifs' and m['tprate'] and m['ptype']:
            keys = sorted(set(m['tprate']) & set(m['ptype']))
            rate = np.stack([np.clip(m['tprate'][k], 0, None) * 3600.0 for k in keys])
            frozen = np.stack([np.isin(np.nan_to_num(m['ptype'][k]).astype(np.int16), PTYPE_FROZEN) for k in keys])
        elif self.kind == 'aifs' and step >= 6:
            prev = self._members(run, step - 6, ('tp', 'sf'), domain)
            keys = sorted(set(m['tp']) & set(prev['tp'] if prev else ()))
            if keys:
                dtp = np.stack([np.clip(m['tp'][k] - prev['tp'][k], 0, None) for k in keys])
                dsf = np.stack([np.clip(m['sf'][k] - prev['sf'][k], 0, None) if k in m['sf'] and k in prev['sf'] else np.zeros_like(m['tp'][k]) for k in keys])
                rate, frozen = dtp / 6.0, dsf >= 0.5 * np.maximum(dtp, 1e-6)
        if rate is not None:
            out['rain'] = np.where(frozen, 0.0, rate).mean(axis=0)
            out['snow'] = np.where(frozen, rate, 0.0).mean(axis=0)
        elif step > 0:
            missing.append('prate')
        if step == 0:                                # vaste lagen uit AIFS Single (zelfde 0,25°-raster)
            st = aifs._fields(run, 0, domain, {'lsm', 'z'}) or {}
            if 'lsm' in st and 'z' in st:
                out['lsm'] = np.clip(st['lsm'], 0, 1)
                out['orog'] = st['z'] / 9.80665
        out['_missing'] = missing + [p for p in ('msl', '2t', 'tcc') if not m[p]]
        return out


def _decode(msg, domain):
    gid = ifs.eccodes.codes_new_from_message(msg)
    try:
        nj, ni, si, sj = ifs._grid_slice(gid, domain)
        v = ifs.eccodes.codes_get_values(gid).reshape(nj, ni)[si, sj].astype(np.float32)
        if ifs.eccodes.codes_get(gid, 'bitmapPresent'):
            v[v == ifs.eccodes.codes_get(gid, 'missingValue')] = np.nan
        return v
    finally:
        ifs.eccodes.codes_release(gid)


IFS_ENS = Ensemble('ifs')
AIFS_ENS = Ensemble('aifs')
