/* KNMI tienminutenmetingen, bestaande actueel-feed; interne windeenheid m/s. */
(function(root) {
  'use strict';
  var FIELDS = {t2m:'ta', td2m:'td', wdir:'dd', wspd:'ff', gust:'fx'};
  function number(v) { return typeof v === 'number' && Number.isFinite(v) ? v : NaN; }
  function distance(a,b) {
    var rad=Math.PI/180, dlat=(b.lat-a.lat)*rad, dlon=(b.lon-a.lon)*rad;
    var h=Math.sin(dlat/2)**2+Math.cos(a.lat*rad)*Math.cos(b.lat*rad)*Math.sin(dlon/2)**2;
    return 6371*2*Math.asin(Math.sqrt(Math.min(1,h)));
  }
  function select(feed, place, now) {
    if (!place || !feed || !feed.stations) return null;
    var best=null;
    Object.keys(feed.stations).forEach(function(key) {
      var station=feed.stations[key];
      if (!Number.isFinite(station.lat) || !Number.isFinite(station.lon)) return;
      var km=distance(place,station);
      if(km<=15 && (!best || km<best.km)) best={station:station, name:station.naam || key, km:km};
    });
    if (!best) return null;
    var rows=new Map();
    (best.station.historie || []).forEach(function(row) {
      var t=Date.parse(row.t);
      if(Number.isFinite(t) && t<=now+60000) rows.set(t,row);
    });
    best.rows=Array.from(rows, function(entry) {return {t:entry[0], row:entry[1]};}).sort(function(a,b){return a.t-b.t;});
    best.last=best.rows.length ? best.rows[best.rows.length-1].t : null;
    return best;
  }
  function series(selected, params) {
    if(!selected) return [];
    return params.filter(function(p){return FIELDS[p];}).map(function(p) {
      var values=selected.rows.map(function(item){
        var v=number(item.row[FIELDS[p]]);
        if(p==='wdir' && (v<0 || v>360 || number(item.row.ff)===0)) return NaN;
        if((p==='wspd' || p==='gust') && v<0) return NaN;
        return v;
      });
      return {model:'observations', observation:true, station:selected.name, stationKm:selected.km,
        param:p, t:selected.rows.map(function(item){return item.t;}), v:values,
        color:'#111111', label:'KNMI '+selected.name, maxGap:20*60000};
    }).filter(function(s){return s.v.some(Number.isFinite);});
  }
  var api={select:select,series:series,distance:distance};
  if(typeof module!=='undefined' && module.exports) module.exports=api;
  else root.TSObservations=api;
})(typeof window!=='undefined'?window:this);
