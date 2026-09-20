// One URL per byte range avoids HTTP-cache locks that serialize simultaneous
// Range requests for one large file. The application cache still keys native
// blocks by immutable run/file identity, independently of this wire URL.
export const EDGE_ORIGIN='https://weerlab-ecmwf-cache.dawn-term-a69f.workers.dev';
export function rangeRequestURL(url,start,end){
  return url.startsWith(EDGE_ORIGIN+'/')?`${url}?range=${start}-${end-1}`:url;
}
