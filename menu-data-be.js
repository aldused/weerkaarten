/* Belgische inhoud in dezelfde navigatie als Weerlab Nederland. */
window.WEERLAB_MENU_SITE = {
  selfPage:'index_be.html', storagePrefix:'weerlab-menu-be-v1', directProducts:true,
  homeTitle:'Jouw Belgische weeroverzicht',
  homeDescription:'Weerkaarten, verwachtingen en metingen voor België, op één plek.',
  welcome:'Welkom bij Weerlab België', searchTitle:'Zoek in Weerlab België', searchScope:'Weerlab België',
  navItems:['nu','verwachting','analyse'],
  categories:{
    start:{name:'Overzicht',icon:'home'},
    nu:{name:'Nu',icon:'sun',title:'Het weer van dit moment',description:'Bekijk de laatste luchthavenmetingen en verwachtingen voor de luchtvaart.'},
    verwachting:{name:'Verwachting',icon:'cloud',title:'Wat gaat het weer doen?',description:'Bekijk de Belgische weerkaarten en de verwachting voor jouw plaats.'},
    analyse:{name:'Analyse',icon:'chart',title:'Verdieping bij de verwachting',description:'Volg veranderingen tussen modelruns en lees de meteorologische modelbeoordeling.'},
    favorieten:{name:'Favorieten',icon:'star',title:'Jouw Belgische favorieten',description:'De Belgische onderdelen die je graag bij de hand houdt.'}
  },
  typeNames:{kaarten:'Weerkaarten',pluim:'Weerpluim',metingen:'Metingen',analyse:'Analyse',nieuws:'Nieuws'},
  filterSets:{}, defaultFavorites:['mosmix','pluim','trend'],
  quickProducts:['mosmix','mosmix-parameter','pluim','trend'],
  searchSuggestions:['MOSMIX','Neerslag','Pluim','Trend','METAR'],
  routeAliases:{'mosmix-overzicht':'mosmix','mosmix-mosmix-overzicht':'mosmix','mosmix-mosmix-parameter':'mosmix-parameter',nieuws:'nieuw',eigen:'menu/start'},
  extraLinks:[{href:'index_be.html#nieuw',name:'Wat is nieuw'},{href:'index.html',name:'Weer in Nederland'},{href:'/cdn-cgi/access/logout',name:'Uitloggen'}],
  browse:[
    {id:'nu',description:'Wat gebeurt er op dit moment?',links:[['metar','METAR & TAF']]},
    {id:'verwachting',description:'Wat kun je de komende dagen verwachten?',links:[['mosmix','MOS/MIX overzicht'],['mosmix-parameter','Kaarten per weerelement'],['pluim','Interactieve weerpluim']]},
    {id:'analyse',description:'Hoe ontwikkelt de verwachting zich?',links:[['trend','Trend per modelrun'],['guidance','Guidance modelbeoordeling']]}
  ]
};
const MENU_LABELS = {};
const MENU_PRODUCTS = [
  {id:'mosmix',name:'MOS/MIX België',description:'Het verwachte weer in één overzichtskaart.',category:'verwachting',type:'kaarten',icon:'map',src:'mosmix_composiet_be.html?v=20260911-belgie1',keywords:'België Belgisch Brussel overzicht temperatuur neerslag regen wind zon bewolking DWD'},
  {id:'mosmix-parameter',name:'Kaarten per weerelement',description:'Temperatuur, neerslag, wind en meer voor België.',category:'verwachting',type:'kaarten',icon:'map',src:'mosmix_kaart_be.html',keywords:'België Belgisch MOSMIX MOS/MIX DWD parameter temperatuur neerslag regen wind zon bewolking'},
  {id:'pluim',name:'Interactieve weerpluim',description:'De verwachting voor jouw plaats, met Brussel als startpunt.',category:'verwachting',type:'pluim',icon:'pluim',src:'pluim_interactief.html?v=20260811-all-runs-v3#temp|7|50.850|4.351|Brussel',thumbnail:'thumbs/pluim-viewer.webp',keywords:'België Belgisch Brussel ensemble ECMWF temperatuur neerslag regen wind bewolking onzekerheid'},
  {id:'trend',name:'MOS/MIX trend',description:'Vergelijk de Belgische verwachting tussen opeenvolgende modelruns.',category:'analyse',type:'analyse',icon:'pluimtrend',src:'grafiek_trend_be.html',thumbnail:'thumbs/mosmix-trend.webp',keywords:'België Belgisch MOSMIX DWD modelrun verandering grafiek temperatuur neerslag regen wind bewolking'},
  {id:'guidance',name:'Guidance modelbeoordeling',description:'De KNMI-toelichting bij de korte en meerdaagse verwachting.',category:'analyse',type:'analyse',icon:'tekst',src:'guidance.html',keywords:'Guidance KNMI modelbeoordeling weerbericht meteorologie tekst'},
  {id:'metar',name:'METAR & TAF',description:'Actuele luchthavenmetingen en luchtvaartverwachtingen.',category:'nu',type:'metingen',icon:'tabel',src:'metar_taf.html',keywords:'België Belgisch Brussel Zaventem EBBR luchthavens luchtvaart wind zicht bewolking metingen'},
  {id:'nieuw',name:'Wat is nieuw',description:'De laatste toevoegingen en verbeteringen in Weerlab.',category:'start',type:'nieuws',icon:'tekst',src:'nieuws.html',keywords:'nieuws updates wijzigingen'}
].map(product=>({...product,href:'index_be.html#'+product.id,facets:product.type==='kaarten'?{model:['mosmix']}: {},restricted:false}));
