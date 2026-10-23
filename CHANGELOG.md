# Wijzigingen

## 1.27.0

### Luchtvaartweer: de wolkenbasis volgens het BOM
- Het Schiphol-blok in de kop toonde als **Wolken** de eerste BKN- of OVC-laag (het ICAO-plafond). Bij *FEW008 SCT010 BKN018* stond er dus **BKN 1800 ft**, terwijl de wolkenbasis volgens het BOM (Deel A §8.2.4.1, note 1: een laag van 3/8 of meer) **SCT 1000 ft** is. Dat is hersteld: het vak heet nu **Wolkenbasis** en toont de laagste laag van SCT of meer
- Onder de wolkenbasis staan **alle gemelde lagen**, laagste eerst (*FEW 800 · SCT 1000 · BKN 1800*). Een FEW-laag onder de basis kleurt oranje: die telt volgens het BOM niet als wolkenbasis, maar wel bij Single pilot EC en Advanced Operations ("geen bewolking incl. FEW")
- Alleen FEW gemeld: wolkenbasis **Geen**, met de FEW-laag eronder. Alleen verticaal zicht: **VV** met de hoogte. Niet gemeten: **Niet gemeten** (stond voorheen ten onrechte als NSC)
- **BOM-toetsing van het moment** in de kop: naast de vliegcategorie staan chips per BOM-profiel dat nu geldt. Overdag (binnen UDP) *Multi pilot* en *Single pilot*, ’s nachts (buiten UDP) *Unaided*, *Aided*, *Advanced* en *SP buiten UDP*. Groen binnen de minima, oranje marginaal of volgens de trend binnen 2 uur eronder, rood erbuiten, grijs geen oordeel. Ze schakelen op de UDP-grenzen direct om; de muis erover geeft de minima uit de tabel en de trend
- **QNH** en het **actuele weer** vielen in de kop rechts buiten beeld; het weer (bijvoorbeeld *-RADZ*) staat nu onder het zicht, met de betekenis in de tooltip, en de QNH is weer te zien

### Weer-tabblad: METAR-widgets
- Elke METAR/TAF-widget heeft in de titelbalk een **stationskeuze**: alle luchthavens (Schiphol, Rotterdam, Eindhoven, Groningen Eelde, Maastricht, Lelystad), de militaire vliegbases (De Kooy, Leeuwarden, Volkel, Gilze-Rijen, Woensdrecht, Deelen), Vlieland en Vlissingen, de Noordzeestations (Euro Platform, Lichteiland Goeree, de platforms en de heliports van de windparken) en de stations net over de grens. Een station dat nieuw in de feed verschijnt komt er vanzelf bij
- Kies je een ander station, dan verandert de titel mee en wordt de keuze bewaard
- De widget is opnieuw opgezet als **nette kaart**: station en vliegcategorie met de waarnemingstijd, de BOM-chips van het moment, een blok met wind, zicht (met het actuele weer), wolkenbasis (met alle lagen), temperatuur/dauwpunt (met de spreiding) en QNH, en daaronder de METAR en de TAF. Zonder TAF staat dat er eerlijk bij
- Dezelfde wolkenbasis, lagen en BOM-chips als in de kop
- Kop, METAR-widgets, weerradar en Zoek & Plan lezen de METAR nu met **één en dezelfde parser**; ze kunnen elkaar niet meer tegenspreken
- **Zicht** tussen 5 en 10 km staat nu met een decimaal als het niet rond is (*7,5 km* in plaats van *8 km*)
- De trend bij Schiphol gebruikt ook het waargenomen verloop van de laatste uren als de METAR geen trend heeft en er geen TAF is, net als op de weerradar
- De vliegcategorie (VFR/MVFR/IFR/LIFR) legt in de tooltip uit dat dit de Amerikaanse indeling van aviationweather.gov is en niets zegt over het BOM

