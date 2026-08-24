// Compatibiliteitslader. De inhoudelijke selector staat op een uniek,
// content-addressed pad zodat CDN-caches nooit een oudere versie kunnen geven.
(function () {
  'use strict';
  const src = 'pluim_run_switcher_48ffbf926db6.js';
  const sourceScript = document.currentScript;
  const forwarded = ['data-required', 'data-editor-mode-aware']
    .map(name => [name, sourceScript?.getAttribute?.(name)])
    .filter(([, value]) => value != null);
  const escaped = value => String(value)
    .replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  if (document.readyState === 'loading') {
    const attributes = forwarded
      .map(([name, value]) => ` ${name}="${escaped(value)}"`).join('');
    document.write(`<script src="${src}"${attributes}><\/script>`);
    return;
  }
  const script = document.createElement('script');
  script.src = src;
  forwarded.forEach(([name, value]) => script.setAttribute(name, value));
  document.head.appendChild(script);
})();
