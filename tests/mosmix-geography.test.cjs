const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const root=path.join(__dirname,'..');
const source=fs.readFileSync(path.join(root,'mosmix-werkstation.js'),'utf8');
const file=source.match(/function geometry\(\)[\s\S]*?fetch\('([^']+)'\)/)?.[1];
assert(file,'The workstation must declare a geographic source');
const geo=JSON.parse(fs.readFileSync(path.join(root,file),'utf8'));
function inRing([x,y],ring){let inside=false;for(let i=0,j=ring.length-1;i<ring.length;j=i++){const [xi,yi]=ring[i],[xj,yj]=ring[j];if((yi>y)!==(yj>y)&&x<(xj-xi)*(y-yi)/(yj-yi)+xi)inside=!inside;}return inside;}
function onLand(point){return geo.features.some(f=>{const g=f.geometry,polys=g.type==='Polygon'?[g.coordinates]:g.type==='MultiPolygon'?g.coordinates:[];return polys.some(p=>inRing(point,p[0])&&!p.slice(1).some(r=>inRing(point,r)));});}
const places={nl:[5.18,52.1],be:[4.35,50.85],fr:[2.35,48.85],de:[13.4,52.5],gb:[-.1,51.5],ibe:[-3.7,40.4],it:[12.5,41.9],alps:[7.45,46.95],scan:[10.75,59.91],ic:[-16.64,28.27],ce:[14.42,50.08],ee:[26.1,44.43],balkan:[20.46,44.82],gr:[23.73,37.98],tr:[32.85,39.93]};
for(const[region,point]of Object.entries(places))test('loaded basemap contains real land in MOS/MIX region '+region,()=>assert(onLand(point),'Missing land at '+point));
test('the North Sea remains sea rather than a filled bounding box',()=>assert.equal(onLand([3,55]),false));
