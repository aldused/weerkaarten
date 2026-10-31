const assert=require('node:assert/strict'),C=require('../klimatologie-core.js');
let flat=Array(365).fill(7);assert(C.trends(flat).every(v=>v===0));assert(C.trends(flat,'difference').every(v=>v===0));assert(C.smooth(flat).every(v=>v===7));
let linear=Array.from({length:365},(_,i)=>3*i+2);assert.equal(C.trends(linear)[100],3);assert.equal(C.trends(linear,'difference')[100],3);
let sine=Array.from({length:365},(_,i)=>Math.sin(2*Math.PI*i/365)),rot=[...sine.slice(40),...sine.slice(0,40)];for(let m of ['regression','difference']){let a=C.trends(sine,m),b=C.trends(rot,m);a.forEach((_,i)=>assert(Math.abs(b[i]-a[(i+40)%365])<1e-12))}
let missing=[...flat];missing[0]=null;assert.equal(C.trends(missing)[364],null);assert.equal(C.smooth(missing)[0],null);assert.equal(C.extremes([null,null]),null);
for(let id of [260,240,280,310,380]){let d=require(`../klimatologie-data/${id}.json`);assert.equal(d.days.length,365);assert(!d.days.includes('02-29'));for(let k of ['tx','tn','tg','rr']){assert.equal(d.series[k].length,365);assert(d.counts[k].every(n=>n<=30));assert(d.series[k].every(Number.isFinite))}assert(d.monthly.every(m=>m.years===30));}
console.log('PASS: constant, linear, circular rotation, missing values and five source datasets');
