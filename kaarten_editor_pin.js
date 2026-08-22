(() => {
  'use strict';
  const script = document.currentScript;
  const PIN_HASH = script?.dataset.pinHash || 'b85bf0f7330be07933314afcfc04aa8e8bb33827eb03bdf2f65ff26fd32444f5';
  const SESSION_KEY = script?.dataset.sessionKey || 'landelijke_weerkaart_pin_ok';
  const start = () => {
    const gate = document.getElementById('pin-gate');
    const root = document.getElementById('root');
    const form = document.getElementById('pin-form');
    const input = document.getElementById('pin-input');
    const error = document.getElementById('pin-error');
    const unlock = () => {
      gate.style.display = 'none';
      root.style.display = 'block';
    };
    try {
      if (sessionStorage.getItem(SESSION_KEY) === '1') unlock();
    } catch (_) {}
    form.addEventListener('submit', async event => {
      event.preventDefault();
      const value = input.value.trim();
      if (!/^\d{4}$/.test(value)) {
        error.textContent = 'Vul vier cijfers in.';
        input.focus();
        return;
      }
      const bytes = new TextEncoder().encode(value);
      const digest = await crypto.subtle.digest('SHA-256', bytes);
      const hash = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
      if (hash === PIN_HASH) {
        try { sessionStorage.setItem(SESSION_KEY, '1'); } catch (_) {}
        error.textContent = '';
        unlock();
      } else {
        error.textContent = 'Onjuiste pincode.';
        input.value = '';
        input.focus();
      }
    });
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();
