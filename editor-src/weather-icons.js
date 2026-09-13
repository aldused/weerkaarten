// A self-contained vector family: no emoji, web fonts or external images.
// Precipitation count and cloud tone retain the existing editor's distinctions.
export const WEATHER_ICON_SPECS = {
  zon:{sun:true,clear:true}, sluierbewolking:{sun:true,cirrus:2}, plukje_sluier:{cirrus:1}, sluierwolken:{cirrus:3},
  zon_groot_stapelwolk:{sun:true,cloud:'light',tall:true}, zon_achter_wolk:{sun:true,cloud:'light'},
  zon_achter_grijze_wolk:{sun:true,cloud:'grey'}, zon_achter_donkere_wolk:{sun:true,cloud:'dark'},
  zon_stapelwolk_mist:{sun:true,cloud:'light',fog:2}, zon_stapelwolk:{sun:true,cloud:'light',tall:true},
  zon_stapelwolk_1druppel:{sun:true,cloud:'light',rain:1}, zon_donkere_wolk:{sun:true,cloud:'dark',tall:true},
  halfbewolkt_regen:{sun:true,cloud:'grey',rain:2}, zon_wolk_regen:{sun:true,cloud:'light',rain:3},
  zon_licht_hagelbui:{sun:true,cloud:'light',hail:2}, zon_donker_hagelbui:{sun:true,cloud:'dark',hail:2},
  zon_licht_hagelbui2:{sun:true,cloud:'light',hail:3}, zon_donker_hagelbui2:{sun:true,cloud:'dark',hail:3},
  bewolkt:{cloud:'grey'}, platte_wolk_licht:{cloud:'light',flat:true}, platte_wolk_grijs:{cloud:'grey',flat:true},
  dubbele_wolk:{cloud:'light',layers:2}, driedubbele_wolk:{cloud:'grey',layers:3},
  '1druppel':{rain:1,standalone:true}, '2druppels':{rain:2,standalone:true},
  '3druppels':{rain:3,standalone:true}, '4druppels':{rain:4,standalone:true},
  regen:{cloud:'grey',rain:3}, donkere_wolk_regen:{cloud:'dark',rain:4},
  wolk_licht_1druppel:{cloud:'light',rain:1}, wolk_licht_2druppels:{cloud:'light',rain:2},
  wolk_1druppel:{cloud:'grey',rain:1}, wolk_2druppels:{cloud:'grey',rain:2},
  wolk_3druppels:{cloud:'grey',rain:3}, wolk_4druppels:{cloud:'grey',rain:4}, motregen:{cloud:'grey',drizzle:true},
  wolk_licht_1vlok:{cloud:'light',snow:1}, wolk_licht_2vlokken:{cloud:'light',snow:2},
  wolk_1vlok:{cloud:'grey',snow:1}, wolk_2vlokken:{cloud:'grey',snow:2},
  wolk_3vlokken:{cloud:'grey',snow:3}, wolk_4vlokken:{cloud:'grey',snow:4},
  sneeuw:{cloud:'grey',snow:2}, zware_sneeuw:{cloud:'dark',snow:4}, winterse_bui:{sun:true,cloud:'grey',mixed:true},
  hagel:{cloud:'grey',hail:3}, hagelstenen:{hail:3,standalone:true}, hagelsteen_1:{hail:1,standalone:true},
  hagelsteen_2:{hail:2,standalone:true}, hagelsteen_3:{hail:3,standalone:true},
  gladheid:{ice:true}, ijzel:{cloud:'grey',freezing:true},
  zon_onweersbui:{sun:true,cloud:'dark',thunder:true,rain:2}, stapelwolk_bliksem:{cloud:'grey',tall:true,thunder:true},
  onweer:{cloud:'dark',thunder:true,rain:2}, bliksem:{thunder:true,standalone:true}, bliksem_klein:{thunder:true,standalone:true,small:true},
  windzak:{windsock:true}, mist2:{fog:2}, mist3:{fog:3}, mist4:{fog:4},
  sterren:{moon:'crescent',stars:true}, maan_wolk:{moon:'crescent',cloud:'light'},
  maan_regen:{moon:'crescent',cloud:'grey',rain:3}, maan_onweer:{moon:'crescent',cloud:'dark',thunder:true},
  nieuwe_maan:{moon:'new'}, wassende_sikkel:{moon:'crescent'}, eerste_kwartier:{moon:'first'},
  wassende_maan:{moon:'waxing'}, volle_maan:{moon:'full'}, afnemende_maan:{moon:'waning'},
  laatste_kwartier:{moon:'last'}, afnemende_sikkel:{moon:'waning-crescent'},
};

