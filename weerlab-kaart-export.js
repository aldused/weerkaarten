/* Gedeeld PNG-kader voor Topkaarten en Dagrecords. */
function tekenWeerlabKaartKop(ctx, breedte, hoogte, dagtekst, kaarttitel, kopregel) {
  ctx.fillStyle = "#1e293b";
  ctx.fillRect(0, 0, breedte, hoogte);
  ctx.fillStyle = "#2ec4e8";
  ctx.fillRect(0, hoogte-6, breedte, 6);
  const pad = 36;
  ctx.fillStyle = "#ffffff";
  ctx.font = "800 46px 'DM Sans', Arial, sans-serif";
  ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
  ctx.fillText("Ed Aldus WM", pad, 58);
  ctx.fillStyle = "#94a3b8";
  ctx.font = "500 22px 'DM Mono', 'Courier New', monospace";
  ctx.fillText(kopregel, pad, 94);
  ctx.fillStyle = "#ffffff";
  ctx.font = "800 46px 'DM Sans', Arial, sans-serif";
  ctx.textAlign = "right";
  ctx.fillText(dagtekst, breedte-pad, 58);
  ctx.fillStyle = "#cbd5e1";
  ctx.font = "500 22px 'DM Sans', Arial, sans-serif";
  ctx.fillText(kaarttitel, breedte-pad, 94);
  ctx.textAlign = "left";
}

function tekenWeerlabKaartVoet(ctx, breedte, y, hoogte, bronTekst) {
  ctx.fillStyle = "#0f172a";
  ctx.fillRect(0, y, breedte, hoogte);
  const pad = 36;
  const midY = y + hoogte/2 + 7;
  ctx.fillStyle = "#f1f5f9";
  ctx.font = "700 22px 'DM Sans', Arial, sans-serif";
  ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
  ctx.fillText("weerlab.nl", pad, midY);
  const merkW = ctx.measureText("weerlab.nl").width;
  ctx.fillStyle = "#94a3b8";
  ctx.font = "500 19px 'DM Sans', Arial, sans-serif";
  ctx.fillText("·  Ed Aldus — weerdata & visualisaties", pad + merkW + 6, midY);
  ctx.font = "500 18px 'DM Mono', 'Courier New', monospace";
  ctx.textAlign = "right";
  const bronW = ctx.measureText(bronTekst).width;
  const pillH = 30, pillX = breedte - pad - bronW - 22, pillY = y + hoogte/2 - pillH/2;
  ctx.fillStyle = "rgba(46,196,232,0.14)";
  const r = pillH/2;
  ctx.beginPath();
  ctx.moveTo(pillX + r, pillY);
  ctx.lineTo(pillX + bronW + 22 - r, pillY);
  ctx.arcTo(pillX + bronW + 22, pillY, pillX + bronW + 22, pillY + r, r);
  ctx.lineTo(pillX + bronW + 22, pillY + pillH - r);
  ctx.arcTo(pillX + bronW + 22, pillY + pillH, pillX + bronW + 22 - r, pillY + pillH, r);
  ctx.lineTo(pillX + r, pillY + pillH);
  ctx.arcTo(pillX, pillY + pillH, pillX, pillY + pillH - r, r);
  ctx.lineTo(pillX, pillY + r);
  ctx.arcTo(pillX, pillY, pillX + r, pillY, r);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = "#7dd3fc";
  ctx.fillText(bronTekst, breedte - pad - 11, midY);
  ctx.textAlign = "left";
}

