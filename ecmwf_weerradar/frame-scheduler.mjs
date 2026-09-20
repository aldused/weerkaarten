// Animation frames stop in a hidden or fully occluded tab. Tile commits and
// main-thread renders must still finish there: a map opened in a background
// tab otherwise waits for its load timeout and reports a false error.
// Visible pages keep using requestAnimationFrame, so painting stays aligned
// with the compositor; a watchdog covers occluded windows that never repaint.
const WATCHDOG_MS = 120;

export function createFrameScheduler({
  raf = globalThis.requestAnimationFrame?.bind(globalThis),
  caf = globalThis.cancelAnimationFrame?.bind(globalThis),
  hidden = () => globalThis.document?.visibilityState === 'hidden',
  timer = (fn, ms) => setTimeout(fn, ms),
  clear = id => clearTimeout(id),
  watchdogMs = WATCHDOG_MS,
} = {}) {
  // A port message is not throttled in a background tab and keeps the queue
  // draining at full speed; setTimeout is only the fallback without one.
  // The channel is created on first use, so a visible page never holds one.
  const waiting = [];
  let channel;
  const openChannel = () => {
    if (channel !== undefined) return channel;
    channel = typeof MessageChannel === 'function' ? new MessageChannel() : null;
    if (channel) {
      channel.port1.onmessage = () => waiting.shift()?.();
      // Node keeps its event loop alive for a started port; tests must end.
      channel.port1.unref?.(); channel.port2.unref?.();
    }
    return channel;
  };
  const immediate = run => {
    const port = openChannel();
    if (!port) return { timer: timer(run, 0) };
    waiting.push(run); port.port2.postMessage(0); return { port: run };
  };
  const schedule = fn => {
    let done = false;
    const handle = {};
    const run = () => { if (done) return; done = true; cancel(handle); fn(); };
    handle.finish = () => { done = true; };
    if (hidden() || !raf) return Object.assign(handle, immediate(run));
    return Object.assign(handle, { frame: raf(run), timer: timer(run, watchdogMs) });
  };
  const cancel = handle => {
    if (!handle) return;
    handle.finish?.();
    if (handle.frame !== undefined && caf) caf(handle.frame);
    if (handle.timer !== undefined) clear(handle.timer);
    if (handle.port) { const i = waiting.indexOf(handle.port); if (i >= 0) waiting.splice(i, 1); }
  };
  return { schedule, cancel };
}

export const frameScheduler = createFrameScheduler();

/** A deadline that only counts the time the page is actually visible.
 * A tab in the background receives almost no processor time; counting that
 * towards the load timeout turns a slow background tab into a false error
 * message, while its map would have been complete on return.
 */
export function visibleTimeout(ms, onTimeout, {
  hidden = () => globalThis.document?.visibilityState === 'hidden',
  timer = (fn, wait) => setTimeout(fn, wait),
  clear = id => clearTimeout(id),
  now = () => Date.now(),
  step = 2000,
} = {}) {
  let spent = 0, last = now(), handle;
  const tick = () => {
    const current = now();
    if (!hidden()) spent += current - last;
    last = current;
    if (spent >= ms) { onTimeout(); return; }
    handle = timer(tick, Math.min(step, ms - spent));
  };
  handle = timer(tick, Math.min(step, ms));
  return () => clear(handle);
}