export const WEATHER_ICON_LABELS = {
  zon:'Zonnig', sluierbewolking:'Zon met sluierbewolking', plukje_sluier:'Dunne sluierwolk', sluierwolken:'Sluierbewolking',
  zon_groot_stapelwolk:'Zon met grote stapelwolk', zon_achter_wolk:'Zon met witte wolk', zon_achter_grijze_wolk:'Zon met grijze wolk',
  zon_achter_donkere_wolk:'Zon met donkere wolk', zon_stapelwolk_mist:'Zon, stapelwolk en mist', zon_stapelwolk:'Zon met stapelwolk',
  zon_stapelwolk_1druppel:'Zon met lichte bui', zon_donkere_wolk:'Zon met donkere stapelwolk', halfbewolkt_regen:'Wisselend bewolkt met buien',
  zon_wolk_regen:'Zon met regenbui', zon_licht_hagelbui:'Lichte hagelbui met zon', zon_donker_hagelbui:'Donkere hagelbui met zon',
  zon_licht_hagelbui2:'Lichte wolk met meer hagel', zon_donker_hagelbui2:'Donkere wolk met meer hagel',
  bewolkt:'Bewolkt', platte_wolk_licht:'Witte laaghangende wolk', platte_wolk_grijs:'Grijze laaghangende wolk', dubbele_wolk:'Twee wolken', driedubbele_wolk:'Drie wolken',
  regen:'Regen', donkere_wolk_regen:'Donkere wolk met regen', motregen:'Motregen', sneeuw:'Sneeuw', zware_sneeuw:'Zware sneeuwval', winterse_bui:'Winterse bui',
  hagelstenen:'Drie hagelstenen', hagelsteen_1:'Eén hagelsteen', hagelsteen_2:'Twee hagelstenen', hagelsteen_3:'Drie hagelstenen',
  hagel:'Hagelbui', ijzel:'IJzel', gladheid:'Gladheid', zon_onweersbui:'Onweersbui met zon', stapelwolk_bliksem:'Stapelwolk met bliksem', onweer:'Onweer met regen', bliksem:'Bliksem', bliksem_klein:'Kleine bliksem',
  windzak:'Windzak', mist2:'Mist · twee banken', mist3:'Mist · drie banken', mist4:'Mist · vier banken', sterren:'Heldere nacht',
  maan_wolk:'Nacht met bewolking', maan_regen:'Nacht met regen', maan_onweer:'Nacht met onweer',
  nieuwe_maan:'Nieuwe maan', wassende_sikkel:'Wassende sikkel', eerste_kwartier:'Eerste kwartier', wassende_maan:'Wassende maan',
  volle_maan:'Volle maan', afnemende_maan:'Afnemende maan', laatste_kwartier:'Laatste kwartier', afnemende_sikkel:'Afnemende sikkel',
};
export const WEATHER_ICON_BASICS = [
  ['zon','Zonnig'], ['zon_achter_wolk','Halfbewolkt'], ['sluierbewolking','Sluierbewolking'], ['bewolkt','Bewolkt'],
  ['zon_wolk_regen','Buien'], ['regen','Regen'], ['motregen','Motregen'], ['onweer','Onweer'],
  ['sneeuw','Sneeuw'], ['winterse_bui','Winterse bui'], ['hagel','Hagel'], ['ijzel','IJzel'],
  ['mist3','Mist'], ['sterren','Heldere nacht'], ['maan_wolk','Bewolkte nacht'], ['maan_regen','Regen in de nacht'],
];
for (let n=1;n<=4;n++) {
  WEATHER_ICON_LABELS[n===1?'1druppel':`${n}druppels`] = `${n} ${n===1?'regendruppel':'regendruppels'}`;
  WEATHER_ICON_LABELS[`wolk_${n}druppel${n>1?'s':''}`] = `Grijze wolk · ${n} ${n===1?'druppel':'druppels'}`;
  WEATHER_ICON_LABELS[`wolk_${n}${n===1?'vlok':'vlokken'}`] = `Grijze wolk · ${n} ${n===1?'sneeuwvlok':'sneeuwvlokken'}`;
  if(n<=2) {
    WEATHER_ICON_LABELS[`wolk_licht_${n}druppel${n>1?'s':''}`] = `Witte wolk · ${n} ${n===1?'druppel':'druppels'}`;
    WEATHER_ICON_LABELS[`wolk_licht_${n}${n===1?'vlok':'vlokken'}`] = `Witte wolk · ${n} ${n===1?'sneeuwvlok':'sneeuwvlokken'}`;
  }
}

