const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const html=fs.readFileSync(require('node:path').join(__dirname,'../weerkaarten_europa.html'),'utf8');
const setModelSource=html.slice(html.indexOf('function setModel('),html.indexOf('function setRun('));
function viewer(region='northsea',model='ecmwf'){
 const elements={'region-view':{value:region},modelbar:{disabled:true},mapsize:{value:250},'mapsize-value':{textContent:'250%'}};
 const time='2026-10-22T12:00:00Z';
 const ctx={regionView:region,curModel:model,idx:0,mapZoom:2.5,mapPanX:25,mapPanY:15,
  $:id=>elements[id],R:()=>({frames:[{valid_utc:time}]}),D:()=>({}),orderCycles:()=>['00'],buildRunBar:()=>{},
  setRun:(cycle,valid)=>ctx.selectedValid=valid,meldStandAanOuder:()=>{}};
 vm.createContext(ctx);vm.runInContext(setModelSource,ctx);return {ctx,elements,time};
}
test('HARMONIE can be selected from the North Sea view and opens hourly Netherlands maps',()=>{
 const {ctx,elements,time}=viewer();ctx.setModel('harmonie43');
 assert.equal(ctx.curModel,'harmonie43');assert.equal(ctx.regionView,'netherlands');
 assert.equal(elements.modelbar.disabled,false);assert.equal(elements['region-view'].value,'netherlands');
 assert.equal(ctx.selectedValid,time);assert.equal(ctx.mapZoom,1);assert.equal(elements.mapsize.value,100);
});
test('GFS, ICON and CAMS can also be selected from North Sea without being forced back to ECMWF',()=>{
 for(const model of ['gfs','icon','cams']){
  const {ctx,elements}=viewer();ctx.setModel(model);
  assert.equal(ctx.curModel,model);assert.equal(ctx.regionView,'europe');assert.equal(elements.modelbar.disabled,false);
 }
});
test('ECMWF retains its North Sea maps while the selector remains available',()=>{
 const {ctx,elements}=viewer();ctx.setModel('ecmwf');
 assert.equal(ctx.regionView,'northsea');assert.equal(elements.modelbar.disabled,false);
});
test('Switching from HARMONIE back to ECMWF retains the Netherlands and selected valid time',()=>{
 const {ctx,elements,time}=viewer('netherlands','harmonie43');ctx.setModel('ecmwf');
 assert.equal(ctx.curModel,'ecmwf');assert.equal(ctx.regionView,'netherlands');
 assert.equal(ctx.selectedValid,time);assert.equal(elements.modelbar.disabled,false);
});
