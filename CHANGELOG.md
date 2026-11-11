# Wijzigingen

## 1.41.0

### Het dashboard onthoudt op welk scherm het staat
- **Na een herstart, update of herinstallatie komt het dashboard vanzelf terug op het scherm waar het stond.** Sleep (of verplaats met Windows+Shift+pijl) het dashboard één keer naar het juiste scherm; vanaf dan wordt die plek onthouden en teruggezet. De keuze staat in `window-display.json` in de userData en blijft dus ook bij een herinstallatie bewaard. Zo hoeft het dashboard nooit meer met de hand naar het juiste scherm na een update

## 1.40.0

### Schermslot: Lock PC-knop, klok bovenaan en spatie toont het wachtwoord
- **Het bureaublad-icoon "Lock PC" zet nu het Schermslot van het dashboard aan** in plaats van de Windows-vergrendeling. De app start daarvoor met `--lock-screen` en de al draaiende app vergrendelt meteen; het vertrouwde hangslot-icoon blijft op het bureaublad staan
- **De klok en datum staan nu dikker gedrukt en bovenaan het scherm gecentreerd**, zodat het vergrendelscherm exact overeenkomt met dat van Windows
- **Een druk op de spatiebalk (of Enter) toont nu het wachtwoordveld** zonder een teken in te voeren, net als bij Windows

## 1.39.0

### Schermslot: echte achtergrond, uil als profielfoto en standaard 5 minuten
- **De achtergrond is nu de échte achtergrond van deze pc** (de uil), schermvullend weergegeven net als het Windows-vergrendelscherm. Eerder pakte het soms per ongeluk een Windows Spotlight-foto; dat is eruit. De aangeleverde afbeelding zit ook als terugval ingebouwd, zodat er altijd de juiste achtergrond staat
- **De profielfoto op het aanmeldscherm is dezelfde afbeelding** (de uil), rond en dekkend
- **Vanzelf vergrendelen staat nu standaard op 5 minuten** zonder toetsenbord of muis zodra er een wachtwoord is ingesteld. Aan te passen (of uit te zetten) onder Instellingen › Scherm › Schermslot

## 1.38.0

### Schermslot: het wachtwoord mag nu tekst zijn
- Het Schermslot neemt nu een gewoon **wachtwoord** in plaats van alleen een cijfercode: letters, cijfers en tekens, 1 tot 64 tekens. Het veld heet "Wachtwoord" en gedraagt zich als het Windows-aanmeldscherm met een wachtwoord (gemaskeerd, Enter of de pijl om aan te melden). Instellen, wijzigen of verwijderen onder Instellingen › Scherm › Schermslot

## 1.37.0

### Nieuw: Schermslot — vergrendel de pc, laat het dashboard staan
- **Een vergrendelscherm over het werkscherm, terwijl het dashboard doorloopt.** Op een pc met twee schermen legt het Schermslot een schermvullend vergrendelscherm over het werkscherm (het scherm waar het dashboard níét op staat) en laat het dashboard op het tweede scherm gewoon draaien. Zo is een onbeheerde pc dicht zonder dat de operator het dashboard kwijt is. Vergrendelen met het slotje in de kop; op een pc met één scherm vergrendelt Windows zelf (Windows+L)
- **Eén op één het Windows-vergrendelscherm.** Het toont de echte vergrendelachtergrond van deze pc (het ingestelde vergrendelbeeld, anders de nieuwste Windows Spotlight-foto, anders de bureaubladachtergrond), de klok en de datum, en na een aanraking de accountavatar met de naam en het codeveld — met de echte Windows-accentkleur onder het veld, de ronde pijlknop erin en de "Even geduld"-animatie bij het aanmelden
- **Een eigen toegangscode, niet je Windows-wachtwoord.** De code (4 tot 12 cijfers) staat versleuteld en alleen lokaal (scrypt + AES-256-GCM, in palv-screenlock.json, alleen voor deze gebruiker leesbaar). Na vijf foute pogingen een halve minuut wachten. Instellen, wijzigen of verwijderen onder Instellingen › Scherm › Schermslot, net als de naam onder de avatar en vanzelf vergrendelen na een aantal minuten zonder toetsenbord of muis
- **Het houdt wie wegloopt buiten.** Alt+Tab, de Windows-toets en Alt+F4 zijn geblokkeerd, vensters erachter zijn niet te bereiken en het dashboardvenster kan niet dicht zolang het slot aan staat. Wat geen enkel programma kan afvangen is Ctrl+Alt+Del; dat blijft de grens van een slot op dit niveau — bedoeld voor gescreend personeel, geen vervanging van de Windows-aanmelding. Alleen op Windows

## 1.36.0

