# P-ALV Dashboard

Operationeel dashboard voor de Police Air Support Unit: een desktop-app (Windows en macOS) voor een groot scherm in de meldkamer of hangar. Het dashboard draait dagen achter elkaar onbeheerd.

## Wat het toont

- **Kop:** klokken (LT en UTC), uniforme daglichtperiode (UDP), maan (fase, maanop en -onder, lichtniveau in lux en millilux) en het luchtvaartweer van Schiphol met de spreiding tussen temperatuur en dauwpunt.
- **Vluchtradar:** eigen live-kaart van al het ADS-B-verkeer (adsb.fi en adsb.lol), met categorieën, routes, kaartlagen en een noodsquawk-alarm.
- **Weerradar:** Windy met METAR- en TAF-stations, getoetst aan de BOM-weerminima.
- **Baangebruik Schiphol** (per vlucht van de Schiphol-radar via de BAS-flighttracker, live ADS-B als terugval) en **In de lucht** (eigen eenheden), live waargenomen.
- **Zoek & Plan:** navigatie en vluchtplanning voor EC135 en AW139: zoeken met aanvullen, routes met wind en brandstof, meetlint, afstandsringen, luchtruim (openAIP), platforms, live vloot, zoekpatronen, orbit, actieradius en briefing. De eigen cijfers uit vlieghandboek en SOP staan niet in deze code maar in een privébestand op het scherm (`plan-private.json`).
- Versheidsbolletje op elke widget: groen, oranje of rood, met tijd en leeftijd van de gegevens.

## Beheer

- **Updates:** elke 30 minuten wordt gekeken naar de [releases](../../releases). Een nieuwe versie wordt gedownload, met SHA-256 gecontroleerd en automatisch geïnstalleerd.
- **Schermoverzicht:** dashboards in hetzelfde netwerk of via Tailscale zien elkaar. Elk dashboard heeft een statuspagina op `http://<adres>:47800/` (alleen-lezen, alleen bereikbaar vanaf privé- en Tailscale-adressen).
- **Betrouwbaarheid:** het scherm blijft altijd aan, het dashboard herstelt zichzelf na een crash, de indeling heeft automatische reservekopieën, en er is een logboek van 14 dagen en OLED-bescherming.

## Ontwikkelen

```bash
npm install
npm start            # starten
npm run check        # lint en tests (draaien ook vóór elke build)
npm run dist         # Windows-installer
npm run dist:mac     # macOS-installer en update-archieven (bouwt op elk platform)
npm run release      # publiceren als GitHub-release
```

Met `npx electron . --user-data=<map>` draai je op een aparte configuratie, zonder de echte indeling te raken.

Dit dashboard is een hulpmiddel voor situationeel overzicht. Het vervangt geen officiële briefing- of vluchtvoorbereidingsbronnen.
