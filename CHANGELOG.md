# Wijzigingen

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
