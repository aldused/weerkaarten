import {domainOptions,GridFactory,getRanges} from '@openmeteo/weather-map-layer';
export const EUROPEAN_HARMONIE=['knmi_harmonie_arome_europe','dmi_harmonie_arome_europe'];
const grids=Object.fromEntries(domainOptions.filter(d=>EUROPEAN_HARMONIE.includes(d.value)).map(d=>[d.value,d.grid]));
export const projectedGridData=model=>grids[model];
export function projectedRanges(model,bounds){
 const g=grids[model];if(!g)throw Error('Onbekend modelraster');
 // Retain a full monotone interpolation stencil around the visible crop.
 const ranges=getRanges(g,bounds);if(ranges.some(r=>r.end<=r.start))return ranges;
 return ranges.map((r,i)=>({start:Math.max(0,r.start-3),end:Math.min(i?g.nx:g.ny,r.end+3)}));
}
export function createProjectedGrid(meta){
 const grid=GridFactory.create(grids[meta.model],meta.ranges);
 grid.kind='projected';
 return grid;
}
export function projectedPacket(data,model,ranges,bounds,identity){
 return {metadata:{schema:1,kind:'projected',model,ranges,bounds,...identity,count:data.values.length,scaleFactor:data.scaleFactor,directions:!!data.directions},values:data.values,directions:data.directions};
}
export function encodeProjectedPacket(packet){
 const header=new TextEncoder().encode(JSON.stringify(packet.metadata)),offset=8+Math.ceil(header.length/4)*4,buffer=new ArrayBuffer(offset+packet.values.byteLength+(packet.directions?.byteLength||0)),view=new DataView(buffer);
 view.setUint32(0,0x574c4831);view.setUint32(4,header.length);new Uint8Array(buffer,8,header.length).set(header);new Float32Array(buffer,offset,packet.values.length).set(packet.values);if(packet.directions)new Float32Array(buffer,offset+packet.values.byteLength,packet.values.length).set(packet.directions);return buffer;
}
export function decodeProjectedPacket(buffer,expected){
 if(buffer.byteLength<8)throw Error('Onvolledig Europees HARMONIE-veld');
 const view=new DataView(buffer),length=view.getUint32(4),offset=8+Math.ceil(length/4)*4;
 if(view.getUint32(0)!==0x574c4831||length>10000||offset>buffer.byteLength)throw Error('Ongeldig Europees HARMONIE-veld');
 const m=JSON.parse(new TextDecoder().decode(new Uint8Array(buffer,8,length))),g=grids[m.model];
 if(m.schema!==1||m.kind!=='projected'||!g||!m.source.startsWith('/data_spatial/'+m.model+'/')||m.source!==expected.source||m.variable!==expected.variable||JSON.stringify(m.bounds)!==JSON.stringify(expected.bounds))throw Error('HARMONIE-veld hoort bij een andere selectie');
 if(!Array.isArray(m.ranges)||m.ranges.length!==2||m.ranges.some((r,i)=>!Number.isInteger(r.start)||!Number.isInteger(r.end)||r.start<0||r.end> (i?g.nx:g.ny)||r.end<=r.start))throw Error('Ongeldige HARMONIE-uitsnede');
 const count=(m.ranges[0].end-m.ranges[0].start)*(m.ranges[1].end-m.ranges[1].start);
 if(m.count!==count||!Number.isFinite(m.scaleFactor)||m.scaleFactor<=0||buffer.byteLength!==offset+count*4*(m.directions?2:1))throw Error('Onvolledig HARMONIE-raster');
 return {metadata:m,values:new Float32Array(buffer,offset,count),scaleFactor:m.scaleFactor,...(m.directions?{directions:new Float32Array(buffer,offset+count*4,count)}:{})};
}
