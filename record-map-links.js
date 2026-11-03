// Date links keep the record selection open while showing the national day map.
(()=>{
 const $=id=>document.getElementById(id);
 const table=$('records-tabel'),tbody=$('records-body');
 if(!table||!tbody)return;
 function decorate(){for(const row of tbody.rows){
   // Only individual days have a national day map; period totals stay plain text.
   const headings=[...$('records-tabel').tHead.rows[0].cells].map(c=>c.textContent.trim());
   [...row.cells].forEach((cell,i)=>{
    if(!cell.classList.contains('datum-cel')&&!/^(Volledige )?datum$/i.test(headings[i]||''))return;
    const textNode=[...cell.childNodes].find(n=>n.nodeType===3&&n.textContent.trim());
    const match=textNode?.textContent.trim().match(/^(\d{2})-(\d{2})-(\d{4})$/);
    if(!match)return;
    const date=`${match[3]}-${match[2]}-${match[1]}`;
    const parsed=new Date(date+'T12:00:00');
    if(!Number.isFinite(parsed.getTime())||parsed.getFullYear()!==+match[3]||parsed.getMonth()+1!==+match[2]||parsed.getDate()!==+match[1]||+match[3]<1894)return;
    const params={tx:'TX',tn:'TN',tg:'TG',rh:'RH',sq:'SQ',fx:'FXX',fhx:'FHX',fg:'FG',pg:'PG'};
    const query=new URLSearchParams({date});
    const param=typeof huidigeParam==='string'?huidigeParam:'tx';
    if(params[param])query.set('param',params[param]);
    const link=document.createElement('a');
    link.textContent=textNode.textContent;link.href='historisch.html?'+query;link.target='_blank';link.rel='noopener';link.title='Bekijk de landelijke dagkaart (nieuw tabblad)';
    link.style.cssText='color:inherit;text-decoration:underline;text-underline-offset:3px';
    link.addEventListener('click',e=>e.stopPropagation());
    link.addEventListener('keydown',e=>e.stopPropagation());
    textNode.replaceWith(link);
   });
 }}
 new MutationObserver(decorate).observe(tbody,{childList:true});
 // Capture keyboard events before a record row's details handler sees them.
 tbody.addEventListener('keydown',e=>{if(e.target.closest('a'))e.stopPropagation();},true);
 decorate();
})();
