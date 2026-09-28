/* Significant-weercomposiet: dezelfde indicatieve drempels als harmonie_significant.html.
   Elk bronveld wordt op zijn eigen rooster bemonsterd; ontbrekend blijft onbekend. */
(function(root,factory){
  if(typeof module==='object'&&module.exports)module.exports=factory(require('./vierluik-core.js'));
  else root.VierluikSignificant=factory(root.VierluikCore);
})(typeof globalThis!=='undefined'?globalThis:this,function(core){
  'use strict';
  const required=['bewolking','neerslag'];
  const optional=['wind','temp','dauwpunt','cape','zicht','profiel'];
  const colors={helder:[255,247,214],bewolkt:[112,112,112],regen:[58,143,212],sneeuw:[80,221,235],natteSneeuw:[255,192,138],ijzel:[255,64,64],onweer:[232,48,232],mist:[255,244,42],unknown:[200,210,220]};
  const clamp=v=>Math.max(0,Math.min(1,v));
  const blend=(a,b,f)=>a.map((v,i)=>Math.round(v*(1-f)+b[i]*f));
  function wetBulb(t,td){
    if(!Number.isFinite(t)||!Number.isFinite(td))return NaN;
    const rh=Math.max(1,Math.min(100,100*Math.exp(17.625*td/(243.04+td)-17.625*t/(243.04+t))));
    return t*Math.atan(0.151977*Math.sqrt(rh+8.313659))+Math.atan(t+rh)-Math.atan(rh-1.676331)+0.00391838*Math.pow(rh,1.5)*Math.atan(0.023101*rh)-4.686035;
  }
  function classify(v,withLabel=true){
    if(![v.high,v.mid,v.low,v.rain].every(Number.isFinite))return {kind:'unknown',color:colors.unknown,label:'Geen volledige brondata'};
    const low=clamp(v.low),mid=clamp(v.mid),high=clamp(v.high);
    const lowMid=clamp(Math.max(low*.98,mid*.84)),cirrus=clamp(high*(1-lowMid*.65));
    const cover=clamp(Math.max(lowMid,cirrus*.18)),dark=clamp(low*.16+mid*.09);
    const tone=Math.max(82,Math.min(246,Math.round(238-cover*126-dark*36-cirrus*20)));
    let color=blend(colors.helder,[tone,tone,tone],clamp(cover+dark*.4+cirrus*.1));
    let kind='cloud',label=withLabel?'Bewolking '+Math.round((1-(1-high)*(1-mid)*(1-low))*8)+'/8 (schatting)':'';
    if(v.rain>=.1){
      const tw=v.tw===undefined?wetBulb(v.temp,v.dew):v.tw;
      if(tw<=.6){
        if(v.temp<=.2&&v.warmLayer===true){kind='ijzel';label='Indicatie ijzel';color=v.rain>=.5?[208,0,0]:colors.ijzel;}
        else {kind='sneeuw';label='Indicatie sneeuw';color=v.rain>=2.5?[53,105,189]:v.rain>=1?[70,140,240]:colors.sneeuw;}
      }else if(tw<=1.4){kind='natteSneeuw';label='Indicatie natte sneeuw';color=v.rain>=1.5?[255,146,56]:colors.natteSneeuw;}
      else if((v.cape>450&&v.rain>1)||(v.cape>1200&&v.rain>=.2)){
        kind='onweer';label='Indicatie convectieve neerslag / onweer';color=v.rain>5.5||v.cape>1200?[188,20,196]:colors.onweer;
      }else {kind='regen';label=Number.isFinite(tw)?'Regen':'Neerslag (type onbekend)';color=colors.regen;}
      return {kind,color,label:withLabel?label+' · '+v.rain.toFixed(1)+' mm/uur':''};
    }
    if(Number.isFinite(v.visibility)&&v.visibility>=0&&v.visibility<500){
      kind='mist';label='Mistindicatie · zicht '+Math.round(v.visibility)+' m';color=v.visibility<200?[199,195,31]:colors.mist;
    }
    return {kind,color,label};
  }
  function sample(pd,step,lat,lon,withLabel=true){
    const fields=pd.fields;
    function value(key,component=0){
      const v=core.sample(fields[key],step,lat,lon,component,key==='neerslag'?'nearest':'bilinear');
      return v===null?NaN:v;
    }
    const v={high:value('bewolking',0),mid:value('bewolking',1),low:value('bewolking',2),rain:value('neerslag')};
    if(v.rain>=.1){
      v.temp=value('temp');v.dew=value('dauwpunt');v.tw=wetBulb(v.temp,v.dew);
      if(v.tw<=.6&&v.temp<=.2)v.warmLayer=[2,3,4].some(c=>value('profiel',c)>.5);
      if(!(v.tw<=1.4))v.cape=value('cape');
    }else v.visibility=value('zicht');
    const result=classify(v,withLabel);
    result.rain=v.rain;
    return result;
  }
  return {required,optional,colors,wetBulb,classify,sample};
});
