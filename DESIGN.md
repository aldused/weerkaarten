---
version: alpha
name: Weerlab
description: Operationeel weerplatform voor kaarten, modeldata, MOSMIX, satellietbeelden en weerbewaking.
colors:
  primary: "#00205b"
  primary-strong: "#003366"
  primary-soft: "#eff6ff"
  secondary: "#0b3a8a"
  accent: "#2ec4e8"
  accent-strong: "#035e7a"
  background: "#f6f8fb"
  background-soft: "#eef2f7"
  surface: "#ffffff"
  surface-muted: "#f8fafc"
  border: "#e3e8ef"
  border-strong: "#cbd5e1"
  text: "#0f172a"
  text-muted: "#64748b"
  text-soft: "#94a3b8"
  success: "#10b981"
  warning-yellow: "#e6b800"
  warning-orange: "#e07000"
  danger: "#cc0000"
  weather-blue: "#1d4ed8"
  weather-teal: "#0d9488"
  probability-purple: "#6d28d9"
typography:
  headline-lg:
    fontFamily: DM Sans
    fontSize: 22px
    fontWeight: 700
    lineHeight: 1.2
    letterSpacing: 0px
  headline-md:
    fontFamily: DM Sans
    fontSize: 16px
    fontWeight: 700
    lineHeight: 1.25
    letterSpacing: 0px
  body-md:
    fontFamily: DM Sans
    fontSize: 14px
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: 0px
  body-sm:
    fontFamily: DM Sans
    fontSize: 12px
    fontWeight: 400
    lineHeight: 1.45
    letterSpacing: 0px
  label-md:
    fontFamily: DM Sans
    fontSize: 13px
    fontWeight: 600
    lineHeight: 1.25
    letterSpacing: 0px
  label-caps:
    fontFamily: DM Sans
    fontSize: 10px
    fontWeight: 700
    lineHeight: 1.1
    letterSpacing: 0.1em
  data-sm:
    fontFamily: DM Mono
    fontSize: 12px
    fontWeight: 500
    lineHeight: 1.35
    letterSpacing: 0px
rounded:
  none: 0px
  sm: 4px
  md: 8px
  lg: 12px
  xl: 16px
  full: 9999px
spacing:
  xs: 4px
  sm: 8px
  md: 16px
  lg: 24px
  xl: 32px
  xxl: 48px
  sidebar-width: 240px
  content-max: 1400px
components:
  shell-sidebar:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text}"
    borderColor: "{colors.border}"
    width: "{spacing.sidebar-width}"
  shell-sidebar-dark:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.surface}"
    borderColor: "{colors.secondary}"
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.surface}"
    rounded: "{rounded.md}"
    typography: "{typography.label-md}"
    padding: 8px 14px
  button-primary-hover:
    backgroundColor: "{colors.primary-strong}"
  button-accent:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.primary}"
    rounded: "{rounded.md}"
    typography: "{typography.label-md}"
    padding: 8px 14px
  card:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text}"
    borderColor: "{colors.border}"
    rounded: "{rounded.md}"
    padding: "{spacing.md}"
  panel-header:
    backgroundColor: "{colors.primary-strong}"
    textColor: "{colors.surface}"
    typography: "{typography.label-md}"
    padding: 10px 14px
  data-table-header:
    backgroundColor: "{colors.primary-strong}"
    textColor: "{colors.surface}"
    typography: "{typography.body-sm}"
  warning-green:
    backgroundColor: "#1a7a1a"
    textColor: "{colors.surface}"
  warning-yellow:
    backgroundColor: "{colors.warning-yellow}"
    textColor: "#333333"
  warning-orange:
    backgroundColor: "{colors.warning-orange}"
    textColor: "{colors.surface}"
  warning-red:
    backgroundColor: "{colors.danger}"
    textColor: "{colors.surface}"
---

# Weerlab Design System

## Overview

Weerlab is een compact, betrouwbaar en datarijk weerplatform. De interface moet aanvoelen als een operationele werkplek voor meteorologische kaarten, verwachtingen, MOSMIX-tabellen, satellietbeelden en weerbewaking: rustig, snel scanbaar, precies en zonder marketinglaag.

De visuele stijl is technisch maar toegankelijk. Gebruik heldere informatiehierarchie, sterke leesbaarheid, consequente navigatie en compacte componenten. De gebruiker moet op elk scherm snel kunnen zien welk model, gebied, tijdstip en parameter actief zijn.

## Colors

De kleurtaal is gebaseerd op donker weerkundig blauw, witte en lichtgrijze werkvlakken, en een helder cyaan accent.

