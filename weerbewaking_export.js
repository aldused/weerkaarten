(function(){
  function syncSelectValues(root=document){
    root.querySelectorAll('select').forEach(select=>{
      [...select.options].forEach(option=>option.removeAttribute('selected'));
      const live=select.options[select.selectedIndex];
      if(live) live.setAttribute('selected','');
    });
  }
  function html2pdfSave(element, options){
    if(typeof html2pdf !== 'function') return Promise.reject(new Error('html2pdf is niet geladen'));
    const worker=html2pdf().set(options).from(element).save();
    if(worker && typeof worker.then === 'function') return Promise.resolve(worker);
    return new Promise(resolve=>setTimeout(resolve,2000));
  }
  async function canvasPdf(element, filename, options={}){
    if(typeof html2canvas !== 'function' || !window.jspdf?.jsPDF){
      throw new Error('PDF-bibliotheek is niet geladen');
    }
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
  window.WBExport={ syncSelectValues, html2pdfSave, canvasPdf };
})();
