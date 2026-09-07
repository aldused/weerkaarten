(function(){
  // Geen enkele afbeelding mag de PDF-export laten hangen. img.decode() en een
  // trage fetch geven soms nooit antwoord — met name als de gebruiker tijdens
  // het exporteren naar een ander tabblad gaat, want dan zet de browser het
  // decoderen van losse afbeeldingen stil. Zonder deze grens bleef de hele
  // export daarop wachten en leek het alsof de PDF eindeloos duurde.
  const IMG_FETCH_TIMEOUT_MS = 4000;   // netwerk mag traag zijn
  const IMG_DECODE_TIMEOUT_MS = 1500;  // decoderen van een logo duurt normaal enkele ms

  function metTijdslimiet(belofte, ms, bijTimeout = null){
    return Promise.race([
      Promise.resolve(belofte).catch(()=>bijTimeout),
      new Promise(resolve=>setTimeout(()=>resolve(bijTimeout), ms)),
    ]);
  }

  function blobNaarDataUrl(blob){
    return new Promise((resolve,reject)=>{
      const reader=new FileReader();
      reader.onload=()=>resolve(String(reader.result || ''));
      reader.onerror=()=>reject(reader.error || new Error('Afbeelding kon niet worden ingelezen'));
      reader.readAsDataURL(blob);
    });
  }

  async function safeImageDataUrl(img){
    if(!img) return null;
    const bron=img.currentSrc || img.getAttribute('src') || '';
    if(!bron) return null;
    if(/^data:/i.test(bron)) return bron;
    try{
      const url=new URL(bron,document.baseURI);
      const ctrl=typeof AbortController==='function'?new AbortController():null;
      const afbreken=setTimeout(()=>{ try{ ctrl && ctrl.abort(); }catch(_){ } }, IMG_FETCH_TIMEOUT_MS);
      let response;
      try{
        response=await fetch(url.href,{
          credentials:url.origin===location.origin?'same-origin':'omit',
          mode:'cors',cache:'force-cache',signal:ctrl?ctrl.signal:undefined
        });
      } finally { clearTimeout(afbreken); }
      if(!response.ok) throw new Error('HTTP '+response.status);
      return await blobNaarDataUrl(await response.blob());
    }catch(fetchError){
      try{
        if(!img.complete || !img.naturalWidth || !img.naturalHeight) return null;
        const canvas=document.createElement('canvas');
        canvas.width=img.naturalWidth; canvas.height=img.naturalHeight;
        canvas.getContext('2d').drawImage(img,0,0);
        return canvas.toDataURL('image/png');
      }catch(canvasError){
        return null;
      }
    }
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
  async function html2pdfSave(element, options){
    if(typeof html2pdf !== 'function') return Promise.reject(new Error('html2pdf is niet geladen'));
    await prepareForCanvas(element);
    const worker=html2pdf().set(options).from(element).save();
    if(worker && typeof worker.then === 'function') return Promise.resolve(worker);
    return new Promise(resolve=>setTimeout(resolve,2000));
  }
  async function canvasPdf(element, filename, options={}){
    if(typeof html2canvas !== 'function' || !window.jspdf?.jsPDF){
      throw new Error('PDF-bibliotheek is niet geladen');
    }
    await prepareForCanvas(element);
    const canvas=await html2canvas(element,{
      scale:options.scale || 1.8,useCORS:true,backgroundColor:'#ffffff',logging:false,
      scrollX:0,scrollY:0,windowWidth:element.scrollWidth,windowHeight:element.scrollHeight
    });
    const width=options.widthMm || 210;
    const imageHeight=canvas.height/canvas.width*width;
    const pageHeight=Math.max(options.minHeightMm || 297,Math.ceil(imageHeight)+2);
    const pdf=new jspdf.jsPDF({unit:'mm',format:[width,pageHeight],orientation:'portrait'});
    pdf.addImage(canvas,'JPEG',0,0,width,imageHeight,undefined,'FAST');
    pdf.save(filename);
  }
  window.WBExport={ syncSelectValues, safeImageDataUrl, prepareForCanvas, html2pdfSave, canvasPdf };
})();
