const {test}=require('node:test');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.resolve(__dirname,'..');
const source=JSON.parse(fs.readFileSync(path.join(root,'winter-data/winterstatistieken.json'),'utf8'));
function harness(data=source){
 const script=fs.readFileSync(path.join(root,'winterstatistieken.js'),'utf8').replace('  init().catch(error => {','  source=window.fixture;window.testStats={summarize,snowContext};return;\n  init().catch(error => {');
 const window={fixture:data};vm.runInNewContext(script,{window,document:{getElementById:()=>({}),querySelectorAll:()=>[]},Intl,Date});return window.testStats;
}
test('Both stations sharing the 2009/10 snow-cover record retain their dates',()=>{
 const stats=harness().summarize(source.series.snow['2010']);
 assert.equal(stats.value,57);assert.equal(stats.leaders.length,2);
 assert.match(stats.context,/30 dec\.? 2009/);assert.match(stats.context,/24 feb\.? 2010/);
 assert.equal((stats.context.match(/30 dec\.? 2009/g)||[]).length,1,'One shared interval is displayed once');
 for(const record of stats.leaders)assert(stats.context.includes(source.names.snow[record[0]]));
});
test('Different tied intervals all remain visible',()=>{
 const data={names:{snow:{1:'A',2:'B',3:'C'}}};
 const rows=[[1,4,'2021-01-01','2021-01-04',365],[2,4,'2021-02-01','2021-02-04',365],[3,4,'2021-02-01','2021-02-04',365]];
 const stats=harness(data).summarize(rows);
 assert.match(stats.context,/1 jan\.? 2021.*4 jan\.? 2021/);assert.match(stats.context,/B, C.*1 feb\.? 2021.*4 feb\.? 2021/);
});
test('Every snowy winter this century has all leading date ranges in its summary',()=>{
 const {summarize}=harness(),format=iso=>new Intl.DateTimeFormat('nl-NL',{timeZone:'UTC',day:'numeric',month:'short',year:'numeric'}).format(new Date(iso+'T00:00:00Z'));
 let years=0;
 for(const [year,rows]of Object.entries(source.series.snow)){
  if(Number(year)<2001)continue;
  const stats=summarize(rows);if(!stats.leaders.length)continue;years++;
  for(const record of stats.leaders){assert(stats.context.includes(format(record[2])),`Start shown for ${year}`);assert(stats.context.includes(format(record[3])),`End shown for ${year}`);}
 }
 assert.equal(years,26);
});
test('A single leading station and winters without snow keep a clear summary',()=>{
 const api=harness({names:{snow:{1:'A'}}});
 assert.match(api.summarize([[1,3,'2020-02-10','2020-02-12',366]]).context,/A.*10 feb\.? 2020.*12 feb\.? 2020/);
 assert.equal(api.summarize([[1,0,null,null,365]]).context,'Geen gemeten sneeuwdek');
});
