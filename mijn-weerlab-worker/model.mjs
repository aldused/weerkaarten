export class InputError extends Error {}
export const emptyDashboard=()=>({schemaVersion:1,revision:0,favorites:[],categories:[],savedPages:[],preferences:{view:'cards',start:'personal',history:false},recent:[]});
const text=(v,max=100)=>{if(typeof v!=='string'||v.length>max)throw new InputError('Ongeldige tekst.');return v.trim();};
const record=v=>{if(!v||typeof v!=='object'||Array.isArray(v))throw new InputError('Ongeldige invoer.');return v;};
const key=v=>{v=text(v,150);if(!/^[a-zA-Z0-9_-]+$/.test(v))throw new InputError('Ongeldige identificatie.');return v;};
export function validateDashboard(input,catalog,previous=emptyDashboard()) {
  if(!input||input.schemaVersion!==1||!Array.isArray(input.favorites)||!Array.isArray(input.categories)||input.favorites.length>1000||input.categories.length>100)throw new InputError('Ongeldig dashboard (maximaal 1000 favorieten en 100 categorieën).');
  const categoryIds=new Set(),products=new Set(),favoriteIds=new Set();
  const categories=input.categories.map(c=>{record(c);const id=key(c.id),name=text(c.name);if(!name||categoryIds.has(id))throw new InputError('Categorieën moeten uniek zijn en een naam hebben.');categoryIds.add(id);return {id,name};});
  const favorites=input.favorites.map(f=>{
    record(f);const productId=key(f.productId),incomingId=key(f.id),old=previous.favorites.find(x=>x.productId===productId),id=old?.id||incomingId;
    if(products.has(productId)||favoriteIds.has(id))throw new InputError('Dit product staat al in je favorieten.');
    if(!catalog.has(productId)&&!old)throw new InputError('Onbekend product.');
    const categoryId=f.categoryId===null?null:key(f.categoryId);
    if(categoryId&&!categoryIds.has(categoryId))throw new InputError('Onbekende categorie.');
    products.add(productId);favoriteIds.add(id);
    return {id:old?.id||id,productId,customName:text(f.customName||''),categoryId,createdAt:old?.createdAt||new Date().toISOString(),updatedAt:new Date().toISOString()};
  });
  const p=input.preferences;
  if(!p||!['cards','list'].includes(p.view)||!['general','personal'].includes(p.start)||typeof p.history!=='boolean')throw new InputError('Ongeldige voorkeuren.');
  const recent=p.history&&Array.isArray(input.recent)?[...new Set(input.recent.filter(id=>typeof id==='string'&&catalog.has(id)))].slice(0,5):[];
  const savedPages=validateSavedPages(input.savedPages??previous.savedPages??[],catalog,previous.savedPages||[]);
  return {schemaVersion:1,revision:previous.revision+1,favorites,categories,savedPages,preferences:{view:p.view,start:p.start,history:p.history},recent};
}
export function importDashboard(input,existing,catalog) {
  if(!input||input.schemaVersion!==1||!Array.isArray(input.favorites)||!Array.isArray(input.categories)||input.favorites.length>1000||input.categories.length>100)throw new InputError('Geen geldig Mijn Weerlab-bestand.');
  const result=structuredClone(existing), mapping=new Map();
  for(const c of input.categories){record(c);const name=text(c.name);if(!name)continue;let target=result.categories.find(x=>x.name===name);if(!target){target={id:crypto.randomUUID(),name};result.categories.push(target);}mapping.set(c.id,target.id);}
  let skipped=0;
  for(const f of input.favorites){record(f);if(!catalog.has(f.productId)||result.favorites.some(x=>x.productId===f.productId)){skipped++;continue;}result.favorites.push({id:crypto.randomUUID(),productId:f.productId,customName:text(f.customName||''),categoryId:mapping.get(f.categoryId)||null});}
  if(input.savedPages!==undefined){
    if(!Array.isArray(input.savedPages)||input.savedPages.length>200)throw new InputError('Ongeldige bewaarde pagina’s.');
    result.savedPages??=[];
    for(const row of input.savedPages){
      record(row);if(row.productId&&!catalog.has(row.productId)){skipped++;continue;}
      const [page]=validateSavedPages([{...row,id:crypto.randomUUID()}],catalog);
      if(result.savedPages.some(p=>p.productId===page.productId&&p.menuRoute===page.menuRoute&&p.query===page.query)){skipped++;continue;}
      result.savedPages.push(page);
    }
  }
  return {dashboard:validateDashboard(result,catalog,existing),skipped};
}

// Saved configurations keep a product reference and query separate from the canonical route.
export function validateSavedPages(rows,catalog,previous=[]) {
  if(!Array.isArray(rows)||rows.length>200)throw new InputError('Maximaal 200 bewaarde pagina’s.');
  const ids=new Set(),targets=new Set();
  return rows.map(row=>{
    record(row);const id=key(row.id),title=text(row.title,180);
    const productId=row.productId===null?null:key(row.productId);
    if(productId&&!catalog.has(productId)&&!previous.some(p=>p.id===id&&p.productId===productId))throw new InputError('Onbekend product.');
    const menuRoute=productId?null:text(row.menuRoute,80);
    if(!productId&&!/^menu\/(start|nu|verwachting|terugkijken|favorieten|professioneel|zoeken)$/.test(menuRoute))throw new InputError('Ongeldige paginaroute.');
    const query=new URLSearchParams(text(row.query||'',4096)).toString(),target=(productId||menuRoute)+'?'+query;
    if(!title||ids.has(id)||targets.has(target))throw new InputError('Dubbele of ongeldige bewaarde pagina.');
    ids.add(id);targets.add(target);return {id,title,productId,menuRoute,query};
  });
}