### BOM-profielen (weerradar, Zoek & Plan en kop)
- **Single pilot EC buiten UDP** (voorheen "Single pilot (ferry) EC buiten UDP") stond op 1200 ft / 5000 m. Volgens de BOM-tabel (versie 10, revisie 1, 1 oktober 2025) is het **geen bewolking (incl. FEW) onder 1100 ft bij 3000 m zicht**, voor de ferryvlucht (note 5) én de operationele vlucht na 07:00 of na 22:00 LT (note 6). Dat is nu zo
- De namen volgen de tabel: *Single pilot EC Dag*; de volgorde ’s nachts is Unaided, Aided, Advanced, SP buiten UDP
- Instellingen › Systeem legt uit hoe de wolkenbasis en de BOM-chips werken

## 1.26.0

### Zoek & Plan: route plannen, eenvoudiger
- **Opslaan** staat nu direct in de naambalk van de route, naast routemodus, omdraaien en wissen. De naam typ je bovenin; zonder naam wordt het *vertrek – bestemming*. Na het opslaan staat er een groen **Opgeslagen**, tot je de route weer verandert
- De **routepunten** staan bovenaan, direct onder de naam, en niet meer onderaan de pagina
- Elk punt heeft een **greep** (zes puntjes): vasthouden en omhoog of omlaag slepen om de volgorde te wijzigen. Werkt met de vinger op het touchscreen en met de muis; met het toetsenbord kan het met de pijltjes
- De uitlegtekst onder *Tekort* in het brandstofblok is weg
- Het tabblad **Profiel** staat nu helemaal links, voor Route: daar begin je, zodat alle berekeningen daarna kloppen

### Zoek & Plan: briefing
- **Exporteren** staat bovenaan: één grote knop voor het kniebord (PDF), met GPX, KML en Navlog eronder
- **Luchtruim langs de route** en **Verticaal profiel** zijn ingeklapt; het aantal luchtruimen staat in de kop. Een klik klapt ze uit, en dat blijft zo zolang het dashboard draait

### Zoek & Plan: punt op de kaart
- In het detailvenster staat nog één coördinaat (DMS). Het pijltje rechts in die balk klapt de andere notaties uit (DDM, DD, RD, MGRS, UTM); een klik op een coördinaat kopieert hem nog steeds
- **Luchtruim boven dit punt** is ingeklapt, met het aantal in de kop
- Kies je in het detailvenster Orbit, Zoeken, Bereik of Ringen, dan opent het gereedschap links meteen, uitgeklapt en in beeld. Dat geldt ook voor de knoppen boven de kaart; het laatst gekozen gereedschap blijft uitgeklapt, ook na Esc

## 1.25.1

### Zoek & Plan: wie is er het snelst?
- **Wind meerekenen** laat nu per toestel de wind zien die het onderweg krijgt: richting en sterkte op de eigen vlieghoogte, gemiddeld over de hele lijn naar het doel
- Daaronder wat die wind op deze lijn doet: tegenwind of meewind, zijwind van links of rechts, en de grondsnelheid
- Plus de vergelijking: de tijd zonder wind (of met wind, als de schakelaar uit staat) en hoeveel minuten de wind kost of scheelt, in oranje of groen
- Bovenin staat of de wind al binnen is. Zolang hij wordt opgehaald staat er *Wind ophalen…*, en is Open-Meteo niet bereikbaar dan zegt het paneel eerlijk dat er windstil is gerekend
- Het misleidende woord windstil bij elke regel is weg; onder de tijd staat nu *met wind* of *windstil*, afhankelijk van de schakelaar
- De lijst werkt zich direct bij zodra de wind binnenkomt, in plaats van na een paar seconden

### Titelbalk van de widgets
- De knoppen rechts in een titelbalk lopen niet meer onder het venster ernaast door. Bij de Vluchtradar op een smaller of touchscreen-scherm wordt de categorieknop (Politie · Trauma · …) korter, zodat de knop voor opnieuw laden altijd helemaal zichtbaar blijft
- De titel van een widget verdwijnt netjes als hij niet past, in plaats van half afgekapt te blijven staan

## 1.25.0

