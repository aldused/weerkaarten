// Share in-flight work until the last consumer leaves. A subsequent foreground
// request can join a preload without forcing a second download or decode.
export function createFrameCache(maxBytes, maxEntries, sizeOf, read) {
  const ready = new Map();
  const pending = new Map();
  let bytes = 0;

  function load(key, input, signal, priority = 'auto') {
    if (signal?.aborted) return Promise.reject(signal.reason);
    if (ready.has(key)) {
      const entry = ready.get(key);
      ready.delete(key);
      ready.set(key, entry);
      return Promise.resolve(entry.value);
    }

    let entry = pending.get(key);
    if (!entry) {
      const controller = new AbortController();
      entry = {controller, consumers: 0, priority};
      pending.set(key, entry);
      entry.promise = Promise.resolve().then(() => {
        controller.signal.throwIfAborted();
        return read(input, controller.signal, entry.priority);
      }).then(value => {
        controller.signal.throwIfAborted();
        const size = sizeOf(value);
        if (size <= maxBytes) {
          ready.set(key, {value, size});
          bytes += size;
          while (bytes > maxBytes || ready.size > maxEntries) {
            const oldest = ready.keys().next().value;
            bytes -= ready.get(oldest).size;
            ready.delete(oldest);
          }
        }
        return value;
      }).finally(() => {
        if (pending.get(key) === entry) pending.delete(key);
      });
    } else if (priority === 'high') entry.priority = priority;

    entry.consumers++;
    return new Promise((resolve, reject) => {
      function release() {
        signal?.removeEventListener('abort', abort);
        if (--entry.consumers === 0 && pending.get(key) === entry) {
          pending.delete(key);
          entry.controller.abort();
        }
      }
      function abort() {
        release();
        reject(signal.reason);
      }
      signal?.addEventListener('abort', abort, {once: true});
      entry.promise.then(value => {
        if (signal?.aborted) return;
        release();
        resolve(value);
      }, error => {
        if (signal?.aborted) return;
        release();
        reject(error);
      });
    });
  }
  load.has = key => ready.has(key);
  return load;
}

export function preloadPolicy(connection, memory, smallScreen) {
  const slow = connection?.saveData || ['slow-2g','2g','3g'].includes(connection?.effectiveType) ||
    (connection?.downlink > 0 && connection.downlink < 1.5);
  const limited = smallScreen || (memory > 0 && memory <= 4);
  if (slow) return {ahead: 0, behind: 0, delay: 0, limited: true};
  return limited ? {ahead: 2, behind: 1, delay: 115, limited} :
    {ahead: 6, behind: 3, delay: 65, limited};
}

export function preloadTimes(times, index, direction, {ahead, behind}, loop) {
  const candidates = new Set();
  const add = offset => {
    let step = index + offset;
    if (loop) step = ((step % times.length) + times.length) % times.length;
    if (step !== index && times[step] !== undefined) candidates.add(times[step]);
  };
  const forward = direction < 0 ? behind : ahead;
  const backward = direction < 0 ? ahead : behind;
  for (let i = 1; i <= forward; i++) add(i * direction);
  for (let i = 1; i <= backward; i++) add(-i * direction);
  return [...candidates];
}
