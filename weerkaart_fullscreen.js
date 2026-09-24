/* Gedeelde beeldvullend-bediening voor weerkaartpagina's.
 *
 * Ingesloten (shell → product-host → kaartpagina) vraagt de pagina de
 * buitenste shell om echte browser-fullscreen; die verbergt zijn kopbalk en
 * meldt de toestand terug. Los geopend vraagt de pagina zelf fullscreen aan.
 *
 * Gebruik: elke knop met [data-wl-fullscreen] wordt bediend. Optioneel bevat
 * de knop .wl-fs-icon en .wl-fs-label; die krijgen "⛶"/"✕" en
 * "Beeldvullend"/"Sluiten". Op <html> staat klasse .wl-fullscreen zolang het
 * aan staat; window krijgt daarbij het event 'wl-fullscreen-change'.
 */
(function () {
  if (window.WeerlabFullscreen) return;
  var origin = location.protocol === 'file:' ? '*' : location.origin;
  var embedded = window.parent !== window;
  var active = false;

  function labels() {
    document.querySelectorAll('[data-wl-fullscreen]').forEach(function (btn) {
      btn.setAttribute('aria-pressed', String(active));
      btn.setAttribute('aria-label', active ? 'Beeldvullend sluiten' : 'Kaart beeldvullend tonen');
      btn.title = active ? 'Beeldvullend sluiten (Esc)' : 'Kaart beeldvullend tonen';
      var icon = btn.querySelector('.wl-fs-icon');
      var text = btn.querySelector('.wl-fs-label');
      if (icon) icon.textContent = active ? '✕' : '⛶';
      if (text) text.textContent = active ? 'Sluiten' : 'Beeldvullend';
      btn.classList.toggle('actief', active);
    });
  }

  function setActive(next) {
    next = Boolean(next);
    if (next === active) { labels(); return; }
    active = next;
    document.documentElement.classList.toggle('wl-fullscreen', active);
    labels();
    window.dispatchEvent(new Event('wl-fullscreen-change'));
  }

  function toggle() {
    if (embedded) {
      parent.postMessage({ type: 'weerlab-fullscreen-toggle' }, origin);
      return;
    }
    var el = document.documentElement;
    if (document.fullscreenElement) {
      document.exitFullscreen();
    } else if (el.requestFullscreen) {
      el.requestFullscreen({ navigationUI: 'hide' }).catch(function () {});
    } else if (el.webkitRequestFullscreen) {
      el.webkitRequestFullscreen();
    }
  }

  // Ingesloten: toestand komt van de shell.
  window.addEventListener('message', function (event) {
    if (event.source !== parent || (event.origin !== location.origin && origin !== '*')) return;
    var data = event.data;
    if (!data || data.type !== 'weerlab-fullscreen-state') return;
    setActive(data.active);
    // Meld dat deze pagina een eigen sluitknop heeft; de shell verbergt dan de zijne.
    parent.postMessage({ type: 'weerlab-fullscreen-ui', own: true }, origin);
  });
  // Los geopend: toestand van de browser zelf.
  document.addEventListener('fullscreenchange', function () {
    if (!embedded) setActive(Boolean(document.fullscreenElement));
  });

  document.addEventListener('click', function (event) {
    var btn = event.target.closest && event.target.closest('[data-wl-fullscreen]');
    if (!btn) return;
    event.preventDefault();
    toggle();
  });
  document.addEventListener('DOMContentLoaded', labels);

  // Pagina geladen terwijl de shell al beeldvullend staat (bijv. route wissel).
  if (embedded) parent.postMessage({ type: 'weerlab-fullscreen-query' }, origin);

  window.WeerlabFullscreen = { toggle: toggle, isActive: function () { return active; } };
})();