export function createWeatherIcon(React, LegacyIcon) {
  const h = React.createElement;
  return function WeatherIcon({type, s = 250}) {
    const unique = React.useId().replace(/:/g, '');
    const spec = WEATHER_ICON_SPECS[type];
    if (!spec) return LegacyIcon ? h(LegacyIcon, {type, s}) : null;
    const id = `wx-${unique}`;
    const nodes = [];
    const path = (d, props = {}) => h('path', {d, strokeLinecap:'round', strokeLinejoin:'round', ...props});
    const circle = (cx,cy,r,props={}) => h('circle',{cx,cy,r,...props});
    const line = (x1,y1,x2,y2,props={}) => h('line',{x1,y1,x2,y2,strokeLinecap:'round',...props});
    const gradient = (name, top, bottom) => h('linearGradient',{id:`${id}-${name}`,x1:'0',y1:'0',x2:'0',y2:'1'},h('stop',{offset:'0%',stopColor:top}),h('stop',{offset:'100%',stopColor:bottom}));
    nodes.push(h('defs',null,gradient('sun','#ffd34d','#ffbc2e'),gradient('light','#ffffff','#e0e7ed'),gradient('grey','#d8e0e7','#9babbc'),gradient('dark','#98a7b7','#5c7187'),gradient('moon','#f3f6fb','#c7d4e3')));
    function sun(cx,cy,r) {
      return h('g',null,Array.from({length:12},(_,i)=>{const a=i*Math.PI/6,outer=r+(i%3===0?12:9);return line(cx+Math.cos(a)*(r+5),cy+Math.sin(a)*(r+5),cx+Math.cos(a)*outer,cy+Math.sin(a)*outer,{stroke:'#f7bd35',strokeWidth:2.6,key:i});}),circle(cx,cy,r,{fill:`url(#${id}-sun)`}));
    }
    function cloud(tone, transform, flat=false, tall=false) {
      const d = flat ? 'M24 61a10 10 0 0 1-1-20c4-10 17-11 24-4 10-8 25-2 26 8 15-2 18 16 4 16H24Z' : tall ? 'M23 65a12 12 0 0 1-1-24c-2-12 7-19 17-16 9-13 28-8 28 9 11-3 21 7 19 18-1 8-7 13-16 13H23Z' : 'M24 65a12 12 0 0 1-1-24c0-10 8-18 18-18 9 0 16 5 18 13 10-5 22 2 23 12 9 7 4 17-7 17H24Z';
      return h('g',{transform},path(d,{fill:`url(#${id}-${tone})`,stroke:tone==='dark'?'#b2c1d0':'#8395a7',strokeWidth:.85}));
    }
    function flake(x,y,size=6) {
      return h('g',{transform:`translate(${x} ${y})`,stroke:'#bce9fc',strokeWidth:1.7,fill:'none'},[0,60,120].map(a=>h('g',{key:a,transform:`rotate(${a})`},line(-size,0,size,0),path(`M${-size+2}-2 ${-size+3.5} 0 ${-size+2} 2M${size-2}-2 ${size-3.5} 0 ${size-2} 2`))));
    }
    function drop(x,y,scale=1,drizzle=false) {
      const d=drizzle?'M.6-1.4-.6 1.4':'M3-6-2 5';
      // A narrow white edge separates the blue from both land and water, also in PNG exports.
      return h('g',{transform:`translate(${x} ${y}) scale(${scale})`,fill:'none'},
        path(d,{stroke:'#fff',strokeOpacity:drizzle?.65:.8,strokeWidth:drizzle?1.35:4.1}),
        path(d,{stroke:drizzle?'#8bdffc':'#51b9e5',strokeWidth:drizzle?.95:3.4}));
    }
    if(spec.sun) nodes.push(spec.clear?sun(48,46,20):sun(spec.cirrus?43:31,spec.cirrus?48:30,spec.cirrus?18:15));
    if(spec.moon) {
      const phase=spec.moon, small=!!spec.cloud, cx=small?22:48,cy=small?22:46,R=small?18:25;
      const moon=[];
      if(phase==='crescent'||phase==='waning-crescent') {
        moon.push(path(`M0 ${-R}A${R} ${R} 0 1 1 0 ${R}A${R*.85} ${R*1.03} 0 0 0 0 ${-R}Z`,{fill:`url(#${id}-moon)`,stroke:'#95a9bd',strokeWidth:.7}));
      } else {
        moon.push(circle(0,0,R,{fill:phase==='full'?`url(#${id}-moon)`:'#455e78',stroke:'#bccbd8',strokeWidth:1.5}));
        if(!['full','new'].includes(phase)) {
          moon.push(path(`M0 ${-R}A${R} ${R} 0 0 1 0 ${R}Z`,{fill:`url(#${id}-moon)`}));
          if(['waxing','waning'].includes(phase)) moon.push(h('ellipse',{cx:0,cy:0,rx:R*.6,ry:R,fill:`url(#${id}-moon)`}));
        }
      }
      nodes.push(h('g',{transform:`translate(${cx} ${cy}) scale(${['waning-crescent','last','waning'].includes(phase)?-1:1} 1)`},moon));
      if(spec.stars) nodes.push(circle(76,28,1.7,{fill:'#d7e6f6'}),circle(26,60,1.5,{fill:'#d7e6f6'}));
    }
    if(spec.layers===3) nodes.push(cloud('grey','translate(10 -17) scale(.75)'));
    if(spec.layers>=2) nodes.push(cloud('grey','translate(18 -8) scale(.82)'));
    if(spec.cloud) nodes.push(cloud(spec.cloud,spec.flat?'translate(0 4)':undefined,spec.flat,spec.tall));
    if(spec.cirrus) nodes.push(h('g',{fill:'none',stroke:'#e5edf4',strokeWidth:3,strokeLinecap:'round'},Array.from({length:spec.cirrus===1?2:spec.cirrus},(_,i)=>path(`M${12+i*7} ${spec.cirrus===1?43+i*9:26+i*11}h12c15 0 17-11 31-11h21`,{key:i}))));
    if(spec.rain) {
      const gap=spec.standalone?17:14,cy=spec.standalone?49:77;
      nodes.push(h('g',null,Array.from({length:spec.rain},(_,i)=>h('g',{key:i},drop(48+(i-(spec.rain-1)/2)*gap,cy,spec.standalone?1.5:1)))));
    }
    if(spec.snow) nodes.push(h('g',null,Array.from({length:spec.snow},(_,i)=>h('g',{key:i},flake(48+(i-(spec.snow-1)/2)*16,77,spec.snow>3?5:6)))));
    if(spec.hail) nodes.push(h('g',null,Array.from({length:spec.hail},(_,i)=>circle(48+(i-(spec.hail-1)/2)*(spec.standalone?20:17),spec.standalone?49:77,spec.standalone?7:4.5,{key:i,fill:'#e9faff',stroke:'#6dc9ed',strokeWidth:2}))));
    if(spec.mixed) nodes.push(drop(37,77),flake(61,77,7));
    if(spec.drizzle) nodes.push(h('g',null,[32,43,54,65].flatMap(x=>[h('g',{key:x},drop(x,73,1,true)),h('g',{key:x+100},drop(x-3,81,1,true))])));
    if(spec.thunder) nodes.push(path('M48 51h13L50 68h10L38 91l7-21H35Z',{fill:'#fac644',stroke:'#b7872f',strokeWidth:.65,transform:spec.standalone?(spec.small?'translate(17 1) scale(.65)':'translate(-5 -38) scale(1.15)'):'translate(0 -2)'}));
    if(spec.fog) {
      const y=spec.cloud?72:48-(spec.fog-1)*6;
      nodes.push(h('g',null,Array.from({length:spec.fog},(_,i)=>line(i%2?25:17,y+i*11,i%2?80:72,y+i*11,{key:i,stroke:'#c1d0dd',strokeWidth:3.5}))));
    }
    if(spec.freezing) nodes.push(drop(35,76),drop(57,76),path('M23 86h49m-40 0 4 5 4-5m18 0 4 5 4-5',{stroke:'#a5dff6',strokeWidth:1.8,fill:'none'}));
    if(spec.ice) nodes.push(path('m22 61 12-10 12 10 12-10 15 10M18 68h61',{stroke:'#a5ddf6',strokeWidth:4,fill:'none'}),flake(48,34,11));
    if(spec.windsock) nodes.push(line(25,25,25,81,{stroke:'#c4d6e6',strokeWidth:4}),circle(25,22,3,{fill:'#eff7ff'}),path('M29 25 80 33v14L29 52Z',{fill:'#f7fafc',stroke:'#8196a7',strokeWidth:1.3}),path('M29 25 41 27v22L29 52ZM53 29l12 2v16l-12 1Z',{fill:'#f47e52'}),line(14,82,36,82,{stroke:'#c4d6e6',strokeWidth:3}));
    return h('g',{'data-weather-icon':type,transform:`scale(${s/96})`},nodes);
  };
}
