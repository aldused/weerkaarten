const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
test('Toplijst rounds whole m/s before Beaufort classification',()=>{
 const html=fs.readFileSync('toplijst.html','utf8');const fn=html.match(/function msToBft\(ms\)\{[^\n]+\}/)[0];const ctx={};vm.runInNewContext(fn,ctx);
 for(const [v,b] of [[20.49,8],[20.5,9],[20.79,9],[21.4,9],[22.1,9],[24.49,9],[24.5,10]])assert.equal(ctx.msToBft(v),b);
});
