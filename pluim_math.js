(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.WeerlabPlumeMath = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const HOUR_MS = 60 * 60 * 1000;

  function finiteNumber(value) {
    if (value == null || value === '') return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }

  function quantile(values, probability) {
    const sorted = values.map(finiteNumber).filter(Number.isFinite).sort((a, b) => a - b);
    if (!sorted.length) return null;
    const p = Math.max(0, Math.min(1, Number(probability)));
    const index = (sorted.length - 1) * p;
    const lower = Math.floor(index);
    const upper = Math.ceil(index);
    return sorted[lower] + (sorted[upper] - sorted[lower]) * (index - lower);
  }

  function mean(values) {
    const finite = values.map(finiteNumber).filter(Number.isFinite);
    return finite.length ? finite.reduce((sum, value) => sum + value, 0) / finite.length : null;
  }

  function perturbedMemberKeys(hourly, base) {
    const prefix = `${base}_member`;
    return Object.keys(hourly || {})
      .filter(key => key.startsWith(prefix) && /^\d+$/.test(key.slice(prefix.length)))
      .sort((a, b) => Number(a.slice(prefix.length)) - Number(b.slice(prefix.length)));
  }

  function ensembleMemberKeys(hourly, base) {
    const keys = perturbedMemberKeys(hourly, base);
    return Array.isArray(hourly?.[base]) ? [base, ...keys] : keys;
  }

  function utcIso(date) {
    return date.toISOString().slice(0, 16) + 'Z';
  }

  function asDate(value) {
    if (value instanceof Date) return new Date(value.getTime());
    const date = new Date(value);
    return Number.isFinite(date.getTime()) ? date : null;
  }

  function isUtcBoundary(date, hours) {
    return date.getUTCMinutes() === 0 && date.getUTCSeconds() === 0 && date.getUTCHours() % hours === 0;
  }

  // Open-Meteo-neerslag staat op het EINDE van het voorafgaande modelinterval.
  // Deze routine maakt daarom uitsluitend complete, rechts-gelabelde klokvakken.
  // Hij werkt ook wanneer de native modelstap binnen de reeks van 3 naar 6 uur gaat.
  function aggregatePrecedingHours(times, members, hours = 6, options = {}) {
    const dates = (times || []).map(asDate);
    if (!dates.length || dates.some(date => !date)) {
      return { times: [], endDates: [], members: [], groups: [] };
    }
    const milliseconds = dates.map(date => date.getTime());
    const windowMs = hours * HOUR_MS;
    const steps = milliseconds.map((time, index) => {
      if (index > 0) return time - milliseconds[index - 1];
      return milliseconds.length > 1 ? milliseconds[1] - time : 0;
    });
    const groups = [];

    dates.forEach((endDate, endIndex) => {
      if (!isUtcBoundary(endDate, hours)) return;
      const endMs = milliseconds[endIndex];
      const startMs = endMs - windowMs;
      const idxs = [];
      let coveredMs = 0;
      let wholeIntervals = true;
      for (let index = endIndex; index >= 0 && milliseconds[index] > startMs; index--) {
        const stepMs = steps[index];
        if (!(stepMs > 0) || stepMs > windowMs + 1000) continue;
        const intervalStart = milliseconds[index] - stepMs;
        const overlap = Math.max(0, Math.min(milliseconds[index], endMs) - Math.max(intervalStart, startMs));
        if (overlap > 0) {
          idxs.unshift(index);
          coveredMs += overlap;
          if (Math.abs(overlap - stepMs) > 1000) wholeIntervals = false;
        }
      }
      const complete = wholeIntervals && coveredMs >= windowMs - 1000;
      const isInitial = endIndex === 0 && options.keepInitialZero !== false;
      const initialValues = (members || []).flatMap(member => idxs.map(index => finiteNumber(member?.[index]))).filter(Number.isFinite);
      const zeroInitial = isInitial && initialValues.length > 0 && initialValues.every(value => Math.abs(value) < 1e-9);
      if (complete || zeroInitial) groups.push({ endDate, endIndex, idxs, complete, initial: zeroInitial && !complete });
    });

    const aggregatedMembers = (members || []).map(member => groups.map(group => {
      if (group.initial) return 0;
      const values = group.idxs.map(index => finiteNumber(member?.[index]));
      if (!values.length || values.some(value => !Number.isFinite(value))) return null;
      return values.reduce((sum, value) => sum + Math.max(0, value), 0);
    }));

    return {
      times: groups.map(group => utcIso(group.endDate)),
      endDates: groups.map(group => new Date(group.endDate.getTime())),
      members: aggregatedMembers,
      groups,
    };
  }

  function cumulativeMembers(members) {
    return (members || []).map(member => {
      let total = 0;
      let complete = true;
      return member.map(value => {
        const number = finiteNumber(value);
        if (!Number.isFinite(number)) complete = false;
        if (!complete) return null;
        total += Math.max(0, number);
        return total;
      });
    });
  }

  function kmhToBeaufort(kmh) {
    const value = finiteNumber(kmh);
    if (!Number.isFinite(value)) return null;
    const lowerBounds = [1, 6, 12, 20, 29, 39, 50, 62, 75, 89, 103, 118];
    let beaufort = 0;
    lowerBounds.forEach((bound, index) => {
      if (value >= bound) beaufort = index + 1;
    });
    return beaufort;
  }

  function markUtcTimes(data) {
    const mark = value => typeof value === 'string' && !/(?:Z|[+-]\d\d:\d\d)$/.test(value) ? `${value}Z` : value;
    if (Array.isArray(data?.hourly?.time)) data.hourly.time = data.hourly.time.map(mark);
    return data;
  }

  return {
    aggregatePrecedingHours,
    cumulativeMembers,
    ensembleMemberKeys,
    finiteNumber,
    kmhToBeaufort,
    markUtcTimes,
    mean,
    perturbedMemberKeys,
    quantile,
  };
});