### Dempen
- Nieuwe knop **Geluid / Gedempt** in de menubalk, naast licht/donker. Eén tik en het dashboard is stil: het noodsquawksignaal, het briefinggeluid en het geluid van ingesloten pagina's (zoals Windy)
- Meldingen, de oranje en rode gloed en de rode noodbalk blijven gewoon verschijnen, alleen zonder geluid
- Gedempt staat er een oranje **GEDEMPT** in de tabbalk, ook in volledig scherm; één tik daarop zet het geluid weer aan. De keuze blijft bewaard, ook na een herstart. Ook onder Instellingen › Meldingen

### Touchscreen
- Nieuwe instellingen onder Instellingen › **Bediening**. Op een scherm met touchscreen staat de touchscreenmodus bij de eerste start vanzelf aan; daarna blijft bewaard wat je kiest
- Grotere knoppen en aanraakvlakken in de menubalk, tabbladen, widgets, dialogen en Zoek & Plan, en alles reageert direct op een tik
- Lang indrukken toont de uitleg die je met de muis bij het aanwijzen krijgt. Op de kaart is lang indrukken hetzelfde als rechtsklikken (bijvoorbeeld een routepunt verwijderen)
- Volledig scherm: tik op de greep **MENU** bovenaan, of veeg omlaag vanaf de bovenrand, voor de menubalk
- Bewerkmodus: widgets slepen en schalen met je vinger, met grote bolletjes
- Vliegtuigen op de Vluchtradar zijn met een vinger makkelijker aan te tikken

### Schermtoetsenbord
- Een eigen toetsenbord op het scherm verschijnt zodra je met je vinger een tekstveld aanraakt, ook in ingesloten pagina's, en verdwijnt als je klaar bent. Met muis en gewoon toetsenbord blijft het weg
- Bij tijden en getallen komt een cijferblok; letters, hoofdletters, cijfers, leestekens en é, ë, ü en °. Wissen en de pijltjes herhalen als je ze vasthoudt
- Een venster schuift omhoog boven het toetsenbord; met Verplaatsen zet je het toetsenbord boven of onder in beeld
- In- en uitschakelen onder Instellingen › Bediening; in touchscreenmodus staat er ook een knop **Toetsenbord** in de menubalk

### Zoek & Plan
- Recent gezochte plaatsen hebben een prullenbakje om ze een voor een te verwijderen, en bovenaan staat **Alles wissen** (tik twee keer, zodat het niet per ongeluk gebeurt). Op een touchscreen veeg je een item naar links om het te verwijderen. Er wordt nooit iets vanzelf gewist

## 1.24.1

### Schermoverzicht
- Een scherm met een oudere versie blijft zichtbaar als "draait" terwijl de andere schermen al bijgewerkt zijn (het werd 10 minuten als niet bereikbaar getoond als een firewall de beveiligde poort stil liet)

## 1.24.0

### Beveiligde verbinding tussen de dashboards
- Alles wat de dashboards elkaar sturen (live verkeer, wind, routes, profielen en dekken) gaat nu versleuteld met een eigen eenheidssleutel (TLS, ECDHE-PSK met ChaCha20-Poly1305). Beide kanten bewijzen dat ze de sleutel hebben; een apparaat zonder sleutel krijgt alleen de statuspagina
- Niets in te stellen: het eerste scherm maakt de sleutel en de schermen die elkaar al kenden krijgen hem vanzelf, versleuteld. Een nieuw scherm koppel je één keer met de koppelcode onder Schermoverzicht › Eenheidssleutel
- Gedicht: een apparaat in hetzelfde netwerk kon zich voordoen als dashboard en het profielbestand ophalen of verkeer doorsturen
- Het Schermoverzicht toont per scherm of de verbinding beveiligd is. De beveiligde verbinding gebruikt poort 47801, naast de statuspagina op 47800

