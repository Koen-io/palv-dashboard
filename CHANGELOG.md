# Wijzigingen

## 1.20.0

### In de lucht: waar vliegt de eenheid?
- Bij elke eigen eenheid staat nu de plaats, met klein erboven "boven" als hij boven die woonplaats vliegt, of anders afstand en richting tot de dichtstbijzijnde woonplaats ("4 km NO van" Bunnik). Ook boven zee ("15 km W van" Den Helder). In een smalle widget staat de plaats onder de roepnaam
- Werkt zonder internet: alle 2.503 Nederlandse woonplaatsen met hun grenzen zitten in het dashboard (PDOK, BAG)

## 1.19.0

### Zoek & Plan: eenvoudiger in gebruik
- Eén gereedschap tegelijk, bovenin en in het paneel Gereedschap gelijk: kies je er bovenin een, dan opent het paneel op hetzelfde gereedschap, en andersom. Zoekpatroon, orbit en actieradius plaats je nu ook met een klik op de kaart
- Een balk bovenin de kaart zegt wat een klik doet zolang een gereedschap aan staat, met een knop Klaar (of Esc)
- Lijst "Op de kaart" linksonder: alles wat je hebt gemaakt (route, meetlinten, ringen, zoekpatroon, orbit, actieradius), nieuwste bovenaan met tijd. Klik om het te tonen, de prullenbak om het weg te halen, of alles in één keer
- Bij elk gemaakt object een prullenbakje op de kaart, en "Ongedaan maken" als je iets per ongeluk weggooit
- Meerdere meetlinten tegelijk
- Een klik op de kaart toont de coördinaat, met daaronder het dichtstbijzijnde adres op land en hoe ver en in welke richting dat ligt; ook op zee
- Profiel: alles onder "Deze vlucht" is ingeklapt, met een zoekveld dat de onderdelen opent waarin staat wat je zoekt (bijvoorbeeld VNE, hoist of wind)
- "Wie is er het snelst": schakelaar Wind meerekenen, met bij elk toestel ook de tijd zonder wind
- Bronnen, sleutels, offline kaarten en het profielbestand staan nu onder Instellingen › Zoek & Plan

## 1.18.0

### Nieuw in Zoek & Plan
- Brandstofberekening volgens het BOM Deel A: start/taxi + trip + 5 % contingency + uitwijk + eindreserve + extra, tegen de brandstof aan boord, met wat er over is of tekort komt
- Eindreserve per vluchtsoort: 20 minuten op beste bereiksnelheid bij VFR dag, 30 minuten op holdingsnelheid bij VFR nacht, boven zee en IFR, en nooit minder dan de vaste P-ALV-waarde. Beide getallen staan erbij
- Vluchtsoort automatisch (dag of nacht volgens de UDP, boven zee als de route naar een platform gaat) of zelf te kiezen; uitwijkhaven te kiezen uit de velden rond de bestemming, met waarschuwing als die vereist is; geïsoleerde offshore-bestemming voor de AW139 (dan een PNR)
- Brandstofsoort JET A-1 of JP-8 met de dichtheid uit het BOM, en de brandstofopbouw ook op de kniebord-PDF
- Waarschuwingen voor vliegtijd boven 6 uur per dienst en voor de minimumhoogtes (300/200 ft, 1000 ft boven zee)
- Massacalculator met de standaardmassa's uit het BOM, die met één klik het vlieggewicht van de vlucht invult
- Helidek: de dekkaart vult zich met wat openbaar is (dekhoogte, frequenties), en toont de wind op het dek nu: nadering tegen de wind in binnen of buiten de obstakelvrije sector, componenten langs de dek-heading, de rotorlimiet en de offshore-regels uit de eigen documenten
- Knoppen naar de officiële AIP van LVNL (geldende AIRAC-cyclus) bij elk vliegveld, elk luchtruim en in de briefing, en naar de ICAO-kaart 1:500.000

### Verbeterd
- Windgegevens: alle schermen samen blijven ruim onder de limieten van Open-Meteo (70 % per dag, 60 % per uur, 50 % per minuut); de schermen vertellen elkaar hoeveel ze gebruikt hebben. Wind langs de route wordt per 0,25° gevraagd en niet meer tijdens het slepen van routepunten. Bij een drukke server wordt het na een minuut opnieuw geprobeerd

