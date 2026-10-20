/* Display Dutch civil time; source timestamps and model-run identifiers stay UTC. */
(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.WeerkaartenTime=factory();})(typeof globalThis!=='undefined'?globalThis:this,function(){
 'use strict';
 const zone='Europe/Amsterdam';
 const partsFormatter=new Intl.DateTimeFormat('en-GB',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23',timeZoneName:'shortOffset'});
 function parts(iso){const p=Object.fromEntries(partsFormatter.formatToParts(new Date(iso)).filter(v=>v.type!=='literal').map(v=>[v.type,v.value]));return {day:p.year+'-'+p.month+'-'+p.day,clock:p.hour+':'+p.minute,minutes:Number(p.hour)*60+Number(p.minute),offset:p.timeZoneName};}
 function label(iso){return new Intl.DateTimeFormat('nl-NL',{timeZone:zone,weekday:'short',day:'numeric',month:'short',hour:'2-digit',minute:'2-digit',hourCycle:'h23',timeZoneName:'short'}).format(new Date(iso));}
 function short(iso){return new Intl.DateTimeFormat('nl-NL',{timeZone:zone,weekday:'short',day:'numeric',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date(iso));}
 function dayLabel(key){return new Intl.DateTimeFormat('nl-NL',{timeZone:'UTC',weekday:'short',day:'numeric',month:'short'}).format(new Date(key+'T12:00Z'));}
 return {parts,label,short,dayLabel};
});