- **Primary (#00205b):** Weerlab-blauw voor hoofdnav, actieve context, kopbalken en primaire merkherkenning.
- **Primary Strong (#003366):** Dieper blauw voor tabelkoppen, downloadknoppen en compacte werkbalken.
- **Accent (#2ec4e8):** Cyaan voor actieve randen, subtabs, gekozen lagen en kleine statusaccenten.
- **Background (#f6f8fb):** Koele lichtgrijze pagina-achtergrond die kaarten en tabellen laat ademen.
- **Surface (#ffffff):** Panelen, kaarten, formulieren en documentvlakken.
- **Warning colors:** Gebruik groen, geel, oranje en rood uitsluitend voor KNMI-waarschuwingsniveaus, validatie en risico-aanduiding.
- **Probability Purple (#6d28d9):** Alleen voor kansproducten zoals neerslagkans, niet als generieke accentkleur.

## Typography

Gebruik **DM Sans** voor de applicatieshell, dashboards en gewone UI. Gebruik **DM Mono** spaarzaam voor technische waarden zoals lead times, timestamps, stationscodes en korte numerieke labels.

Koppen blijven compact. Weerlab-schermen bevatten veel informatie; hero-typografie en grote marketingkoppen passen niet bij het product. Labels mogen vet zijn, maar vermijd zware typografie in grote blokken tekst.

## Layout

De standaard layout is een vaste of sticky sidebar met een flexibel hoofdvlak. Desktop-schermen mogen breed zijn tot ongeveer 1400px, met compacte panels en genoeg ruimte voor kaarten, canvaslagen en tabellen.

Gebruik een 4px/8px spacingritme. Houd bedieningselementen dicht bij de data die ze beinvloeden: modelkeuze, parameterkeuze, tijdslider en legenda horen bij de kaart of grafiek, niet ver weg in een losse sectie.

Mobiel mag vereenvoudigen, maar moet operationeel blijven: navigatie inklapbaar, panels onder elkaar, tabellen horizontaal scrollbaar waar nodig.

## Elevation & Depth

Weerlab gebruikt vooral tonale lagen, lijnen en contrast. Schaduwen zijn subtiel en functioneel. Gebruik geen zware floating-card look voor hele pagina's.

Panelen mogen een lichte rand en kleine schaduw hebben. Kaarten, satellietbeelden en grafieken moeten visueel voorrang krijgen boven decoratieve diepte.

## Shapes

Gebruik kleine radii. Standaard cards en inputs gebruiken 4px tot 8px. Grotere radii zijn alleen geschikt voor badges, pills en compacte statuslabels.

Combineer scherpe datatabellen niet met extreem ronde controls in hetzelfde scherm. De vormtaal moet precies en instrumenteel blijven.

## Components

**Sidebar:** De sidebar is de primaire routekaart door Weerlab. Groepeer items per domein, toon actieve items duidelijk, en gebruik compacte labels. Badges zoals "nieuw" zijn klein, helder en niet schreeuwerig.

**Topbar:** De topbar toont context: pagina, gebied, actualiteit en snelle acties. Houd tekst kort en scanbaar.

**Buttons:** Primaire acties zijn donkerblauw. Accentknoppen zijn schaars en bedoeld voor actieve of nieuwe functies. Download, export en terug-acties mogen compact zijn.

**Subtabs and chips:** Gebruik subtabs voor productvarianten zoals MOSMIX-landen, kaarttypen en tijdresoluties. Actieve tabs hebben primary of accent, inactieve tabs blijven licht.

**Data tables:** Tabellen zijn compact, met duidelijke koprijen, voldoende contrast en rustige celranden. Numerieke waarden moeten makkelijk vergelijkbaar zijn.

**Maps and canvases:** Kaarten en modelcanvassen zijn inhoud, geen decoratie. Zorg voor duidelijke legenda's, actieve parameterstatus, looptijd/leadtime en update-informatie.

**Warnings:** Waarschuwingskleuren behouden hun semantische betekenis. Gebruik geel, oranje en rood niet voor gewone navigatie of marketingaccenten.

**Weerbewaking documents:** Documentweergaven mogen formeler zijn dan de algemene app-shell. Gebruik donkerblauwe koppen, heldere tabellen en print/PDF-vriendelijke contrasten.

## Do's and Don'ts

- Do keep screens compact, data-first and immediately useful.
- Do show active model, valid time, lead time and data source near the visualization.
- Do use the primary blue for navigation, headers and core actions.
- Do reserve warning colors for real warning/status meaning.
- Do use DM Mono only for technical or numeric metadata.
- Don't create marketing-style hero sections for operational pages.
- Don't use decorative gradient blobs, large illustrations or atmospheric filler.
- Don't make entire pages look like nested cards.
- Don't introduce a new accent color unless it maps to a weather product or status meaning.
- Don't hide legends, timestamps or model names behind hover-only UI.
