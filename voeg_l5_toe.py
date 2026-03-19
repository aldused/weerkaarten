#!/usr/bin/env python3
"""
voeg_l5_toe.py — Voegt L5 Gemiddelde tab toe aan records_debilt.html.
Zet dit script in de projectroot en draai het eenmalig.
"""
import os, re

ROOT = os.path.dirname(os.path.abspath(__file__))
HTML_PAD = os.path.join(ROOT, "records_debilt.html")

h = open(HTML_PAD, encoding="utf-8").read()

# ── 1. Mode-toggle toevoegen aan header ───────────────────────────────────────
HEADER_LINKS_OUD = '<div class="header-links">'
HEADER_LINKS_NIEUW = '''<div style="display:flex;align-items:center;gap:8px;margin-right:16px;">
    <div id="mode-btn-stations" onclick="wisselModus('stations')"
         style="padding:6px 14px;border-radius:8px;cursor:pointer;font-size:0.82em;font-weight:600;background:var(--accent);color:white;white-space:nowrap;transition:all 0.15s;">
      📊 Stations
    </div>
    <div id="mode-btn-l5" onclick="wisselModus('l5')"
         style="padding:6px 14px;border-radius:8px;cursor:pointer;font-size:0.82em;font-weight:600;background:var(--kaart);border:1px solid var(--rand);color:var(--tekst2);white-space:nowrap;transition:all 0.15s;">
      🗺️ L5 Gemiddelde
    </div>
  </div>
  <div class="header-links">'''

h = h.replace(HEADER_LINKS_OUD, HEADER_LINKS_NIEUW, 1)

