# PNG van de zichtbare kaart

De knop **PNG** naast Lagen maakt een PNG-voorbeeld van de huidige kaartuitsnede. De gebruiker slaat het beeld op via **Download PNG**. Dit werkt via dezelfde kaartweergave voor alle modellen en voor weer, neerslag, temperatuur en wind.

Met **Gebied** kan de gebruiker met de muis een rechthoek trekken. Menu's verdwijnen tijdelijk; **Maak PNG** exporteert uitsluitend de geselecteerde kaartpixels met dezelfde header/footer. Opnieuw slepen vervangt het kader; **Annuleren** of Escape herstelt de kaart. Kaders kleiner dan 40 × 40 pixels worden niet geaccepteerd. Verplaatsen of formaatwijziging van de kaart annuleert de selectie; automatische modelverversing wacht tot de selectie is afgerond.

Gebiedselectie gecontroleerd met een echte muissleep van 560 × 480 pixels: PNG toont exact die kaartuitsnede zonder selectierand of donkere overlay. Aanvullende tests dekken vier sleeprichtingen, kaartgrenzen, afronding en exacte canvas-broncoördinaten. Totale suite: 194 geslaagde tests.

- Header: model, kaartsoort, gekozen geldigheid en Nederlandse tijdzone.
- Footer: **Ed Aldus · Weerlab**, oorspronkelijke modelrun, verwachtingstermijn, laag-opacity, toepasselijke legenda en bronvermeldingen.
- Alleen de kaartvlakken en plaatsnamen worden samengevoegd: geen menu, bediening of informatievenster. De zoom, uitsnede en zichtbare laag-opacity blijven behouden.
- Uitgeschakelde wolkenlagen ontbreken ook in de legenda. Ontbrekende mist-/wolkenbasisgegevens worden niet verzonnen.
- Laden/fouten blokkeren export met een leesbare melding; er wordt geen lege PNG aangeboden. Satelliettegels gebruiken anonymous CORS. Bij een geblokkeerde achtergrondbron wordt geen onvolledig beeld gedownload.
- De afbeelding wordt lokaal in de browser opgebouwd; er is geen upload of extra dienst. Sluiten geeft de tijdelijke blob vrij en bereidt de volgende animatiestap opnieuw voor.

Publicatie via de bestaande GitHub Pages-route, bovenop de eerder gepubliceerde snelheidsverbeteringen. `npm test`: 191 tests geslaagd; `npm run build`: geslaagd. Browsercontrole: echte ECMWF-PNG met zichtbare header, volledige kaart, legenda en naam; ook export na inzoomen gecontroleerd.
