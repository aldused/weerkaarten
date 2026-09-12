/* Pure beeldkeuze en verwerking; gedeeld door viewer en regressietests. */
(function(root) {
'use strict';
function radialen(graden) {
  return graden * Math.PI / 180;
}

function graden(radialen) {
  return radialen * 180 / Math.PI;
}

function zonhoogte(tijd, lat = 52.1, lon = 5.2) {
  const dagStart = Date.UTC(tijd.getUTCFullYear(), tijd.getUTCMonth(), tijd.getUTCDate());
  const dagNummer = Math.floor((dagStart - Date.UTC(tijd.getUTCFullYear(), 0, 0)) / 86400000);
  const uur = tijd.getUTCHours() + tijd.getUTCMinutes() / 60 + tijd.getUTCSeconds() / 3600;
  const gamma = 2 * Math.PI / 365 * (dagNummer - 1 + (uur - 12) / 24);
  const decl =
    0.006918
    - 0.399912 * Math.cos(gamma)
    + 0.070257 * Math.sin(gamma)
    - 0.006758 * Math.cos(2 * gamma)
    + 0.000907 * Math.sin(2 * gamma)
    - 0.002697 * Math.cos(3 * gamma)
    + 0.00148 * Math.sin(3 * gamma);
  const tijdCorrectie = 229.18 * (
    0.000075
    + 0.001868 * Math.cos(gamma)
    - 0.032077 * Math.sin(gamma)
    - 0.014615 * Math.cos(2 * gamma)
    - 0.040849 * Math.sin(2 * gamma)
  );
  const wareZonnetijd = uur * 60 + tijdCorrectie + 4 * lon;
  const uurhoek = radialen(wareZonnetijd / 4 - 180);
  const latRad = radialen(lat);
  return graden(Math.asin(
    Math.sin(latRad) * Math.sin(decl)
    + Math.cos(latRad) * Math.cos(decl) * Math.cos(uurhoek)
  ));
}


function lichtSituatie(tijd, bbox) {
  const [west, zuid, oost, noord] = bbox;
  const hoogtes = [[zuid,west],[zuid,oost],[noord,west],[noord,oost],[(zuid+noord)/2,(west+oost)/2]]
    .map(([lat,lon]) => zonhoogte(tijd,lat,lon));
  return { minimum: Math.min(...hoogtes), maximum: Math.max(...hoogtes) };
}
function besteProduct(tijd, bbox) {
  const licht = lichtSituatie(tijd, bbox);
  if (licht.minimum >= 4) return {layer:'mtg_fd:rgb_truecolour',label:'Natuurlijke kleuren',reden:'Daglicht in het hele gebied: natuurlijke kleuren tonen de wolken zonder stadslichten.'};
  return {layer:'mtg_fd:rgb_geocolour',label:'Dag & nacht',reden:licht.maximum < 0
    ? 'Nacht: infrarood maakt wolken zichtbaar. De stadslichten zijn een vaste achtergrond.'
    : 'Schemering of een deels donker gebied: GeoColour combineert daglicht en infrarood.'};
}
function detailFactor(pan, blur, helderste, alpha=255, panAlpha=255) {
  // Zwakke signalen, transparante pixels en bijna witte wolkentoppen ontzien.
  if (alpha < 250 || panAlpha < 250 || pan < 12 || blur < 12) return 1;
  const signaal = Math.min(1, (Math.min(pan,blur)-12)/28);
  const ratio = Math.max(.82,Math.min(1.22,(pan+6)/(blur+6)));
  const factor = 1 + (ratio-1)*.55*signaal;
  return factor > 1 ? Math.min(factor,255/Math.max(1,helderste)) : factor;
}
function tijdvenster(nu, laatste=17, vertraging=30) {
  const basis = new Date(nu);
  basis.setUTCMinutes(Math.floor((basis.getUTCMinutes()-vertraging)/10)*10,0,0);
  return Array.from({length:laatste+1},(_,i)=>new Date(+basis-(laatste-i)*600000));
}
const api = {zonhoogte,lichtSituatie,besteProduct,detailFactor,tijdvenster};
if(typeof module !== 'undefined' && module.exports) module.exports=api;
else root.SatellietCore=api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
