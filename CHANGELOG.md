# Wijzigingen

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
