# Sneller eerste kaartbeeld en kleinere zoomstappen — 5 oktober 2026

De eerste kaart start met bewolking en regen. Bewolking krijgt een tijdelijke voorweergave van 128 pixels per tegel; na het complete eerste beeld worden dezelfde tegels met 256 pixels vervangen. De definitieve interpolatie, modelwaarden en kleuren blijven behouden. Losse pixelcaches voorkomen dat een voorweergave als definitieve tegel wordt hergebruikt; verwijderde tegels annuleren ook hun verfijning. Mist, sneeuw, onweer, plaatswaarden en isobaren volgen na het primaire beeld. Latere tijdwissels blijven atomair. Voorbereiding van buurbeelden en significant weer wacht op de eerste verfijningen, zodat die downloads niet concurreren.

Zoomknoppen en toetsen gebruiken kwartniveaus (circa 19% vergroting); de muiswielsnelheid is viermaal lager. Regionale en modeluitsneden blijven passend berekend. De reserve voor canvaswerk wanneer het compositorframe uitblijft is verkort van 120 naar 32 ms.

## Controle

266 kaarttests en de verplichte publicatiecontroles voor historische records slagen. Browsercontrole op 3200 × 1442 met actuele ECMWF-data: oorspronkelijke versie met gevulde cache eerste zichtbare weerlaag 1368 ms, primaire kaart gereed 8405 ms; aangepaste versie 331 ms en 7625 ms. Dit zijn losse lokale metingen, geen gegarandeerde tijden; de eerste oorspronkelijke meting zonder gevulde cache was 12855 ms tot gereed. Een herhaalde aangepaste meting gaf 15127 ms tot gereed: de volledige laadduur is sterk afhankelijk van browserbelasting. Zoomknop geverifieerd van 6.25 naar 6.50.

De lokale map KNMI_Project/weerlab bevat oudere kaartbronnen dan productie; de wijziging is gebaseerd op de actuele main-bron 3a1006cb.

Na toevoeging van de voorweergave: bij 1280 × 800 oorspronkelijke versie 543 ms tot eerste laag en 4389 ms tot gereed, aangepaste versie 246 ms en 3695 ms. In de DOM waren na afloop alle 300 weertegels 256 pixels breed; geen 128-pixelvoorweergaven bleven achter. Volgende tijdstap gecontroleerd. Op het grote scherm blijven de tijden variabel; voorweergave metingen 4077 ms en 14441 ms.
