(function(){
  // Geen enkele afbeelding mag de PDF-export laten hangen. img.decode() en een
  // trage fetch geven soms nooit antwoord — met name als de gebruiker tijdens
  // het exporteren naar een ander tabblad gaat, want dan zet de browser het
  // decoderen van losse afbeeldingen stil. Zonder deze grens bleef de hele
  // export daarop wachten en leek het alsof de PDF eindeloos duurde.
  const IMG_FETCH_TIMEOUT_MS = 4000;   // netwerk mag traag zijn
  const IMG_DECODE_TIMEOUT_MS = 1500;  // decoderen van een logo duurt normaal enkele ms

  const imageCache=new Map();
  let activeExport=null;

  function metTijdslimiet(belofte, ms, bijTimeout = null){
    return new Promise(resolve=>{
      const timer=setTimeout(()=>resolve(bijTimeout),ms);
      Promise.resolve(belofte).then(value=>{clearTimeout(timer);resolve(value);},()=>{clearTimeout(timer);resolve(bijTimeout);});
    });
  }

  function blobNaarDataUrl(blob){
    return new Promise((resolve,reject)=>{
      const reader=new FileReader();
      reader.onload=()=>resolve(String(reader.result || ''));
      reader.onerror=()=>reject(reader.error || new Error('Afbeelding kon niet worden ingelezen'));
      reader.readAsDataURL(blob);
    });
  }

  function loadedImageData(img){
    if(!img?.complete || !img.naturalWidth || !img.naturalHeight) return null;
    try{
      const canvas=document.createElement('canvas');
      canvas.width=img.naturalWidth; canvas.height=img.naturalHeight;
      canvas.getContext('2d').drawImage(img,0,0);
      return canvas.toDataURL('image/png');
    }catch(e){ return null; }
  }

  async function safeImageDataUrl(img){
    if(!img) return null;
    const bron=img.currentSrc || img.getAttribute('src') || '';
    if(!bron) return null;
    if(/^data:/i.test(bron)) return bron;
    const url=new URL(bron,document.baseURI);
    if(imageCache.has(url.href)) return imageCache.get(url.href);
    const promise=(async()=>{
      // Een geladen logo is al beschikbaar: geen extra netwerkronde of decode.
      const loaded=loadedImageData(img) || loadedImageData([...document.images].find(other=>
        (other.currentSrc || other.src)===url.href && other.complete && other.naturalWidth));
      if(loaded) return loaded;
      const ctrl=typeof AbortController==='function'?new AbortController():null;
      const timer=setTimeout(()=>ctrl?.abort(),IMG_FETCH_TIMEOUT_MS);
      try{
        const response=await fetch(url.href,{
          credentials:url.origin===location.origin?'same-origin':'omit',
          mode:'cors',cache:'force-cache',signal:ctrl?.signal
        });
        if(!response.ok) return null;
        return await blobNaarDataUrl(await response.blob());
      }catch(e){ return null; }
      finally{ clearTimeout(timer); }
    })();
    const bounded=metTijdslimiet(promise,IMG_FETCH_TIMEOUT_MS);
    imageCache.set(url.href,bounded);
    if(imageCache.size>32) imageCache.delete(imageCache.keys().next().value);
    const result=await bounded;
    if(!result) imageCache.delete(url.href); // later opnieuw proberen na een netwerkfout
    return result;
  }

  async function inlineImages(root){
    const afbeeldingen=[...root.querySelectorAll('img')];
    await Promise.all(afbeeldingen.map(async img=>{
      const dataUrl=await metTijdslimiet(safeImageDataUrl(img), IMG_FETCH_TIMEOUT_MS);
      if(!dataUrl){
        // Eén geblokkeerde externe afbeelding mag nooit de hele PDF blokkeren.
        img.remove();
        return;
      }
      img.removeAttribute('srcset');
      img.removeAttribute('crossorigin');
      img.src=dataUrl;
      // decode() is alleen een optimalisatie; html2canvas wacht zelf ook op de
      // afbeelding. Blijft het decoderen hangen, dan gaat de export gewoon door.
      if(typeof img.decode==='function') await metTijdslimiet(img.decode(), IMG_DECODE_TIMEOUT_MS);
    }));
  }

  function inlineCanvases(root){
    root.querySelectorAll('canvas').forEach(canvas=>{
      try{
        const img=document.createElement('img');
        img.src=canvas.toDataURL('image/png');
        img.width=canvas.width; img.height=canvas.height;
        img.style.cssText=canvas.style.cssText;
        canvas.replaceWith(img);
      }catch(e){
        // Een reeds besmet extern canvas wordt bewust niet meegenomen.
        canvas.remove();
      }
    });
  }

  async function prepareForCanvas(element){
    await inlineImages(element);
    inlineCanvases(element);
    return element;
  }

  function syncSelectValues(root=document){
    root.querySelectorAll('select').forEach(select=>{
      [...select.options].forEach(option=>option.removeAttribute('selected'));
      const live=select.options[select.selectedIndex];
      if(live) live.setAttribute('selected','');
    });
  }
  function canvasOptions(options={}){
    const onclone=options.onclone;
    return {
      logging:false,imageTimeout:IMG_FETCH_TIMEOUT_MS,...options,
      scrollX:0,scrollY:0,
      onclone:async function(cloneDoc,element){
        cloneDoc.documentElement.style.scrollBehavior='auto';
        cloneDoc.documentElement.scrollTop=0;
        cloneDoc.documentElement.scrollLeft=0;
        if(cloneDoc.body){ cloneDoc.body.scrollTop=0; cloneDoc.body.scrollLeft=0; }
        cloneDoc.defaultView?.scrollTo(0,0);
        if(onclone) await onclone(cloneDoc,element);
      }
    };
  }

  // Ook de bovenliggende schil kan gescrold zijn. Herstel alle posities na
  // afloop, zodat de gebruiker verder kan schrijven waar hij gebleven was.
  function resetScroll(){
    const restore=[];
    const seen=new Set();
    function elementScroll(el){
      if(!el || seen.has(el)) return;
      seen.add(el);
      const x=el.scrollLeft,y=el.scrollTop,behavior=el.style.scrollBehavior;
      if(!x && !y) return;
      el.style.scrollBehavior='auto'; el.scrollLeft=0; el.scrollTop=0;
      restore.push(()=>{el.scrollLeft=x;el.scrollTop=y;el.style.scrollBehavior=behavior;});
    }
    let view=window;
    while(view){
      try{
        const x=view.scrollX,y=view.scrollY,root=view.document.documentElement;
        const behavior=root.style.scrollBehavior;
        root.style.scrollBehavior='auto'; view.scrollTo(0,0);
        const savedView=view;
        restore.push(()=>{savedView.scrollTo(x,y);root.style.scrollBehavior=behavior;});
        let frame=view.frameElement;
        if(!frame) break;
        for(let parent=frame.parentElement;parent;parent=parent.parentElement) elementScroll(parent);
        view=view.parent;
      }catch(e){break;}
    }
    return ()=>{for(const reset of restore.reverse()) reset();};
  }

  function runExport(action){
    if(activeExport) return activeExport;
    const buttons=[...document.querySelectorAll('button[onclick*="exporteerPDF"],button[onclick*="downloadPdf"]')]
      .map(el=>({el,text:el.textContent,disabled:el.disabled}));
    buttons.forEach(({el})=>{el.disabled=true;el.textContent='PDF maken…';el.setAttribute('aria-busy','true');});
    activeExport=(async()=>{
      const restore=resetScroll();
      try{ return await action(); }
      finally{
        restore();
        buttons.forEach(({el,text,disabled})=>{el.disabled=disabled;el.textContent=text;el.removeAttribute('aria-busy');});
        activeExport=null;
      }
    })();
    return activeExport;
  }

  function html2pdfSave(element, options={}){
    return runExport(async()=>{
      if(typeof html2pdf !== 'function') throw new Error('html2pdf is niet geladen');
      await prepareForCanvas(element);
      // html2pdf centreert zijn tijdelijke pagina in het huidige venster.
      // Een andere render-viewport verschuift die pagina en snijdt de linkerkant af.
      const opt={...options,html2canvas:canvasOptions(options.html2canvas)};
      delete opt.html2canvas.windowWidth;
      delete opt.html2canvas.windowHeight;
      await html2pdf().set(opt).from(element).save();
    });
  }
  function canvasPdf(element, filename, options={}){
    return runExport(async()=>{
      if(typeof html2canvas !== 'function' || !window.jspdf?.jsPDF){
        throw new Error('PDF-bibliotheek is niet geladen');
      }
      await prepareForCanvas(element);
      const canvas=await html2canvas(element,canvasOptions({
        scale:options.scale || 1.8,useCORS:true,backgroundColor:'#ffffff',
        windowWidth:element.scrollWidth,windowHeight:element.scrollHeight
      }));
      const width=options.widthMm || 210;
      const imageHeight=canvas.height/canvas.width*width;
      const pageHeight=Math.max(options.minHeightMm || 297,Math.ceil(imageHeight)+2);
      const pdf=new jspdf.jsPDF({unit:'mm',format:[width,pageHeight],orientation:'portrait'});
      pdf.addImage(canvas,'JPEG',0,0,width,imageHeight,undefined,'FAST');
      pdf.save(filename);
    });
  }
  window.WBExport={ syncSelectValues, safeImageDataUrl, prepareForCanvas, html2pdfSave, canvasPdf };
})();
