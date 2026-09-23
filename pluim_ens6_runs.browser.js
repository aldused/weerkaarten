// Generated from pluim_ens6_runs.mjs; run scripts/build_ens6_runs.cjs to rebuild.
var WeerlabEns6Runs = (() => {
  var __defProp = Object.defineProperty;
  var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __export = (target, all) => {
    for (var name in all)
      __defProp(target, name, { get: all[name], enumerable: true });
  };
  var __copyProps = (to, from, except, desc) => {
    if (from && typeof from === "object" || typeof from === "function") {
      for (let key of __getOwnPropNames(from))
        if (!__hasOwnProp.call(to, key) && key !== except)
          __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
    }
    return to;
  };
  var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

  // pluim_ens6_runs.mjs
  var pluim_ens6_runs_exports = {};
  __export(pluim_ens6_runs_exports, {
    PANEL_TOTAL: () => PANEL_TOTAL,
    RunController: () => RunController,
    panelCount: () => panelCount,
    runId: () => runId,
    runLabel: () => runLabel,
    runToken: () => runToken
  });

  // pluim_ens6_data.mjs
  var MODEL = "ecmwf_ifs025";
  var CORE = ["cloud_cover", "wind_direction_10m"];
  var PARAMETERS = [...CORE, "cloud_cover_low", "cloud_cover_mid", "snowfall", "temperature_850hPa", "temperature_500hPa"];
  var ALLOWED_PARAMETERS = [...PARAMETERS, "cape"];
  var PANEL_GROUPS = [["cloud_cover_low", "cloud_cover_mid"], ["snowfall"], ["temperature_850hPa"], ["temperature_500hPa"]];
  var PANEL_TOTAL = 2 + PANEL_GROUPS.length;
  function panelCount(entry) {
    const has = (field) => entry?.fields?.includes(field) || entry?.sparse_fields?.includes(field);
    return 2 + PANEL_GROUPS.filter((group) => group.every(has)).length;
  }
  function runId(value) {
    const raw = String(value || "");
    const match = /^(\d{4})(\d{2})(\d{2})T(00|06|12|18)$/.exec(raw);
    const iso = match ? `${match[1]}-${match[2]}-${match[3]}T${match[4]}:00:00Z` : raw;
    if (!/^\d{4}-\d{2}-\d{2}T(00|06|12|18):00(?::00(?:\.000)?)?Z$/.test(iso)) throw new Error("Ongeldige modelrun. Gebruik een volledige UTC-datum en 00, 06, 12 of 18 UTC.");
    const date = new Date(iso);
    if (!Number.isFinite(+date) || date.toISOString().slice(0, 16) !== iso.slice(0, 16)) throw new Error("Ongeldige modelrundatum.");
    return date.toISOString().replace(".000Z", "Z");
  }
  function runToken(value) {
    return runId(value).replaceAll("-", "").replace(":00:00Z", "");
  }
  function runLabel(value) {
    const date = new Date(runId(value));
    return `${new Intl.DateTimeFormat("nl-NL", { timeZone: "UTC", day: "numeric", month: "long", year: "numeric" }).format(date)} \u2013 ${String(date.getUTCHours()).padStart(2, "0")} UTC`;
  }
  function assertDataset(data, id) {
    const expected = runId(id);
    if (data?.run !== expected || runId(data.ens?.weerlab_run) !== expected || data.meta?.last_run_initialisation_time * 1e3 !== Date.parse(expected)) throw new Error("De ontvangen gegevens horen niet bij de gekozen modelrun.");
    const times = data.ens.hourly?.time;
    if (!times?.length || Date.parse(times[0]) !== Date.parse(expected) || Date.parse(times.at(-1)) !== data.meta.data_end_time * 1e3) throw new Error("De tijdas hoort niet bij de gekozen modelrun.");
    return data;
  }

  // pluim_ens6_runs.mjs
  var RunController = class {
    constructor({ fetcher = globalThis.fetch.bind(globalThis), base = "https://om.weerlab.nl", requested = null } = {}) {
      this.fetcher = fetcher;
      this.base = base;
      this.requested = requested;
      this.selectedRun = null;
      this.runs = [];
      this.catalogs = /* @__PURE__ */ new Map();
      this.cache = /* @__PURE__ */ new Map();
      this.serial = 0;
      this.abort = null;
      this.activeKey = null;
      this.pending = null;
    }
    async catalog(location, signal, refresh = false) {
      const key = `${location.lat},${location.lon}`;
      const cached = this.catalogs.get(key);
      if (!refresh && cached && Date.now() - cached.at < 6e4) {
        this.runs = cached.data.runs;
        return cached.data;
      }
      const query = new URLSearchParams({ latitude: location.lat, longitude: location.lon, model: MODEL });
      const data = await this.json(`${this.base}/ens6-runs?${query}`, signal);
      signal.throwIfAborted();
      data.runs = (data.runs || []).map((r) => ({ ...r, run: runId(r.run) })).sort((a, b) => Date.parse(b.run) - Date.parse(a.run));
      this.catalogs.set(key, { data, at: Date.now() });
      this.runs = data.runs;
      return data;
    }
    async json(url, signal) {
      const response = await this.fetcher(url, { signal, cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || `Gegevens niet beschikbaar (HTTP ${response.status}).`);
      return data;
    }
    choose(value) {
      this.abort?.abort();
      this.serial++;
      this.requested = value;
      this.selectedRun = null;
      if (value && !/^(00|06|12|18)$/.test(value)) this.selectedRun = runId(value);
    }
    async load(location, { refresh = false, onSelection = () => {
    } } = {}) {
      const key = JSON.stringify([location.lat, location.lon, this.selectedRun || this.requested, refresh]);
      if (this.pending && key === this.activeKey && !this.abort?.signal.aborted) return this.pending;
      this.abort?.abort();
      const abort = new AbortController(), serial = ++this.serial;
      this.abort = abort;
      this.activeKey = key;
      const { signal } = abort;
      const work = (async () => {
        const catalog = await this.catalog(location, signal, refresh);
        signal.throwIfAborted();
        if (!this.selectedRun) {
          if (/^(00|06|12|18)$/.test(this.requested || "")) {
            this.selectedRun = this.runs.find((r) => new Date(r.run).getUTCHours() === Number(this.requested))?.run;
            if (!this.selectedRun) throw new Error(`De gekozen ${this.requested} UTC-run is niet beschikbaar.`);
          } else if (this.requested) this.selectedRun = runId(this.requested);
          else this.selectedRun = (this.runs.find((r) => panelCount(r) === PANEL_TOTAL) || this.runs[0])?.run;
        }
        const id = this.selectedRun;
        if (!id) throw new Error("Geen bruikbare ENS6plus-runs beschikbaar voor deze locatie.");
        onSelection(id, catalog);
        const option = this.runs.find((r) => r.run === id);
        if (!option) throw new Error(`Modelrun ${runLabel(id)} is niet beschikbaar voor deze locatie. Kies bewust een andere run.`);
        const query = new URLSearchParams({ latitude: location.lat, longitude: location.lon, model: MODEL, run: id, hourly: [...PARAMETERS].sort().join(","), start_hour: id, forecast: "all-native", revision: option.revision || catalog.revision || "" });
        const cacheKey = query.toString();
        let data = !refresh && this.cache.get(cacheKey);
        if (!data) {
          data = assertDataset(await this.json(`${this.base}/ens6-run?${query}`, signal), id);
          signal.throwIfAborted();
          if (data.location?.latitude !== location.lat || data.location?.longitude !== location.lon) throw new Error("De ontvangen gegevens horen bij een andere locatie.");
          this.cache.set(cacheKey, data);
          if (this.cache.size > 24) this.cache.delete(this.cache.keys().next().value);
        }
        signal.throwIfAborted();
        if (serial !== this.serial || id !== this.selectedRun) throw new DOMException("Ingehaald door een nieuwe keuze", "AbortError");
        return { data, serial, location: { ...location }, cacheKey };
      })();
      this.pending = work;
      try {
        return await work;
      } finally {
        if (this.pending === work) {
          this.pending = null;
          this.activeKey = null;
        }
      }
    }
    isCurrent(result) {
      return result.serial === this.serial && result.data.run === this.selectedRun && !this.abort.signal.aborted;
    }
  };
  return __toCommonJS(pluim_ens6_runs_exports);
})();
