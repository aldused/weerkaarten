function maakKaartTopDrie(svg, titel, rijen, {schaal = 1, compact = false} = {}) {
  const x = 10, y = 10, tekstX = 35, rijHoogte = 38;
  const titelGrootte = 11, naamGrootte = 11, waardeGrootte = 10;
  let breedte = 180;
  if (compact) {
    const context = svg.ownerDocument.createElement("canvas").getContext("2d");
    function meet(tekst, grootte) {
      context.font = `bold ${grootte}px Arial, sans-serif`;
      return context.measureText(tekst).width;
    }
    breedte = Math.ceil(Math.max(
      110,
      meet(titel, titelGrootte) + 24,
      ...rijen.map(({naam, waarde}) =>
        tekstX + Math.max(meet(naam, naamGrootte), meet(waarde, waardeGrootte)) + 12)
    ));
  }
  const hoogte = 20 + rijen.length * rijHoogte;
  const kleuren = ["#cc0000", "#8B6914", "#888888"];
  const maakElement = (tag, attributen) => {
    const element = svg.ownerDocument.createElementNS(svg.namespaceURI, tag);
    for (const [naam, waarde] of Object.entries(attributen)) element.setAttribute(naam, waarde);
    return element;
  };
  const groep = maakElement("g", {
    class: "kaart-top3", transform: `translate(${x} ${y}) scale(${schaal})`,
    "font-family": "Arial,sans-serif", "font-weight": "bold"
  });
  function tekst(waarde, attributen) {
    const element = maakElement("text", attributen);
    element.textContent = waarde;
    groep.appendChild(element);
    return element;
  }

  groep.appendChild(maakElement("rect", {
    width: breedte, height: hoogte, rx: 6, fill: "white",
    "fill-opacity": 0.88, stroke: "#cccccc", "stroke-width": 0.8
  }));
  tekst(titel, {x: breedte / 2, y: 14, "text-anchor": "middle", "font-size": titelGrootte, fill: "#003366"});

  rijen.forEach(({rang, naam, waarde}, index) => {
    const ry = 22 + index * rijHoogte;
    const kleur = kleuren[rang - 1];
    groep.appendChild(maakElement("circle", {cx: 18, cy: ry + 12, r: 12, fill: kleur}));
    tekst(rang, {x: 18, y: ry + 17, "text-anchor": "middle", "font-size": 13, fill: "white"});
    tekst(naam, {class: "kaart-top3-station", x: tekstX, y: ry + 10, "font-size": naamGrootte, fill: "#222222"});
    tekst(waarde, {class: "kaart-top3-waarde", x: tekstX, y: ry + 24, "font-size": waardeGrootte, fill: kleur});
  });

  return {groep, grenzen: {l: x, t: y, r: x + breedte * schaal, b: y + hoogte * schaal}};
}
