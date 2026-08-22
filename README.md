# weerkaart
MOS/MIX ECMWF/ICON

## Publicatie

De repository-root is de enige bron voor de website. Cloudflare Pages voert
`cf_build.sh` uit en bouwt `_deploy/` bij iedere publicatie volledig opnieuw op.
Bestanden onder `_deploy/` daarom nooit handmatig aanpassen of als bron voor een
wijziging gebruiken; oude output wordt tijdens de volgende build verwijderd.