# ── 2. L5 sectie HTML toevoegen vóór </body> ──────────────────────────────────
L5_HTML = '''
<!-- ═══════════════════════════════════════════════════════════════════════ -->
<!-- L5 GEMIDDELDE SECTIE                                                   -->
<!-- ═══════════════════════════════════════════════════════════════════════ -->
<div id="l5-sectie" style="display:none;">

  <!-- L5 filters balk -->
  <div class="filters" id="l5-filters">
    <div class="filter-groep">
      <div class="filter-label">Parameter</div>
      <div style="display:flex;gap:6px;flex-wrap:wrap;">
        <div class="ptab actief" id="l5-ptab-TX" onclick="l5WisselParam('TX')">🌡 Max temp (TX)</div>
        <div class="ptab" id="l5-ptab-TN" onclick="l5WisselParam('TN')">❄️ Min temp (TN)</div>
        <div class="ptab" id="l5-ptab-TG" onclick="l5WisselParam('TG')">🌡 Gem temp (TG)</div>
        <div class="ptab" id="l5-ptab-RH" onclick="l5WisselParam('RH')">🌧 Neerslag (RH)</div>
      </div>
    </div>
    <div class="periode-tabs">
      <div class="ptab actief" id="l5-per-dag"      onclick="l5WisselPeriode('dag')">Dag</div>
      <div class="ptab"        id="l5-per-decade"   onclick="l5WisselPeriode('decade')">Decade</div>
      <div class="ptab"        id="l5-per-maand"    onclick="l5WisselPeriode('maand')">Maand</div>
      <div class="ptab"        id="l5-per-seizoen"  onclick="l5WisselPeriode('seizoen')">Seizoen</div>
      <div class="ptab"        id="l5-per-jaar"     onclick="l5WisselPeriode('jaar')">Jaar</div>
    </div>
    <div class="filter-groep" id="l5-filter-seizoen" style="display:none;">
      <div class="filter-label">Seizoen</div>
      <select id="l5-sel-seizoen" onchange="l5Toon()">
        <option value="winter">Winter (dec-feb)</option>
        <option value="lente">Lente (mrt-mei)</option>
        <option value="zomer">Zomer (jun-aug)</option>
        <option value="herfst">Herfst (sep-nov)</option>
      </select>
    </div>
    <div style="display:flex;align-items:center;padding:0 16px;border-left:1px solid var(--rand);margin-left:auto;">
      <div onclick="l5WisselJaar()" id="l5-btn-jaaroverzicht"
           style="padding:6px 16px;border-radius:8px;cursor:pointer;font-size:0.82em;font-weight:600;background:linear-gradient(135deg,#1d4ed8,#0d9488);color:white;white-space:nowrap;">
        📋 Jaaroverzicht
      </div>
    </div>
  </div>

  <!-- L5 records content -->
  <div class="content" id="l5-content">
    <div class="records-header">
      <div>
        <div class="records-titel" id="l5-titel">L5 Gemiddelde – alltime records</div>
        <div class="records-sub" id="l5-sub">De Bilt · Den Helder · Eelde · Vlissingen · Maastricht</div>
      </div>
      <div class="records-periode" id="l5-periode-lbl"></div>
    </div>

    <!-- Records tabel -->
    <div id="l5-records-sectie">
      <div class="richting-tabs" id="l5-richting-tabs">
        <div class="rtab actief" onclick="l5WisselRichting('hoog')">Hoogste</div>
        <div class="rtab"        onclick="l5WisselRichting('laag')">Laagste</div>
      </div>
      <div class="tabel-wrapper">
        <div class="laden" id="l5-laden">Laden...</div>
        <table id="l5-tabel" style="display:none;">
          <thead>
            <tr>
              <th>#</th>
              <th>Datum / Periode</th>
              <th id="l5-th-waarde">Waarde</th>
            </tr>
          </thead>
          <tbody id="l5-body"></tbody>
        </table>
      </div>
    </div>

    <!-- Jaaroverzicht sectie -->
    <div id="l5-jaar-sectie" style="display:none;">
      <div style="display:flex;align-items:center;gap:12px;margin-bottom:16px;">
        <div style="font-size:1.1em;font-weight:600;color:white;">📋 Jaaroverzicht L5</div>
        <button onclick="l5SluitJaar()"
          style="padding:6px 14px;border-radius:20px;border:1px solid var(--rand);background:var(--kaart);color:var(--tekst2);cursor:pointer;font-size:0.80em;font-weight:500;font-family:'DM Sans',sans-serif;">
          ← Terug naar records
        </button>
      </div>
      <div style="background:var(--kaart);border:1px solid var(--rand);border-radius:14px;padding:16px 24px;overflow-x:auto;">
        <table style="width:100%;border-collapse:collapse;font-size:0.82em;min-width:700px;">
          <thead>
            <tr style="background:rgba(59,130,246,0.12);">
              <th onclick="l5SortJaar('jaar')"    style="padding:8px 12px;text-align:left;font-size:0.72em;font-weight:600;text-transform:uppercase;letter-spacing:0.08em;color:var(--tekst2);border-bottom:1px solid var(--rand);cursor:pointer;" id="l5j-th-jaar">Jaar↕</th>
              <th onclick="l5SortJaar('tg_gem')"  style="padding:8px 12px;text-align:right;color:#f59e0b;border-bottom:1px solid var(--rand);cursor:pointer;" id="l5j-th-tg">TG gem↕</th>
              <th onclick="l5SortJaar('tx_gem')"  style="padding:8px 12px;text-align:right;color:#ef4444;border-bottom:1px solid var(--rand);cursor:pointer;" id="l5j-th-tx">TX gem↕</th>
              <th onclick="l5SortJaar('tn_gem')"  style="padding:8px 12px;text-align:right;color:#60a5fa;border-bottom:1px solid var(--rand);cursor:pointer;" id="l5j-th-tn">TN gem↕</th>
              <th onclick="l5SortJaar('warme_dagen')" style="padding:8px 12px;text-align:right;color:#ef4444;border-bottom:1px solid var(--rand);cursor:pointer;">Warm&gt;20↕</th>
              <th onclick="l5SortJaar('zomerse_dagen')" style="padding:8px 12px;text-align:right;color:#f59e0b;border-bottom:1px solid var(--rand);cursor:pointer;">Zomer&gt;25↕</th>
              <th onclick="l5SortJaar('vorst_dagen')" style="padding:8px 12px;text-align:right;color:#60a5fa;border-bottom:1px solid var(--rand);cursor:pointer;">Vorst&lt;0↕</th>
              <th onclick="l5SortJaar('rh_som')"  style="padding:8px 12px;text-align:right;color:#60a5fa;border-bottom:1px solid var(--rand);cursor:pointer;" id="l5j-th-rh">Neerslag↕</th>
              <th onclick="l5SortJaar('neerslagdagen')" style="padding:8px 12px;text-align:right;color:var(--tekst2);border-bottom:1px solid var(--rand);cursor:pointer;">Ndagen↕</th>
            </tr>
          </thead>
          <tbody id="l5-jaar-body"></tbody>
        </table>
      </div>
    </div>

    <!-- Metadata -->
    <div style="margin-top:20px;font-size:0.75em;color:var(--tekst2);padding:12px 16px;background:var(--kaart);border-radius:10px;border:1px solid var(--rand);">
      <strong style="color:var(--tekst);">L5 Gemiddelde</strong> — Dagelijks gemiddelde van de 5 officiële KNMI-hoofdstations:
      <strong style="color:var(--accent);">De Bilt · Den Helder · Eelde · Vlissingen · Maastricht</strong>.
      Minimaal 3 stations vereist per dag. TX/TN/TG in &deg;C, RH in mm.
      <span id="l5-meta-periode" style="margin-left:8px;color:var(--tekst2);"></span>
    </div>
  </div>
</div>
'''