### Weerradar: nieuwe labels bij de meetstations
- **Onder elkaar in plaats van naast elkaar.** Onder de stationscode staat elke waarde op een eigen regel (wind, wolkenbasis, zicht, …), elk met een eigen klein icoontje, zodat de waarden netjes onder elkaar uitlijnen en de labels niet meer ver naar rechts lopen. De windpijl wijst mee met de wind. De kleur van het oordeel (groen, oranje, rood) loopt langs de rand van het label, zodat duidelijk blijft bij welk bolletje het hoort
- **Labels zoeken zelf een vrije plek.** Elk label kiest uit acht plekken rond zijn bolletje (rechts, links, boven, onder en schuin) de plek waar het geen ander label en geen ander bolletje bedekt, en ook niet de statusbalk, de knoppen of de tijdbalk van Windy. De grote velden gaan voor, slecht weer gaat voor goed weer, en een label blijft staan waar het stond zolang die plek vrij is (geen verspringende labels). Past het nergens, dan blijft alleen de stationscode staan; past zelfs dat niet, dan verschijnt het label pas als je met de muis op het bolletje staat
- **Nieuw in het tandwiel:** Indeling (Onder elkaar / Naast elkaar), Plek (Auto, Rechts, Links, Boven, Onder: de voorkeursplek; labels wijken altijd uit voor elkaar) en Tekstgrootte als een rij steeds grotere letters
- **Het menu van de weerradar** valt niet meer van het scherm: alle knoppen passen in de breedte, en is het menu hoger dan de kaart, dan scrollt het

### Kop
- **Noordzee als eigen strook onder de Maan.** Sea state, golfhoogte, zeewatertemperatuur en het meetstation staan nu in een derde strook, gebouwd zoals UDP en Maan, met de labels netjes in één lijn. Onder de METAR staat alleen nog het weer van de basis. De drie stroken lopen over de hele hoogte van de kop, waardoor de kop lager is en de widgets meer ruimte krijgen
- **Maan, UDP en Noordzee lopen niet meer uit hun vakje.** Is de ruimte te krap (ook bij een grotere tekstgrootte van de kop), dan vallen eerst de minst belangrijke onderdelen weg, zoals de windrichting in woorden of de lichtmeter, en wordt ONDER HORIZON kort ONDER. Alles staat nog in de tooltip

