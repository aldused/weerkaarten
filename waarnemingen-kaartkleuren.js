const TEMPERATUUR_MIN = -22;
const TEMPERATUUR_STAP = 2;
const TEMPERATUUR_KLEUREN = [
  "#f3e7f4","#d59bcf","#b04ca9","#8f248e","#672080","#472080",
  "#232080","#13268c","#1536a4","#154bbd","#1466d6",
  "#167264","#168653","#1a9c4b","#24b83a","#48ce23","#75d91c",
  "#a2e724","#cce82b","#e9e72c","#f9e627","#ffdb1b","#ffc51a",
  "#ffa316","#ff7c18","#f94f1a","#ed291e","#d91d24","#bf1728",
  "#9e1534","#7a123b","#821866","#9b23a7"
];
const TEMPERATUUR_KLASSEN = TEMPERATUUR_KLEUREN.map((kleur,i)=>({
  kleur, rgb:hexToRgb(kleur), vanaf:TEMPERATUUR_MIN+i*TEMPERATUUR_STAP
}));

function temperatuurKlasse(waarde) {
  const index=Math.floor((waarde-TEMPERATUUR_MIN)/TEMPERATUUR_STAP);
  return TEMPERATUUR_KLASSEN[Math.max(0,Math.min(index,TEMPERATUUR_KLASSEN.length-1))];
}

const WAARNEMINGEN_KAARTSCHALEN = {
  // Beide kaartvelden gebruiken de ruwe windsnelheid in m/s.
  wind: {
    kleuren: [["#ffffff",0],["#c8e6c9",2],["#81c784",4],["#4caf50",6],["#ffee58",8],["#ffa726",11],["#ff7043",14],["#e53935",17],["#b71c1c",21],["#7b1fa2",25]],
    schaal: [0,25],
    legendaEenheid: " m/s",
  },
  windstoot: {
    kleuren: [["#ffffff",5],["#c8e6c9",8],["#81c784",11],["#4caf50",14],["#ffee58",17],["#ffa726",21],["#ff7043",25],["#e53935",30]],
    schaal: [0,35],
    legendaFactor: 3.6,
  },
};

function hexToRgb(hex) {
  return [parseInt(hex.slice(1,3),16),parseInt(hex.slice(3,5),16),parseInt(hex.slice(5,7),16)];
}
function interpKleur(val, schaal, stops) {
  const colors = stops.map(s=>hexToRgb(s[0]));
  let idx, f;
  if(typeof stops[0][1]==='number'){
    const temps=stops.map(s=>s[1]);
    const v=Math.max(temps[0],Math.min(temps[temps.length-1],val));
    idx=temps.length-2;
    for(let i=0;i<temps.length-1;i++){if(v<=temps[i+1]){idx=i;break;}}
    f=(v-temps[idx])/(temps[idx+1]-temps[idx]);
  } else {
    const t=Math.max(0,Math.min(1,(val-schaal[0])/(schaal[1]-schaal[0])));
    idx=Math.min(colors.length-2,Math.floor(t*(colors.length-1)));
    f=t*(colors.length-1)-idx;
  }
  const a=colors[idx],b=colors[idx+1];
  const r=Math.round(a[0]+f*(b[0]-a[0])), g=Math.round(a[1]+f*(b[1]-a[1])), bl=Math.round(a[2]+f*(b[2]-a[2]));
  const lum=(0.299*r+0.587*g+0.114*bl)/255;
  return [`rgb(${r},${g},${bl})`, lum<0.55?"white":"#222"];
}

