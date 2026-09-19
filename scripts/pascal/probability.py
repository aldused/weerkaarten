"""Legacy strict-window helpers and shared model blending.

Production coverage-aware event evaluation lives in engine.py. The strict
helpers remain for older callers and regression comparisons.
"""
from datetime import datetime, time, timedelta, timezone
from zoneinfo import ZoneInfo
import numpy as np

METHOD_VERSION = 3
LOCAL_TZ = ZoneInfo("Europe/Amsterdam")


def complete_day_indices(times, day, cadence_hours=1):
    """Full local day on the model's sampling grid (including 23/25-hour days)."""
    start = datetime.combine(day, time(), LOCAL_TZ).astimezone(timezone.utc)
    end = datetime.combine(day + timedelta(days=1), time(), LOCAL_TZ).astimezone(timezone.utc)
    utc = [t.astimezone(timezone.utc) for t in times]
    indices = [i for i, t in enumerate(utc) if start <= t < end]
    if not indices:
        return []
    selected = [utc[i] for i in indices]
    step = timedelta(hours=cadence_hours)
    if selected[0] - start >= step or end - selected[-1] > step:
        return []
    if any(b <= a or b - a > step for a, b in zip(selected, selected[1:])):
        return []
    return indices


def event_probability(values, threshold, below=False):
    """OR in space/time per member, then mean over members, in percent."""
    a = np.asarray(values, dtype=float)
    if a.ndim < 2 or not a.size or not np.isfinite(a).all():
        return None
    events = a <= threshold if below else a >= threshold
    hits = events.reshape(a.shape[0], -1).any(axis=1)
    return float(100 * hits.mean())


def cumulative_windows(values, hours, end_indices, duration=24):
    """Exact cumulative differences. No shortening or extrapolated start.

    A cumulative field has a known zero at lead 0, even if no step-0 file is
    supplied. Negative differences (reset/corruption) invalidate the window.
    """
    a = np.asarray(values, dtype=float)
    if not end_indices:
        return None
    lookup = {h: i for i, h in enumerate(hours)}
    out = []
    for i in end_indices:
        start = hours[i] - duration
        if start < 0 or (start != 0 and start not in lookup):
            return None
        base = a[:, lookup[start]] if start in lookup else 0
        diff = a[:, i] - base
        if not np.isfinite(diff).all() or (diff < -1e-6).any():
            return None
        out.append(np.maximum(diff, 0))
    return np.stack(out, axis=1)


def hourly_windows(values, end_indices, duration=24):
    """Hourly interval totals, including the hour ending at each index."""
    a = np.asarray(values, dtype=float)
    if not end_indices or min(end_indices) < duration - 1:
        return None
    out = []
    for i in end_indices:
        window = a[:, i-duration+1:i+1]
        if not np.isfinite(window).all() or (window < 0).any():
            return None
        out.append(window.sum(axis=1))
    return np.stack(out, axis=1)


def blend(contributions, weighting="model"):
    """Experimental equal-model mixture, or explicit member-weighted pooling.

    contributions contain one (p, member count) per model family, never duplicate
    delivery routes of the same ensemble. Keep precision until presentation.
    """
    if weighting not in ("model", "member"):
        raise ValueError("Unknown weighting")
    valid = [(p, n) for p, n in contributions
             if p is not None and np.isfinite(p) and 0 <= p <= 100
             and n is not None and np.isfinite(n) and n > 0]
    if not valid:
        return None
    weights = [1 if weighting == "model" else n for p, n in valid]
    return sum(p * w for (p, n), w in zip(valid, weights)) / sum(weights)
