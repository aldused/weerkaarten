const harmonieModels = new Set(['harmonie', 'harmonie46']);
const iconModels = new Set(['icond2', 'icond2ruc']);
const knmiSource = 'knmi-p1-surface-hour';
const dwdSource = 'dwd-ww-surface-hour';
const knmiTypes = [1, 2, 4, 9, 8];
const dwdTypes = [1, 2, 5, 8];

export const precipitationColors = [
  null,
  [18, 106, 194],  // Regen
  [192, 70, 153],  // Sneeuw
  [173, 126, 214], // Natte sneeuw
  [107, 48, 134],  // Regen en sneeuw
  [224, 35, 113],  // IJzel / onderkoelde regen
  [245, 129, 24],  // IJsregen
  [192, 43, 50],
  [100, 106, 116], // Type onbekend
  [178, 141, 23],  // Korrelhagel
];
export const precipitationIntensity = [.05, .2, .5, 1, 2, 5, 10];
export const precipitationShades = precipitationColors.map(color => {
  if (!color) return null;
  return precipitationIntensity.map((_, level) => {
    const lightness = (1 - level / (precipitationIntensity.length - 1)) * 115;
    return color.map(channel => Math.min(255, Math.round(channel * .83 + lightness)));
  });
});

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
