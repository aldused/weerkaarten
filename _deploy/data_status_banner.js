/* data_status_banner.js
 * Toont noodbanner bovenaan de pagina als (a) data-pipelines te oud zijn,
 * of (b) er een handmatige override actief is in nood_override.json.
 *
 * Inclusie:
 *   <script src="data_status_banner.js" defer></script>
 *
 * Configuratie via window.WEERLAB_BANNER_CONFIG (optioneel) voor het laden
 * van het script:
 *   window.WEERLAB_BANNER_CONFIG = {
 *     pipelines: { dagdata: 26*3600, mtg-benelux: 30*60 },  // max-leeftijd in s
 *     defaultMaxAge: 6*3600,
 *     heartbeatUrl: 'https://data.weerlab.nl/heartbeat.json',
 *     overrideUrl:  'nood_override.json'
 *   };
 */
(function () {
  var cfg = Object.assign({
    heartbeatUrl: 'https://data.weerlab.nl/heartbeat.json',
    overrideUrl:  'nood_override.json',
    defaultMaxAge: 6 * 3600,
    pipelines: {
      dagdata:         26 * 3600,
      maanddata:       40 * 24 * 3600,
      'mtg-benelux':   45 * 60,
      satelliet:       45 * 60,
      synopkaart:      90 * 60,
      waarschuwingen:  60 * 60,
      bliksem:         15 * 60,
      verificatie:     26 * 3600,
      'europa-obs':    90 * 60,
      pascal:          26 * 3600,
      tekort:          26 * 3600,
      weerrecords:     26 * 3600,
      'mosmix-json':   90 * 60,
      'post-x-temp':   60 * 60,
      'macbook-pull':  3 * 3600
    }
  }, window.WEERLAB_BANNER_CONFIG || {});

  function el(tag, attrs, children) {
    var n = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      if (k === 'style') Object.assign(n.style, attrs[k]);
      else n.setAttribute(k, attrs[k]);
    });
    (children || []).forEach(function (c) {
      n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    });
    return n;
  }

  function show(level, message) {
    if (document.getElementById('weerlab-nood-banner')) return;
    var colors = {
      info:  { bg: '#1d4ed8', fg: '#fff' },
      warn:  { bg: '#d97706', fg: '#fff' },
      error: { bg: '#b91c1c', fg: '#fff' }
    };
    var c = colors[level] || colors.warn;
    var bar = el('div', {
      id: 'weerlab-nood-banner',
      role: 'status',
      style: {
        position: 'sticky',
        top: '0',
        zIndex: '9999',
        background: c.bg,
        color: c.fg,
        padding: '8px 14px',
        font: '500 13px/1.4 "DM Sans", system-ui, sans-serif',
        textAlign: 'center',
        boxShadow: '0 2px 6px rgba(0,0,0,0.18)'
      }
    }, [message]);
    document.body.insertBefore(bar, document.body.firstChild);
  }

  function ageSeconds(iso) {
    var t = Date.parse(iso);
    if (isNaN(t)) return Infinity;
    return (Date.now() - t) / 1000;
  }

  function bust(url) {
    return url + (url.indexOf('?') >= 0 ? '&' : '?') + 't=' + Date.now();
  }

  Promise.all([
    fetch(bust(cfg.overrideUrl)).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; }),
    fetch(bust(cfg.heartbeatUrl)).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; })
  ]).then(function (res) {
    var override = res[0], hb = res[1];

    if (override && override.active) {
      var lvl = override.level || 'warn';
      var msg = override.message || 'Storing — handmatige melding actief.';
      show(lvl, msg);
      return;
    }

    if (!hb || !hb.pipelines) return;

    var stale = [];
    Object.keys(cfg.pipelines).forEach(function (name) {
      var entry = hb.pipelines[name];
      var max = cfg.pipelines[name] || cfg.defaultMaxAge;
      if (!entry || !entry.ts) {
        stale.push(name + ' (geen heartbeat)');
        return;
      }
      var age = ageSeconds(entry.ts);
      if (age > max) {
        var hrs = Math.round(age / 3600);
        stale.push(name + ' (' + (hrs >= 1 ? hrs + 'u' : Math.round(age / 60) + 'min') + ' oud)');
      }
    });

    if (stale.length) {
      show('warn', '⚠️ Data-storing: pipelines verouderd — ' + stale.join(', ') + '. Site werkt verder normaal.');
    }
  });
})();
