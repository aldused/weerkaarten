(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.WeerlabCloudProbability = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const TIME_ZONE = 'Europe/Amsterdam';
  const CLOUD_CATEGORIES = Object.freeze([
    Object.freeze({ id: 'clear', label: 'Onbewolkt', min: 0, max: 20, color: '#ffe500' }),
    Object.freeze({ id: 'light', label: 'Licht bewolkt', min: 20, max: 40, color: '#fff19a' }),
    Object.freeze({ id: 'half', label: 'Half bewolkt', min: 40, max: 60, color: '#c9bd67' }),
    Object.freeze({ id: 'heavy', label: 'Zwaar bewolkt', min: 60, max: 80, color: '#b9c1ca' }),
    Object.freeze({ id: 'overcast', label: 'Geheel bewolkt', min: 80, max: 100, color: '#596574' }),
  ]);

  function finiteCloud(value) {
    if (value == null || value === '') return null;
    const number = Number(value);
    return Number.isFinite(number) && number >= 0 && number <= 100 ? number : null;
  }

  // Grenzen zijn halfopen [min, max), behalve de laatste klasse [80, 100].
  // Daardoor valt 20% in "Licht bewolkt" en 100% in "Geheel bewolkt".
  function cloudCategoryIndex(value) {
    const number = finiteCloud(value);
    if (!Number.isFinite(number)) return -1;
    if (number < 20) return 0;
    if (number < 40) return 1;
    if (number < 60) return 2;
    if (number < 80) return 3;
    return 4;
  }

  // Largest-remainder afronding: de getoonde tienden tellen altijd exact op tot 100,0%.
  function percentagesFromCounts(counts, total, decimals = 1) {
    if (!Number.isFinite(total) || total <= 0) return counts.map(() => null);
    const scale = 10 ** decimals;
    const target = 100 * scale;
    const raw = counts.map(count => Math.max(0, Number(count) || 0) / total * target);
    const units = raw.map(Math.floor);
    let remainder = target - units.reduce((sum, value) => sum + value, 0);
    const order = raw.map((value, index) => ({ index, fraction: value - units[index] }))
      .sort((a, b) => b.fraction - a.fraction || a.index - b.index);
    for (let index = 0; index < remainder; index++) units[order[index % order.length].index]++;
    return units.map(value => value / scale);
  }

  function probabilityStack(members, categories = CLOUD_CATEGORIES) {
    const matrix = Array.isArray(members) ? members.filter(Array.isArray) : [];
    const length = matrix.reduce((max, member) => Math.max(max, member.length), 0);
    const valuesByCategory = categories.map(() => new Array(length).fill(null));
    const validCounts = new Array(length).fill(0);
    const percentagesByTime = new Array(length);

    for (let timeIndex = 0; timeIndex < length; timeIndex++) {
      const counts = categories.map(() => 0);
      for (const member of matrix) {
        const categoryIndex = cloudCategoryIndex(member[timeIndex]);
        if (categoryIndex < 0) continue;
        counts[categoryIndex]++;
        validCounts[timeIndex]++;
      }
      const percentages = percentagesFromCounts(counts, validCounts[timeIndex], 1);
      percentagesByTime[timeIndex] = percentages;
      percentages.forEach((percentage, categoryIndex) => {
        valuesByCategory[categoryIndex][timeIndex] = percentage;
      });
    }

    return {
      series: categories.map((category, index) => ({
        ...category,
        values: valuesByCategory[index],
      })),
      validCounts,
      percentagesByTime,
    };
  }

  // Low en mid zijn laagfracties. Optellen zou overlap dubbel tellen; max() zou
  // de tweede laag juist geheel negeren. De complement-productbenadering neemt
  // willekeurige overlap aan: 1 - (1 - low) * (1 - mid).
  function combineShadowMembers(lowMembers, midMembers) {
    const low = Array.isArray(lowMembers) ? lowMembers : [];
    const mid = Array.isArray(midMembers) ? midMembers : [];
    const count = Math.min(low.length, mid.length);
    const combined = [];
    for (let memberIndex = 0; memberIndex < count; memberIndex++) {
      const length = Math.max(low[memberIndex]?.length || 0, mid[memberIndex]?.length || 0);
      const values = new Array(length);
      for (let timeIndex = 0; timeIndex < length; timeIndex++) {
        const lowValue = finiteCloud(low[memberIndex]?.[timeIndex]);
        const midValue = finiteCloud(mid[memberIndex]?.[timeIndex]);
        values[timeIndex] = Number.isFinite(lowValue) && Number.isFinite(midValue)
          ? 100 * (1 - (1 - lowValue / 100) * (1 - midValue / 100))
          : null;
      }
      combined.push(values);
    }
    return combined;
  }

  function localTimeParts(value) {
    const date = value instanceof Date ? value : new Date(value);
    if (!Number.isFinite(date.getTime())) return null;
    const parts = new Intl.DateTimeFormat('nl-NL', {
      timeZone: TIME_ZONE,
      weekday: 'short', year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZoneName: 'short',
    }).formatToParts(date);
    const get = type => parts.find(part => part.type === type)?.value || '';
    return {
      weekday: get('weekday').replace('.', ''),
      year: Number(get('year')),
      month: Number(get('month')),
      day: Number(get('day')),
      hour: Number(get('hour')),
      minute: Number(get('minute')),
      zone: get('timeZoneName'),
      dateKey: `${get('year')}-${get('month')}-${get('day')}`,
    };
  }

  function formatLocalDateTime(value) {
    const date = value instanceof Date ? value : new Date(value);
    if (!Number.isFinite(date.getTime())) return 'ongeldig tijdstip';
    return new Intl.DateTimeFormat('nl-NL', {
      timeZone: TIME_ZONE,
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
      hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZoneName: 'short',
    }).format(date);
  }

  return {
    CLOUD_CATEGORIES,
    TIME_ZONE,
    cloudCategoryIndex,
    combineShadowMembers,
    finiteCloud,
    formatLocalDateTime,
    localTimeParts,
    percentagesFromCounts,
    probabilityStack,
  };
});
