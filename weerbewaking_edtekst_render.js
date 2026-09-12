/* EDtekst: one renderer for the live preview and the downloadable PNG. */
(function (root) {
  const colors={bg:'#080a0d',blue:'#2020ef',cyan:'#00eeee',green:'#20fa39',yellow:'#fff12a',white:'#f5f5ed',muted:'#8c97a6'};
  const sample={date:'2026-09-12',time:'15:45',region:'Rijnmondgebied',heading:'Tot en met donderdag',summary:'Zondag regenachtig. Maandag en dinsdag droog met geregeld zon en ook wat hogere temperaturen. Vanaf woensdag wisselvalliger en koeler.',demo:true,crt:false,days:[{day:'zo',sun:4,rain:80,min:14,max:20,dir:'W',force:3},{day:'ma',sun:6,rain:10,min:12,max:23,dir:'ZW',force:2},{day:'di',sun:8,rain:20,min:15,max:23,dir:'ZW',force:3},{day:'wo',sun:7,rain:80,min:12,max:18,dir:'NW',force:3},{day:'do',sun:4,rain:80,min:12,max:18,dir:'ZW',force:3}]};
  function normalize(t){return String(t).normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[–—]/g,'-').replace(/[‘’]/g,"'");}
  function wrap(t,width=40){const out=[];for(const para of normalize(t).split('\n')){let line='';for(let word of para.split(/\s+/).filter(Boolean)){if(line && line.length+word.length+1>width){out.push(line);line='';}while(word.length>width){out.push(word.slice(0,width));word=word.slice(width);}line+=(line?' ':'')+word;}out.push(line);}return out;}
  function validate(s){
    if(!s || !/^\d{4}-\d{2}-\d{2}$/.test(s.date)|| !/^\d{2}:\d{2}$/.test(s.time)||Number(s.time.slice(0,2))>23||Number(s.time.slice(3))>59)throw Error('Vul een geldige datum en tijd in.');
    const parsedDate=new Date(s.date+'T12:00:00Z');if(!Number.isFinite(+parsedDate)||parsedDate.toISOString().slice(0,10)!==s.date)throw Error('Vul een geldige datum in.');
    for(const key of ['region','heading','summary'])if(typeof s[key]!=='string'||!s[key].trim())throw Error('Vul de regio, kop en weerschets in.');
    if(s.region.length>26||s.heading.length>40||s.summary.length>200||wrap(s.summary).length>5)throw Error('De weerschets past op maximaal 5 regels van 40 tekens. Maak de tekst iets korter.');
    if([s.region,s.heading,s.summary].some(t=>[...normalize(t)].some(c=>!/[a-z0-9 .,:\/°%!?'()+&\n-]/i.test(c))))throw Error('Gebruik letters, cijfers en gewone leestekens; geen emoji.');
    if(!Array.isArray(s.days)||s.days.length!==5)throw Error('Vul vijf dagen in.');
    for(const d of s.days){if(!['ma','di','wo','do','vr','za','zo'].includes(d.day))throw Error('Kies een geldige weekdag.');if(d.sun!==null&&(!Number.isInteger(d.sun)||d.sun<0||d.sun>24))throw Error('Controleer de zonuren: 0–24 hele uren.');for(const [k,lo,hi] of [['rain',0,100],['min',-40,50],['max',-40,50],['force',0,12]])if(d[k]!==null&&(!Number.isInteger(d[k])||d[k]<lo||d[k]>hi))throw Error('Controleer de waarden: regenkans 0–100%, temperatuur -40–50 °C, wind 0–12 Bft.');if(d.min!==null&&d.max!==null&&d.min>d.max)throw Error('De minimumtemperatuur mag niet hoger zijn dan de maximumtemperatuur.');if(d.dir!==null&&!['N','NNO','NO','ONO','O','OZO','ZO','ZZO','Z','ZZW','ZW','WZW','W','WNW','NW','NNW','VAR'].includes(d.dir))throw Error('Kies een geldige windrichting.');}
    return s;
  }
  function draw(ctx,s,{editable=false}={}){
    validate(s);const c=colors;
    function box(x,y,w,h,color){ctx.fillStyle=color;ctx.fillRect(x,y,w,h);}
    function text(t,x,y,size=4,color=c.white,align='left') {
      ctx.font=`400 ${size*10}px "EDtekst Mono", "DejaVu Sans Mono", monospace`;
      ctx.textAlign=align;
      ctx.textBaseline='alphabetic';
      ctx.fillStyle=color;
      ctx.fillText(normalize(t),x,y+size*7.5);
    }
    box(0,0,1080,1350,c.bg);
    text('P704',48,34,3,c.yellow);text('EDtekst',186,34,3,c.white);text(s.date.split('-').reverse().join('-')+' '+s.time,1032,34,3,c.cyan,'right');
    box(48,86,984,110,c.blue);text('ED',73,107,10,c.yellow);text('tekst',212,107,10,c.white);text('704',1008,122,6,c.yellow,'right');
    box(48,210,984,47,c.green);text('WEER',68,220,4,c.bg);text('meerdaagse',1012,220,4,c.bg,'right');
    text(s.region,48,285,3,c.white);text('1/1',1032,285,3,c.muted,'right');
    text(s.heading,48,342,4,c.green);
    wrap(s.summary).forEach((line,i)=>text(line,48,399+i*37,4,c.cyan));
    box(48,602,984,10,c.blue);
    const xs=[488,615,742,869,996];
    s.days.forEach((d,i)=>{if(!editable)text(d.day,xs[i],648,5,c.cyan,'center');});
    const rows=[['zonuren','sun',727,c.green],['regenkans    %','rain',798,c.green],['minimum     °C','min',891,c.white],['maximum     °C','max',968,c.yellow],['windrichting','dir',1062,c.green],['wind       Bft','force',1133,c.green]];
    for(const [label,key,y,col] of rows){text(label,48,y,4,c.cyan);if(!editable)s.days.forEach((d,i)=>text(d[key]??'-',xs[i],y,4,col,'center'));}
    box(48,1231,244,10,c.blue);box(788,1231,244,10,c.blue);text('Ed Aldus',540,1219,6,c.yellow,'center');
    text('Het weer, elke dag.',540,1284,3,c.cyan,'center');
    if(s.demo)text('DEMO / VOORBEELDGEGEVENS',540,1322,2,c.muted,'center');
    if(s.crt){ctx.fillStyle='rgba(0,0,0,0.17)';for(let y=0;y<1350;y+=6)ctx.fillRect(0,y,1080,1);}
  }
  const api={sample,draw,wrap,validate,colors};if(typeof module!=='undefined')module.exports=api;else root.EDtekst=api;
})(globalThis);
