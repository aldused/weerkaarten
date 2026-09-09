/* Presentation and accessibility for radar.html; weather calculations stay in the radar engine. */
(function (global) {
  'use strict';
  var paths = {
    radar:'M12 3a9 9 0 1 0 9 9M12 7a5 5 0 1 0 5 5M12 12l8-8M12 3v9',
    pin:'M19 10c0 5-7 11-7 11S5 15 5 10a7 7 0 1 1 14 0ZM15 10a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z',
    layers:'m3 8 9-5 9 5-9 5-9-5Zm0 5 9 5 9-5M3 18l9 5 9-5',
    sliders:'M4 7h7m4 0h5M4 17h3m4 0h9M11 4v6M7 14v6',
    pointer:'m4 3 6 18 3-8 8-3L4 3Z',
    cloud:'M7 18a5 5 0 1 1 1-9.9A6 6 0 0 1 20 11a3.5 3.5 0 0 1-.5 7H7Z',
    lightning:'m13 2-9 12h7l-1 8 10-13h-7l0-7Z',
    snow:'M12 2v20M3 7l18 10M3 17 21 7M9 4l3 3 3-3M9 20l3-3 3 3',
    left:'m14 5-7 7 7 7', right:'m10 5 7 7-7 7', close:'m6 6 12 12M6 18 18 6',
    expand:'M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5'
  };
  function isWindowAvailable(times, nowIndex, code) {
    if (!times || !times.length || nowIndex < 0) return false;
    if (code === 'nu' || code === 'radar') return true;
    var match = /^([+-])(\d+)(u|m)$/.exec(code);
    if (!match) return false;
    var offset = Number(match[2]) * (match[3] === 'u' ? 3600000 : 60000) * (match[1] === '-' ? -1 : 1);
    var target = Date.parse(times[nowIndex]) + offset;
    return Number.isFinite(target) && target >= Date.parse(times[0]) && target <= Date.parse(times[times.length - 1]);
  }
  function mapLabelScale(displayWidth, nativeWidth) {
    return Math.max(1, nativeWidth / Math.max(200, displayWidth || nativeWidth));
  }
  function init() {
    var d=global.document;
    d.querySelectorAll('[data-radar-icon]').forEach(function(el) {
      var p=paths[el.getAttribute('data-radar-icon')];
      if(p) el.innerHTML='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="'+p+'"/></svg>';
    });
    var tabs=Array.from(d.querySelectorAll('[data-radar-tab]'));
    function activate(tab, focus) {
      tabs.forEach(function(t) {
        var active=t===tab;
        t.setAttribute('aria-selected',String(active)); t.tabIndex=active?0:-1;
        d.getElementById(t.getAttribute('aria-controls')).hidden=!active;
      });
      if(focus) tab.focus();
    }
    tabs.forEach(function(tab,index) {
      tab.addEventListener('click',function(){activate(tab,false);});
      tab.addEventListener('keydown',function(event){
        var next=event.key==='ArrowRight'?(index+1)%tabs.length:event.key==='ArrowLeft'?(index+tabs.length-1)%tabs.length:event.key==='Home'?0:event.key==='End'?tabs.length-1:null;
        if(next!==null){event.preventDefault();event.stopPropagation();activate(tabs[next],true);}
      });
    });
    d.querySelectorAll('[data-needs-radar]').forEach(function(el){el.disabled=true;});
    d.querySelectorAll('.speed-btn').forEach(function(el){el.setAttribute('aria-pressed',String(el.classList.contains('actief')));});
    d.getElementById('radar-retry').addEventListener('click',function(){global.location.reload();});
  }
  function ready(times,nowIndex) {
    global.document.querySelectorAll('[data-needs-radar]').forEach(function(el){el.disabled=false;});
    global.document.querySelectorAll('[data-window]').forEach(function(el){
      if (!el.dataset.availableTitle) el.dataset.availableTitle=el.getAttribute('title') || '';
      el.disabled=!isWindowAvailable(times,nowIndex,el.getAttribute('data-window'));
      el.title=el.disabled?'Dit tijdstip is niet beschikbaar in de huidige radargegevens':el.dataset.availableTitle;
    });
    global.document.getElementById('radar-retry').hidden=true;
  }
  function sync(state) {
    var d=global.document,kind=d.getElementById('frame-kind');
    kind.textContent=state.mode!=='instant'?'NEERSLAGSOM':state.forecast?'VERWACHTING · KNMI':'GEMETEN RADAR';
    kind.dataset.kind=state.mode!=='instant'?'sum':state.forecast?'forecast':'observed';
    d.getElementById('slider').setAttribute('aria-valuetext',state.label);
    if (state.latest && Number.isFinite(Date.parse(state.latest))) {
      var age=Math.max(0,Math.floor((Date.now()-Date.parse(state.latest))/60000));
      var freshness=d.getElementById('hdr-update');
      var ageKey=state.latest+'|'+age;
      if (freshness.dataset.ageKey!==ageKey) {
        var stamp=new Date(state.latest).toLocaleTimeString('nl-NL',{hour:'2-digit',minute:'2-digit',timeZone:'Europe/Amsterdam'});
        freshness.dataset.ageKey=ageKey;
        freshness.dataset.stale=String(age>20);
        freshness.textContent=(age>20?'Verouderde meting · ':'Laatste meting · ')+stamp+' · '+age+' min geleden';
      }
    }
    d.querySelectorAll('.layer-btn').forEach(function(el){el.setAttribute('aria-pressed',String(!!state.layers[el.getAttribute('data-layer')]));});
    d.querySelectorAll('[data-window]').forEach(function(el){el.setAttribute('aria-pressed',String(el.classList.contains('actief')));});
  }
  global.RadarUI={init:init,ready:ready,sync:sync,isWindowAvailable:isWindowAvailable,mapLabelScale:mapLabelScale};
})(window);