### Vluchtradar knippert niet meer
- De kaart van de Vluchtradar knipperde soms even weg. Oorzaak: de OLED-bescherming verschuift het hele dashboard elke minuut een pixel en liet dat 20 seconden glijden. Daarvoor zette Chromium het hele dashboard steeds tijdelijk op een eigen laag op de videokaart en haalde die er daarna weer af; bij elke wissel werd alles opnieuw getekend, en de kaart met zijn honderden kaarttegels was daarbij soms even leeg. Nu blijft het dashboard altijd op één eigen laag en is elke stap van een pixel alleen nog een verschuiving van die laag: er wordt niets opnieuw getekend. De tekst blijft daardoor ook altijd scherp
- Overdag wordt de vervaagde nachtkaart van de Vluchtradar helemaal van het scherm gehaald (zoals de dagkaart 's nachts al), zodat die de videokaart niets meer kost

## 1.35.0

### Nieuw tabblad Browser (Windows)
- **Een privébrowser in het dashboard**, met een wereldbol in de tabbalk, naast MadeSmart (dat blijft zoals het is). Gebouwd op de Chromium van het dashboard zelf: video, pdf, downloads, afdrukken, pop-ups voor inloggen, volledig scherm, tabbladen, zoeken op de pagina, zoomen, het rechtermuisknopmenu en het schermtoetsenbord werken gewoon. Gratis en open source, zonder account
- **Via Tor, standaard.** Alles van de browser (ook het opzoeken van adressen) gaat door Tor; sites zien een adres van het Tor-netwerk, niet dat van dit netwerk, en het netwerk hier ziet niet welke sites bezocht worden. .onion-sites werken. Tor zit in de installatie (Tor Expert Bundle 16.0 van het Tor Project, gecontroleerd tegen hun handtekening) en start pas als het tabblad opengaat. **Valt Tor weg, dan laadt er niets**: er gaat nooit iets langs Tor heen. Blokkeert een netwerk Tor, dan zijn er bruggen (Snowflake, obfs4, meek) in Instellingen › Browser. Bewust kiezen voor **Direct** kan ook (sneller, maar sites zien het IP-adres)
- **Niets wordt bewaard.** Geen geschiedenis, cookies, cache of wachtwoorden op schijf: alles staat in het geheugen. **Nieuwe identiteit** (de bezem) sluit alle tabbladen, wist alles en laat Tor een nieuwe route kiezen. Alleen de favorieten op de startpagina en de instellingen blijven
- **Trackers, advertenties en cookiemeldingen geblokkeerd** met de lijsten van uBlock Origin, EasyList en EasyPrivacy (de blokkeermotor van Ghostery). Cookies van andere sites worden nooit verstuurd of bewaard. Alleen https: een site die alleen onversleuteld werkt, opent pas na een waarschuwing
- **Bescherming tegen vingerafdrukken**, zoals Mullvad Browser en Brave: tijdzone UTC en taal Engels, overal dezelfde gewone waarden voor processor, geheugen, scherm, videokaart, stemmen en batterij, en een heel klein beetje ruis in canvas, WebGL en audio die per site en per sessie anders is. **Letterboxing**: de pagina krijgt een maat in vaste stappen, met een rand eromheen. WebRTC lekt geen IP-adres, WebGPU staat uit
- **Schild per site**: werkt een site niet goed, zet de bescherming dan alleen voor die site uit (tot de volgende nieuwe identiteit). Het schild toont hoeveel er geblokkeerd is
- **Nooit deze computer of het lokale netwerk**: een website kan niet bij het dashboard zelf of andere apparatuur in het gebouw. Geen camera, microfoon, locatie, meldingen, USB of Bluetooth. Het schermtoetsenbord draait onzichtbaar voor de sites, zodat niets verraadt dat dit het dashboard is
- Op de Mac Mini komt het tabblad niet: daar is geen browser nodig

### Onder de motorkap
- Windows draait nu op **Electron 45** (Chromium 156), de huidige versie met beveiligingsupdates; 38 kreeg die niet meer. De Mac Mini (macOS 12) blijft op Electron 43, de laatste die daar start
- Nieuwe tests voor de adresbalk, letterboxing, de afscherming van het lokale netwerk, https, Tor en het tabblad (wel op Windows, niet op de Mac)

## 1.34.0

### Nieuw tabblad MadeSmart
- **MadeSmart Tracker in een eigen tabblad**, met de knoppen van een gewone browser: terug, vooruit, vernieuwen (of stoppen), startpagina, het adres met slotje voor een beveiligde verbinding, zoom (50 tot 200%, onthouden) en een eigen adresbalk
- **Eigen, afgeschermde inlogsessie**: wat je bij MadeSmart inlogt staat los van alle andere ingesloten websites en blijft op dit scherm
- Rechtsklikken geeft het gewone menu (kopiëren, plakken, link kopiëren, terug, vernieuwen); vensters die MadeSmart zelf opent (een rapport of document) openen in dezelfde sessie
- **Downloads** gaan direct naar de map Downloads; de laatste staat rechts in de balk, een klik opent de map
- Op bestaande schermen komt het tabblad er vanzelf bij, achteraan. Haal je het weg, dan blijft het weg; de startpagina is aan te passen via Bewerken › tandwiel

### Tabbladen slepen
- In **Bewerken** sleep je tabbladen naar een andere plek, met de muis of je vinger. De andere tabbladen schuiven opzij en de volgorde wordt bewaard. Elk scherm houdt zijn eigen volgorde

### Pc vergrendelen
- **Slotje in de kop**, rechts van P-ALV DASHBOARD: één klik als je wegloopt en Windows vergrendelt, net als Windows+L. Daarna is je wachtwoord of pincode nodig. Altijd te zien, ook in volledig scherm. Alleen op Windows, niet op de Mac

### Meldingen stil of weg
- **Elke briefing- en timingmelding** heeft onderin twee knoppen: **Geluid uit** (de melding blijft, zonder geluid) en **Verbergen**. Verbergen vraagt in de melding zelf "Weet je zeker dat je deze melding definitief wilt verbergen?" met Ja of Annuleren
- Briefings (OPCO en Flight Ops): het geldt voor die briefing op die dag, op dit scherm. Na verbergen geen pop-up, rand of geluid meer; morgen komt hij gewoon weer
- Timings: het geldt op alle schermen. Een verborgen timer loopt door zonder melding of geluid. Terugzetten kan in de timer zelf, bij Meldingen (Normaal, Geluid uit of Verborgen)
- Ook in de rode en oranje timingbalk bovenaan

## 1.33.0

### Privacy: wat het dashboard naar buiten stuurt
- **Een schip aantikken stuurt niets meer naar buiten.** Tot nu toe ging bij elke tik de naam of het IMO-nummer naar Wikimedia Commons (voor de foto) en de exacte positie naar Open-Meteo (voor de sea state). Nu haalt het scherm met de AIS-stroom op de achtergrond, rustig, een foto op van **álle** schepen op de Noordzee en bewaart die op het scherm zelf. Een aangetikt schip komt alleen uit die eigen opslag (of van het scherm dat de stroom heeft, via de beveiligde verbinding van de eenheid). Buiten is dus niet te zien naar welk schip er gekeken wordt
- Een schip dat net binnenkomt heeft nog even geen foto, tot het aan de beurt is. De voortgang staat in Instellingen › Offshore (Scheepsfoto's)
- **De sea state bij een aangetikte plek** wordt gevraagd voor een vak van ongeveer 5 km (afgerond op 0,05°), niet meer voor het exacte punt
- **Geen naam meer in het internetverkeer.** Alle verzoeken gaan onder een neutrale, algemene naam: niets meer dat naar het dashboard, de eenheid of de politie wijst (voorheen stond er bij de scheepsfoto's zelfs "police aviation unit" in). Ook het venster zelf laat de naam en versie van het dashboard weg
- **Zoeken in Zoek & Plan blijft in Nederland.** Wat je typt en een aangetikt punt gaan alleen nog naar PDOK (Kadaster, Nederlandse overheid). Photon (komoot, een bedrijf in Duitsland) voor plaatsen in het buitenland staat standaard uit en is aan te zetten in Instellingen › Zoek & Plan › Zoeken, voor alle schermen tegelijk. Vindt de zoekbalk niets in Nederland, dan zegt hij dat en brengt een tik je naar die instelling
- **Geen servers in Rusland meer:** de reserve-server voor OpenStreetMap-gegevens (maps.mail.ru) is geschrapt; overpass-api.de en kumi.systems (Duitsland) blijven
- Een nieuwe test bewaakt dit alles: geen eigen naam in het verkeer, geen Russische servers, Photon alleen als het aan staat, sea state alleen afgerond en scheepsfoto's nooit bij een tik

## 1.32.1

### Werkplek
- Een andere werkplek kiezen verandert de kaarten niet meer: de **Vluchtradar blijft op heel Nederland** staan (ook een zelf verschoven kaartbeeld blijft), en de **METAR-kaartjes op de pagina Weer blijven** hun eigen stations houden. Alleen het weer in de kop, het baangebruik, de afstandsringen en de afstanden volgen de werkplek
- Het automatische licht/donker-thema schakelt weer op zonsopkomst en -ondergang van Schiphol, net als vroeger, ongeacht de werkplek
- Een eigen titel van de widget Baangebruik blijft staan; alleen de automatische titel ("Baangebruik Schiphol") wisselt mee
- Escape sluit alleen het Werkplek-menu, niet ook het volledig scherm of de bewerkmodus

### Baangebruik
- De kaartjes van **Volkel en Rotterdam** lopen nu net zo zacht uit aan de randen als dat van Schiphol

### Verder netjes gemaakt
- De blauwe pulserende cirkel kost veel minder rekenkracht (vooral op de Mac Mini) en staat stil op een pagina die niet in beeld is
- In de bewerkmodus blijft geen oranje markering op de kop achter na Gereed
- Een laat antwoord voor de vorige werkplek kan de METAR van de nieuwe werkplek niet meer rood maken
- Zoek & Plan: het weer bij de bases wordt niet meer op de achtergrond opgehaald nadat het tabblad is gesloten

## 1.32.0

### Kop
- De kop is een stuk lager zonder dat er iets uit verdwijnt: logo en naam klein bovenaan, de twee klokken eronder, en de regels **UDP** en **Maan** precies uitgelijnd naast de klokken (boven en onder gelijk). De METAR is iets kleiner
- **Maanstand** en maan-info zijn samen één regel **Maan**: fase en percentage, azimut en elevatie, het lichtniveau (lux) en boven/onder de horizon. Op- en ondergang en de volgende volle en nieuwe maan staan in de tooltip
- **De kop is aan te passen** in de bewerkmodus (Bewerken): onder de kop verschijnt een balk waarmee je per onderdeel (logo, klokken, UDP, maan, METAR, Noordzee) de grootte van het blok en van de tekst instelt. Buiten de bewerkmodus staat de kop vast

### Werkplek
- Uiterst rechts in de tabbladbalk: **Werkplek** met een keuzemenu voor Schiphol, Volkel of Rotterdam. Alles wisselt mee: het weer in de kop, het baangebruik, de ringen, de afstanden, Zoek & Plan en het automatische thema

### (De)Briefing
- Onder **Briefing** staat de crewbriefing (Aircrew briefing), net als de debriefing: in- en uitzoomen en verschuiven
- Document kiezen en verwijderen staat niet meer op het tabblad, maar alleen onder **Instellingen › (De)Briefing**

### Offshore en Zoek & Plan
- Een gekozen schip, platform of punt krijgt een **blauwe pulserende cirkel**, zoals een GPS-positie; in Zoek & Plan net zo voor elke gekozen plek of elk object

## 1.31.0

### Basis van het dashboard
- Nieuw onder **Instellingen › Basis**: vanaf welk steunpunt dit dashboard draait: **Schiphol-Oost**, **Volkel** (Vliegbasis Volkel) of **Rotterdam** (Rotterdam The Hague Airport). De basis bepaalt het luchtvaartweer in de kop (METAR en BOM-toets van het veld), het baangebruik, de afstandsringen op de Vluchtradar en de afstanden in meldingen ("x NM van Volkel"), de eerste basis in Zoek & Plan en het referentiepunt van Offshore. De METAR-widgets van de oude basis op de pagina Weer wisselen mee, de Vluchtradar centreert op het veld
- **Baangebruik** werkt nu voor elk veld: Schiphol zoals altijd per vlucht via de BAS-flighttracker; Volkel en Rotterdam uit het live verkeer (ADS-B) op de banen van dat veld, met de **baan in de wind** uit de METAR (tegenwind en dwarswind) erbij. De kaart in de widget komt uit de eigen tegelopslag
- De standaardindeling van een nieuw dashboard is nu die van de Mac Mini Flightroom: Vluchtradar links, Baangebruik en In de lucht in het midden, Weerradar rechts; op Weer de METAR van Schiphol, Volkel en Deelen

### Zoek & Plan
- Onder Opgeslagen › **Bases** staan de drie steunpunten, de basis van dit dashboard bovenaan, elk met het **actuele weer van het veld** (BOM-toets, wind, zicht, bewolking, temperatuur, QNH en de ruwe METAR, elke minuut ververst) en de **banen** met de baan in de wind. Eigen bases blijven mogelijk; "Wie is er het snelst" en de puntkaart rekenen vanaf alle drie

### Timings
- Knop **Positie** tussen Snel en L-uur: in één tik een positietimer voor de kist, met het eigen toestel dat nu vliegt al gekozen

### Overal
- De scheidingslijnen in dialoogvensters waren een stipje: hersteld

## 1.30.0

### Kop van het dashboard
- **Noordzee onder de METAR**: de **sea state** (Douglas-schaal 0–9, met een golf-icoontje dat meegroeit) uit de significante golfhoogte, de golfperiode en de **zeewatertemperatuur**, gemeten door Rijkswaterstaat op een Noordzeestation (standaard Europlatform; te kiezen onder Instellingen › Weerradar), met de waarnemingstijd en de spreiding over alle stations in de sector. Alle stations met hun waarden staan in de tooltip. Elke vijf minuten ververst; bij een oude waarneming kleurt de bron oranje
- **Maanstand onder de maan**: azimut (graden en windrichting, met een kompasroos) en elevatie boven de horizon voor Nederland, elke halve minuut bijgewerkt. Gecontroleerd tegen de JPL-efemeride: azimut op 0,1° nauwkeurig, elevatie op 0,2° (met refractie, zoals je de maan ziet)

### Weerradar
- Het blauwe pulserende bolletje is weg: dat was Windy's eigen "mijn locatie" (een schatting uit het IP-adres, altijd aan op de radarlaag) en zei niets over het dashboard

### Whiteboard
- **Alle iconen opnieuw getekend, gedetailleerd**: één set van 215 iconen met herkenbare silhouetten, ramen, dekuitrusting, masten en echte verhoudingen. De AW139 en EC135 van boven met de juiste rotorschijf ten opzichte van de romp, vijf of vier bladen, sponsons en staartrotor aan bakboord (AW139) of skids en fenestron (EC135); AW189, H145, NH90, Dash 8, Cessna en drone; vaartuigen in zij- en bovenaanzicht met brug, luiken, kranen en helidek; politieauto, ME-bus en personenauto ook van boven; personen met uitrusting (agent, BOA, DSI, hondengeleider, hulpverlener); platforms, turbines en infra als technische tekeningen; tactische symbolen zoals de TACSOP ze bedoelt (LEAD en GATE zonder cijfer), plus cordon, wegversperring, windpijl en NVG. De keuze Eenvoudig/Gedetailleerd is vervallen; oude borden tonen hun iconen in de nieuwe versie
- **Vergrendelen met een slot**: de knop Slot in de balk vergrendelt het bord met een pincode (6 tot 12 cijfers) en een geheugensteuntje. Daarna is de inhoud alleen op dat scherm te zien; de andere schermen tonen de naam, het slot en het geheugensteuntje, en krijgen de inhoud pas na de pincode (die blijft daar dan bekend). Verbergen op een scherm of het slot opheffen gaat via hetzelfde menu. De inhoud staat versleuteld in de gedeelde bestanden (AES-256-GCM, sleutel uit de pincode met scrypt), ook een streek die nog getekend wordt gaat niet live naar schermen zonder sleutel; na vijf foute pincodes wacht het slot een halve minuut

### Mission Planning
- Ook een **slot** voor een missie: alle velden versleuteld, de naam en status leesbaar; de missielijst toont het slot en het geheugensteuntje
- De startpagina is opnieuw ingericht: de knop **Nieuwe missie** in het midden, daaronder alle missies **onder elkaar**, genummerd en klikbaar, met status, voortgang en L-uur; naast elke missie knoppen om de naam te wijzigen, hem omhoog of omlaag te zetten en te verwijderen (altijd met een bevestiging). De knop Missies in de balk brengt je er terug

### Timings
- Een positietimer kan zijn punt nu **op de kaart** krijgen: de knop Kies op de kaart opent een venster met de kaart (kaart, satelliet, topo NL of VFR, met zeekaart), tik waar het punt moet komen, de gele ring toont de straal, het dichtstbijzijnde dorp of de coördinaat wordt de naam; daarna vul je straal en moment in zoals altijd

### Offshore
- Tik op een plek op de kaart (of een schip, platform of station) en in de balk boven de kaart staan de **sea state** en de **zeewatertemperatuur** op die plek: het golfmodel van Open-Meteo op het punt zelf (golfhoogte, periode, richting, deining in de tooltip) naast de dichtstbijzijnde meting van Rijkswaterstaat met de afstand, zodat je model en meting kunt vergelijken
- De dubbele gradentekens in de kaart ("334°°") zijn weg

## 1.29.0

### Whiteboard
- **Tekenen werkt meteen**: het tabblad opent vanzelf het laatste bord van de eenheid en maakt er een als er nog geen is; tot nu toe deden pen, iconen en tekst niets zolang er geen bord was gekozen
- De achtergrond is nu **wit** (ook lichtgrijs, papier, donker, zwart en krijtbord), gekozen met een klik; hij werkt ook zonder open bord en de pen wisselt mee van zwart naar wit en terug
- **Een stuk kaart op het bord**: kies satelliet (met de luchtfoto van Nederland), kaart, topografisch (NL of wereld), luchtfoto of VFR-kaart, met de zeekaart erover; zoek een plaats, platform, vliegveld, favoriet of coördinaat, kies de verhouding van het kader (16:9, 4:3, 1:1, 3:4, A4 of vrij) of sleep zelf een kader, en zet het gebied op het bord. De kaart ligt vergrendeld onder alles wat je tekent, met schaalbalk, noordpijl en bron; de muis boven de kaart geeft de coördinaat; vergrendelen, dekking en centreren onder het nieuwe paneel Kaart. De tegels komen uit de eigen kaartopslag, dus de kaart staat ook op de andere schermen en blijft scherp bij inzoomen
- **Nieuwe iconen**: de AW139, AW189, EC135 en H145 opnieuw getekend met de bladen netjes om de rotorkop (vijf of vier), sponsons, staartrotor of fenestron; de Dash 8 van de kustwacht; ruim twintig **vaartuigen in bovenaanzicht** (vracht, container, tanker, bulk, veerboot, cruise, patrouille, fregat, RIB, speedboot, zeiljacht, kotter, sleepboot, PSV, CTV, KNRM, loodsboot, baggerschip, duwbak, waterscooter, kajak, rubberboot) om op de scheepssectoren en de kaart te zetten; veel meer scheepstypen in zijaanzicht (bulkcarrier, LNG-tanker, cruiseschip, ro-ro, PSV, SOV, CTV, boorschip, fregat, onderzeeboot, loodsboot, kustwachtcutter, politieboot, speedboot, hovercraft, kajak, rubberboot, reddingsvlot, lichtschip, duwbak, trawler, baggerschip, zeiljacht); offshore (hefeiland, halfafzinkbaar platform, FPSO, transformatorstation, monopile, satellietplatform, pijpleiding, anker, TSS); en een **gedetailleerde set** naast de eenvoudige (helikopters in boven- en zijaanzicht, drone, containerschip, tanker, veerboot, patrouillevaartuig, RIB, kotter, KNRM, platform, windturbine, politieauto, ME-bus, gepantserd voertuig, DSI-operator, agent, vuurtoren, haven), te kiezen met Eenvoudig / Gedetailleerd; elk icoon met zijn naam in het paneel
- Selectie: naar voren of naar achteren, kopie, pijlpunt en lijnstijl van een lijn, label en rechtzetten van een icoon; gereedschap Lijn en Verschuiven ook in de balk; K opent de kaart

### Mission Planning
- De balk met de missie, de status, L-uur → Timings en PDF was onzichtbaar (platgedrukt door een naamconflict in de opmaak) en staat er weer, met een eigen knop **Nieuwe missie** en de voortgang van de hele SOMP

### Offshore
- De knoppen Schepen en Lagen rechtsboven en het tabblad Bronnen zijn weg: de panelen staan links, de AIS-sleutel onder Instellingen › Offshore, en Platforms en Kustpunten opnieuw ophalen onder Lagen
- **Sneller**: de projectie van duizenden schepen zonder tussenobjecten, schepen buiten beeld worden overgeslagen vóór het rekenen, gegist bestek alleen als het zichtbaar is (vanaf zoom 8), de kaart tekent elke seconde alleen ingezoomd of met eigen vloot in beeld (anders elke 2,5 of 6 seconden), de scheepslijst in het paneel ververst hooguit elke tien seconden en het aanwijzen op de kaart hooguit één keer per beeld

### Overal
- Het woord "null" verscheen op plekken waar een leeg onderdeel werd getoond (onder meer "nullnull" in de tijdlijn van Timings): een leeg onderdeel wordt nu overal weggelaten

## 1.28.1

### Offshore
- De schepen kwamen niet op de kaart: aisstream.io stuurt zijn berichten als binaire frames en die werden als tekst gelezen en weggegooid. Nu worden ze als bytes gelezen; binnen een minuut staan er honderden schepen op de kaart
- Een scherm dat de schepen van een ander scherm krijgt, meldt dat ook zo in de status ("AIS via …") als het tabblad daar even niet in beeld is

## 1.28.0

Vier nieuwe tabbladen, achter de bestaande: **Timings**, **Mission Planning**, **Whiteboard** en **Offshore**. Wat je daar zet of tekent staat binnen een tiende seconde op alle schermen van de eenheid, over de beveiligde verbinding met de eenheidssleutel; drie nieuwe gedeelde bestanden naast de routes en profielen.

### Timings
- **Timers** (aftellen vanaf een duur), **wekkers** (een tijdstip, LT of UTC) en **positietimers**: gaat af als een eigen toestel een punt bereikt (of een gebied verlaat), met het toestel uit de live-bron, een punt uit het zoeken van Zoek & Plan (plaats, platform, vliegveld, favoriet of coördinaat), een straal in NM en een ETA uit koers en grondsnelheid
- Elke timing heeft een naam, categorie (Missie, Dienst, Brandstof, Briefing, Bemanning, Overig), toelichting, de tekst van de melding, een **waarschuwing vooraf** (minuten), een geluid vooraf en een geluid als hij afgaat, en de keuze voor een pop-up over het hele scherm of alleen de balk bovenaan
- Geluiden worden ter plekke gemaakt (gong, belletje, alarm, sirene, piepjes, tik, hoorn) of het eigen briefinggeluid van het scherm; volume, herhaling en standaardwaarden onder de knop Geluiden en onder Instellingen › Meldingen
- Een afgegane timing geeft op elk scherm de rode balk, de gloed en (naar keuze) de pop-up, en herhaalt het geluid tot iemand **bevestigt**; dat stopt hem overal. Een wekker kan vijf minuten later opnieuw
- Kaarten met aftelring, status, start/pauze, +1 en +5 minuten, terugzetten, bewerken; sorteren op resterende tijd, tijdstip, naam, categorie of aanmaak; filteren op lopend, afgegaan of categorie; rechts een tijdlijn van wat komt en wat ging
- **L-uur ketting** volgens de TACSOP-ingress: holding (L-30), holding verlaten (L-5), 1LEAD (L-3), 1GATE (L-2), 1 minuut en HAMMER, plus eigen punten; en snelle timers en voorkeuzes (playtime, bingo fuel, rotor running, HOTO, laatste intel-update)
- Het **tabblad** toont de dichtstbijzijnde lopende timer als badge (groen, oranje binnen een minuut, rood afgegaan); niets als er niets loopt
- Nieuwe widget **Next event**: de eerstvolgende timing als aftelling, tijdstip of allebei, met Bevestigen als hij is afgegaan; per widget een categorie

### Mission Planning (SOMP)
- De Scheme Of Maneuver Planning van de TACSOP AW139 (hoofdstuk 5.1) digitaal: Opdracht, Fase 1, Initial guidance, ICM, Fase 2, SOMP, Post-SOMP, Fase 3, FCM, Mission briefing, Uitvoering en Missiekaart, met de planborden van appendix 6.1 (ML, PF/FL, TFO despatcher per fase), de SOMP-checklist (mission statement, SOMP briefing met COEFAK, SOM development, SWOT, configuratie, C2, communicatie, minimum result), de producten, de FCM-onderwerpen en de volledige briefingchecklist (appendix 2)
- Het **overzicht** laat in één oogopslag zien of de SOMP compleet is: percentage en ring per fase en totaal, wat nog open staat (klik en je bent er), wat het laatst is gewijzigd en door wie, het L-uur met aftelling, en de status (in planning, gereed, lopend, afgerond, archief)
- Meerdere missies naast elkaar; elk veld wordt los opgeslagen, zodat twee mensen op twee schermen tegelijk aan dezelfde missie kunnen werken
- **L-uur → Timings** zet de ingress-ketting als wekkers; **PDF** drukt het hele plan af (A4)

### Whiteboard
- Tekenen met de vinger of de muis: pen, markeerstift, lijn, pijl, rechthoek, ellips (gevuld of niet), tekst (dubbeltik om te bewerken), gum; selecteren, verplaatsen, **draaien en schalen** met grepen; zoomen met het wiel, de knoppen of **twee vingers**; ongedaan maken en opnieuw; raster; vier achtergronden; sneltoetsen
- Een bibliotheek met ruim **honderd operationele iconen** als vector, in elke kleur en grootte: AW139 en EC135 (bovenaanzicht), H145, AW189, drone, vliegtuig, helipad, baan, windzak; politieauto, onopvallende auto, bus, vrachtwagen, motor, ambulance, brandweer, gepantserd voertuig; RIB, patrouillevaartuig, vracht- en containerschip, tanker, kotter, zeilboot, veerboot, reddingboot, sleper, boei; verdachte, eigen eenheid, agent, team, DSI, hondengeleider, bereden politie, slachtoffer, drone-operator, menigte; woning, flat, loods, hangar, boerderij, school, ziekenhuis, bureau, brug, tunnel, mast, hoogspanningsmast en -lijn, windturbine, windpark, platform, vuurtoren, haven, tankstation, kerk, parkeerplaats, weg, spoor, water, hek, slagboom, duin, veld; boom, bos, vogels, wild, vee, zeehonden, hond, paard, vis; en de tactische symbolen uit de TACSOP: 1LEAD, 1GATE, 1-minuutpunt, doel, hot zone, de **deconflictie-standaard** (4/5 km, N-E-S-W), holding, LP, PUP, DP, LZ, FARP, CP, OP, RV, no fire area, fase-lijn, ingress en egress, sniper/EPS, sector, camera, antenne, gevaar, no-go, explosie, brand, vlag, cijfers, letters, speld, ster, vinkje, kruis, vraagteken, klok, noordpijl, schaalbalk. Zoeken op naam of trefwoord, per categorie; dubbeltik op een geplaatst icoon voor een label (callsign, LP-nummer)
- De **scheepssectoren** (bow, mid, stern; bakboord rood, stuurboord groen; 0°, 45°, 90°, 139°, 180°) als vector-ondergrond, groot en haarscherp op elke zoom; alles wat je daarna tekent of plaatst komt erbovenop
- Borden **bewaren en laden** met een miniatuur, hernoemen, kopiëren, verwijderen, als PNG opslaan; het paneel werkt als dat van Zoek & Plan (Tekenen, Iconen, Borden) en klapt in
- **Live samen tekenen**: elke streek, vorm of icoon staat zodra hij af is op de andere schermen; een streek die nog getekend wordt groeit daar mee, en je ziet van elk ander scherm de naam en de cursor op het bord

### Offshore
- Eén kaart met alles van de offshore-operatie: alle **platforms** (olie en gas, trafostations van de windparken, FPSO's; NLOG, Rijkswaterstaat, GEUS, NSTA, Sodir, BOEM, EMODnet, OpenStreetMap), windparken met veiligheidszones, windturbines, helidekken (openAIP), **EEZ en 12-mijlsgrens** (Marine Regions), pijpleidingen, kabels, scheepsdichtheid, militaire oefengebieden en Natura 2000 (EMODnet), de zeekaart (OpenSeaMap), KNRM-reddingstations, kustwachtposten, vuurtorens, havens, ziekenhuizen en helipads (OpenStreetMap), de eigen vloot en de Noordzee-weerstations getoetst aan het BOM; alle lagen apart aan en uit
- **Live AIS** van alle schepen op de Noordzee via aisstream.io (gratis, met een API-sleutel van een gratis account: Instellingen › Offshore). Eén scherm houdt de stream open; de andere schermen krijgen de schepen van dat scherm, zoals het vliegverkeer. Schepen gekleurd per soort (vracht, tanker, passagiers, visserij, HSC, sleep/loods/werk, zeil, overheid/SAR/militair, bakens), met koerslijn en gegist bestek tussen twee berichten
- Klik op een schip voor de **detailkaart**: naam, vlag (uit de MMSI), MMSI, IMO, roepnaam, type, navigatiestatus, snelheid, koers en heading, draaisnelheid, positie, leeftijd van het bericht, afmetingen, diepgang, bestemming en ETA, afstand en peiling vanaf de basis en vanaf elk eigen toestel in de lucht (met vliegtijd), de **past track** van de laatste uren en een **foto** van het schip (Wikimedia Commons, op IMO-nummer of op naam, met fotograaf en licentie). Volgen, markeren, centreren, positie kopiëren
- **Zoeken** op naam, MMSI, IMO, roepnaam of bestemming; filteren op soort en minimumsnelheid; sorteren op naam, afstand, snelheid of laatste bericht; gemarkeerde schepen bovenaan en altijd met naam op de kaart. Platforms zoeken met de dichtstbijzijnde eerst; bij elk platform en elk punt op de kaart de dichtstbijzijnde schepen en platforms

### (De)Briefing
- Nieuw tabblad met bovenin een knop **Briefing** en een knop **Debriefing**: elk toont het document van de eenheid (afbeelding of pdf), passend in beeld, met zoomen (wiel of twee vingers) en verschuiven. Laden met *Document kiezen*; het document komt in het profielbestand van de eenheid en staat daarmee op alle schermen, nooit in de code

### Weerradar
- Het **tandwiel** in de titelbalk kiest wat er bij elk bolletje staat: stationscode, naam, wind, **wolkenbasis volgens het BOM** (met een lagere FEW-laag ernaast), alle wolkenlagen, zicht, actueel weer, temperatuur en dauwpunt, QNH, de trendpijl en de waarnemingstijd; standaard code, wind, wolkenbasis, zicht en trend
- Alle stations op elk zoomniveau tonen, en de grootte van de labels (klein tot extra groot)
- De waarden komen elke minuut vers van aviationweather.gov, uit dezelfde parser als de kop en de METAR-widgets

### Onder de motorkap
- Drie gedeelde bestanden (timers, whiteboards, missies) naast de routes en profielen; een scherm haalt alleen op wat na de vorige keer veranderde, en een wijziging wordt direct aan de andere schermen gemeld in plaats van elke 15 seconden
- Een live-kanaal tussen de schermen voor wat niet bewaard hoeft te worden (cursors, lopende pennenstreken)
- Instellingen › Offshore (AIS-sleutel en bronnen) en Instellingen › Meldingen › Timings

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