h = h.replace('</body>', L5_HTML + '\n</body>', 1)

# ── 3. L5 JavaScript toevoegen vóór </script> (laatste) ──────────────────────
L5_JS = '''

// ════════════════════════════════════════════════════════════════════════════
// L5 GEMIDDELDE
// ════════════════════════════════════════════════════════════════════════════

let l5Data = null;
let l5Param = "TX";
let l5Periode = "dag";
let l5Richting = "hoog";
let l5JaarModus = false;
let l5JaarSort = { kolom: "jaar", asc: false };

async function wisselModus(modus) {
  const isL5 = modus === "l5";
  document.getElementById("l5-sectie").style.display = isL5 ? "block" : "none";

  // Verberg/toon stations UI
  document.querySelector(".filters").style.display = isL5 ? "none" : "flex";
  document.querySelector(".content").style.display = isL5 ? "none" : "block";

  // Knoppen stylen
  const btnS = document.getElementById("mode-btn-stations");
  const btnL = document.getElementById("mode-btn-l5");
  btnS.style.background = isL5 ? "var(--kaart)" : "var(--accent)";
  btnS.style.color = isL5 ? "var(--tekst2)" : "white";
  btnS.style.border = isL5 ? "1px solid var(--rand)" : "none";
  btnL.style.background = isL5 ? "var(--accent)" : "var(--kaart)";
  btnL.style.color = isL5 ? "white" : "var(--tekst2)";
  btnL.style.border = isL5 ? "none" : "1px solid var(--rand)";

  if (isL5) {
    if (!l5Data) await l5LaadData();
    l5Toon();
  }
}

async function l5LaadData() {
  document.getElementById("l5-laden").style.display = "block";
  document.getElementById("l5-tabel").style.display = "none";
  try {
    const r = await fetch("l5_records.json?t=" + Date.now());
    l5Data = await r.json();
    // Metadata tonen
    const meta = l5Data.meta;
    document.getElementById("l5-meta-periode").textContent =
      "TX/TN/TG: " + meta.periode_TX_start + " t/m " + meta.periode_TX_eind +
      " · RH: " + meta.periode_RH_start + " t/m " + meta.periode_RH_eind +
      " · Gegenereerd: " + meta.gegenereerd;
  } catch(e) {
    document.getElementById("l5-laden").textContent = "Fout bij laden l5_records.json: " + e.message;
    document.getElementById("l5-laden").className = "fout";
  }
}

function l5WisselParam(p) {
  l5Param = p;
  ["TX","TN","TG","RH"].forEach(function(x) {
    const el = document.getElementById("l5-ptab-" + x);
    if (el) el.classList.toggle("actief", x === p);
  });
  // Laagste niet beschikbaar voor RH bij dag
  const laagBtn = document.querySelector("#l5-richting-tabs .rtab:last-child");
  if (p === "RH" && l5Periode === "dag") {
    if (l5Richting === "laag") { l5Richting = "hoog"; document.querySelector("#l5-richting-tabs .rtab").classList.add("actief"); laagBtn.classList.remove("actief"); }
    laagBtn.style.opacity = "0.3"; laagBtn.style.pointerEvents = "none";
  } else {
    laagBtn.style.opacity = ""; laagBtn.style.pointerEvents = "";
  }
  l5Toon();
}

function l5WisselPeriode(p) {
  l5Periode = p;
  ["dag","decade","maand","seizoen","jaar"].forEach(function(x) {
    const el = document.getElementById("l5-per-" + x);
    if (el) el.classList.toggle("actief", x === p);
  });
  document.getElementById("l5-filter-seizoen").style.display = p === "seizoen" ? "flex" : "none";
  l5Toon();
}

function l5WisselRichting(r) {
  l5Richting = r;
  document.querySelectorAll("#l5-richting-tabs .rtab").forEach(function(b) {
    b.classList.toggle("actief", b.textContent.toLowerCase().includes(r === "hoog" ? "hoogste" : "laagste"));
  });
  l5Toon();
}

function l5WisselJaar() {
  l5JaarModus = true;
  document.getElementById("l5-records-sectie").style.display = "none";
  document.getElementById("l5-jaar-sectie").style.display = "block";
  document.getElementById("l5-filters").querySelector(".periode-tabs").style.display = "none";
  document.getElementById("l5-filter-seizoen").style.display = "none";
  document.getElementById("l5-btn-jaaroverzicht").style.opacity = "0.6";
  l5VulJaar();
}

function l5SluitJaar() {
  l5JaarModus = false;
  document.getElementById("l5-records-sectie").style.display = "block";
  document.getElementById("l5-jaar-sectie").style.display = "none";
  document.getElementById("l5-filters").querySelector(".periode-tabs").style.display = "flex";
  document.getElementById("l5-btn-jaaroverzicht").style.opacity = "1";
  if (l5Periode === "seizoen") document.getElementById("l5-filter-seizoen").style.display = "flex";
}

function l5Toon() {
  if (!l5Data) return;
  if (l5JaarModus) { l5VulJaar(); return; }

  const rec = l5Data.records[l5Param];
  if (!rec) return;

  // Bepaal de juiste key
  let sleutel;
  if (l5Periode === "dag")     sleutel = l5Richting === "hoog" ? "hoogste_dag"    : "laagste_dag";
  else if (l5Periode === "decade") sleutel = l5Richting === "hoog" ? "hoogste_decade" : "laagste_decade";
  else if (l5Periode === "maand")  sleutel = l5Richting === "hoog" ? "hoogste_maand"  : "laagste_maand";
  else if (l5Periode === "jaar")   sleutel = l5Richting === "hoog" ? "hoogste_jaar"   : "laagste_jaar";
  else if (l5Periode === "seizoen") {
    const s = document.getElementById("l5-sel-seizoen").value;
    sleutel = l5Richting === "hoog" ? ("hoogste_" + s) : ("laagste_" + s);
  }

  const rijen = rec[sleutel] || [];

  // Titel updaten
  const paramLabels = { TX: "Max temp TX", TN: "Min temp TN", TG: "Gem temp TG", RH: "Neerslag RH" };
  const periodeLabels = { dag: "Dag", decade: "Decade", maand: "Maand", seizoen: "Seizoen", jaar: "Jaar" };
  const seizoenLabel = l5Periode === "seizoen"
    ? " – " + document.querySelector("#l5-sel-seizoen option:checked").text
    : "";
  document.getElementById("l5-titel").textContent =
    (l5Richting === "hoog" ? "Hoogste" : "Laagste") + " " + paramLabels[l5Param] +
    " · " + periodeLabels[l5Periode] + seizoenLabel + " · L5 gemiddelde";

  const eenheid = l5Data.meta.param_eenheid[l5Param];
  document.getElementById("l5-th-waarde").textContent = paramLabels[l5Param] + " (" + eenheid + ")";

  // Periodes
  const meta = l5Data.meta;
  const periodeStr = l5Param === "RH"
    ? meta.periode_RH_start + " – " + meta.periode_RH_eind
    : meta.periode_TX_start + " – " + meta.periode_TX_eind;
  document.getElementById("l5-periode-lbl").textContent = periodeStr;

  // Tabel vullen
  const tbody = document.getElementById("l5-body");
  tbody.innerHTML = "";
  if (rijen.length === 0) {
    document.getElementById("l5-laden").style.display = "block";
    document.getElementById("l5-laden").className = "laden";
    document.getElementById("l5-laden").textContent = "Geen data beschikbaar voor deze combinatie.";
    document.getElementById("l5-tabel").style.display = "none";
    return;
  }

  document.getElementById("l5-laden").style.display = "none";
  document.getElementById("l5-tabel").style.display = "table";

  rijen.forEach(function(r, i) {
    const tr = document.createElement("tr");
    // Medaille kleuren voor top 3
    const kleuren = ["#ffd700","#c0c0c0","#cd7f32"];
    const rankStijl = i < 3 ? ("color:" + kleuren[i] + ";font-weight:700;") : "color:var(--tekst2);";
    tr.innerHTML =
      "<td style='" + rankStijl + "'>" + (i + 1) + "</td>" +
      "<td style='color:var(--tekst);'>" + r.label + "</td>" +
      "<td style='text-align:right;font-weight:600;" + (l5Richting === "hoog" ? "color:#ef4444;" : "color:#60a5fa;") + "'>" +
        r.waarde + " " + eenheid + "</td>";
    tbody.appendChild(tr);
  });
}

function l5VulJaar() {
  if (!l5Data || !l5Data.jaaroverzicht) return;
  const data = l5Data.jaaroverzicht.slice();
  const k = l5JaarSort.kolom;
  data.sort(function(a, b) {
    const va = a[k] != null ? a[k] : -9999;
    const vb = b[k] != null ? b[k] : -9999;
    return l5JaarSort.asc ? va - vb : vb - va;
  });

  const tbody = document.getElementById("l5-jaar-body");
  tbody.innerHTML = "";
  data.forEach(function(r) {
    const tr = document.createElement("tr");
    tr.style.borderBottom = "1px solid var(--rand)";
    function cel(v, kleur, extra) {
      return "<td style='padding:6px 12px;text-align:right;color:" + (kleur||"var(--tekst)") + ";" + (extra||"") + "'>" + (v != null ? v : "–") + "</td>";
    }
    tr.innerHTML =
      "<td style='padding:6px 12px;text-align:left;font-weight:600;color:var(--tekst);'>" + r.jaar + "</td>" +
      cel(r.tg_gem != null ? r.tg_gem + " °C" : null, "#f59e0b") +
      cel(r.tx_gem != null ? r.tx_gem + " °C" : null, "#ef4444") +
      cel(r.tn_gem != null ? r.tn_gem + " °C" : null, "#60a5fa") +
      cel(r.warme_dagen, r.warme_dagen > 100 ? "#ef4444" : "var(--tekst)") +
      cel(r.zomerse_dagen, r.zomerse_dagen > 60 ? "#f59e0b" : "var(--tekst)") +
      cel(r.vorst_dagen, r.vorst_dagen > 60 ? "#60a5fa" : "var(--tekst)") +
      cel(r.rh_som != null ? r.rh_som + " mm" : null, r.rh_som > 1000 ? "#60a5fa" : "var(--tekst)") +
      cel(r.neerslagdagen);
    tbody.appendChild(tr);
  });
}

function l5SortJaar(kolom) {
  if (l5JaarSort.kolom === kolom) l5JaarSort.asc = !l5JaarSort.asc;
  else { l5JaarSort.kolom = kolom; l5JaarSort.asc = false; }
  l5VulJaar();
}
'''

# Voeg L5 JS toe vóór de laatste </script>
laatste_script = h.rfind('</script>')
if laatste_script != -1:
    h = h[:laatste_script] + L5_JS + '\n</script>' + h[laatste_script+9:]

# Schrijf terug
with open(HTML_PAD, "w", encoding="utf-8") as f:
    f.write(h)

print("ok:", HTML_PAD)
print("Grootte:", len(h), "chars")
print("L5 sectie aanwezig:", "l5-sectie" in h)
print("wisselModus aanwezig:", "wisselModus" in h)