### Vloeiend zoomen
- Zoomen met het muiswiel en de trackpad gaat vloeiend en is op Windows en macOS even snel. Elke tik telt direct mee, ook als de kaart nog beweegt (eerst werd die genegeerd, en op de Mac kwam één tik veel zwakker binnen)
- Tijdens het zoomen worden de kaartlagen alleen geschaald en pas daarna scherp opnieuw getekend. Op de Mac Mini gaat zoomen in Zoek & Plan daardoor veel soepeler, ook met veel lagen aan
- Geldt voor de Vluchtradar en Zoek & Plan

### Vluchtradar
- In het detailvenster van een toestel staat rechtsboven de vlag van het land waar het geregistreerd is, met daaronder de naam van het land. Dat land volgt uit het ICAO-adres van de transponder (de toewijzing per land uit ICAO Annex 10), dus ook bij toestellen zonder registratie in de database

### Mac
- Volledig scherm bedekt nu het hele scherm, ook de menubalk en het Dock: de menubalk valt niet meer over de titelbalk van het dashboard. Kies je een ander programma, dan stapt het dashboard terug; klik je erop, dan is het weer volledig

## 1.23.0

### Baangebruik Schiphol
- Nooit meer "starten 36R": dat kwam van toestellen die van 36C vertrekken en meteen rechtsaf draaien. De Aalsmeerbaan (36R) en Polderbaan (18R) worden nooit meer als startbaan getoond, 18L en 36L nooit als landingsbaan
- Het baangebruik komt nu per vlucht van de Schiphol-radar, via de flighttracker van het Bewoners Aanspreekpunt Schiphol (de bron waar Schiphol zelf naar verwijst). Toestellen die nu voor een baan naderen tellen mee, zodat een baanwissel sneller zichtbaar is
- Valt die bron weg, dan neemt het live vliegverkeer (ADS-B) het over, met een strakkere herkenning: getoetst op een week aan radarsporen (ruim 1.500 vluchten), nog 3 kleine afwijkingen bij lichte toestellen op de Oostbaan
- Onderaan de widget staat welke bron er gebruikt wordt: "Schiphol-radar (BAS)" of "Live waargenomen (ADS-B)"
- Lichte toestellen en helikopters op de Oostbaan tellen niet mee

## 1.22.0

### Zoek & Plan
- Orbit en Actieradius klappen weer netjes open nadat je Zoekpatroon hebt gebruikt (een invoerveld hield het paneel vast)
- Actieradius: één keuze Heen en terug, Enkele reis of Beide, met uitleg. Heen en terug is hoe ver je weg kunt en nog terugkomt bij het vertrekpunt; enkele reis is hoe ver je komt als je ergens anders landt
- De keuze EC135 of AW139 staat in een geel kader met het label Toestel
- Bij live eenheden staan de vooruitprojecties nu als 1 min, 2 min en 5 min in een donker label met gekleurde rand, leesbaar op elke kaart (licht, donker, grijs en luchtfoto); labels die zouden overlappen vallen weg
- De vensters Lagen en Eenheden hebben bovenin een duidelijke knop Sluiten (ook met Esc)
- Het zijpaneel klap je in en uit met een pijltje op de rand tussen paneel en kaart

### Kopbalk
- De maanbalk loopt niet meer over in het Schiphol-blok: hij is zo breed als de klokken, en als het krap is vallen eerst de Zulu-tijden van maan op en onder en daarna de fasenaam weg (beide staan in de tooltip). Het Schiphol-blok heeft daardoor ook meer ruimte

## 1.21.0

### Briefingmelding
- 5 minuten voor een briefing verschijnt een melding met welke briefing het is (Flight Ops of Driebergen OPCO, ochtend, middag of nacht) en een aftelling, en krijgt het scherm een oranje gloed
- Op 1 minuut en 30 seconden klinkt het aankondigingsgeluid, komt de melding terug en wordt de gloed rood, tot de briefing begint
- Tijden: Flight Ops 08:15, 14:30 en 22:30; Driebergen (OPCO) 08:00, 15:00 en 23:00. Aan te passen of uit te zetten onder Instellingen › Meldingen, met een knop om de melding te testen
- Eigen geluid per scherm te kiezen; zonder eigen geluid klinkt een ingebouwde gong, anders dan bij de noodsquawk

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
