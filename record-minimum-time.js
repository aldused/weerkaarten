/* KNMI minimum-temperature intervals, counted in UTC minutes from the start of the measurement day. */
(() => {
  const local = {timeZone: 'Europe/Amsterdam'};
  const clock = new Intl.DateTimeFormat('nl-NL', {...local, hour: '2-digit', minute: '2-digit', hourCycle: 'h23'});
  const day = new Intl.DateTimeFormat('nl-NL', {...local, day: 'numeric', month: 'short'});
  const offset = new Intl.DateTimeFormat('nl-NL', {...local, timeZoneName: 'shortOffset'});
  const zone = date => offset.formatToParts(date).find(part => part.type === 'timeZoneName').value;

  function format(datum, vak) {
    if (typeof datum !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(datum) || !Array.isArray(vak)) return '';
    const [eind, duur] = vak;
    if (![10, 60].includes(duur) || !Number.isInteger(eind) || eind < duur || eind > 1440 || eind % duur) return '';
    const basis = Date.parse(datum + 'T00:00:00Z');
    if (!Number.isFinite(basis)) return '';
    const start = basis + (eind - duur) * 60000;
    const stop = basis + eind * 60000;
    const startDag = day.format(start);
    const eindDag = day.format(stop);
    if (zone(start) !== zone(stop)) return `${clock.format(start)} (${zone(start)})–${clock.format(stop)} (${zone(stop)})`;
    if (startDag !== eindDag) return `${startDag} ${clock.format(start)}–${eindDag} ${clock.format(stop)} uur`;
    const label = `${clock.format(start)}–${clock.format(stop)} uur`;
    return startDag === day.format(basis) ? label : `${startDag} ${label}`;
  }

  function forRecord(bron, datum, waarde) {
    if (typeof datum !== 'string') return '';
    const [jaar, maand, dag] = datum.split('-');
    const meting = bron?.maanddetail?.[jaar]?.[Number(maand)]?.dagen?.find(rij => Number(rij.dag) === Number(dag));
    return meting && meting.tn === waarde ? format(datum, meting.tn_vak) : '';
  }

  globalThis.RecordMinimumTime = {format, forRecord};
})();
