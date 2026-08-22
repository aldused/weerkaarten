(function(){
  const SYNC_BASE = 'https://om.weerlab.nl/draft/';
  const SYNC_ENABLED_KEY = 'wb_live_sync_enabled';
  const EVENT_STORE_KEY = 'wb_eventen_v1';
  const EVENT_STATE_KEY = 'wb_eventen_state_v1';

  function isEnabled(){
    try{ return localStorage.getItem(SYNC_ENABLED_KEY) === '1'; }
    catch(e){ return false; }
  }

  function syncDisabledError(){
    const err = new Error('Gedeelde live sync staat uit');
    err.code = 'WB_SYNC_DISABLED';
    return err;
  }

  function setEnabled(enabled){
    const actief = !!enabled;
    try{ localStorage.setItem(SYNC_ENABLED_KEY, actief ? '1' : '0'); }catch(e){}
    updateToggleControls();
    document.dispatchEvent(new CustomEvent('wb-sync-toggle', { detail: { enabled: actief } }));
    return actief;
  }

  function updateToggleControls(){
    const actief = isEnabled();
    document.querySelectorAll('[data-wb-sync-toggle], #wb-live-sync').forEach(el => {
      if(el.type === 'checkbox') el.checked = actief;
    });
    document.querySelectorAll('[data-wb-sync-status], #wb-live-sync-status').forEach(el => {
      el.textContent = actief ? 'sync aan' : 'sync uit';
      el.style.color = actief ? '#2a7a2a' : '#888';
    });
  }

  function initToggle(opts = {}){
    updateToggleControls();
    document.querySelectorAll('[data-wb-sync-toggle], #wb-live-sync').forEach(el => {
      if(el.dataset.wbSyncBound === '1') return;
      el.dataset.wbSyncBound = '1';
      el.addEventListener('change', () => {
        const actief = setEnabled(el.checked);
        if(actief && typeof opts.onEnable === 'function') opts.onEnable();
        if(!actief && typeof opts.onDisable === 'function') opts.onDisable();
      });
    });
    window.addEventListener('storage', e => {
      if(e.key === SYNC_ENABLED_KEY) updateToggleControls();
    });
  }

  function urlVoorKey(key){
    return SYNC_BASE + encodeURIComponent(key);
  }

  async function getJson(key){
    if(!isEnabled()) throw syncDisabledError();
    const r = await fetch(urlVoorKey(key) + '?_=' + Date.now(), { cache: 'no-store' });
    if(!r.ok) throw new Error('Sync GET mislukt: ' + r.status);
    return r.json();
  }

  // Versie die de toggle negeert — bedoeld voor evenementenplanning die altijd over
  // alle laptops moet worden gedeeld, los van de live-sync schakelaar.
  async function getJsonAltijd(key){
    const r = await fetch(urlVoorKey(key) + '?_=' + Date.now(), { cache: 'no-store' });
    if(!r.ok) throw new Error('Sync GET mislukt: ' + r.status);
    return r.json();
  }

  async function putJson(key, data){
    if(!isEnabled()) return false;
    const r = await fetch(urlVoorKey(key), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    if(!r.ok) throw new Error('Sync PUT mislukt: ' + r.status);
    return true;
  }

  async function putJsonAltijd(key, data){
    const r = await fetch(urlVoorKey(key), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    if(!r.ok) throw new Error('Sync PUT mislukt: ' + r.status);
    return true;
  }

  async function putRawJson(key, jsonText){
    if(!isEnabled()) return false;
    JSON.parse(jsonText);
    const r = await fetch(urlVoorKey(key), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: jsonText
    });
    if(!r.ok) throw new Error('Sync PUT mislukt: ' + r.status);
    return true;
  }

  async function deleteKey(key){
    if(!isEnabled()) return false;
    const r = await fetch(urlVoorKey(key), { method: 'DELETE' });
    if(!r.ok) throw new Error('Sync DELETE mislukt: ' + r.status);
    return true;
  }

  function parseStorage(key, fallback){
    try{
      const v = localStorage.getItem(key);
      return v ? JSON.parse(v) : fallback;
    }catch(e){
      return fallback;
    }
  }

  function docSlug(naam){
    return String(naam || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'') || 'document';
  }

  function docDraftKey(type, datum, naam){
    const prefix = type === 'wm' ? 'wb_wm_draft_' : 'wb_uurlijks_draft_';
    return prefix + datum + '_' + docSlug(naam);
  }

  function normalizeEvent(ev){
    if(!ev || !ev.date || !ev.title) return null;
    const updated = Number(ev.updated || ev.__ts || Date.now());
    const id = String(ev.id || ('evt_' + updated.toString(36) + '_' + docSlug(ev.title).slice(0, 16)));
    return {
      id,
      date: String(ev.date),
      endDate: String(ev.endDate || ev.date),
      days: Math.max(1, parseInt(ev.days || '1', 10) || 1),
      title: String(ev.title || '').trim(),
      location: String(ev.location || '').trim(),
      wmDoc: String(ev.wmDoc || '').trim(),
      hourlyDoc: String(ev.hourlyDoc || '').trim(),
      updated
    };
  }

  function normalizeEventState(input){
    const state = (input && typeof input === 'object' && !Array.isArray(input)) ? input : { events: input };
    const deleted = {};
    if(state.deleted && typeof state.deleted === 'object'){
      Object.entries(state.deleted).forEach(([id, ts]) => {
        const n = Number(ts || 0);
        if(id && n) deleted[id] = n;
      });
    }
    const map = new Map();
    (Array.isArray(state.events) ? state.events : []).forEach(raw => {
      const ev = normalizeEvent(raw);
      if(!ev) return;
      const goneAt = deleted[ev.id] || 0;
      if(goneAt && goneAt >= ev.updated) return;
      const oud = map.get(ev.id);
      if(!oud || ev.updated >= oud.updated) map.set(ev.id, ev);
    });
    let ts = Number(state.__ts || 0);
    map.forEach(ev => { if(ev.updated > ts) ts = ev.updated; });
    Object.values(deleted).forEach(v => { if(v > ts) ts = v; });
    return { __ts: ts || Date.now(), events: [...map.values()], deleted };
  }

  function readLocalEventState(){
    const state = normalizeEventState(parseStorage(EVENT_STATE_KEY, null));
    const legacy = normalizeEventState(parseStorage(EVENT_STORE_KEY, []));
    return mergeEventStates(state, legacy);
  }

  function writeLocalEventState(state){
    const normaal = normalizeEventState(state);
    localStorage.setItem(EVENT_STATE_KEY, JSON.stringify(normaal));
    localStorage.setItem(EVENT_STORE_KEY, JSON.stringify(normaal.events));
    return normaal;
  }

  function mergeEventStates(a, b){
    const left = normalizeEventState(a || {});
    const right = normalizeEventState(b || {});
    const deleted = { ...left.deleted };
    Object.entries(right.deleted).forEach(([id, ts]) => {
      if(!deleted[id] || ts > deleted[id]) deleted[id] = ts;
    });
    const map = new Map();
    [...left.events, ...right.events].forEach(raw => {
      const ev = normalizeEvent(raw);
      if(!ev) return;
      const goneAt = deleted[ev.id] || 0;
      if(goneAt && goneAt >= ev.updated) return;
      const oud = map.get(ev.id);
      if(!oud || ev.updated >= oud.updated) map.set(ev.id, ev);
    });
    let ts = Math.max(left.__ts || 0, right.__ts || 0);
    map.forEach(ev => { if(ev.updated > ts) ts = ev.updated; });
    Object.values(deleted).forEach(v => { if(v > ts) ts = v; });
    return { __ts: ts || Date.now(), events: [...map.values()], deleted };
  }

  function stateSignature(state){
    const normaal = normalizeEventState(state);
    return JSON.stringify({
      __ts: normaal.__ts,
      events: normaal.events.slice().sort((a,b)=>a.id.localeCompare(b.id)),
      deleted: normaal.deleted
    });
  }

  // Evenementenplanning wordt altijd gedeeld zodat elk apparaat de geplande events
  // ziet, los van de live-sync toggle (die alleen voor drafts geldt).
  async function syncEventState(){
    const local = readLocalEventState();
    let remote = normalizeEventState({});
    try{
      remote = normalizeEventState(await getJsonAltijd(EVENT_STATE_KEY));
    }catch(e){}
    const merged = mergeEventStates(local, remote);
    const localChanged = stateSignature(merged) !== stateSignature(local);
    const remoteChanged = stateSignature(merged) !== stateSignature(remote);
    if(localChanged) writeLocalEventState(merged);
    else writeLocalEventState(local);
    if(remoteChanged){
      try{ await putJsonAltijd(EVENT_STATE_KEY, merged); }catch(e){}
    }
    return { state: merged, localChanged, remoteChanged };
  }

  async function pushEventState(state){
    const normaal = writeLocalEventState(state);
    try{ await putJsonAltijd(EVENT_STATE_KEY, normaal); }catch(e){}
    return normaal;
  }

  function updateEventStateDoc(state, eventId, eventType, datum, oldDoc, newDoc){
    const normaal = normalizeEventState(state);
    const veld = eventType === 'uur' ? 'hourlyDoc' : 'wmDoc';
    let changed = false;
    normaal.events = normaal.events.map(ev => {
      const zelfdeEvent = eventId && ev.id === eventId;
      const zelfdeDocument = oldDoc && ev[veld] === oldDoc && (!datum || ev.date === datum);
      if(!zelfdeEvent && !zelfdeDocument) return ev;
      if(ev[veld] === newDoc) return ev;
      changed = true;
      return { ...ev, [veld]: newDoc, updated: Date.now() };
    });
    if(changed) normaal.__ts = Date.now();
    return { state: normaal, changed };
  }

  async function updateSharedEventDocLink(opts){
    const local = updateEventStateDoc(readLocalEventState(), opts.eventId, opts.eventType, opts.datum, opts.oldDoc, opts.newDoc);
    if(local.changed) writeLocalEventState(local.state);
    let remote = null;
    try{ remote = normalizeEventState(await getJsonAltijd(EVENT_STATE_KEY)); }catch(e){}
    const basis = remote ? mergeEventStates(local.state, remote) : local.state;
    const updated = updateEventStateDoc(basis, opts.eventId, opts.eventType, opts.datum, opts.oldDoc, opts.newDoc);
    const state = updated.changed ? updated.state : basis;
    writeLocalEventState(state);
    try{ await putJsonAltijd(EVENT_STATE_KEY, state); }catch(e){}
    return state;
  }

  function hasData(obj){
    if(!obj) return false;
    if(Array.isArray(obj)) return obj.length > 0;
    if(typeof obj !== 'object') return false;
    return !!obj.__ts || Object.keys(obj).length > 0;
  }

  async function sharedKeyHasData(key){
    if(!isEnabled()) return false;
    try{ return hasData(await getJson(key)); }
    catch(e){ return false; }
  }

  async function migrateLocalStorage(prefixes){
    if(!isEnabled()) return false;
    const keys = [];
    try{
      for(let i=0;i<localStorage.length;i++){
        const key = localStorage.key(i);
        if(prefixes.some(prefix => key && key.startsWith(prefix))) keys.push(key);
      }
    }catch(e){}
    for(const key of keys){
      try{
        const value = localStorage.getItem(key);
        if(value) await putRawJson(key, value);
      }catch(e){}
    }
  }

  window.WBSync = {
    SYNC_ENABLED_KEY,
    EVENT_STORE_KEY,
    EVENT_STATE_KEY,
    isEnabled,
    setEnabled,
    initToggle,
    updateToggleControls,
    docDraftKey,
    getJson,
    putJson,
    getJsonAltijd,
    putJsonAltijd,
    putRawJson,
    deleteKey,
    sharedKeyHasData,
    normalizeEvent,
    normalizeEventState,
    readLocalEventState,
    writeLocalEventState,
    mergeEventStates,
    syncEventState,
    pushEventState,
    updateSharedEventDocLink,
    migrateLocalStorage
  };
})();
