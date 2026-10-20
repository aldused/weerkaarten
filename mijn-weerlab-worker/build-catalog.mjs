import fs from 'node:fs';
import vm from 'node:vm';
// Build-time only: the browser and server share the existing product registry.
const file=process.argv[2]||new URL('../menu-data.js',import.meta.url);
const products=vm.runInNewContext(fs.readFileSync(file,'utf8')+';MENU_PRODUCTS');
const catalog=products.map(({id,name,description,section,category,href,restricted})=>({id,name,description,section,category,href,requiresProductGate:!!restricted,available:true}));
if(new Set(catalog.map(p=>p.id)).size!==catalog.length)throw Error('Duplicate product IDs');
for(const p of catalog)if(!/^index\.html#[a-z0-9_-]+$/i.test(p.href))throw Error('Noncanonical route: '+p.id);
fs.writeFileSync(new URL('./catalog.mjs',import.meta.url),'// Generated from menu-data.js.\nexport const catalog='+JSON.stringify(catalog,null,2)+';\n');
console.log(catalog.length+' registered products');
