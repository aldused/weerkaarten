/* A separately committed immutable prefix never replaces the complete archive. */
export function validProgress(manifest) {
  return manifest?.ready === true && manifest.progressive === true
    && manifest.station_count === 39 && manifest.member_count === 51
    && /^\d{4}-\d{2}-\d{2}T(00|06|12|18):00:00Z$/.test(manifest.run || '')
    && /^[a-f0-9]{64}$/.test(manifest.revision || '')
    && manifest.path === `pluim-progressive/${manifest.run.slice(0,13).replaceAll('-','').replaceAll(':','')}/${manifest.revision}`
    && Number.isInteger(manifest.available_through_hour) && manifest.available_through_hour >= 12
    && manifest.available_through_hour <= manifest.expected_through_hour
    && Array.isArray(manifest.fields) && Object.keys(manifest.station_digests || {}).length === 39;
}
export function progressEntry(m) {
  return {...m, fields:m.fields, complete:false, progressive:true, data_sha256:m.revision};
}
export function verifyProgress(document, m, slug) {
  const d=document?.runs?.find(r=>r.run===m.run);
  const n=m.available_through_hour+1;
  if (!validProgress(m) || !d || d.data_sha256!==m.station_digests[slug]
    || d.source?.provider!=='ECMWF Open Data' || d.source?.run_initialisation!==m.run
    || d.source?.available_through_hour!==m.available_through_hour
    || d.times_ms?.length!==n || d.times_ms.some((t,i)=>t!==Date.parse(m.run)+i*3600000)
    || m.fields.some(f=>d.members?.[f]?.length!==51 || d.members[f].some(row=>row.length!==n || row.some(v=>!Number.isFinite(v))))) {
    throw Error('Run in opbouw is niet volledig gecontroleerd voor deze tijdstappen');
  }
  return document;
}
export async function readProgress(read, completeEntries=[]) {
  const m=await read('/pluim_progressive_meta.json').catch(()=>null);
  if(!validProgress(m))return null;
  if(completeEntries.some(e=>Date.parse(e.run)===Date.parse(m.run) || Date.parse(e.run)-Date.parse(m.run)>=86400000))return null;
  return m;
}
