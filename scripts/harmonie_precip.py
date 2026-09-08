"""HARMONIE precipitation: distinguish accumulated mass and instantaneous flux.

KNMI GRIB1: parameter 181, level type 105, level 0, TRI 0 is rain
intensity (kg m-2 s-1); TRI 4 is accumulated rain (kg m-2).
https://english.knmidata.nl/latest/news/2021/09/27/short-newsmessage-new-dataset-harmonie-keps
https://www.knmidata.nl/open-data/harmonie
"""
import numpy as np


RADAR_METHOD = 'instantaneous_rain_marshall_palmer_v1'


def grib1_precip_kind(parameter, level_type, level, tri):
    """Do not confuse column integrals or accumulated rain with surface flux."""
    if level_type != 105 or level != 0:
        return None
    if parameter == 61 and tri == 4:
        return 'cum'
    if parameter == 181 and tri == 0:
        return 'regenrate'
    return None


def rain_rate_mm_h(flux):
    """kg m-2 s-1 → mm/h (water equivalent). Missing is not dry."""
    flux = np.asarray(flux, dtype=np.float64)
    if not np.isfinite(flux).all() or np.any(flux < -1e-7):
        raise ValueError('Invalid instantaneous rain flux')
    return np.maximum(flux, 0) * 3600.0


def rain_rate_to_dbz(rate):
    """Rain-only proxy Z=200 R^1.6, with R in mm/h; no reflectivity gain."""
    rate = np.asarray(rate, dtype=np.float64)
    if not np.isfinite(rate).all() or np.any(rate < 0):
        raise ValueError('Invalid rain rate')
    return np.where(rate >= 0.05,
                    10 * np.log10(200 * np.maximum(rate, 0.001) ** 1.6), 0)


def hourly_from_accumulation(accumulated):
    """Difference consecutive hourly GRIB accumulations before byte encoding.

    Small negative GRIB packing errors are clipped; a reset or missing field
    must not silently produce a plausible-looking precipitation series.
    """
    if len(accumulated) < 2 or any(v is None for v in accumulated):
        raise ValueError('Missing precipitation accumulation')
    result = []
    for previous, current in zip(accumulated, accumulated[1:]):
        if previous.shape != current.shape:
            raise ValueError('Precipitation grid changed')
        delta = np.asarray(current, dtype=np.float64) - previous
        if not np.isfinite(delta).all() or np.any(delta < -0.02):
            raise ValueError('Precipitation accumulation reset or invalid')
        result.append(np.maximum(delta, 0))
    return result
