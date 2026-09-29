const {chromium}=require('playwright');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
(async()=>{
 const browser=await chromium.launch({channel:'chrome',headless:true});
 try{
  const page=await browser.newPage();
  await page.goto(pathToFileURL(path.resolve(__dirname,'../regiokaart-spraakkaart.html')).href);
  await page.pdf({path:path.resolve(__dirname,'../regiokaart-spraakkaart.pdf'),format:'A4',printBackground:true,preferCSSPageSize:true,displayHeaderFooter:true,headerTemplate:'<span></span>',footerTemplate:'<div style="font:9px Arial;color:#64748b;width:100%;text-align:center">Weerlab · Spraakkaart regiokaart · <span class="pageNumber"></span> / <span class="totalPages"></span></div>'});
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
