# Nieuwe pagina’s en Mijn Weerlab

De opslagserver gebruikte een ingebouwde kopie van de productlijst. Alleen de
statische site publiceren ververste die kopie niet. `live-catalog.mjs` leest nu
maximaal eenmaal per minuut de vaste officiële GitHub-bron `menu-data.js`.
Acorn parseert de bron als AST; uitsluitend letterlijke gegevens in MENU_PRODUCTS
worden overgenomen. De bron wordt niet uitgevoerd. IDs, routes en metadata
worden gecontroleerd; externe/uitvoerbare routes en dubbele IDs worden geweigerd.

De authentieke productlijst wordt zowel bij `/catalog` als bij validatie van
favorieten en bewaarde configuraties gebruikt. De bundel bevat een actuele
reservekopie; bij een bronfout blijft de laatst gevalideerde lijst bruikbaar.
De frontend ververst een onbekend product automatisch en bewaart het daarna
met één klik. Een afgebroken sessie kan geen oude gegevens herstellen. Bestaande
accountkoppeling, revisiecontroles en producttoegang blijven van toepassing.

Bij nieuwe menu-items is geen nieuwe Worker-deploy nodig. De bron-URL staat vast
in de serverconfiguratie; browserinvoer kan deze niet vervangen. De dependency
acorn is vastgezet in package.json. Controle: node --test
mijn-weerlab-worker/tests/*.test.mjs mijn-weerlab-worker/tests/*.test.cjs, plus de
Miniflare-opslag- en beveiligingscontroles.