## 1.17.0

### Nieuw: tabblad Zoek & Plan
- Navigatie en vluchtplanning voor EC135 en AW139 op één kaart. Kies het profiel bovenin: snelheden, VNE, verbruik, bereik en windlimieten in het hele tabblad volgen het gekozen toestel
- Zoekbalk met aanvullen tijdens het typen: adressen, plaatsen, postcodes en hectometerpalen in Nederland, plaatsen in de hele wereld, alle vliegvelden en heliports (ook op ICAO-code), platforms, favorieten en coördinaten in elk formaat (graden, RD, MGRS)
- Route bouwen: punten klikken, slepen en invoegen. Navigatielog per stuk met koers (magnetisch of waar), wind op vlieghoogte op het moment dat je er bent, windcorrectie, grondsnelheid, ETE/ETA en brandstof. Met de muis over de route: afstand vanaf het vertrek en tot het eind, tijd, wind met kop- en dwarswind, en brandstof op dat punt
- Point of no return en point of safe return, eindreserve en waarschuwingen voor VNE, gewicht, brandstof en wind
- Meetlint A→B (kortste lijn met maatstreepjes), afstandsringen met kompasroos, in NM of km
- Wind zoals op Windy: stromingslijnen, kleurvlak of windveren, vijf hoogtes en de komende 12 uur, wereldwijd
- Luchtruim per soort aan en uit (CTR, TMA, TMZ, RMZ, P/R/D, TRA/TSA en meer) met hoogtegrenzen, meldpunten, bakens, vliegvelden, ziekenhuishelipads en obstakels (openAIP), en de VFR-kaart van openFlightMaps
- Alle platforms in Nederland en grote delen van de wereld (NLOG, Rijkswaterstaat, Denemarken, Noorwegen, VK, Golf van Mexico, OpenStreetMap) met per platform alle openbare gegevens en een eigen dekkaart voor heading, dekhoogte, D/t-waarde en frequenties
- Live vloot op de kaart met vooruitprojectie, en "Wie is er het snelst" naar een punt
- Zoekpatronen (uitdijend vierkant, sector, kruipende lijn, parallelle banen), orbitplanner met helling in wind, actieradius met wind
- Briefing: doorkruist luchtruim, verticaal profiel, weer langs de route getoetst aan de BOM-minima, SIGMET's, licht bij vertrek en aankomst. Exporteren als kniebord-PDF, GPX of KML
- Eigen profielen uit RFM en SOP, dekkaarten, routes en favorieten gaan vanzelf mee naar de andere schermen van de eenheid. Bekeken kaarten blijven 30 dagen bewaard voor gebruik zonder internet

## 1.16.0

### Nieuw
- Eén ophaler voor alle schermen: draaien er meer dashboards, dan haalt er maar één het live verkeer op (het scherm waarvan adsb.fi het best werkt) en krijgen de andere elke ronde direct van dat scherm door. De bronnen worden daardoor niet vaker gevraagd dan met één scherm en gaan niet weigeren of blokkeren
- Geen merkbare vertraging: de andere schermen houden een open verbinding met de ophaler en krijgen elke wijziging op het moment dat die binnenkomt, met alleen de toestellen die veranderd zijn
- Automatische overname: valt de ophaler weg, dan haalt een ander scherm meteen zelf op (binnen een halve seconde, of 2,5 seconden als de ophaler vastloopt zonder af te sluiten). Raakt de ophaler adsb.fi kwijt terwijl een ander scherm het nog wel heeft, dan neemt dat scherm het over. De kaart blijft intussen gevuld
- De ophaler haalt ook het gebied en de eigen eenheden van de andere schermen op
- Vluchtradar en "In de lucht" tonen "via" met de naam van het scherm dat ophaalt; het schermoverzicht toont per scherm of het zelf ophaalt, met wie het deelt of van wie het ontvangt

### Verbeterd
- Posities van adsb.lol en OpenSky gaan direct naar het scherm, in plaats van bij de volgende ronde

## 1.15.1

