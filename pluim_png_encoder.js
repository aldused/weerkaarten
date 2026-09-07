/**
 * pluim_png_encoder.js
 *
 * Gedeelde PNG-encoder voor de kleurpluimen en de Weerbewaking-pluimexport.
 *
 * Waarom: canvas.toBlob() comprimeert een PNG op de hoofdthread. Voor een
 * kleurpluim van 2800x1960 px kost dat ~1,2-1,6 s per plaatje, en tijdens die
 * tijd staat de pagina stil. Acht pluimen achter elkaar duurden daardoor ruim
 * tien seconden, vrijwel volledig in de compressie (de ensembledata zelf is
 * maar enkele tientallen kilobytes).
 *
 * Oplossing: teken op een OffscreenCanvas, geef de pixels met
 * transferToImageBitmap() zonder kopie door aan een pool van web workers en
 * comprimeer daar parallel met convertToBlob(). Gemeten op een 10-core Mac:
 * acht pluimen van 12,5 s naar 1,25 s, met byte-identieke PNG's.
 *
 * Publieke API:
 *   WeerlabPngEncoder.supported            -> bool
 *   WeerlabPngEncoder.createCanvas(w, h)   -> OffscreenCanvas of <canvas>
 *   WeerlabPngEncoder.toBlob(canvas, type, quality) -> Promise<Blob>
 *   WeerlabPngEncoder.warmUp()             -> workers alvast starten
 *   WeerlabPngEncoder.dispose()            -> workers opruimen
 *
 * Zonder OffscreenCanvas-ondersteuning valt alles terug op canvas.toBlob().
 */
(function () {
  'use strict';

  const WORKER_SRC = `
self.onmessage = async (e) => {
  const { id, bitmap, type, quality } = e.data;
  try {
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    canvas.getContext('2d').drawImage(bitmap, 0, 0);
    bitmap.close();
    const blob = await canvas.convertToBlob(quality == null ? { type } : { type, quality });
    self.postMessage({ id, blob });
  } catch (err) {
    try { bitmap.close(); } catch (_) {}
    self.postMessage({ id, error: String((err && err.message) || err) });
  }
};`;

  const supported = (() => {
    try {
      if (typeof OffscreenCanvas !== 'function' || typeof Worker !== 'function') return false;
      const probe = new OffscreenCanvas(1, 1);
      return typeof probe.convertToBlob === 'function'
        && typeof probe.transferToImageBitmap === 'function'
        && !!probe.getContext('2d');
    } catch (_) {
      return false;
    }
  })();

  // Eén worker minder dan het aantal cores, zodat de hoofdthread de volgende
  // pluim kan blijven tekenen terwijl er wordt gecomprimeerd.
  const POOL_SIZE = Math.max(1, Math.min(4, (navigator.hardwareConcurrency || 4) - 1));

  let workerUrl = null;
  const pool = [];      // { worker, busy }
  const wachtrij = [];  // { canvas, type, quality, resolve, reject }
  let volgendeId = 1;

  function maakWorkerUrl() {
    if (!workerUrl) workerUrl = URL.createObjectURL(new Blob([WORKER_SRC], { type: 'text/javascript' }));
    return workerUrl;
  }

  function maakWorker() {
    const worker = new Worker(maakWorkerUrl());
    const slot = { worker, busy: false, taak: null };
    worker.onmessage = (e) => {
      const taak = slot.taak;
      slot.taak = null;
      slot.busy = false;
      if (taak) {
        if (e.data && e.data.error) taak.reject(new Error(e.data.error));
        else if (e.data && e.data.blob) taak.resolve(e.data.blob);
        else taak.reject(new Error('PNG-encoder gaf geen resultaat'));
      }
      pompWachtrij();
    };
    worker.onerror = (e) => {
      const taak = slot.taak;
      slot.taak = null;
      slot.busy = false;
      if (taak) taak.reject(new Error('PNG-encoder crashte: ' + (e.message || 'onbekende fout')));
      pompWachtrij();
    };
    pool.push(slot);
    return slot;
  }

  function vrijeWorker() {
    const bestaand = pool.find(slot => !slot.busy);
    if (bestaand) return bestaand;
    if (pool.length < POOL_SIZE) return maakWorker();
    return null;
  }

  function pompWachtrij() {
    while (wachtrij.length) {
      const slot = vrijeWorker();
      if (!slot) return;
      const taak = wachtrij.shift();
      let bitmap;
      try {
        bitmap = taak.canvas.transferToImageBitmap();
      } catch (err) {
        // Pixels konden niet worden overgedragen: val terug op de hoofdthread.
        taak.resolve(hoofdthreadBlob(taak.canvas, taak.type, taak.quality));
        continue;
      }
      slot.busy = true;
      slot.taak = taak;
      slot.worker.postMessage({ id: volgendeId++, bitmap, type: taak.type, quality: taak.quality }, [bitmap]);
    }
  }

  function hoofdthreadBlob(canvas, type, quality) {
    if (typeof canvas.convertToBlob === 'function') {
      return canvas.convertToBlob(quality == null ? { type } : { type, quality });
    }
    return new Promise((resolve, reject) => {
      canvas.toBlob(blob => (blob ? resolve(blob) : reject(new Error('PNG maken mislukt'))), type, quality);
    });
  }

  function createCanvas(width, height) {
    if (supported) return new OffscreenCanvas(Math.max(1, width), Math.max(1, height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, width);
    canvas.height = Math.max(1, height);
    return canvas;
  }

  function toBlob(canvas, type = 'image/png', quality) {
    if (!canvas) return Promise.reject(new Error('Geen canvas om te comprimeren'));
    if (!supported || typeof canvas.transferToImageBitmap !== 'function') {
      return hoofdthreadBlob(canvas, type, quality);
    }
    return new Promise((resolve, reject) => {
      wachtrij.push({ canvas, type, quality, resolve, reject });
      pompWachtrij();
    });
  }

  function warmUp() {
    if (!supported) return;
    while (pool.length < POOL_SIZE) maakWorker();
  }

  function dispose() {
    pool.splice(0).forEach(slot => { try { slot.worker.terminate(); } catch (_) {} });
    if (workerUrl) { URL.revokeObjectURL(workerUrl); workerUrl = null; }
  }

  window.WeerlabPngEncoder = { supported, poolSize: POOL_SIZE, createCanvas, toBlob, warmUp, dispose };
})();
