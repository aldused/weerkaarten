/* Weerlab daily MOSMIX: TX/TN °C, FF km/h, DD degrees, SQ sunshine
 * hours (may be estimated), R101 highest hourly probability (%).
 * Feed dates are Europe/Amsterdam calendar dates. */
(function(root){
  const station='Rotterdam Airport';
  const directions=['N','NNO','NO','ONO','O','OZO','ZO','ZZO','Z','ZZW','ZW','WZW','W','WNW','NW','NNW'];
  const weekdays=['zo','ma','di','wo','do','vr','za'];
  const fullDays=['zondag','maandag','dinsdag','woensdag','donderdag','vrijdag','zaterdag'];
  const finite=v=>typeof v==='number'&&Number.isFinite(v);
  function localDate(now=new Date()){return new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Amsterdam',year:'numeric',month:'2-digit',day:'2-digit'}).format(now);}
  function addDays(date,n){const d=new Date(date+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+n);return d.toISOString().slice(0,10);}
  function dayLength(date){const d=new Date(date+'T12:00:00Z'),day=Math.floor((d-Date.UTC(d.getUTCFullYear(),0,0))/86400000);const dec=-23.45*Math.cos(2*Math.PI*(day+10)/365)*Math.PI/180;return 24/Math.PI*Math.acos(Math.max(-1,Math.min(1,-Math.tan(51.957*Math.PI/180)*Math.tan(dec))));}
  function beaufort(kmh){if(!finite(kmh)||kmh<0)return null;const ms=kmh/3.6;return [0.3,1.6,3.4,5.5,8,10.8,13.9,17.2,20.8,24.5,28.5,32.7].filter(x=>ms>=x).length;}
  function mapFeed(feed,now=new Date()){
    if(!feed?.data||!feed.stations?.[station]||!Array.isArray(feed.dagen))throw Error('Rotterdam Airport ontbreekt in de MOSMIX-bron.');
    const run=new Date(feed.run);if(!Number.isFinite(+run)||now-run>86400000||run-now>3600000)throw Error('De MOSMIX-bron is niet actueel. Probeer het later opnieuw.');
    const today=localDate(now),mapped={};
    for(const date of feed.dagen){if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||date<today)continue;const d=feed.data[date];if(!d)continue;
      const value=k=>d[k]?.[station],rounded=(k,lo,hi)=>finite(value(k))&&value(k)>=lo&&value(k)<=hi?Math.round(value(k)):null;
      const sq=value('SQ'),dd=value('DD');
      mapped[date]={date,day:weekdays[new Date(date+'T12:00:00Z').getUTCDay()],sun:finite(sq)&&sq>=0&&sq<=24?Math.min(100,Math.round(100*sq/dayLength(date))):null,rain:rounded('R101',0,100),min:rounded('TN',-40,50),max:rounded('TX',-40,50),force:beaufort(value('FF')),dir:finite(dd)&&dd>=0&&dd<=360?directions[Math.round(dd/22.5)%16]:null};
      if(mapped[date].min!==null&&mapped[date].max!==null&&mapped[date].min>mapped[date].max){mapped[date].min=null;mapped[date].max=null;}
    }
    return {station,stationId:'06344',run:run.toISOString(),retrievedAt:now.toISOString(),days:mapped};
  }
  function selectDays(data,start){const dates=Array.from({length:5},(_,i)=>addDays(start,i));if(dates.some(date=>!data.days?.[date]))throw Error('Er zijn geen vijf opeenvolgende dagen beschikbaar vanaf deze datum.');return dates.map(date=>({...data.days[date]}));}
  const api={station,directions,weekdays,fullDays,localDate,addDays,dayLength,beaufort,mapFeed,selectDays};if(typeof module!=='undefined')module.exports=api;else root.MOSMIX=api;
})(globalThis);