### Opgelost
- Noodsquawk: geen valse meldingen meer. Alleen squawk 7500, 7600 of 7700 telt, en pas als die minstens 30 seconden en in minstens 5 berichten is gezien, zonder gewone squawk ertussen. Losse verminkte berichten en de losse noodstatus uit ADS-B (zoals NORDO of DOWNED zonder squawk) geven geen melding meer
- Noodsquawk: de melding bovenin geldt alleen nog voor toestellen in FIR Amsterdam (het Nederlandse luchtruim, volgens de AIP). Buiten de FIR wordt een bevestigd toestel alleen op de Vluchtradar rood
- Noodsquawk: een melding verdwijnt zodra het toestel twee keer een gewone squawk uitzendt, in plaats van anderhalve minuut te blijven staan
- Vluchtradar en "In de lucht" kleuren een toestel alleen nog rood bij een bevestigde noodsquawk
- De nachtelijke verversing om 04:00 werd tegengehouden, waardoor het logboek een uur lang elke seconde een regel kreeg. De verversing gaat nu via het programma zelf en wordt maar één keer gevraagd

## 1.15.0

### Nieuw
- OpenSky Network als reserve voor de Vluchtradar, "In de lucht" en de noodsquawkbewaking: leveren adsb.fi en adsb.lol langer dan 5 seconden niets, dan springt OpenSky bij. De Vluchtradar toont dan RESERVE
- Instellingen › Live verkeer: OpenSky-sleutel invullen en het dagbudget volgen. De sleutel blijft alleen op deze computer
- Strikte budgetbewaking: elke aanvraag kost 1 credit, het tempo volgt het resterende saldo van het account (gedeeld door alle schermen), stop bij 300 resterend en per scherm nooit meer dan 3600 per dag

### Verbeterd
- adsb.lol wordt niet vaker dan elke 5 seconden gevraagd, ook niet als het adsb.fi vervangt; dat voorkomt de reeksen weigeringen
- adsb.fi wordt net onder de toegestane één keer per seconde gevraagd, en na een blokkade van het adres steeds langer met rust gelaten (tot eens per 30 minuten)
- Posities van OpenSky schuiven op de kaart langer door en vervagen later, omdat ze minder vaak binnenkomen

## 1.14.2

### Opgelost
- Mac: automatische updates stonden uit, omdat de Mac-build de GitHub-koppeling niet meenam

## 1.14.1

### Verbeterd
- Vluchtradar: blokkeert een bron het internetadres (HTTP 403), dan wacht het dashboard tot 10 minuten tussen pogingen, zodat de blokkade vanzelf verloopt; de andere bron neemt het intussen over
- Schermoverzicht: een Mac toont zijn eigen computernaam; testvensters melden zich niet meer aan, en een scherm dat maar kort te zien was verdwijnt na een uur uit de lijst
- Nettere opmaak van de statuspagina-links in het schermoverzicht

## 1.14.0

### Nieuw
- Maan in de kop: fase zoals aan de hemel, percentage verlicht, maanop en maanonder (LT en Z), en het lichtniveau op de grond in lux en millilux
- Versheid op elke widget: groen, oranje of rood bolletje met de tijd en de leeftijd van de gegevens
- Noodsquawk-alarm: 7500, 7600 en 7700 van al het verkeer boven Nederland, met "Toon op radar" en geluidssignaal
- Temperatuur en dauwpunt: verschil (Δ), relatieve vochtigheid en waarschuwing voor kans op mist
- Automatische updates via GitHub, gecontroleerd met SHA-256, met aftelling en uitstelknop
- Schermoverzicht: welke dashboards draaien, ook via Tailscale, met statuspagina voor de browser
- OLED-bescherming: onzichtbaar meeschuivend beeld, verdwijnende muisaanwijzer en nachtelijke dimming
- Automatische reservekopieën van de indeling, terug te zetten onder Instellingen › Indeling
- Logboek van de laatste 14 dagen en automatisch herstel na een crash of vastloper
- Scherm blijft altijd aan (geen slaapstand of schermbeveiliging)

### Opgelost
- Vluchtradar: "geen verbinding" na lang draaien. Er konden meerdere ophaalrondes tegelijk ontstaan die de bronnen overbelastten; nu is er altijd precies één, met een regelaar per bron
- Baangebruik leest mee uit de live-feed in plaats van de bronnen extra te belasten
- Een import met app-tegels die programma's starten vraagt eerst om bevestiging
