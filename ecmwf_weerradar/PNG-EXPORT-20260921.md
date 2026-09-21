# PNG van de zichtbare kaart

De knop **PNG** naast Lagen maakt een PNG-voorbeeld van de huidige kaartuitsnede. De gebruiker slaat het beeld op via **Download PNG**. Dit werkt via dezelfde kaartweergave voor alle modellen en voor weer, neerslag, temperatuur en wind.

- Header: model, kaartsoort, gekozen geldigheid en Nederlandse tijdzone.
- Footer: **Ed Aldus · Weerlab**, oorspronkelijke modelrun, verwachtingstermijn, laag-opacity, toepasselijke legenda en bronvermeldingen.
- Alleen de kaartvlakken en plaatsnamen worden samengevoegd: geen menu, bediening of informatievenster. De zoom, uitsnede en zichtbare laag-opacity blijven behouden.
- Uitgeschakelde wolkenlagen ontbreken ook in de legenda. Ontbrekende mist-/wolkenbasisgegevens worden niet verzonnen.
- Laden/fouten blokkeren export met een leesbare melding; er wordt geen lege PNG aangeboden. Satelliettegels gebruiken anonymous CORS. Bij een geblokkeerde achtergrondbron wordt geen onvolledig beeld gedownload.
- De afbeelding wordt lokaal in de browser opgebouwd; er is geen upload of extra dienst. Sluiten geeft de tijdelijke blob vrij en bereidt de volgende animatiestap opnieuw voor.

Publicatie via de bestaande GitHub Pages-route, bovenop de eerder gepubliceerde snelheidsverbeteringen. `npm test`: 191 tests geslaagd; `npm run build`: geslaagd. Browsercontrole: echte ECMWF-PNG met zichtbare header, volledige kaart, legenda en naam; ook export na inzoomen gecontroleerd.