function tekenWeerlabKaartBijschrift(breedte, legenda, historischeLocaties, topDrie) {
  const paneel = document.createElement("canvas");
  const ctx = paneel.getContext("2d");
  const pad = 26, regelhoogte = 31;
  const legendaItems = legenda ? legenda.labels.map(({kleur, tekst})=>({
    kleur, tekst:tekst+" "+legenda.eenheid
  })) : [];
  if (historischeLocaties) legendaItems.push({tekst:"Historische meetlocatie"});
  ctx.font = "500 21px 'DM Sans', Arial, sans-serif";
  let x = pad, y = pad + (topDrie.length ? (topDrie.length+1)*regelhoogte + 12 : 0);
  const posities = legendaItems.map(item=>{
    const ruimte = 29 + ctx.measureText(item.tekst).width + 18;
    if (x > pad && x + ruimte > breedte-pad) {
      x = pad;
      y += regelhoogte;
    }
    const positie = {...item, x, y};
    x += ruimte;
    return positie;
  });
  paneel.width = breedte;
  paneel.height = y + (posities.length ? 30 : 0);
  ctx.fillStyle = "#f8fafc";
  ctx.fillRect(0,0,paneel.width,paneel.height);
  ctx.font = "500 21px 'DM Sans', Arial, sans-serif";
  ctx.textBaseline = "middle";
  for (const {kleur, tekst:label, x, y} of posities) {
    ctx.strokeStyle = "#56728a";
    if (kleur) {
      ctx.fillStyle = kleur;
      ctx.fillRect(x,y-9,18,18);
      ctx.strokeRect(x,y-9,18,18);
    } else {
      ctx.save();
      ctx.setLineDash([3,2]);
      ctx.beginPath();
      ctx.arc(x+9,y,7,0,2*Math.PI);
      ctx.stroke();
      ctx.restore();
    }
    ctx.fillStyle = "#172b40";
    ctx.fillText(label,x+26,y);
  }
  if (topDrie.length) {
    ctx.fillStyle = "#172b40";
    ctx.font = "700 23px 'DM Sans', Arial, sans-serif";
    ctx.fillText("Top 3",pad,pad);
    ctx.font = "500 21px 'DM Sans', Arial, sans-serif";
    topDrie.forEach(({rang,naam,waarde}, i)=>{
      ctx.fillText(rang+".  "+naam+" · "+waarde,pad,pad+(i+1)*regelhoogte,breedte-2*pad);
    });
  }
  return paneel;
}

async function rasteriseerWeerlabKaartlaag(svg, breedte, hoogte, stijl) {
  const kloon = svg.cloneNode(true);
  if (stijl) {
    const element = svg.ownerDocument.createElementNS(svg.namespaceURI, "style");
    element.textContent = stijl;
    kloon.prepend(element);
  }
  kloon.setAttribute("width", breedte);
  kloon.setAttribute("height", hoogte);
  const bron = new XMLSerializer().serializeToString(kloon);
  const url = URL.createObjectURL(new Blob([bron], {type: "image/svg+xml"}));
  try {
    const afbeelding = new Image();
    afbeelding.src = url;
    await afbeelding.decode();
    return afbeelding;
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function maakWeerlabKaartCanvas({
  basis, kleurlaag, overlay, basisStijl, overlayStijl,
  breedte = 1600, dagtekst, kaarttitel, kopregel, bron, tekenLabels,
  legenda, historischeLocaties = false, topDrie = []
}) {
  const kaart = basis.viewBox.baseVal;
  const hoogte = Math.round(breedte * kaart.height / kaart.width);
  const kopHoogte = 130, voetHoogte = 60;
  const canvas = document.createElement("canvas");
  const bijschrift = legenda || topDrie.length
    ? tekenWeerlabKaartBijschrift(breedte,legenda,historischeLocaties,topDrie)
    : null;
  const voetY = kopHoogte + hoogte + (bijschrift?.height || 0);
  canvas.width = breedte;
  canvas.height = voetY + voetHoogte;
  const ctx = canvas.getContext("2d");
  const [land, bovenlaag] = await Promise.all([
    rasteriseerWeerlabKaartlaag(basis, breedte, hoogte, basisStijl),
    rasteriseerWeerlabKaartlaag(overlay, breedte, hoogte, overlayStijl)
  ]);
  tekenWeerlabKaartKop(ctx, breedte, kopHoogte, dagtekst, kaarttitel, kopregel);
  ctx.fillStyle = "#b8d4e8";
  ctx.fillRect(0, kopHoogte, breedte, hoogte);
  ctx.drawImage(land, 0, kopHoogte);
  if (kleurlaag.width > 1) ctx.drawImage(kleurlaag, 0, kopHoogte, breedte, hoogte);
  ctx.drawImage(bovenlaag, 0, kopHoogte);
  if (tekenLabels) {
    ctx.save();
    ctx.translate(0, kopHoogte);
    ctx.scale(breedte / kaart.width, hoogte / kaart.height);
    tekenLabels(ctx);
    ctx.restore();
  }
  if (bijschrift) ctx.drawImage(bijschrift,0,kopHoogte+hoogte);
  tekenWeerlabKaartVoet(ctx, breedte, voetY, voetHoogte, bron);
  return canvas;
}
