// node scripts/audit_mosmix_maps.cjs [--live]
// Read-only audit; does not adjust or publish source values.
const fs=require('node:fs'),path=require('node:path'),core=require('../mosmix-core.js');
(async()=>{
 const read=async file=>process.argv.includes('--live')?core.fetchJSON('https://data.weerlab.nl/'+file):JSON.parse(fs.readFileSync(path.join(__dirname,'..',file)));
 const [daily,hourly]=await Promise.all([read('mosmix_nl.json'),read('mosmix_uurlijks_nl.json')]);
 core.validateDaily(daily);core.assertSameRun(daily,hourly);
 const invalid=[],windMismatch=[];let numericValues=0;
 for(const day of daily.dagen){
  for(const [param,values] of Object.entries(daily.data[day]))for(const [name,value] of Object.entries(values)){
   numericValues++;
   if(!core.finite(value)||(/^R1|^ww|^N|^FXh|^RV/.test(param)&&(value<0||value>100)))invalid.push({day,param,name,value});
  }
  for(const [name,s] of Object.entries(hourly.data)){
   const speeds=s.tijden.flatMap((t,i)=>t.slice(0,10)===day&&+t.slice(11,13)>=6&&+t.slice(11,13)<18&&core.finite(s.FF[i])?[s.FF[i]]:[]);
   const value=daily.data[day].FF?.[name];
   if(speeds.length&&core.finite(value)&&Math.abs(value-speeds.reduce((a,b)=>a+b)/speeds.length)>.2)windMismatch.push({day,name,value});
  }
 }
 const probabilityIssues=core.probabilityIssues(daily);
 console.log(JSON.stringify({run:daily.run,stations:Object.keys(daily.stations).length,days:daily.dagen.length,numericValues,invalid,windMismatch,probabilityIssueCount:probabilityIssues.length,probabilityExamples:probabilityIssues.slice(0,5),note:'Kansoverschrijdingen zijn waarschuwingen; bronwaarden blijven intact. Dit is geen verificatie tegen waarnemingen.'},null,2));
 if(invalid.length||windMismatch.length)process.exitCode=1;
})().catch(e=>{console.error(e);process.exitCode=1;});
