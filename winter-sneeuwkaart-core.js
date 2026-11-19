/* Calendar-month climate normals. Winter combines Dec/Jan/Feb within the reference period. */
(function(root){
  'use strict';
  const names=['Januari','Februari','Maart','April','Mei','Juni','Juli','Augustus','September','Oktober','November','December'];
  const scopes=[{key:'year',label:'Hele jaar (jan–dec)',months:[1,2,3,4,5,6,7,8,9,10,11,12],unit:'per kalenderjaar',breaks:[5,10,15,20,25,30]},
    ...names.map((label,index)=>({key:'month-'+(index+1),label,months:[index+1],unit:'in '+label.toLowerCase(),breaks:[.5,1,2,3,4,6]})),
    ...[['winter','Winter (dec–feb)',[12,1,2],'in de winter'],['spring','Lente (mrt–mei)',[3,4,5],'in de lente'],['summer','Zomer (jun–aug)',[6,7,8],'in de zomer'],['autumn','Herfst (sep–nov)',[9,10,11],'in de herfst']].map(([key,label,months,unit])=>({key:'season-'+key,label,months,unit,breaks:[2,5,10,15,20,25]}))];
  function scope(key){return scopes.find(s=>s.key===key)||scopes[0];}
  function aggregate(station,data,key='year'){
    const selected=scope(key),snowfall=data.kind==='snowfall';
    if(!station.monthlyAnnual){
      if(selected.key!=='year')throw Error('Maandgegevens ontbreken');
      return {...station,expectedDays:data.expectedDays,expectedHours:data.expectedHours};
    }
    const annual=station.monthlyAnnual.map(([year,months])=>{
      let count=0,valid=0,hours=0,expected=0;
      for(const month of selected.months){
        const row=months[month-1]||[0,0,0];count+=row[0];valid+=row[1];hours+=row[2]||0;
        expected+=new Date(Date.UTC(year,month,0)).getUTCDate();
      }
      const usable=valid===expected&&(!snowfall||hours>=expected*24*(data.minimumYearHourCoverage??.99));
      return [year,usable?count:null,valid,hours,count,expected];
    });
    const usable=annual.filter(row=>row[1]!==null),minimum=data.minimumYears??30;
    const mean=usable.length>=minimum?Math.round(usable.reduce((sum,row)=>sum+row[1],0)/usable.length*1e4)/1e4:null;
    return {...station,mean,years:usable.length,annual,validDays:annual.reduce((sum,row)=>sum+row[2],0),
      validHours:annual.reduce((sum,row)=>sum+row[3],0),expectedDays:annual.reduce((sum,row)=>sum+row[5],0),expectedHours:annual.reduce((sum,row)=>sum+row[5]*24,0)};
  }
  const api={scopes,scope,aggregate};
  if(typeof module==='object'&&module.exports)module.exports=api;else root.WeerlabSnowNormals=api;
})(typeof window!=='undefined'?window:globalThis);
