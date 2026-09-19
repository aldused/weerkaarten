/* Shared calendar/record helpers. Calendar dates never use local midnight. */
(function(root) {
  'use strict';
  const DAY = 86400000;
  function calendar(value) {
    const raw = String(value ?? '').replaceAll('-', '');
    if (!/^\d{8}$/.test(raw)) return null;
    const jaar = Number(raw.slice(0,4)), mm = Number(raw.slice(4,6)), dd = Number(raw.slice(6,8));
    const epoch = Date.UTC(jaar, mm - 1, dd), d = new Date(epoch);
    return d.getUTCFullYear() === jaar && d.getUTCMonth() === mm - 1 && d.getUTCDate() === dd
      ? {raw, jaar, mm, dd, epoch} : null;
  }
  function historicalRecords(json) {
    // New exports contain the complete observations before any top-N ranking.
    // Older exports retain the daily lists, unlike truncated month/year rankings.
    const records = json.waarnemingen ?? Object.values(json.dag || {}).flatMap(month =>
      Object.values(month).flatMap(day => ['tx_hoog','tn_laag'].flatMap(key =>
        (day[key] || []).map(([waarde, datum, station]) => ({waarde, datum, station, parameter:key === 'tx_hoog' ? 'TX' : 'TN'})))));
    const seen = new Set();
    return records.filter(r => {
      const key = JSON.stringify([r.station,r.datum,r.parameter,r.waarde]);
      if (!calendar(r.datum) || !['TX','TN'].includes(r.parameter) || !Number.isFinite(r.waarde) || seen.has(key)) return false;
      seen.add(key); return true;
    });
  }
  function mergeRows(rows, columns, records) {
    const byDate = new Map();
    for (const row of rows) {
      const date = calendar(row[columns.YYYYMMDD]);
      if (!date) continue;
      const merged = byDate.get(date.raw) || [];
      for (const [key,index] of Object.entries(columns)) {
        const value = row[index];
        if (key === 'YYYYMMDD') merged[index] = date.raw;
        else if (value !== null && value !== undefined && value !== '') {
          if (merged[index] != null && Number(merged[index]) !== Number(value))
            throw new Error(`Tegenstrijdige bronwaarden op ${date.raw} (${key})`);
          merged[index] = value;
        }
      }
      byDate.set(date.raw, merged);
    }
    for (const record of records) {
      const date = calendar(record.datum), index = columns[record.parameter];
      if (!date || index === undefined) continue;
      const row = byDate.get(date.raw) || [];
      row[columns.YYYYMMDD] = date.raw;
      const value = Math.round(record.waarde * 10);
      if (row[index] != null && row[index] !== '' && Number(row[index]) !== value)
        throw new Error(`Tegenstrijdige bronnen voor ${record.station} op ${date.raw} (${record.parameter})`);
      row[index] = value;
      byDate.set(date.raw, row);
    }
    return [...byDate.values()].sort((a,b) => a[columns.YYYYMMDD].localeCompare(b[columns.YYYYMMDD]));
  }
  function boundary(records, side) {
    const valid = records.filter(Boolean);
    if (!valid.length) return [];
    const position = (side === 'first' ? Math.min : Math.max)(...valid.map(r=>r.sDag));
    return valid.filter(r=>r.sDag === position).sort((a,b)=>
      String(a.raw).localeCompare(String(b.raw)) || String(a.stationNaam || '').localeCompare(String(b.stationNaam || '')));
  }
  function top(records, descending, count = 10) {
    const sorted = [...records].sort((a,b)=>(descending ? b.waarde-a.waarde : a.waarde-b.waarde)
      || a.jaar-b.jaar || a.mm-b.mm || a.dd-b.dd || String(a.stationNaam||'').localeCompare(String(b.stationNaam||'')));
    // Include every tied observation at rank N, including other stations that day.
    return sorted.filter((r,i)=>i<count || r.waarde === sorted[count-1].waarde);
  }
  function windowDays(first, last) {
    return first && last ? (calendar(last.raw).epoch - calendar(first.raw).epoch) / DAY + 1 : null;
  }
  function periodDays(year, info) {
    const startYear = info.spansYear ? year - 1 : year;
    const start = Date.UTC(startYear,info.startM-1,1);
    return (Date.UTC(startYear,info.startM-1+info.maanden.length,1)-start)/DAY;
  }
  const api = {calendar,historicalRecords,mergeRows,boundary,top,periodDays,windowDays};
  root.StationRecords = api;
  if (typeof module !== 'undefined') module.exports = api;
})(typeof globalThis === 'undefined' ? this : globalThis);
