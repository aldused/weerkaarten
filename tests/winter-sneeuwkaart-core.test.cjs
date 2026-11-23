const test=require('node:test'),assert=require('node:assert/strict');
const core=require('../winter-sneeuwkaart-core.js');
function series(kind='snowcover'){
 const data={kind,minimumYears:kind==='snowfall'?24:30,minimumYearHourCoverage:.99};
 const monthlyAnnual=Array.from({length:30},(_,index)=>{const year=1991+index;return [year,Array.from({length:12},(_,m)=>{const days=new Date(Date.UTC(year,m+1,0)).getUTCDate();return kind==='snowfall'?[m+1,days,days*24]:[m+1,days];})];});
 return {data,station:{id:1,monthlyAnnual}};
}
test('November counts November alone; winter means December, January and February',()=>{
 const {data,station}=series();
 assert.equal(core.aggregate(station,data,'month-11').mean,11);
 assert.equal(core.aggregate(station,data,'season-winter').mean,15);
 assert.equal(core.aggregate(station,data,'season-spring').mean,12);
 assert.equal(core.aggregate(station,data,'year').mean,78);
 assert.equal(core.aggregate(station,data,'month-11').expectedDays,900);
 assert.equal(core.aggregate(station,data,'month-2').expectedDays,848);
});
test('Winter halfyear uses the previous autumn and the end year’s leap day', () => {
 const {data,station}=series();
 station.previousAutumn = [[10,31],[11,30],[12,31]];
 const result = core.aggregate(station, data, 'winter-halfyear');
 assert.deepEqual(result.annual[0], [1991,39,182,0,39,182]);
 assert.deepEqual(result.annual[1], [1992,39,183,0,39,183]);
 assert.equal(result.mean, 39);
});
test('Missing summer measurements do not invalidate a complete November',()=>{
 const {data,station}=series();station.monthlyAnnual[0][1][6][1]--;
 assert.equal(core.aggregate(station,data,'year').mean,null);
 assert.equal(core.aggregate(station,data,'month-11').mean,11);
 station.monthlyAnnual[0][1][10]=[0,0];
 assert.equal(core.aggregate(station,data,'month-11').mean,null);
});
test('Snowfall excludes missing reference years, requires 24, and respects hourly coverage',()=>{
 const {data,station}=series('snowfall');
 for(let i=0;i<6;i++)station.monthlyAnnual[i][1][10]=[0,0,0];
 let result=core.aggregate(station,data,'month-11');assert.equal(result.mean,11);assert.equal(result.years,24);
 station.monthlyAnnual[6][1][10][2]=700;
 result=core.aggregate(station,data,'month-11');assert.equal(result.mean,null);assert.equal(result.years,23);
});
test('Whole-year aggregation reproduces every published station mean and coverage',()=>{
 for(const type of ['sneeuwval','sneeuwdek'])for(const period of ['1961-1990','1991-2020']){
  const data=require(`../winter-data/${type}-normalen-${period}.json`);
  for(const station of data.stations){const result=core.aggregate(station,data,'year');assert.equal(result.mean,station.mean,`${type} ${period} ${station.id}`);assert.equal(result.years,station.years);assert.equal(result.validDays,station.validDays);}
 }
});
test('Real De Bilt November normals are independent for both snow metrics and climate periods',()=>{
 for(const [type,id,old,recent]of [['sneeuwval',260,2.4667,1],['sneeuwdek',550,1.3333,.2667]])for(const [period,expected]of [['1961-1990',old],['1991-2020',recent]]){
  const data=require(`../winter-data/${type}-normalen-${period}.json`),station=data.stations.find(s=>s.id===id);
  assert.equal(core.aggregate(station,data,'month-11').mean,expected);
 }
});