function kaartLegendaSchaal(p) {
  if(p.temperatuur){
    return {
      eenheid:"°C", stapsgewijs:true, kleuren:TEMPERATUUR_KLEUREN,
      labels:TEMPERATUUR_KLASSEN.flatMap(({vanaf,kleur},i,klassen)=>{
        const eerste=i===0, laatste=i===klassen.length-1;
        if(!eerste&&!laatste&&(vanaf%8!==0||i===klassen.length-2))return [];
        const getal=String(vanaf).replace("-","−");
        return [{positie:eerste?0:i/klassen.length, kleur, tekst:eerste?"≤"+getal:laatste?getal+"+":getal}];
      })
    };
  }
  const kleuren=p.kleuren.map(([kleur])=>kleur);
  const [min,max]=p.schaal;
  const posities=p.kleuren.map(([,waarde],i)=> typeof waarde === "number"
    ? (waarde-p.kleuren[0][1])/(p.kleuren.at(-1)[1]-p.kleuren[0][1]) : i/(kleuren.length-1));
  const labels=p.kleuren.map(([kleur,waarde],i)=>{
    const getal=typeof waarde === "number"?waarde:min+(max-min)*posities[i];
    const label=p.legendaFactor ? Math.round(getal*p.legendaFactor) : getal;
    return {kleur,positie:posities[i],tekst:String(label)+(i===kleuren.length-1?"+":"")};
  });
  return {eenheid:(p.legendaEenheid ?? p.eenheid).trim(),kleuren,posities,labels,stapsgewijs:false};
}

function tekenKaartLegenda(svg, p, x, y){
  const {eenheid, kleuren, posities, labels, stapsgewijs}=kaartLegendaSchaal(p);
  const ns = tag => svg.ownerDocument.createElementNS(svg.namespaceURI, tag);
  const kleinsteStap=Math.min(...labels.slice(1).map((label,i)=>label.positie-labels[i].positie));
  const lengte=stapsgewijs?350:Math.max(152,Math.ceil(24/kleinsteStap));
  const boven=48, breedte=122, balkX=14, balkBreedte=24;
  const groep=ns("g");
  groep.setAttribute("transform",`translate(${x} ${y})`);
  groep.setAttribute("role","img");
  groep.setAttribute("aria-label",`Kleurenschaal ${eenheid}: ${labels.map(l=>l.tekst).join(", ")}`);
  function element(tag, attributen, tekst) {
    const node=ns(tag);
    for(const [naam,waarde] of Object.entries(attributen))node.setAttribute(naam,waarde);
    if(tekst!==undefined)node.textContent=tekst;
    groep.appendChild(node);
    return node;
  }
  const tekstStijl={"font-family":"Arial,sans-serif","font-size":22,fill:"#172b40"};
  element("rect",{width:breedte,height:boven+lengte+24,rx:10,fill:"#ffffff","fill-opacity":.94,stroke:"#a7c0d2"});
  element("text",{x:14,y:30,...tekstStijl,"font-weight":700},eenheid);
  if(stapsgewijs){
    const stap=lengte/kleuren.length;
    kleuren.forEach((kleur,i)=>element("rect",{
      x:balkX,y:boven+lengte-(i+1)*stap,width:balkBreedte,height:stap+.15,fill:kleur
    }));
  }else{
    const id="kaart-legenda-verloop";
    const verloop=element("linearGradient",{id,x1:"0%",x2:"0%",y1:"100%",y2:"0%"});
    kleuren.forEach((kleur,i)=>{
      const stop=ns("stop");
      stop.setAttribute("offset",posities[i]);
      stop.setAttribute("stop-color",kleur);
      verloop.appendChild(stop);
    });
    element("rect",{x:balkX,y:boven,width:balkBreedte,height:lengte,fill:`url(#${id})`});
  }
  element("rect",{x:balkX,y:boven,width:balkBreedte,height:lengte,fill:"none",stroke:"#384d61"});
  for(const {positie,tekst} of labels){
    const ry=boven+lengte-Math.min(1,positie)*lengte;
    const nul=stapsgewijs&&tekst==="0";
    element("line",{x1:balkX+balkBreedte,x2:balkX+balkBreedte+8,y1:ry,y2:ry,stroke:"#384d61","stroke-width":nul?2.5:1.25});
    element("text",{x:balkX+balkBreedte+13,y:ry,...tekstStijl,"dominant-baseline":"central","font-weight":nul?700:500},tekst);
  }
  svg.appendChild(groep);
}

function kaartLegendaItems(p) {
  const {eenheid,labels}=kaartLegendaSchaal(p);
  return labels.map(({kleur,tekst})=>
    `<div class="legenda-item"><div class="legenda-blok" style="background:${kleur}"></div>${tekst} ${eenheid}</div>`
  ).join("");
}
