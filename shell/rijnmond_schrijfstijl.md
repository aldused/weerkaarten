# Eigen schrijfstijl voor de regioverwachting

De taalredactie gebruikt `rijnmond_redactie_prompt.md` en optioneel
`rijnmond_stijlvoorbeelden.json` in dezelfde map. Het JSON-bestand is een lijst
van maximaal twintig eigen weerberichten (strings), bij voorkeur tien tot
twintig gevarieerde, goedgekeurde teksten. Een lege lijst gebruikt de algemene
stijl; er staan bewust geen verzonnen auteursvoorbeelden in.

De actuele verwachting blijft gescheiden van de stijlvoorbeelden. De bestaande
validator keurt herschreven dagdelen af bij bepaalde inhoudelijke afwijkingen
en valt dan terug op de oorspronkelijke tekst. Dit is geen volledige semantische
controle; beoordeel proefberichten redactioneel voordat taalredactie live gaat.

De scheduler is op 15 oktober 2026 aangezet met RIJNMOND_REDACTIE=claude.
De acht bestaande uitgiftetijden blijven behouden. Claude wordt eerst geprobeerd;
bij uitval wordt de bestaande Codex-reserve gebruikt. Het pad naar de huidige
gebundelde Codex CLI is hersteld en kan via CODEX_BIN worden overschreven.
De proefrun op de uitgifte van 16.00 uur slaagde via Codex: zeven dagdelen,
geen afkeuringen. Claude meldde bij deze controle onvoldoende tegoed.
