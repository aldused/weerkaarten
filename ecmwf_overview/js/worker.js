// Laad-worker: fetch (HTTP-cache), PNG (8-bit grijs) decoderen met de native
// DecompressionStream en isobaren delta-decoderen — allemaal buiten de
// hoofdthread. Eigen PNG-decoder i.p.v. createImageBitmap: zo krijgen we de
// codes exact terug, zonder kleurbeheer of premultiply (ook in Safari).

const ctrls = new Map();

self.onmessage = async (e) => {
  const m = e.data;
  if (m.type === 'abort') { ctrls.get(m.id)?.abort(); return; }
  if (m.type === 'decode') {           // L2-hit: bytes al in geheugen
    try { post(m.id, m.kind, await decode(m.kind, m.buf), null); } catch (err) { fail(m.id, err); }
    return;
  }
  const ac = new AbortController();
  ctrls.set(m.id, ac);
  const t0 = performance.now();
  try {
    const r = await fetch(m.url, { signal: ac.signal, cache: 'default', mode: 'cors', credentials: 'omit' });
    if (!r.ok) throw Object.assign(new Error('HTTP ' + r.status), { status: r.status });
    const buf = await r.arrayBuffer();
    const tNet = performance.now() - t0;
    const out = await decode(m.kind, buf);
    const rt = performance.getEntriesByName(r.url).pop();
    post(m.id, m.kind, out, buf, tNet, performance.now() - t0, rt ? rt.transferSize : -1);
  } catch (err) {
    fail(m.id, err);
  } finally {
    ctrls.delete(m.id);
  }
};

function fail(id, err) {
  self.postMessage({ id, error: err.name === 'AbortError' ? 'abort' : String(err.message || err), status: err.status || 0 });
}

function post(id, kind, out, raw, tNet = 0, tAll = 0, xfer = -1) {
  const transfer = [];
  if (kind === 'png') transfer.push(out.data.buffer);
  else out.lines.forEach((l) => transfer.push(l.pts.buffer));
  if (raw) transfer.push(raw);
  self.postMessage({ id, out, raw, tNet, tAll, xfer }, transfer);
}

async function decode(kind, buf) {
  if (kind === 'png') return decodePng(buf);
  return decodeIso(JSON.parse(new TextDecoder().decode(buf)));
}

function decodeIso(j) {
  const lines = j.lines.map((l) => {
    const d = l.d, n = d.length / 2, pts = new Float32Array(d.length);
    let x = 0, y = 0, x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (let i = 0; i < n; i++) {
      x += d[2 * i]; y += d[2 * i + 1];
      const X = x / 10, Y = y / 10;
      pts[2 * i] = X; pts[2 * i + 1] = Y;
      if (X < x0) x0 = X; if (X > x1) x1 = X; if (Y < y0) y0 = Y; if (Y > y1) y1 = Y;
    }
    return { p: l.p, pts, b: [x0, y0, x1, y1] };
  });
  return { lines, hl: j.hl };
}

async function inflate(u8) {
  const ds = new DecompressionStream('deflate');
  const stream = new Blob([u8]).stream().pipeThrough(ds);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function decodePng(buf) {
  const b = new Uint8Array(buf), dv = new DataView(buf);
  let p = 8, w = 0, h = 0, depth = 0, ctype = 0;
  const idat = [];
  let total = 0;
  while (p < b.length) {
    const len = dv.getUint32(p), type = String.fromCharCode(b[p + 4], b[p + 5], b[p + 6], b[p + 7]);
    if (type === 'IHDR') {
      w = dv.getUint32(p + 8); h = dv.getUint32(p + 12); depth = b[p + 16]; ctype = b[p + 17];
      if (b[p + 20] !== 0) throw new Error('interlaced PNG niet ondersteund');
    } else if (type === 'IDAT') { idat.push(b.subarray(p + 8, p + 8 + len)); total += len; }
    else if (type === 'IEND') break;
    p += 12 + len;
  }
  if (depth !== 8 || ctype !== 0) throw new Error(`PNG-type ${ctype}/${depth} niet ondersteund`);
  const z = new Uint8Array(total);
  let o = 0; for (const c of idat) { z.set(c, o); o += c.length; }
  const raw = await inflate(z);
  const out = new Uint8Array(w * h);
  let prev = new Uint8Array(w);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (w + 1)], src = raw.subarray(y * (w + 1) + 1, (y + 1) * (w + 1));
    const row = out.subarray(y * w, (y + 1) * w);
    switch (f) {
      case 0: row.set(src); break;
      case 1: for (let x = 0; x < w; x++) row[x] = (src[x] + (x ? row[x - 1] : 0)) & 255; break;
      case 2: for (let x = 0; x < w; x++) row[x] = (src[x] + prev[x]) & 255; break;
      case 3: for (let x = 0; x < w; x++) row[x] = (src[x] + (((x ? row[x - 1] : 0) + prev[x]) >> 1)) & 255; break;
      case 4: for (let x = 0; x < w; x++) {
        const a = x ? row[x - 1] : 0, bb = prev[x], c = x ? prev[x - 1] : 0;
        const pp = a + bb - c, pa = Math.abs(pp - a), pb = Math.abs(pp - bb), pc = Math.abs(pp - c);
        row[x] = (src[x] + (pa <= pb && pa <= pc ? a : pb <= pc ? bb : c)) & 255;
      } break;
      default: throw new Error('PNG-filter ' + f);
    }
    prev = row;
  }
  return { w, h, data: out };
}
