import {parse} from 'acorn';
import {catalog as bundledCatalog} from './catalog.mjs';

export const SOURCE = 'https://raw.githubusercontent.com/aldused/weerkaarten/main/menu-data.js';
const MAX_BYTES = 524288;

function literal(node) {
  if (node?.type === 'Literal' && !node.regex && (node.value === null || ['string', 'number', 'boolean'].includes(typeof node.value))) return node.value;
  if (node?.type === 'ArrayExpression') return node.elements.map(literal);
  if (node?.type === 'ObjectExpression') {
    const out = Object.create(null);
    for (const property of node.properties) {
      if (property.type !== 'Property' || property.computed || property.method || property.kind !== 'init') throw Error('Nonliteral catalog property');
      const key = property.key.type === 'Identifier' ? property.key.name : literal(property.key);
      if (typeof key !== 'string' || ['__proto__', 'constructor', 'prototype'].includes(key) || Object.hasOwn(out, key)) throw Error('Invalid catalog key');
      out[key] = literal(property.value);
    }
    return out;
  }
  throw Error('Executable expressions are not allowed in the catalog');
}

export function parseCatalog(source) {
  if (new TextEncoder().encode(source).byteLength > MAX_BYTES) throw Error('Catalog too large');
  const ast = parse(source, {ecmaVersion: 'latest', sourceType: 'script'});
  const declarations = ast.body.filter(n => n.type === 'VariableDeclaration').flatMap(n => n.declarations).filter(n => n.id.type === 'Identifier' && n.id.name === 'MENU_PRODUCTS');
  if (declarations.length !== 1) throw Error('Missing unique product registry');
  const products = literal(declarations[0].init);
  if (!Array.isArray(products) || !products.length || products.length > 1000) throw Error('Invalid registry size');
  const ids = new Set();
  return products.map(p => {
    if (!p || !/^[a-z0-9_-]{1,150}$/i.test(p.id) || ids.has(p.id) || !/^index\.html#[a-z0-9_-]+$/i.test(p.href)) throw Error('Invalid product route or ID');
    ids.add(p.id);
    for (const field of ['name', 'description', 'section', 'category']) if (typeof p[field] !== 'string' || p[field].length > 4000) throw Error('Invalid product metadata');
    return {id:p.id, name:p.name, description:p.description, section:p.section, category:p.category, href:p.href, requiresProductGate:!!p.restricted, available:true};
  });
}

export function catalogProvider({fallback = bundledCatalog, fetcher = fetch, now = Date.now} = {}) {
  let current = fallback, checked = -Infinity, pending;
  return async function get({refresh = false} = {}) {
    if (pending) return pending;
    if (!refresh && now() - checked < 60000) return current;
    pending = (async () => {
      try {
        // The source is fixed server-side. No browser-provided registry or URL.
        const response = await fetcher(SOURCE + '?v=' + Math.floor(now()/60000), {signal:AbortSignal.timeout(5000), headers:{'User-Agent':'Weerlab-Personal-Catalog/1.0'}});
        if (!response.ok) throw Error('Catalog unavailable');
        if (Number(response.headers.get('Content-Length')) > MAX_BYTES) throw Error('Catalog too large');
        const reader = response.body.getReader(), chunks = []; let size = 0;
        while (true) {
          const {value, done} = await reader.read(); if (done) break;
          size += value.byteLength;
          if (size > MAX_BYTES) {await reader.cancel(); throw Error('Catalog too large');}
          chunks.push(value);
        }
        const buffer = new Uint8Array(size); let offset = 0;
        for (const chunk of chunks) {buffer.set(chunk, offset); offset += chunk.length;}
        current = parseCatalog(new TextDecoder().decode(buffer));
      } catch {
        // Keep the last verified registry, including the bundled cold-start copy.
      } finally {checked = now(); pending = null;}
      return current;
    })();
    return pending;
  };
}

const live = catalogProvider();
export const getCatalog = (env, options) => env?.CATALOG_SOURCE === SOURCE ? live(options) : Promise.resolve(bundledCatalog);
