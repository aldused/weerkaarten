import {availableForecastFrames, DATA_ROOT, FORECAST_DAYS, HOUR, runPath} from './core.mjs';

// Metadata-only polling must not rebuild the map for an unchanged, unfinished
// or stale run. The newest timeline source can differ from the selected tail.
export function isNewerForecastRun(latest, timeline, now=Date.now()) {
  try {
    availableForecastFrames(latest,now);
    const run=Date.parse(latest.reference_time);
    const current=Math.max(...timeline.map(frame=>Date.parse(frame.reference_time)));
    return Number.isFinite(current)&&run<=now&&run>current;
  } catch { return false; }
}

/** Find the newest usable short run and a full run for its remaining horizon. */
export async function discoverForecastRuns(loadJSON, now = Date.now()) {
  if (typeof loadJSON !== 'function' || !Number.isFinite(now)) throw new Error('Ongeldige ECMWF-bron of huidige tijd');
  const latest = await loadJSON(`${DATA_ROOT}/latest.json`);
  const reference = Date.parse(latest?.reference_time);
  if (!Number.isFinite(reference) || reference % (6 * HOUR)) throw new Error('ECMWF-modeltijd ontbreekt of is ongeldig');
  const metas = [latest];
  const usable = () => {
    try { combinedForecastFrames(metas, now); return true; } catch { return false; }
  };
  if (usable()) return metas;
  // Check every six-hour run. When latest is an incomplete 00/12 UTC run,
  // the preceding 18/06 UTC run is still the freshest source for nearby days.
  for (let back = 6; back <= 36; back += 6) {
    const run = reference - back * HOUR;
    try {
      const candidate = await loadJSON(`${DATA_ROOT}/${runPath(run)}/meta.json`);
      // A cache or server response from a different run cannot satisfy this URL.
      if (Date.parse(candidate?.reference_time) !== run) continue;
      metas.push(candidate);
      if (usable()) return metas;
    } catch {
      // A missing or still incomplete prior run does not hide older valid runs.
    }
  }
  throw new Error('Geen volledige ECMWF-verwachting voor tien dagen beschikbaar');
}

/**
 * Prefer the newest complete run, retaining an older complete run only beyond
 * its shorter horizon. All fields for a frame must be read using frame.url and
 * frame.modelMeta. Never subtract amounts across the sourceChanged boundary.
 * Invalid candidates are discarded; an uncovered ten-day horizon is an error.
 */
export function combinedForecastFrames(metas, now = Date.now()) {
  if (!Array.isArray(metas) || !Number.isFinite(now)) throw new Error('Ongeldige ECMWF-modelruns of huidige tijd');
  const candidates = [];
  const seen = new Set();
  for (const modelMeta of metas) {
    try {
      const frames = availableForecastFrames(modelMeta, now);
      const run = Date.parse(modelMeta.reference_time);
      // Do not accept an uninitialised future model run as an actual forecast.
      if (run > now || seen.has(run)) continue;
      seen.add(run);
      candidates.push({modelMeta, run, frames});
    } catch {
      // latest.json can be incomplete while a preceding run is still usable.
    }
  }
  candidates.sort((a, b) => b.run - a.run);
  if (!candidates.length) throw new Error('Geen complete ECMWF-modelrun beschikbaar');
  const primary = candidates[0];
  const end = primary.frames[0].time + FORECAST_DAYS * 24 * HOUR;
  const selected = [{candidate: primary, frames: primary.frames}];
  if (primary.frames.at(-1).time < end) {
    // Select one older source that covers the whole remainder. Do not construct
    // an arbitrary patchwork of incomplete runs or silently leave a data gap.
    const fallback = candidates.slice(1).find(candidate => candidate.frames.at(-1).time >= end);
    if (!fallback) throw new Error('Geen complete ECMWF-run voor de resterende tien dagen beschikbaar');
    const boundary = primary.frames.at(-1).time;
    const tail = fallback.frames.filter(frame => frame.time > boundary);
    if (!tail.length || tail[0].time - tail[0].hours * HOUR !== boundary) {
      throw new Error('ECMWF-modelruns sluiten niet aan op hetzelfde neerslagtijdvak');
    }
    selected.push({candidate: fallback, frames: tail});
  }
  const result = [];
  for (const {candidate, frames} of selected) {
    for (const frame of frames) {
      const previous = result.at(-1);
      result.push({
        ...frame,
        modelMeta: candidate.modelMeta,
        reference_time: candidate.modelMeta.reference_time,
        sourceChanged: Boolean(previous && Date.parse(previous.reference_time) !== candidate.run),
        olderRun: candidate !== primary,
      });
      // Keep the first native step reaching the requested horizon. Do not
      // invent/interpolate an extra timestamp at the ten-day boundary.
      if (frame.time >= end) return result;
    }
  }
  throw new Error('ECMWF-tijdreeks bereikt geen volledige tien dagen');
}
