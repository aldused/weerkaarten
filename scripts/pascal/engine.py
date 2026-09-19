"""Shared event/coverage engine: never turn absent observations into misses."""
from datetime import datetime, time, timedelta, timezone
import numpy as np
from probability import LOCAL_TZ, complete_day_indices


def day_indices(times, day):
    if any(t.tzinfo is None for t in times):
        raise ValueError('Tijdzone ontbreekt')
    utc = [t.astimezone(timezone.utc) for t in times]
    if any(b <= a for a, b in zip(utc, utc[1:])):
        raise ValueError('Tijdas niet strikt oplopend')
    start = datetime.combine(day, time(), LOCAL_TZ).astimezone(timezone.utc)
    end = datetime.combine(day + timedelta(days=1), time(), LOCAL_TZ).astimezone(timezone.utc)
    return [i for i, t in enumerate(utc) if start <= t < end]


def rolling(values, times, duration, cumulative=False, run=None, tolerance=0):
    """Exact elapsed-time windows; missing endpoints/history stay NaN per cell/member."""
    a = np.asarray(values, float)
    out = np.full_like(a, np.nan)
    lookup = {t.astimezone(timezone.utc): i for i, t in enumerate(times)}
    for i, t in enumerate(times):
        t = t.astimezone(timezone.utc)
        start = t - timedelta(hours=duration)
        if cumulative:
            j = lookup.get(start)
            if j is None and start != run: continue
            diff = a[:, i] - (a[:, j] if j is not None else 0)
            out[:, i] = np.where(diff >= -tolerance, np.maximum(diff, 0), np.nan)
        else:
            idx = [lookup.get(t - timedelta(hours=h)) for h in range(duration)]
            if any(j is None for j in idx): continue
            w = a[:, idx]
            valid = np.isfinite(w).all(axis=1) & (w >= 0).all(axis=1)
            out[:, i] = np.where(valid, w.sum(axis=1), np.nan)
    return out


def convection(cape, rain6, times, cadence=1):
    """CAPE maximum and 6h rain at same member/point; use NaN for unknown."""
    a = np.asarray(cape, float)
    out = np.full_like(a, np.nan)
    utc = [t.astimezone(timezone.utc) for t in times]
    for i, t in enumerate(utc):
        start = t - timedelta(hours=6)
        idx = [j for j, s in enumerate(utc) if start <= s <= t]
        if not idx or utc[idx[0]] != start: continue
        if any((utc[b]-utc[c]).total_seconds() > cadence*3600 for c,b in zip(idx,idx[1:])): continue
        maximum = np.max(a[:,idx], axis=1)
        # Rain is tested later; a dry valid window has zero proxy CAPE.
        valid = np.isfinite(maximum) & np.isfinite(rain6[:,i])
        out[:,i] = np.where(valid, np.where(rain6[:,i] >= 2, maximum, 0), np.nan)
    return out


def evaluate(values, times, day, threshold, below=False, cadence=1, member_ids=None):
    """OR over a COMMON observed space/time support, then average valid members.

    Drop entirely absent members first. Exclude members with isolated holes on
    the common support, independent of whether they hit. All-absent points or
    times are omitted and explicitly mark partial coverage. At least two members
    are required; no statistical confidence is inferred from this policy.
    """
    a = np.asarray(values, float)
    if a.ndim == 2: a = a[:,:,None]
    if a.ndim < 3 or a.shape[1] != len(times): raise ValueError('Ongeldige rastervorm')
    a = a.reshape(a.shape[0], a.shape[1], -1)
    idx = day_indices(times, day)
    result = dict(p=None, status='unavailable', reason='', members=0,
                  expected_members=a.shape[0], points=0, expected_points=a.shape[2],
                  hits=0, times=[], available_times=[], member_ids=[], time_complete=False)
    if not idx:
        result['reason'] = 'datum buiten verwachtingstermijn'; return result
    if not a.shape[2]:
        result['reason'] = 'geen rasterpunten in het gebied'; return result
    if not np.isfinite(a[:,idx]).any() and np.isfinite(a).any():
        available=np.where(np.isfinite(a).any(axis=(0,2)))[0]
        if idx[0]>available[-1] or idx[-1]<available[0]:
            result['reason']='datum buiten verwachtingstermijn van deze parameter'; return result
    a = a[:,idx]
    finite = np.isfinite(a)
    active_members = finite.any(axis=(1,2))
    points = finite.any(axis=(0,1))
    time_mask = finite.any(axis=(0,2))
    result['available_times'] = [times[idx[i]].isoformat() for i in np.where(time_mask)[0]]
    if not active_members.any():
        result['reason'] = 'parameter of geldige vensters ontbreken'; return result
    support = a[:,time_mask][:,:,points]
    good = np.isfinite(support).all(axis=(1,2)) & active_members
    n = int(good.sum())
    selected_times = [times[idx[i]] for i in np.where(time_mask)[0]]
    result.update(members=n, points=int(points.sum()), times=[t.isoformat() for t in selected_times],
                  member_ids=[(member_ids or list(range(a.shape[0])))[i] for i in np.where(good)[0]])
    if n < 2:
        result['reason'] = 'onvoldoende volledige ensembleleden (minimaal 2)'; return result
    v = support[good]
    hits = (v <= threshold if below else v >= threshold).any(axis=(1,2))
    complete = bool(complete_day_indices(selected_times, day, cadence))
    partial = not complete or n < a.shape[0] or not points.all()
    reasons = []
    if not complete: reasons.append('gedeeltelijke tijddekking')
    if not points.all(): reasons.append('geen volledige gebiedsdekking')
    if n < a.shape[0]: reasons.append('ontbrekende leden uitgesloten')
    result.update(p=float(100*hits.mean()), hits=int(hits.sum()), time_complete=complete,
                  status='partial' if partial else 'complete', reason='; '.join(reasons) or 'volledige bemonsterde dekking')
    return result


def visibility_m(values, units):
    factors = {'m':1, 'km':1000}
    if units not in factors: raise ValueError('Onbekende zichteenheid: '+units)
    a = np.asarray(values, float)*factors[units]
    return np.where(a >= 0, a, np.nan)
