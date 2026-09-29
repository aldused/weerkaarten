# Lopende temperaturen in de dagrecords

De tienminutenpatcher werkte alleen maanddetail en tussenstanden bij. Nu worden
ook de dagranglijsten TX/TN/TG hoog en laag voor vandaag bijgewerkt. De jaartelling
gebruikt diezelfde lijsten. Evenaringen blijven aan de eerste recorddatum gekoppeld.
Een voorlopig record kan gedurende de dag weer verdwijnen; historische rijen
worden uit maanddetail aangevuld zodat ook de oude nummer 26 kan terugkeren.
De dagrecordlijst markeert vandaag als lopend. Ontbrekende API-parameters wissen
geen eerdere metingen. Een schemaversie zorgt dat de eerste update ook bij
ongewijzigde temperaturen de ranglijsten repareert.

## Broncontrole van de publicatieblokkade

De snapshot van 28 september bevatte voor Wijk aan Zee (257) een voorlopige
TN van 18,1 °C op 28-09-2026 als vast historisch minimumrecord. De complete
lokale dagreeks van 29 september geeft voor die dag TN 15,5 °C; maanddetail en
de opnieuw berekende dagranglijst komen overeen. Een gerichte aanvraag bij
de KNMI validated daily-API bevestigt TN 15,5 °C voor station 257 op die dag. De oudere houder is 17,9 °C
op 28-09-2016. Controle van alle 48 recordbronnen bevestigt 17,9 °C als landelijk
record (daarna 17,6 °C bij Hoek van Holland en Den Helder).
Dezelfde broncontrole vond één andere voorlopige referentie: FX-laag op
28 september stond op 1,1 m/s uit 2026. De complete dagreeksen bevestigen
2,0 m/s in Heino op 28-09-1997 als huidige houder. Alleen deze twee foutief
vastgezette voorlopige referenties zijn gecorrigeerd in fixture en baseline; de controles op bronverlies en historische recordverslechtering
blijven ingeschakeld. De ongewijzigde test faalde ook vóór deze reparatie en
blokkeerde daardoor de R2-upload van lopende metingen.

## Tests

`python3 -m unittest discover -s tests -p test_lopend_dagrecords.py` voert de
patcher uit en test vervolgens de echte JavaScript-jaartellingen van beide
pagina’s: nieuw record, terugvallend voorlopig record, evenaring, ontbrekende
parameter en herstel van een uit de ranglijst gedrukte historische waarneming.
Deze tests draaien ook in de websitebuild.

Bij het verwerken van de actuele temperaturen werd het historische record van
29 september ook daadwerkelijk overtroffen. De publicatiecontrole verifieert
daarom dat de Winterswijk-waarneming in de bronnen behouden blijft en dat het
landelijke maximum niet daalt; ze eist alleen in de vaste snapshot dat
Winterswijk nog op de eerste plaats staat. Een echt nieuw record mag de upload
niet blokkeren.
