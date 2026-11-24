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
  breedte = 1600, dagtekst, kaarttitel, kopregel, bron, tekenLabels
}) {
  const kaart = basis.viewBox.baseVal;
  const hoogte = Math.round(breedte * kaart.height / kaart.width);
  const kopHoogte = 130, voetHoogte = 60;
  const canvas = document.createElement("canvas");
  canvas.width = breedte;
  canvas.height = kopHoogte + hoogte + voetHoogte;
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
  tekenWeerlabKaartVoet(ctx, breedte, kopHoogte + hoogte, voetHoogte, bron);
  return canvas;
}
