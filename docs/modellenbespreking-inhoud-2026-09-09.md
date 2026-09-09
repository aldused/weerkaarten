# Inhoudelijke verbetering modellenbespreking

De generator schrijft voortaan afzonderlijke modelbeoordelingen met een concrete periode, onderbouwde vergelijking, betekenis voor Nederland en verwijzingen naar beschikbare bronnen. Dagteksten kunnen daarnaast een beknopte onzekerheid met het mogelijke gevolg bevatten. De bestaande feedvelden blijven behouden; de vernieuwde pagina ondersteunt zowel bestaande edities als schema versie 2.

## Herstelde problemen

- De verificatiepass kreeg alleen kaarten en feiten. Auteur en verifier krijgen nu hetzelfde volledige bronpakket, inclusief KNMI en DWD.
- Referentieteksten werden na 5.000 tekens afgekapt; de DWD-modelvergelijking stond regelmatig verderop. De volledige beschikbare brontekst wordt nu meegenomen, met een bovengrens van 64.000 tekens tegen onbedoelde pagina-inhoud.
- Actualiteit werd beoordeeld op ophaaltijd. De echte KNMI-uitgifte in Nederlandse tijd en DWD-uitgifte in UTC worden nu gebruikt. Onbekende, te oude of toekomstige uitgiften worden uitgesloten en zichtbaar geregistreerd. De beschreven geldigheidsperiode wordt daarnaast door de tekstcontrole beoordeeld.
- Windstoten en CAPE gebruikten alleen de uren 08–19. De maxima worden nu over het etmaal berekend, inclusief avond en nacht. Ontbrekende windstoten worden niet als nul behandeld.
- Een kaartmoment om 12 UTC mocht eerder een uitspraak over de hele dag bepalen. De prompts wegen nu ook dagfeiten en actuele guidance mee en behouden expliciete verschillen tussen ECMWF en KNMI/HARMONIE.
- Ensemble-informatie onderscheidt P10–P90, het aantal bruikbare leden en het aandeel natte leden op het punt De Bilt per UTC-etmaal. Geen automatische vertaling naar een landelijke regenkans.

## Controle

- `python3 -m unittest discover -s tests -p 'test_guidance_editorial.py'`: zes regressietests geslaagd, waaronder uitgiftetijd/zomertijd, complete brontekst, uitsluiting van oude bronnen, bronverwijzingen, windstoot-eenheden en nachtelijke pieken.
- `node tests/modellenbespreking-regressions.cjs`: oude en nieuwe feeds, bronstatus, ontbrekende velden, geldigheidsdatums, kaartkoppeling en JavaScript-syntaxis gecontroleerd.
- Bash-syntaxis en alle ingebedde Python-blokken gecontroleerd.
- De echte Python-blokken voor bronpakket, verificatieprompt en definitieve feed zijn uitgevoerd in een tijdelijke testmap. Volledige DWD-tekst aanwezig in beide prompts; modelbeoordeling en dagonzekerheid blijven behouden in de uitvoer. Hierbij is geen taalmodel of upload uitgevoerd.
- Browsercontrole op brede en mobiele weergave: geen horizontale overloop, dagkeuze werkt, drie modelonderwerpen zichtbaar, dagonzekerheid zichtbaar en geen consolefouten.

## Lokaal redactioneel voorbeeld

Voorbeeld: `http://127.0.0.1:8767/demo_ecmwf_guidance.html`.
Bestanden: `/Users/aldus/KNMI_Project/artifacts/modellenbespreking-inhoud-2026-09-09/preview/`.

De herschreven voorbeeldtekst is gebaseerd op de vastgelegde editie van 8 september en is nadrukkelijk geen nieuwe actuele verwachting. De KNMI-kaartenset met analyse 9 september 00 UTC is toegevoegd, inclusief de prognoses voor donderdag 10 september 00 en 12 UTC. De nieuwere kaartenset wordt apart gemeld. Beide kaarten laden, worden aan de juiste dag gekoppeld en kunnen worden vergroot; de opdruk van de 12-UTC-kaart is visueel gecontroleerd.

De productiepagina gebruikt de kaarten van haar opgehaalde editie. Als daar voor een dag wel andere kaarten maar geen KNMI-kaart beschikbaar zijn, staat dat expliciet vermeld. KNMI-kaarten worden uitsluitend via hun geldigheidsdatum gekoppeld.

Deze wijzigingen zijn lokaal aangebracht en nog niet gepusht. De verbeterde instructies zijn technisch getest; de kwaliteit van een volgende automatisch gegenereerde volledige editie is hiermee niet al beoordeeld. Bestaande externe bronbestanden en publicatiebestanden zijn tijdens deze controle niet vervangen.

## Herstel volledig kaartenaanbod

Op verzoek zijn ook de zes Bracknell-kaarten, negen ECMWF-overzichtskaarten en drie ENS-clusterkaarten in het lokale voorbeeld hersteld. De openbare feed is opnieuw opgehaald en heeft dezelfde uitgifte en ECMWF-basisrun als het redactionele voorbeeld. De kaartbestanden zijn lokaal vastgelegd en als PNG gecontroleerd.

ECMWF staat bij de bijbehorende dag, naast KNMI. Het overzicht met Bracknell en overige bronkaarten staat standaard open; vanuit de dagkaarten loopt een directe link naar Bracknell. Dit zichtbaarheidsherstel is ook in de productiecode opgenomen. Browsercontrole bevestigt drie geladen kaarten bij donderdag 10 september (ECMWF plus twee KNMI), zes Bracknell-kaarten en werkende vergroting voor beide bronnen. De opdruk van ECMWF bevestigt 10 september 12 UTC met run 8 september 00 UTC. De geopende Bracknell-kaart is geldig op 9 september 06 UTC; er wordt geen onbevestigde dagkoppeling uit de bestandsstap afgeleid.
