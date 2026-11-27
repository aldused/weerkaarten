const harmonieModels = new Set(['harmonie', 'harmonie46']);
const iconModels = new Set(['icond2', 'icond2ruc']);
const knmiSource = 'knmi-p1-surface-hour';
const dwdSource = 'dwd-ww-surface-hour';
const knmiTypes = [1, 2, 4, 9, 8];
const dwdTypes = [1, 2, 5, 8];

export function precipitationKind(modelKey, step, type, rain, snow, freezingRain, icePellets) {
  if (harmonieModels.has(modelKey)) {
    return step.ptypeSource === knmiSource && knmiTypes.includes(type) ? type : 8;
  }
  if (iconModels.has(modelKey)) {
    return step.ptypeSource === dwdSource && dwdTypes.includes(type) ? type : 8;
  }
  // Onderkoelde motregen deelt de kleur van onderkoelde regen.
  if (type === 7) return 5;
  if (type >= 1 && type <= 8) return type;
  if (freezingRain > 0) return 5;
  if (icePellets > 0) return 6;
  return snow > rain ? 2 : 1;
}

export function precipitationLegend(modelKey, step, regional) {
  if (harmonieModels.has(modelKey)) {
    return step.ptypeSource === knmiSource
      ? {types: knmiTypes, description: 'Neerslagtype uit KNMI-modelvelden voor regen, sneeuw en korrelhagel aan de grond over het voorgaande uur.'}
      : {types: [8], description: 'Neerslagtype onbekend. De KNMI-neerslagsoorten ontbreken voor dit uur.'};
  }
  if (iconModels.has(modelKey)) {
    return step.ptypeSource === dwdSource
      ? {types: dwdTypes, description: 'Neerslagtype uit de DWD-weerdiagnose (WW) over het voorgaande uur.'}
      : {types: [8], description: 'Neerslagtype onbekend. De DWD-weerdiagnose ontbreekt voor dit uur.'};
  }
  if (regional) {
    return {types: [1, 2, 3, 8], description: 'Neerslagtype geschat uit temperatuur en dauwpunt.'};
  }
  return {
    types: [1, 2, 3, 4, 5, 6],
    description: step.keys.includes('ptype') ? '' : 'Bij deze stap zijn natte sneeuw en mengvormen samengevoegd met sneeuw.'
  };
}
