// The native spatial OM feed has already deaccumulated ECMWF tp (228) and
// converted metres to millimetres. Never subtract neighbouring OM files again.
export const PRECIPITATION = Object.freeze({
  parameter: 'tp', paramId: 228, sourceUnit: 'm', transportUnit: 'mm',
  transportBasis: 'backward-interval-sum', displayUnit: 'mm/u',
  includes: 'rain, snow water equivalent, large-scale and convective precipitation',
});
export function intervalRate(amountMm, hours) {
  if (![1, 3, 6].includes(hours)) throw new Error('Ongeldig neerslaginterval');
  if (!Number.isFinite(amountMm)) return NaN;
  // A material negative interval is invalid data, not a dry forecast. Tiny
  // floating-point round-off may be clipped; a model reset is never clipped.
  return amountMm < -1e-6 ? NaN : Math.max(0, amountMm) / hours;
}
export function precipitationPeriod(run, valid, hours) {
  const runMs=Date.parse(run),end=Date.parse(valid),start=end-hours*3600000;
  if (![1,3,6].includes(hours)||!Number.isFinite(runMs)||!Number.isFinite(end)||start<runMs||end%3600000) {
    throw new Error('Ongeldige neerslagperiode of modelrun');
  }
  return {run:new Date(runMs).toISOString(),start:new Date(start).toISOString(),end:new Date(end).toISOString(),hours};
}
// Reference conversion for original ECMWF cumulative GRIB samples and audits.
// Records must carry run, valid and cumulativeMetres; never bridge two runs.
export function cumulativeTPInterval(previous,current) {
  if(previous.run!==current.run)throw new Error('Cumulatieve neerslag uit verschillende modelruns');
  const hours=(Date.parse(current.valid)-Date.parse(previous.valid))/3600000;
  const period=precipitationPeriod(current.run,current.valid,hours);
  const a=previous.cumulativeMetres,b=current.cumulativeMetres;
  if(!Number.isFinite(a)||!Number.isFinite(b)||a<0||b<0)throw new Error('Ongeldige cumulatieve neerslag');
  const mm=(b-a)*1000;
  if(mm < -1e-6)throw new Error('Cumulatieve neerslag daalt binnen dezelfde modelrun');
  const amountMm=Math.max(0,mm);
  return {...period,amountMm,rateMmH:intervalRate(amountMm,hours)};
}
