'use strict';

/* ============================================================
   Mission Planning: de Scheme Of Maneuver Planning (SOMP) van de TACSOP AW139 (hoofdstuk 5.1, de
   planborden van appendix 6.1 en de briefingchecklist), digitaal en gedeeld tussen alle schermen.
   ============================================================ */
// A mission is one item (OPS kind 'missions', list 'missions': name, status, lhour, createdAt, by); every
// field of it is an item of its own in the list 'fields' with key "<mission>:<field>", so two people on
// two screens can fill in different boards of the same mission at the same time.
// The schema below follows the TACSOP: the twelve steps of the parallel planning process, with the
// boards of Phase 1, 2 and 3 for ML, PF/FL and TFO despatcher, the SOMP checklist (appendix C), the
// products, the FCM and the mission briefing checklist (appendix 2). `check` counts for the completion;
// so does a text field that is marked `req`.
const MP_PHASES = [
  { id: 'order', name: 'Opdracht', long: 'Issue of order', who: 'ML', intro: 'De ML ontvangt de opdracht (LSO, AM, FM of OPCO), waardeert hem met OPCO/LSO/FM/AM, stelt het planningsteam samen, analyseert de opdracht en bouwt een tijdlijn met terugwaartse planning vanaf de vaste tijden.',
    sections: [
      { id: 'order', title: 'De opdracht', items: [
        { id: 'from', type: 'select', label: 'Opdracht van', options: ['LSO', 'AM', 'FM', 'OPCO', 'Anders'] },
        { id: 'received', type: 'time', label: 'Ontvangen om' },
        { id: 'mission', type: 'area', label: 'Missie (wat, waar, wanneer, voor wie)', req: true },
        { id: 'customer', type: 'text', label: 'Klant / aanvrager (G-TL, DSI, eenheid)' },
        { id: 'appreciated', type: 'check', label: 'Opdracht gewaardeerd met OPCO, LSO, FM en/of AM; benodigd materieel toegewezen' },
        { id: 'room', type: 'check', label: 'Planningsruimte geclaimd (af te sluiten vanwege de gevoeligheid)' },
      ] },
      { id: 'team', title: 'Planningsteam', items: [
        { id: 'ml', type: 'text', label: 'Mission Lead (ML)', req: true }, { id: 'fl', type: 'text', label: 'Formation Lead (FL, plv. ML; cel 3)' },
        { id: 'c1', type: 'text', label: 'Cel 1 · weer, terrein, dreiging' }, { id: 'c2', type: 'text', label: 'Cel 2 · enablers: fire support, UAV, GRID' },
        { id: 'c3', type: 'text', label: 'Cel 3 · routes, tijden, comms, missiekaart, config, W&B, NOTAM, vliegplan' }, { id: 'c4', type: 'text', label: 'Cel 4 · landingspunt, troepen, lading, vuur-/video-arcs (TFO trooping)' },
        { id: 'timeobs', type: 'text', label: 'Time observer' }, { id: 'runner', type: 'text', label: 'Runner' }, { id: 'im', type: 'text', label: 'Information manager (Dragon Force, RFI-bord)' },
        { id: 'lso', type: 'text', label: 'LSO (bij CP)' }, { id: 'opco', type: 'text', label: 'OPCO' },
      ] },
      { id: 'timeline', title: 'Tijdlijn (terugwaarts vanaf de vaste tijden)', items: [
        { id: 'lhour', type: 'time', label: 'L-uur (eerste trooping-helikopter wheels/rope on ground)' },
        { id: 'step', type: 'time', label: 'Step / rotor start' }, { id: 'brief', type: 'time', label: 'Mission briefing' }, { id: 'fcm', type: 'time', label: 'FCM' },
        { id: 'somp', type: 'time', label: 'SOMP begint' }, { id: 'icm', type: 'time', label: 'ICM' }, { id: 'guidance', type: 'time', label: 'Initial guidance' },
        { id: 'tl', type: 'table', label: 'Overige tijden', cols: ['Tijd', 'Gebeurtenis', 'Wie'] },
      ] },
    ] },
  { id: 'phase1', name: 'Fase 1', long: 'Resources en status (planbord fase 1)', who: 'ML · PF/FL · TFO', intro: 'Het planbord van fase 1: de ML verzamelt zijn middelen, vult contactgegevens in en wijst in de toestelmatrix bemanningen en configuraties toe. GO/NOGO aan de LSO op weer, bemanning en toestelstatus. Begin van de commcard.',
    sections: [
      { id: 'ml', title: 'Mission Lead', who: 'ML', items: [
        { id: 'date', type: 'text', label: 'Datum' },
        { id: 'pe', type: 'check', label: 'Personal equipment' },
        { id: 'matrix', type: 'table', label: 'Toestelmatrix', cols: ['Tail', 'PNF', 'PF', 'CC', 'EPS', 'Config', 'C/S', 'Fuel', 'PAX'], rows: 4 },
        { id: 'gonogo', type: 'check', label: 'GO/NOGO (WX / CREW / Aircraft) aan de LSO' },
        { id: 'gonogo_v', type: 'select', label: 'Besluit', options: ['GO', 'NOGO', 'Open'] },
        { id: 'commcard', type: 'check', label: 'COMMCARD gestart' },
        { id: 'afl', type: 'check', label: 'AFL' },
        { id: 'qratel', type: 'check', label: 'QRA TEL doorschakelen' },
        { id: 'porto', type: 'check', label: 'Intern porto' }, { id: 'porto_v', type: 'text', label: 'Porto-nummer / kanaal' },
        { id: 'lso', type: 'text', label: 'LSO' }, { id: 'poc', type: 'text', label: 'POC ground units' },
      ] },
      { id: 'pf', title: 'Pilot Flying / FL', who: 'PF/FL', items: [
        { id: 'pe', type: 'check', label: 'Personal equipment' },
        { id: 'efb', type: 'check', label: 'EFB’s (MASTER)' }, { id: 'efb_v', type: 'text', label: 'Master-EFB' },
        { id: 'easyweigh', type: 'check', label: 'Easyweigh' },
        { id: 'weather', type: 'check', label: 'Weather' },
        { id: 'wv', type: 'text', label: 'W/V' }, { id: 'vis', type: 'text', label: 'Vis' }, { id: 'clouds', type: 'text', label: 'Clouds' },
        { id: 'qnh', type: 'text', label: 'QNH' }, { id: 'fzlvl', type: 'text', label: 'Freezing level' }, { id: 'sunmoon', type: 'text', label: 'Sun / Moon' },
        { id: 'ingress_hdg', type: 'text', label: 'Suggested ingress HDG (bij voorkeur tegen de wind in)' },
        { id: 'alts', type: 'text', label: 'Suggested holdings en (en-route) altitudes' },
        { id: 'tactical', type: 'area', label: 'Tactical considerations' },
        { id: 'lvnl', type: 'check', label: 'LVNL Supervisor' }, { id: 'adaminfo', type: 'check', label: 'A’dam Info / DMIL' }, { id: 'aocs', type: 'check', label: 'AOCS' },
        { id: 'xpndr', type: 'check', label: 'XPNDR off: ATC vooraf gebeld (indien van toepassing)', req: false },
      ] },
      { id: 'tfo', title: 'TFO Despatcher', who: 'CC', items: [
        { id: 'pe', type: 'check', label: 'Personal equipment' },
        { id: 'acprep', type: 'check', label: 'Aircraft preparation (cabine gereed voor de missie)' },
        { id: 'config', type: 'check', label: 'Configuration' },
        { id: 'qrf', type: 'check', label: 'Contact details QRF' },
        { id: 'qrfeps', type: 'table', label: 'QRF / EPS', cols: ['QRF', 'EPS'], rows: 3 },
      ] },
    ] },
  { id: 'guidance', name: 'Initial guidance', long: 'Initial guidance en celtaken (pre-SOMP)', who: 'ML', intro: 'Alle leden van het planningsteam zijn aanwezig. De ML deelt de opdracht, de taken, de samenstelling van de cellen, de tijdlijn (of in elk geval wanneer de SOMP begint) en de producten die de SOMP nodig heeft. Geen "briefing ready" producten: geen routes, geen vaste landingspunten.',
    sections: [
      { id: 'brief', title: 'ML brieft', items: [
        { id: 'tasks', type: 'check', label: 'De missie en (sub)taken' },
        { id: 'cells', type: 'check', label: 'Samenstelling van de planningscellen en de celcommandanten, FL' },
        { id: 'timeline', type: 'check', label: 'Voorlopige tijdlijn, of de tijd tot de SOMP' },
        { id: 'products', type: 'check', label: 'Producten die voor de SOMP nodig zijn' },
        { id: 'notes', type: 'area', label: 'Afspraken' },
      ] },
      { id: 'c1', title: 'Cel 1 · weer, terrein, dreiging', who: 'cel 1', items: [
        { id: 'map50', type: 'check', label: '1:50.000 kaart met alle obstakels en het doel duidelijk aangegeven' },
        { id: 'terrain', type: 'check', label: 'Terreinanalyse (COEFAK)' },
        { id: 'wx', type: 'check', label: 'Weer- en dreigingsinterpretatie' },
      ] },
      { id: 'c2', title: 'Cel 2 · enablers', who: 'cel 2', items: [
        { id: 'support', type: 'check', label: 'Ondersteunt cel 1 en 4 bij hun producten' },
        { id: 'assets', type: 'check', label: 'Analyse van deelnemende airborne- en fire support assets (UAV, sniper, video)' },
      ] },
      { id: 'c3', title: 'Cel 3 · coördinerende instructies', who: 'cel 3 (FL)', items: [
        { id: 'map250', type: 'check', label: '1:250.000 kaart met en-route tijden naar het doelgebied en logistieke locaties' },
        { id: 'comms', type: 'check', label: 'Communicatiemogelijkheden geanalyseerd' },
        { id: 'perf', type: 'check', label: 'Met cel 4: configuratie en brandstof voor de prestatieberekening' },
        { id: 'airspace', type: 'check', label: 'Luchtruim, NOTAM en vliegplanstatus' },
      ] },
      { id: 'c4', title: 'Cel 4 · landingspunt', who: 'cel 4 (TFO trooping)', items: [
        { id: 'grid', type: 'check', label: 'GRID of luchtfoto van het doel: obstakels, ramen en deuren, mogelijke landingspunten' },
        { id: 'troops', type: 'check', label: 'Troepen en lading, gunstigste configuratie voor de klant' },
        { id: 'assist', type: 'check', label: 'Assisteert cel 1 bij de terreinanalyse' },
      ] },
    ] },
  { id: 'icm', name: 'ICM', long: 'Initial Coordination Meeting', who: 'ML · G-TL/DSI · LSO · cel 4', intro: 'Met de ML, Ground force Team Leader (G-TL)/DSI, LSO en zo mogelijk een vertegenwoordiger van cel 4: het grondtactisch plan, welke assets de G-TL/DSI nodig heeft en welk effect die moeten bereiken, de verwachte Rules of Engagement, de commandolijn en de communicatie. Daarna kunnen ML en G-TL/DSI plannen op mogelijkheden, beperkingen, effecten en een voorlopig grondtactisch plan.',
    sections: [
      { id: 'present', title: 'Aanwezig', items: [{ id: 'who', type: 'text', label: 'Deelnemers' }, { id: 'at', type: 'time', label: 'Gehouden om' }] },
      { id: 'topics', title: 'Onderwerpen', items: [
        { id: 'intel', type: 'check', label: 'Update van de huidige situatie (intel)' }, { id: 'intel_v', type: 'area', label: 'Intel-situatie' },
        { id: 'assets', type: 'check', label: 'Beschikbare air assets, configuratie, communicatie en bekende beperkingen (ML)' }, { id: 'assets_v', type: 'area', label: 'Assets en beperkingen' },
        { id: 'gtp', type: 'check', label: 'Ruw grondtactisch plan van G-TL/DSI en/of gewenste effecten van de air assets (mogelijke landingspunten, EPS-focus)' }, { id: 'gtp_v', type: 'area', label: 'Grondtactisch plan / gewenste effecten' },
        { id: 'roe', type: 'check', label: 'Rules of Engagement (OPVI, noodweer, …)' }, { id: 'roe_v', type: 'text', label: 'ROE' },
        { id: 'c3', type: 'check', label: 'Command, control en communicatie: wie heeft de leiding in welke fase' }, { id: 'c3_v', type: 'area', label: 'C3' },
      ] },
    ] },
  { id: 'phase2', name: 'Fase 2', long: 'Missie-initiatie (planbord fase 2)', who: 'ML · PF/FL · TFO', intro: 'Het planbord van fase 2: de ML deelt de missie, de dreiging en de eigen eenheden en bespreekt de benodigde configuratie; de PF plant routes, prestaties en brandstof; de CC maakt de producten voor de SOMP en is woordvoerder richting de technische dienst.',
    sections: [
      { id: 'ml', title: 'Mission Lead', who: 'ML', items: [
        { id: 'mission', type: 'area', label: 'Mission', req: true },
        { id: 'threat', type: 'area', label: 'Threat situation · amount, equipment, ML/MD SCOA (most likely / most dangerous course of action)', req: true },
        { id: 'own', type: 'area', label: 'Own units (multipliers) · composition, C/S, comms, position', req: true },
        { id: 'bump', type: 'area', label: 'Bump plan' },
        { id: 'config', type: 'area', label: 'Required configuration', req: true },
      ] },
      { id: 'pf', title: 'Pilot Flying / FL', who: 'PF/FL', items: [
        { id: 'routes', type: 'check', label: 'Routes: in- en outbound routing limitations bepaald' },
        { id: 'pup', type: 'check', label: 'Pick-up point ground forces' }, { id: 'pup_v', type: 'text', label: 'Pick-up point' },
        { id: 'routetimes', type: 'area', label: 'Route times' }, { id: 'playtime', type: 'text', label: 'Playtime' },
        { id: 'perf', type: 'area', label: 'Performance' },
        { id: 'fuel', type: 'check', label: 'Fuel' }, { id: 'missionfuel', type: 'text', label: 'Mission fuel' }, { id: 'bingo', type: 'text', label: 'Bingo fuel' }, { id: 'refuel', type: 'text', label: 'Location of refuel' },
      ] },
      { id: 'tfo', title: 'TFO Despatcher', who: 'CC', items: [
        { id: 'notams', type: 'check', label: 'NOTAMs in map / EFB' },
        { id: 'lz', type: 'check', label: 'Prepare LZ overview and SAT map (bij voorkeur niet uit open bronnen)' },
        { id: 'landingplan', type: 'check', label: 'Prepare landing plan' },
        { id: 'config', type: 'check', label: 'Configuration' },
        { id: 'td', type: 'check', label: 'Coordination with TD (timings, briefing etc.)' },
        { id: 'ground', type: 'check', label: 'Communication ground units' },
      ] },
    ] },
  { id: 'somp', name: 'SOMP', long: 'Scheme Of Maneuver Planning', who: 'ML (leidt) · FL · celcommandanten · G-TL/DSI', intro: 'Van binnen naar buiten plannen: begin bij het doelgebied, dreigingen en kansen, dan ingress en egress, LP-beveiliging, ingress criteria, en pas daarna van de assembly area naar de holding. Pas na een chronologisch SOM de contingencies. Werk op een "clean sheet": ingress- en egresslijnen, deconflictielijnen, fase-lijnen. Schrijf de afspraken op: dat zijn de contracten voor de cellen.',
    sections: [
      { id: 'ms', title: '1 · Mission statement', who: 'ML', items: [{ id: 'statement', type: 'area', label: 'Mission statement', req: true }, { id: 'endstate', type: 'area', label: 'Endstate / effect (work from inside out)', req: true }] },
      { id: 'brief', title: '2 · SOMP briefing', items: [
        { id: 'wx', type: 'check', label: 'Weather (cel 1)' }, { id: 'wx_v', type: 'area', label: 'Weer: w/v, wolkenbasis, zicht, zon/maan, effect op sensor en trooping' },
        { id: 'threat', type: 'check', label: 'Threat (cel 1/4)' }, { id: 'threat_v', type: 'area', label: 'Dreiging: samenstelling, locatie, uitrusting, S-COA' },
        { id: 'terrain', type: 'check', label: 'Terrain · COEFAK (cel 1)' },
        { id: 'cover', type: 'text', label: 'C · Cover / concealment' }, { id: 'obst', type: 'text', label: 'O · Obstacles' }, { id: 'wxeff', type: 'text', label: 'E · Effects of weather' },
        { id: 'fov', type: 'text', label: 'F · Fields of view / fields of fire' }, { id: 'avenues', type: 'text', label: 'A · Avenues of approach / departure' }, { id: 'key', type: 'text', label: 'K · Key terrain' },
        { id: 'lps', type: 'area', label: 'Possible landing points' },
        { id: 'enablers', type: 'check', label: 'Enablers · UAV / sniper / video (cel 2)' }, { id: 'enablers_v', type: 'area', label: 'Enablers' },
        { id: 'routings', type: 'check', label: 'Routings / timings towards target area, airspace (restrictions) (cel 3)' }, { id: 'routings_v', type: 'area', label: 'Routes, tijden en luchtruim' },
      ] },
      { id: 'som', title: '3 · SOM development', who: 'ML · G-TL/DSI', items: [
        { id: 'gtp', type: 'area', label: 'Ground tactical plan (G-TL/DSI)', req: true },
        { id: 'troop', type: 'area', label: 'Trooping a/c plan' }, { id: 'sniper', type: 'area', label: 'Sniper a/c plan' }, { id: 'video', type: 'area', label: 'Video a/c plan' },
        { id: 'ingress', type: 'area', label: 'INGRESS (holding, lead-in 3 min, gate 2 min, 1 min, LP; 200 ft AGL, 70 kt GS)', req: true },
        { id: 'egress', type: 'area', label: 'EGRESS (egress holding, join-up)', req: true },
        { id: 'logistics', type: 'area', label: 'LOGISTICS (pick-up, laager, refuel/reload)' },
        { id: 'swot_s', type: 'text', label: 'SWOT · Strengths' }, { id: 'swot_w', type: 'text', label: 'SWOT · Weaknesses' }, { id: 'swot_o', type: 'text', label: 'SWOT · Opportunities' }, { id: 'swot_t', type: 'text', label: 'SWOT · Threats' },
        { id: 'cont', type: 'area', label: 'Contingencies (pas na het chronologische SOM)', req: true },
      ] },
      { id: 'config', title: '4 · Configuration', who: 'cel 3/4', items: [
        { id: 'payload', type: 'area', label: 'Payload · performance / W&B', req: true }, { id: 'weapons', type: 'text', label: 'Weapons / effects' }, { id: 'flir', type: 'text', label: 'FLIR / sensor (POI, prioriteit)' },
      ] },
      { id: 'c2', title: '5 · Command & control', who: 'ML', items: [
        { id: 'roe', type: 'area', label: 'ROE', req: true },
        { id: 'control', type: 'area', label: 'Control measures' },
        { id: 'deconf', type: 'area', label: 'Deconfliction · hot zone (straal of grenzen), standaard: sectoren N/E/S/W, hoogtebanden binnen 4 km, geen hoogtewisseling tussen 4 en 5 km', req: true },
        { id: 'holdings', type: 'area', label: 'Holding areas (richting, afstand, hoogte: "holding east, 6 km, 1000 ft")', req: true },
      ] },
      { id: 'comms', title: '6 · Communication', who: 'cel 3', items: [
        { id: 'redundant', type: 'area', label: 'Redundant plan · catch freq', req: true },
        { id: 'callsigns', type: 'area', label: 'Call signs', req: true }, { id: 'secure', type: 'text', label: 'Secure comms' }, { id: 'codewords', type: 'area', label: 'Code words' }, { id: 'noncomms', type: 'area', label: 'Non comms' },
      ] },
      { id: 'min', title: 'Minimum result', items: [
        { id: 'deconf', type: 'check', label: 'Deconfliction measures' }, { id: 'c3', type: 'check', label: 'Command and comms plan' }, { id: 'tasks', type: 'check', label: 'Tasks per air asset' }, { id: 'timeline', type: 'check', label: 'Realistic timeline' }, { id: 'backup', type: 'check', label: 'Back-up plan / contingencies' },
      ] },
    ] },
  { id: 'post', name: 'Post-SOMP', long: 'Interne celcoördinatie en productvoorbereiding', who: 'celcommandanten', intro: 'Na de SOMP brieft elke celcommandant de afspraken aan zijn cel en geeft richting in tijden; vragen gaan naar het RFI-bord. Producten worden briefing ready gemaakt en pas na goedkeuring van ML of FL geprint of in Dragon Force gezet.',
    sections: [
      { id: 'cells', title: 'Interne celcoördinatie', items: [
        { id: 'briefed', type: 'check', label: 'Afspraken uit de SOMP gebrieft aan de cellen, met tijden' }, { id: 'rfi', type: 'check', label: 'RFI-bord bijgewerkt' }, { id: 'boards', type: 'check', label: 'Planborden per cel ingevuld (correcties in ROOD)' },
      ] },
      { id: 'products', title: 'Producten (minimum in-flight package)', items: [
        { id: 'map250', type: 'check', label: '1:250.000 kaart of gedeeld routebestand op de EFB: route (ingress/egress), fase-lijnen, relevante obstakels' },
        { id: 'map50', type: 'check', label: '1:50.000 kaart (track-up): ingress, egress, obstakels, holdings, doel, hot zone, luchtruim/NOTAM met frequenties, noordpijl; ook voor pick-up, laager of refuel/reload' },
        { id: 'card', type: 'check', label: 'Missiekaart: radiosets, tijdlijn, en-route/holding/ingress snelheden en hoogten, IIMC, POB, callsigns, brandstof' },
        { id: 'grid', type: 'check', label: 'GRID / luchtfoto doelgebied: horse blanket, kleurcodes, noord, schaal, naam en coördinaten doel, frequenties, ingress/egress/go-around, obstakels (afgestemd met G-TL/DSI en EPS)' },
        { id: 'checked', type: 'check', label: 'Producten gecontroleerd door ML of FL (juistheid, leesbaarheid, bruikbaarheid)' },
        { id: 'printed', type: 'check', label: 'Geprint en in Dragon Force; sets voor elk toestel, CP/LSO en G-TL/DSI' },
        { id: 'fms', type: 'check', label: 'Vliegplan vooraf in de FMS; routes gedeeld (AirDrop)' },
      ] },
    ] },
  { id: 'phase3', name: 'Fase 3', long: 'Geplande inzet (planbord fase 3)', who: 'ML · PF/FL · TFO', intro: 'Het planbord van fase 3: de ML werkt de planning in detail uit, stemt sensoropties en behoeften van de grondeenheden af met LSO en teamcommandant en bereidt de integrale missiebriefing voor. Contingencies, bump plan en ingress criteria worden met LSO en/of teamcommandant geëvalueerd.',
    sections: [
      { id: 'ml', title: 'Mission Lead', who: 'ML', items: [
        { id: 'prepbrief', type: 'check', label: 'Prepare briefing' },
        { id: 'grid', type: 'check', label: 'Produce / check GRID' },
        { id: 'sensor', type: 'check', label: 'Coordinate sensor tasks and deconfliction' },
        { id: 'commcard', type: 'check', label: 'Finalize mission communication card' },
        { id: 'bump', type: 'check', label: 'Coordinate bump plan / ingress criteria / PONR' },
        { id: 'pf', type: 'check', label: 'PF/FL: prestaties gecontroleerd, alle route-items gemaakt; afwijkingen direct aan ML gemeld' },
        { id: 'cc', type: 'check', label: 'CC: bump plan afgestemd met teamleider/pax; LZ-product met GRID (één bruikbaar product) in Dragon Force' },
        { id: 'wb', type: 'check', label: 'W&B digitaal opgeslagen en getekend door de PIC' },
      ] },
    ] },
  { id: 'fcm', name: 'FCM', long: 'Final Coordination Meeting', who: 'ML · G-TL/DSI · LSO · cel 4 (FM/OPCO/AM)', intro: 'Grondtactisch plan en air maneuver plan gesynchroniseerd en gevalideerd. De FCM is de cut-off voor wijzigingen; daarna worden de producten gecontroleerd, geprint en in Dragon Force gezet.',
    sections: [
      { id: 'meta', title: 'Aanwezig', items: [{ id: 'who', type: 'text', label: 'Deelnemers' }, { id: 'at', type: 'time', label: 'Gehouden om' }, { id: 'auth', type: 'text', label: 'Autorisatie (FM / OPCO / AM)' }] },
      { id: 'topics', title: 'Onderwerpen', items: [
        'Situation update', 'Air movement plan, air-to-air deconfliction, taken per air asset', 'Emplaning / deplaning', 'Landing plan en LP security incl. LP recce/scout', 'Alternate landing points', 'Hot zone definition',
        'Ingress, egress en abort criteria en/of hot LP', 'Effect based tactics', 'Ground tactical plan incl. positie eigen personeel (no fire areas) en fire deconfliction', 'Timings: wanneer de actie begint (time driven of on call)',
        'Chain of command, locatie en deelnemers CP', 'Communicatie incl. NON COMMS-optie', 'Dragon Force usage', 'Contingencies (aircraft down / malfunction, bad weather)', 'Bump plan incl. reloading options',
      ].map((l, i) => ({ id: 't' + i, type: 'check', label: l })).concat([{ id: 'notes', type: 'area', label: 'Besluiten en wijzigingen (cut-off)' }]) },
    ] },
  { id: 'briefing', name: 'Mission briefing', long: 'Mission briefing (checklist appendix 2)', who: 'ML · PF/FL · cel 1 · FL · CC', intro: 'Chronologische presentatie van de scheme of maneuver, voorafgegaan door weer, dreiging, gebied en taken; daarna fire support, coördinerende instructies (missiekaart) en logistiek, afgesloten met safety en risk assessment. Hooguit een uur, geen vragen tussendoor; de ML stelt daarna verificatievragen.',
    sections: [
      { id: 'open', title: 'Opening', who: 'ML', items: [{ id: 'rollcall', type: 'check', label: 'Role call' }, { id: 'supervisor', type: 'check', label: 'Supervisor' }, { id: 'cards', type: 'check', label: 'Distribution of cards and maps' }, { id: 'timecheck', type: 'check', label: 'Time check' }, { id: 'at', type: 'time', label: 'Briefing om' }] },
      { id: 'situation', title: '1 · Situation', who: 'ML', items: [{ id: 'area', type: 'check', label: 'Area overview' }, { id: 'suspects', type: 'check', label: 'Suspects: organization, location, actions' }, { id: 'friendly', type: 'check', label: 'Friendly forces: ground units, location, actions, other air units, supporting units' }] },
      { id: 'mission', title: '2 · Mission', who: 'ML', items: [{ id: 'who', type: 'check', label: 'Who' }, { id: 'what', type: 'check', label: 'What: commander’s intent, success criteria, type of mission' }, { id: 'why', type: 'check', label: 'Why' }, { id: 'when', type: 'check', label: 'When' }, { id: 'where', type: 'check', label: 'Where' }] },
      { id: 'weather', title: '3 · Weather', who: 'PF/FL', items: [{ id: 'current', type: 'check', label: 'Current / forecast: wind, cloud base, freezing level/icing, visibility, precipitation, sunrise/set, moonrise/set, illumination' }, { id: 'tactical', type: 'check', label: 'Tactical considerations: position of sun/moon, wind/sound profile, cloud base, effect op sensor/weapons/trooping, effect op suspects' }, { id: 'regs', type: 'check', label: 'Regulations / limitations' }] },
      { id: 'threat', title: '4 · Threat', who: 'cel 1', items: [{ id: 'terrain', type: 'check', label: 'Terrain: cover and concealment, obstacles, effects of weather, fields of view/fire, avenues of approach and departure, key terrain' }, { id: 'suspects', type: 'check', label: 'Suspects: composition, location(s), equipment, CBRN, S-COA' }] },
      { id: 'taskorg', title: '5 · Task organization', who: 'ML', items: [{ id: 'air', type: 'check', label: 'Air asset tasks' }, { id: 'section', type: 'check', label: 'Section tasks' }, { id: 'endurance', type: 'check', label: 'Crew endurance: regulations/limitations, crew change, hand over take over' }] },
      { id: 'som', title: '6 · Scheme of maneuver', who: 'FL (LP: CC)', items: [
        'NOTAM / Birdtam', 'Timeline', 'Formation type', 'Parking, taxi, line up, take off', 'Departure, join up', 'En-route procedures', 'Holding areas', 'Ingress (details)',
        'PUP/LP/DP planning (CC): LP pri/sec/alt, arrival procedure, position own units/UAV, landing/hover plan, loading/unloading, fire sectors (EPS), no fire areas',
        'Egress', 'Join up / holding', 'Deconfliction of air assets', 'Recovery', 'Refuel plan',
      ].map((l, i) => ({ id: 's' + i, type: 'check', label: `${String.fromCharCode(97 + i)}. ${l}` })) },
      { id: 'coord', title: '7 · Coordinating instructions', who: 'ML', items: [
        'Status of a/c, spare', 'Configuration, EPS', 'Performance limitations', 'Required fuel for the mission', 'UAV integration: endurance, deployment/recovery, position, loss of link, comm/image feed/lost comms', 'Rules of Engagement (ROE)', 'Flight plan filing', 'Time schedule', 'Emergency procedures', 'IIMC',
        'Tactics: a/c lighting, IFF-off procedures, altitudes, minimized comms', 'Other missions affecting the flight', 'Hazards', 'Actions on contact', 'Ingress criteria (time / on call)', 'Egress criteria (time / fuel / success / call)', 'Abort criteria', 'BUMP plan', 'Contingency planning', 'Downed a/c procedure', 'Video procedure', 'Pax manifest', 'Dangerous goods',
      ].map((l, i) => ({ id: 'c' + i, type: 'check', label: `${String.fromCharCode(97 + i)}. ${l}` })) },
      { id: 'card', title: '8 · Missioncard', who: 'ML', items: ['Chain of command', 'Location of CP', 'Frequency list', 'Primary, alternate and CATCH freq', 'Air to air freq', 'XPNDR settings', 'Code words'].map((l, i) => ({ id: 'm' + i, type: 'check', label: `${String.fromCharCode(97 + i)}. ${l}` })) },
      { id: 'safety', title: '9 · Safety & risk assessment', who: 'ML', items: [{ id: 'knock', type: 'check', label: 'KNOCK IT OFF (3×) · STOP STOP STOP' }, { id: 'nonstd', type: 'check', label: 'Non-standard: "ANNOUNCE" · "READ BACK" · "FACILITATE"' }, { id: 'risk', type: 'area', label: 'Risk assessment' }, { id: 'questions', type: 'check', label: 'Questions' }, { id: 'rehearsal', type: 'check', label: 'Rehearsal' }] },
    ] },
  { id: 'exec', name: 'Uitvoering', long: 'Crew briefing, toestel, ROC drill, laatste intel', who: 'crews · TD · ML', intro: 'Crew briefing volgens de SOP met de nadruk op ingress, egress en de rol van de crew. Toestelvoorbereiding via OPCO met de TD; walk-around en uitrusting door de crew zelf, vliegplan vooraf in de FMS. Bij tijd een ROC drill met snapshots van de sleutelmomenten; vlak voor de start een intel-update en go/no-go met CP via de LSO.',
    sections: [
      { id: 'crew', title: 'Crew briefing (SOP)', items: [{ id: 'done', type: 'check', label: 'Crew briefing gegeven, nadruk op ingress, egress en de eigen rol' }, { id: 'at', type: 'time', label: 'Om' }] },
      { id: 'ac', title: 'Aircraft preparation', items: [{ id: 'config', type: 'check', label: 'Configuratie via OPCO aan de TD doorgegeven' }, { id: 'walk', type: 'check', label: 'Walk-around en uitrusting aan boord' }, { id: 'fms', type: 'check', label: 'Vliegplan in de FMS' }, { id: 'hoto', type: 'check', label: 'HOTO afgesproken als de wachttijd langer is dan de duurzaamheid van de crew', req: false }] },
      { id: 'roc', title: 'Rehearsal of Concept (ROC drill)', items: [{ id: 'done', type: 'check', label: 'ROC drill gehouden: locatie, rol en radio per crew op de sleutelmomenten, daarna contingencies', req: false }, { id: 'lead', type: 'text', label: 'Geleid door (ML / FM)' }] },
      { id: 'intel', title: 'Last minute intel update', items: [{ id: 'status', type: 'area', label: 'Status doelgebied (UAV, grond) en weer' }, { id: 'gonogo', type: 'select', label: 'GO / NO-GO (i.c.c.w. CP/LSO)', options: ['GO', 'NO-GO', 'Open'] }, { id: 'changes', type: 'area', label: 'Wijzigingen besproken met CP via de LSO; aanvaardbare risico’s' }] },
    ] },
  { id: 'card', name: 'Missiekaart', long: 'Mission card en commcard', who: 'cel 3', intro: 'De missiekaart gaat mee aan boord: commandolijn, CP, frequenties (primary, alternate, catch, emergency), lucht-lucht, transpondercodes, codewoorden, tijdlijn, snelheden en hoogten, IIMC en brandstof. Dit tabblad houdt ook de REDCON-status bij.',
    sections: [
      { id: 'c2', title: 'Command', items: [{ id: 'chain', type: 'area', label: 'Chain of command' }, { id: 'cp', type: 'text', label: 'Location of CP' }, { id: 'redcon', type: 'select', label: 'REDCON', options: ['0', '1', '2', '3', '4', '5'] }] },
      { id: 'freq', title: 'Frequenties', items: [
        { id: 'table', type: 'table', label: 'Radio sets', cols: ['Net', 'Primary', 'Alternate', 'Catch', 'Emergency', 'Opmerking'], rows: 6 },
        { id: 'a2a', type: 'text', label: 'Air to air (ACN)' }, { id: 'c2000', type: 'text', label: 'C2000 command net (ML → CP)' }, { id: 'xpndr', type: 'text', label: 'XPNDR settings' },
      ] },
      { id: 'words', title: 'Codewoorden en standaardcalls', items: [
        { id: 'codewords', type: 'table', label: 'Code words', cols: ['Woord', 'Betekenis'], rows: 6 },
        { id: 'std', type: 'check', label: 'Standaardcalls gebrieft: ECHO SIGHTED · HAMMER · COLA · CLEAR OF THE AREA · ESTABLISHED IN HOLDING AREA X' },
      ] },
      { id: 'params', title: 'Parameters', items: [
        { id: 'speeds', type: 'table', label: 'Snelheden en hoogten', cols: ['Fase', 'Hoogte', 'Snelheid', 'Opmerking'], rows: 4, preset: [['En-route', '', '', ''], ['Holding', '500 ft', '80 KIAS, rechtsom', ''], ['Ingress', '200 ft AGL', '70 kt GS', 'AW: 80 KIAS bij open deuren'], ['Egress', '', '', '']] },
        { id: 'iimc', type: 'area', label: 'IIMC procedure' }, { id: 'pob', type: 'text', label: 'POB per toestel' }, { id: 'fuel', type: 'text', label: 'Fuel requirements' },
      ] },
    ] },
];
const MP_FIELD_TYPES = ['check', 'text', 'area', 'time', 'select', 'table'];
const mpKey = (mid, ph, sec, it) => `${mid}:${ph}.${sec}.${it}`;

/* ---------- missions and fields ---------- */
function mpMissions() { return OPS.list('missions', 'missions').sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)); }
function mpField(mid, ph, sec, it) { const f = OPS.get('missions', 'fields', mpKey(mid, ph, sec, it)); return f ? f.v : undefined; }
function mpSet(mid, ph, sec, it, v) { OPS.put('missions', 'fields', mpKey(mid, ph, sec, it), v == null || v === '' || v === false ? null : { v, by: OPS.screen.name }); }
const mpFilled = (item, v) => (item.type === 'check' ? v === true : item.type === 'table' ? Array.isArray(v) && v.some((r) => r.some((c) => String(c || '').trim())) : v != null && String(v).trim() !== '');
// Progress of a phase (or a section): the checks and required fields that are filled in.
function mpProgress(mid, ph, sec) {
  let done = 0, total = 0;
  for (const s of ph.sections) {
    if (sec && s !== sec) continue;
    for (const it of s.items) {
      const counts = it.type === 'check' ? it.req !== false : !!it.req;
      if (!counts) continue;
      total += 1;
      if (mpFilled(it, mpField(mid, ph.id, s.id, it.id))) done += 1;
    }
  }
  return { done, total, pct: total ? Math.round((done / total) * 100) : 0 };
}
function mpNewMission(name) {
  const id = OPS.uid();
  const order = Math.max(0, ...mpMissions().map((m) => m.order ?? m.createdAt ?? 0)) + 1;
  OPS.put('missions', 'missions', id, { name, status: 'planning', createdAt: tmNow(), by: OPS.screen.name, order });
  return id;
}
// The missions in the order of the list: the order given by hand, else the moment they were made.
const mpOrdered = () => mpMissions().sort((a, b) => (a.order ?? a.createdAt ?? 0) - (b.order ?? b.createdAt ?? 0) || (a.createdAt || 0) - (b.createdAt || 0));
const MP_STATUS = { planning: 'In planning', ready: 'Gereed', active: 'Lopend', done: 'Afgerond', archived: 'Archief' };
// Everything of one mission gone: the mission and every field of it, on every screen.
function mpDelete(m) {
  const fields = OPS.list('missions', 'fields').filter((f) => f.id.startsWith(m.id + ':'));
  OPS.putMany('missions', [{ list: 'missions', id: m.id, item: null }, ...fields.map((f) => ({ list: 'fields', id: f.id, item: null }))]);
}

/* ---------- the tab ---------- */
function mpCreate(body, w) {
  const cfg = w.cfg;
  const root = h('div', { class: 'mp' });
  const bar = h('div', { class: 'zp-bar mp-bar' });
  const nav = h('nav', { class: 'mp-nav' });
  const main = h('div', { class: 'mp-main' });
  root.append(bar, h('div', { class: 'mp-body' }, nav, main));
  body.append(root);
  const mission = () => (cfg.missionId ? OPS.get('missions', 'missions', cfg.missionId) : null);
  // Toolbar: the mission, new, rename, status, export.
  const sel = h('select', { class: 'input zp-sel mp-sel', title: 'Missie kiezen', onchange: () => { cfg.missionId = sel.value || null; cfg.phase = 'overview'; save(); paint(); } });
  const paintSel = () => {
    const list = mpMissions();
    sel.replaceChildren(h('option', { value: '' }, list.length ? 'Kies een missie…' : 'Nog geen missie'), ...list.map((m) => h('option', { value: m.id, selected: m.id === cfg.missionId || null }, `${m.name}${m.status === 'done' ? ' (afgerond)' : m.status === 'archived' ? ' (archief)' : ''}`)));
    sel.value = cfg.missionId && list.some((m) => m.id === cfg.missionId) ? cfg.missionId : '';
  };
  const newBtn = h('button', { class: 'btn zp-btn primary', title: 'Een nieuwe missie aanmaken', onclick: () => newMission() }, icon('plus'), 'Nieuwe missie');
  const progress = h('span', { class: 'mp-progress', hidden: true });
  const newMission = () => {
    const name = textInput('', { maxlength: 40, placeholder: 'bv. Operatie Noordzee, Bijstand DSI 12-11' });
    const lhour = h('input', { class: 'input', type: 'datetime-local' });
    const ok = (close) => { const n = name.value.trim(); if (!n) return false; cfg.missionId = mpNewMission(n); cfg.phase = 'overview'; save(); if (lhour.value) mpSet(cfg.missionId, 'order', 'timeline', 'lhour', lhour.value); paint(); if (close) close(); };
    const close = openModal({ title: 'Nieuwe missie', body: [field('Naam', name), field('L-uur (optioneel, lokale tijd)', lhour, 'Het moment dat de eerste trooping-helikopter wheels on ground is. Later aan te passen in Opdracht › Tijdlijn.')], actions: [{ label: 'Annuleren' }, { label: 'Aanmaken', primary: true, onClick: () => ok() }] });
    name.addEventListener('keydown', (e) => e.key === 'Enter' && ok(close));
  };
  const statusSel = h('select', { class: 'input zp-sel', title: 'Status van de missie', onchange: () => { const m = mission(); if (m) OPS.put('missions', 'missions', m.id, { ...m, status: statusSel.value }); } }, [['planning', 'In planning'], ['ready', 'Gereed'], ['active', 'Lopend'], ['done', 'Afgerond'], ['archived', 'Archief']].map(([v, n]) => h('option', { value: v }, n)));
  const renameBtn = h('button', { class: 'btn zp-btn', title: 'Naam wijzigen', onclick: () => { const m = mission(); if (!m) return; pageNameDialog('Missie hernoemen', m.name, (n) => OPS.put('missions', 'missions', m.id, { ...m, name: n })); } }, icon('edit'));
  const delBtn = h('button', { class: 'btn zp-btn danger', title: 'Missie verwijderen (ook op de andere schermen)', onclick: () => { const m = mission(); if (!m) return; confirmDialog('Missie verwijderen', `"${m.name}" met alles wat is ingevuld verwijderen, ook op de andere schermen? Dit is niet ongedaan te maken.`, 'Verwijderen', () => { mpDelete(m); cfg.missionId = null; save(); paint(); }); } }, icon('trash'));
  const homeBtn = h('button', { class: 'btn zp-btn', title: 'Alle missies: de lijst om te kiezen, te ordenen, te hernoemen of te verwijderen', onclick: () => { cfg.missionId = null; cfg.phase = 'overview'; save(); paint(); } }, icon('folder'), 'Missies');
  const lockBtn = lockButton(mission, () => { const m = mission(); if (m) lockDialog('missions', m, () => paint()); });
  const timingsBtn = h('button', { class: 'btn zp-btn', title: 'De L-uur ketting (holding, 5-3-2-1, HAMMER) als wekkers in Timings zetten', onclick: () => { const m = mission(); const L = m && mpField(m.id, 'order', 'timeline', 'lhour'); if (!L) return toast('Vul eerst het L-uur in onder Opdracht › Tijdlijn', true); mpLhourToTimings(m, L); } }, icon('clock'), 'L-uur → Timings');
  const exportBtn = h('button', { class: 'btn zp-btn', title: 'Het hele plan als PDF (A4)', onclick: () => { const m = mission(); if (m) mpExport(m); } }, icon('download'), 'PDF');
  bar.append(h('span', { class: 'mp-title' }, icon('shield'), 'MISSION PLANNING'), homeBtn, sel, newBtn, renameBtn, statusSel, lockBtn, progress, h('span', { class: 'zp-spacer' }), timingsBtn, exportBtn, delBtn);

  // Navigation: the overview and every phase, each with its progress.
  function paintNav() {
    const m = mission();
    nav.replaceChildren(h('button', { class: 'mp-navbtn' + (cfg.phase === 'overview' ? ' on' : ''), onclick: () => { cfg.phase = 'overview'; save(); paint(); } }, icon('layout'), h('span', {}, 'Overzicht')),
      ...MP_PHASES.map((ph, i) => {
        const p = m ? mpProgress(m.id, ph) : { done: 0, total: 0, pct: 0 };
        return h('button', { class: 'mp-navbtn' + (cfg.phase === ph.id ? ' on' : '') + (p.total && p.done === p.total ? ' done' : ''), onclick: () => { cfg.phase = ph.id; save(); paint(); } },
          h('i', { class: 'mp-navnum' }, String(i + 1)), h('span', {}, ph.name), m ? h('small', {}, `${p.done}/${p.total}`) : null);
      }));
  }
  // The field widgets.
  function fieldEl(mid, ph, sec, it) {
    const v = mpField(mid, ph.id, sec.id, it.id);
    const set = (val) => mpSet(mid, ph.id, sec.id, it.id, val);
    if (it.type === 'check') return h('label', { class: 'mp-check' + (v === true ? ' on' : '') }, h('input', { type: 'checkbox', checked: v === true, onchange: (e) => { set(e.target.checked); e.target.closest('label').classList.toggle('on', e.target.checked); } }), h('span', {}, it.label), it.req === false ? h('small', {}, 'optioneel') : null);
    if (it.type === 'text') return field(it.label + (it.req ? ' *' : ''), textInput(v || '', { onchange: (e) => set(e.target.value.trim()) }), it.hint);
    if (it.type === 'area') return field(it.label + (it.req ? ' *' : ''), h('textarea', { class: 'input mp-area', value: v || '', onchange: (e) => set(e.target.value.trim()) }), it.hint);
    if (it.type === 'time') return field(it.label, h('input', { class: 'input', type: 'datetime-local', value: v || '', onchange: (e) => set(e.target.value) }));
    if (it.type === 'select') { const s = h('select', { class: 'input', onchange: (e) => set(e.target.value) }, [h('option', { value: '' }, '—'), ...it.options.map((o) => h('option', { value: o, selected: v === o || null }, o))]); return field(it.label, s); }
    if (it.type === 'table') {
      const rows = Array.isArray(v) && v.length ? v.map((r) => [...r]) : (it.preset ? it.preset.map((r) => [...r]) : Array.from({ length: it.rows || 3 }, () => it.cols.map(() => '')));
      const tbl = h('table', { class: 'mp-table' }, h('thead', {}, h('tr', {}, it.cols.map((c) => h('th', {}, c)), h('th'))));
      const tb = h('tbody');
      const commit = () => set(rows.some((r) => r.some((c) => String(c).trim())) ? rows : null);
      const paintRows = () => tb.replaceChildren(...rows.map((r, ri) => h('tr', {}, r.map((c, ci) => h('td', {}, h('input', { class: 'input', value: c, onchange: (e) => { rows[ri][ci] = e.target.value; commit(); } }))), h('td', {}, h('button', { class: 'w-tool', title: 'Rij verwijderen', onclick: () => { rows.splice(ri, 1); commit(); paintRows(); } }, icon('close'))))));
      paintRows();
      tbl.append(tb);
      return h('div', { class: 'field' }, h('label', {}, it.label), h('div', { class: 'mp-tablewrap' }, tbl), h('button', { class: 'btn mp-addrow', onclick: () => { rows.push(it.cols.map(() => '')); paintRows(); } }, icon('plus'), 'Rij'));
    }
    return null;
  }
  function phasePage(m, ph) {
    const p = mpProgress(m.id, ph);
    return h('div', { class: 'mp-phase' },
      h('div', { class: 'mp-phase-head' },
        h('div', {}, h('h2', {}, ph.long), h('p', {}, ph.intro), h('small', {}, `Wie: ${ph.who}`)),
        h('div', { class: 'mp-ring' + (p.total && p.done === p.total ? ' done' : '') }, ringSvg(p.pct), h('b', {}, `${p.pct}%`), h('small', {}, `${p.done} van ${p.total}`))),
      ...ph.sections.map((sec) => {
        const sp = mpProgress(m.id, ph, sec);
        return h('section', { class: 'mp-sec' + (sp.total && sp.done === sp.total ? ' done' : '') },
          h('div', { class: 'mp-sec-head' }, h('h3', {}, sec.title), sec.who ? h('span', { class: 'mp-who' }, sec.who) : null, sp.total ? h('span', { class: 'zp-fold-badge' }, `${sp.done}/${sp.total}`) : null),
          h('div', { class: 'mp-items' }, sec.items.map((it) => fieldEl(m.id, ph, sec, it))));
      }),
      h('div', { class: 'mp-phase-foot' },
        MP_PHASES.indexOf(ph) > 0 ? h('button', { class: 'btn', onclick: () => { cfg.phase = MP_PHASES[MP_PHASES.indexOf(ph) - 1].id; save(); paint(); } }, icon('left'), MP_PHASES[MP_PHASES.indexOf(ph) - 1].name) : h('span'),
        MP_PHASES.indexOf(ph) < MP_PHASES.length - 1 ? h('button', { class: 'btn primary', onclick: () => { cfg.phase = MP_PHASES[MP_PHASES.indexOf(ph) + 1].id; save(); paint(); } }, MP_PHASES[MP_PHASES.indexOf(ph) + 1].name, icon('right')) : h('button', { class: 'btn primary', onclick: () => { cfg.phase = 'overview'; save(); paint(); } }, 'Naar het overzicht')));
  }
  const ringSvg = (pct) => { const s = h('svg', { class: 'tm-ring', viewBox: '0 0 36 36' }); s.innerHTML = `<circle class="tm-ring-bg" cx="18" cy="18" r="15.9"/><circle class="tm-ring-fg" cx="18" cy="18" r="15.9" stroke-dasharray="${pct} 100"/>`; return s; };
  function overview(m) {
    const all = MP_PHASES.map((ph) => ({ ph, p: mpProgress(m.id, ph) }));
    const done = all.reduce((n, x) => n + x.p.done, 0), total = all.reduce((n, x) => n + x.p.total, 0);
    const pct = total ? Math.round((done / total) * 100) : 0;
    const L = mpField(m.id, 'order', 'timeline', 'lhour');
    const lms = L ? new Date(L).getTime() : null;
    const open = [];
    for (const { ph } of all) for (const sec of ph.sections) for (const it of sec.items) if ((it.type === 'check' ? it.req !== false : !!it.req) && !mpFilled(it, mpField(m.id, ph.id, sec.id, it.id))) open.push({ ph, sec, it });
    const fields = OPS.list('missions', 'fields').filter((f) => f.id.startsWith(m.id + ':')).sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 8);
    return h('div', { class: 'mp-over' },
      h('div', { class: 'mp-over-head' },
        h('div', { class: 'mp-over-title' }, h('span', { class: 'mp-status ' + m.status }, { planning: 'IN PLANNING', ready: 'GEREED', active: 'LOPEND', done: 'AFGEROND', archived: 'ARCHIEF' }[m.status] || m.status), h('h2', {}, m.name), h('p', {}, `Aangemaakt ${new Date(m.createdAt).toLocaleString('nl-NL')}${m.by ? ' op ' + m.by : ''}${mpField(m.id, 'order', 'order', 'mission') ? ' · ' + String(mpField(m.id, 'order', 'order', 'mission')).slice(0, 140) : ''}`)),
        h('div', { class: 'mp-over-l' }, h('small', {}, 'L-UUR'), h('b', {}, lms ? `${ltFmt.format(lms)} LT` : '—'), lms ? h('span', {}, `${zulu(lms)} · ${lms > tmNow() ? 'over ' + tmClock(lms - tmNow(), { seconds: false }) : tmClock(tmNow() - lms, { seconds: false }) + ' geleden'}`) : h('span', {}, 'Vul in onder Opdracht › Tijdlijn')),
        h('div', { class: 'mp-ring big' + (total && done === total ? ' done' : '') }, ringSvg(pct), h('b', {}, `${pct}%`), h('small', {}, total && done === total ? 'SOMP compleet' : `${done} van ${total}`))),
      h('div', { class: 'mp-cards' }, all.map(({ ph, p }, i) => h('button', { class: 'mp-card' + (p.total && p.done === p.total ? ' done' : p.done ? ' busy' : ''), onclick: () => { cfg.phase = ph.id; save(); paint(); } },
        h('div', { class: 'mp-card-top' }, h('i', { class: 'mp-navnum' }, String(i + 1)), h('b', {}, ph.name), h('span', { class: 'mp-card-pct' }, `${p.pct}%`)),
        h('div', { class: 'mp-prog' }, h('i', { style: `width:${p.pct}%` })),
        h('small', {}, ph.long), h('span', { class: 'mp-card-who' }, ph.who)))),
      h('div', { class: 'mp-over-cols' },
        h('section', { class: 'mp-sec' }, h('div', { class: 'mp-sec-head' }, h('h3', {}, 'Nog open'), h('span', { class: 'zp-fold-badge' }, String(open.length))),
          open.length ? h('div', { class: 'mp-open' }, open.slice(0, 40).map((o) => h('button', { class: 'zp-linkbtn', onclick: () => { cfg.phase = o.ph.id; save(); paint(); } }, h('b', {}, o.it.label.replace(/\s\*$/, '')), h('small', {}, `${o.ph.name} › ${o.sec.title}`))), open.length > 40 ? h('p', { class: 'zp-hint' }, `… en ${open.length - 40} meer`) : null) : h('p', { class: 'zp-hint ok' }, 'Alles is ingevuld en afgevinkt.')),
        h('section', { class: 'mp-sec' }, h('div', { class: 'mp-sec-head' }, h('h3', {}, 'Laatst gewijzigd')),
          fields.length ? h('div', { class: 'mp-recent' }, fields.map((f) => { const [, key] = f.id.split(':'); const [phId, secId, itId] = key.split('.'); const ph = MP_PHASES.find((x) => x.id === phId), sec = ph && ph.sections.find((x) => x.id === secId), it = sec && sec.items.find((x) => x.id === itId); return h('div', { class: 'mp-recent-row' }, h('b', {}, it ? it.label.replace(/\s\*$/, '') : key), h('small', {}, `${ph ? ph.name : ''} · ${f.by || '—'} · ${ltFmt.format(f.updatedAt)}`)); })) : h('p', { class: 'zp-hint' }, 'Nog niets ingevuld.'))));
  }
  // The home page: a new mission, and every mission of the unit in a list to open, order, rename or remove.
  function home() {
    const list = mpOrdered();
    const open = (m) => { cfg.missionId = m.id; cfg.phase = 'overview'; save(); paint(); };
    const move = (m, dir) => {
      const i = list.findIndex((x) => x.id === m.id), j = i + dir;
      if (j < 0 || j >= list.length) return;
      const a = list[i], b = list[j];
      const oa = a.order ?? a.createdAt ?? 0, ob = b.order ?? b.createdAt ?? 0;
      OPS.putMany('missions', [{ list: 'missions', id: a.id, item: { ...a, order: ob } }, { list: 'missions', id: b.id, item: { ...b, order: oa } }].map((x) => { delete x.item.id; return x; }));
      if (oa === ob) OPS.put('missions', 'missions', a.id, { ...a, order: ob - dir, id: undefined });
    };
    const rows = list.map((m, i) => {
      const all = MP_PHASES.map((ph) => mpProgress(m.id, ph));
      const done = all.reduce((n, p) => n + p.done, 0), total = all.reduce((n, p) => n + p.total, 0);
      const pct = total ? Math.round((done / total) * 100) : 0;
      const L = mpField(m.id, 'order', 'timeline', 'lhour');
      const shut = !!(m.lock && !m.lockOpen);
      return h('div', { class: 'mp-mission' + (m.status === 'archived' ? ' archived' : '') + (m.lock ? ' locked' : '') },
        h('button', { class: 'mp-mission-main', title: shut ? 'Vergrendeld: pincode nodig' : 'Missie openen', onclick: () => open(m) },
          h('i', { class: 'mp-navnum' }, shut ? icon('lock') : String(i + 1)),
          h('div', { class: 'mp-mission-text' },
            h('div', { class: 'mp-mission-top' }, h('b', {}, m.name), m.lock ? h('span', { class: 'mp-lock', title: m.lockOpen ? 'Vergrendeld, zichtbaar op dit scherm' : 'Vergrendeld op een ander scherm' }, icon('lock'), m.lockOpen ? 'VERGRENDELD' : 'PINCODE') : null, h('span', { class: 'mp-status ' + m.status }, (MP_STATUS[m.status] || m.status).toUpperCase())),
            h('small', {}, `${shut ? 'inhoud vergrendeld' + (m.lock.hint ? ' · ' + m.lock.hint : '') : `${pct}% · ${done} van ${total}`}${L && !shut ? ' · L-uur ' + String(L).replace('T', ' ') : ''} · aangemaakt ${new Date(m.createdAt).toLocaleDateString('nl-NL', { day: 'numeric', month: 'short' })}${m.by ? ' op ' + m.by : ''}`),
            shut ? null : h('div', { class: 'mp-prog' + (total && done === total ? ' done' : '') }, h('i', { style: `width:${pct}%` })))),
        h('div', { class: 'mp-mission-acts' },
          h('button', { class: 'w-tool', title: 'Naam wijzigen', onclick: () => pageNameDialog('Missie hernoemen', m.name, (n) => OPS.put('missions', 'missions', m.id, { ...m, name: n, id: undefined })) }, icon('edit')),
          h('button', { class: 'w-tool', title: 'Omhoog in de lijst', disabled: i === 0 || null, onclick: () => move(m, -1) }, icon('arrowUp')),
          h('button', { class: 'w-tool', title: 'Omlaag in de lijst', disabled: i === list.length - 1 || null, onclick: () => move(m, 1) }, icon('arrowDown')),
          h('button', { class: 'w-tool danger', title: 'Missie verwijderen', onclick: () => confirmDialog('Missie verwijderen', `"${m.name}" met alles wat is ingevuld (${OPS.list('missions', 'fields').filter((f) => f.id.startsWith(m.id + ':')).length} velden) verwijderen, ook op de andere schermen? Dit is niet ongedaan te maken.`, 'Verwijderen', () => { mpDelete(m); if (cfg.missionId === m.id) cfg.missionId = null; save(); paint(); }) }, icon('trash'))));
    });
    return h('div', { class: 'mp-home' },
      h('div', { class: 'mp-home-head' }, icon('shield'), h('h2', {}, 'Mission Planning'), h('p', {}, 'De Scheme Of Maneuver Planning van de TACSOP, digitaal: van de opdracht tot en met de missiekaart. Alles wat je invult staat direct op alle schermen van de eenheid.')),
      h('button', { class: 'btn primary mp-newbtn', onclick: newMission }, icon('plus'), 'Nieuwe missie'),
      h('div', { class: 'mp-list' }, h('div', { class: 'mp-list-head' }, h('b', {}, 'Missies'), h('span', { class: 'zp-fold-badge' }, String(list.length))),
        rows.length ? rows : h('p', { class: 'zp-hint' }, 'Nog geen missies. Maak er een met Nieuwe missie.')));
  }
  function paint() {
    paintSel();
    const m = mission();
    statusSel.value = m ? m.status || 'planning' : 'planning';
    statusSel.disabled = renameBtn.disabled = delBtn.disabled = exportBtn.disabled = timingsBtn.disabled = !m;
    lockBtn.paint();
    if (m && m.lock && !m.lockOpen) exportBtn.disabled = timingsBtn.disabled = true;
    if (m) {
      const all = MP_PHASES.map((ph) => mpProgress(m.id, ph));
      const done = all.reduce((n, p) => n + p.done, 0), total = all.reduce((n, p) => n + p.total, 0);
      progress.hidden = false;
      progress.className = 'mp-progress' + (total && done === total ? ' done' : '');
      progress.replaceChildren(h('i', { style: `--p:${total ? Math.round((done / total) * 100) : 0}%` }), h('span', {}, `${total ? Math.round((done / total) * 100) : 0}% · ${done}/${total}`));
      progress.title = 'Voortgang van de hele SOMP: checks en verplichte velden';
    } else progress.hidden = true;
    paintNav();
    // Never while someone is typing: a field would be taken away under their fingers.
    if (main.contains(document.activeElement) && /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName)) { pending = true; return; }
    pending = false;
    const scroll = main.scrollTop;
    if (!m) main.replaceChildren(home());
    else if (m.lock && !m.lockOpen) main.replaceChildren(lockedCover('missions', m, paint));
    else if (cfg.phase === 'overview' || !MP_PHASES.some((p) => p.id === cfg.phase)) main.replaceChildren(overview(m));
    else main.replaceChildren(phasePage(m, MP_PHASES.find((p) => p.id === cfg.phase)));
    main.scrollTop = scroll;
  }
  let pending = false;
  main.addEventListener('focusout', () => { if (pending) setTimeout(() => { if (pending) paint(); }, 100); });
  const unsub = OPS.on('missions', (what) => { if (what && what.local) { paintNav(); if (cfg.phase === 'overview') paint(); return; } paint(); });
  paint();
  return { paint, destroy() { unsub(); } };
}

// The L-hour chain of this mission into Timings.
function mpLhourToTimings(m, L) {
  const lms = new Date(L).getTime();
  if (!(lms > tmNow())) return toast('Het L-uur ligt in het verleden', true);
  const chain = OPS.uid();
  const puts = TM_LHOUR.map((e, i) => ({ list: 'timers', id: OPS.uid(), item: { ...tmNew('alarm', { label: `${m.name} · ${e.min ? `L-${e.min} ` : 'L '}${e.label}`, note: e.note, cat: 'mission', at: lms - e.min * 60000, warnMin: 1, chain, order: tmNow() + i, popup: e.min === 0 ? true : null }) } }));
  OPS.putMany('ops', puts);
  toast(`${puts.length} wekkers gezet rond L-uur ${ltFmt.format(lms)} LT`);
}

// The whole plan as a PDF: every phase, every field, in the order of the TACSOP.
function mpExport(m) {
  const esc = escHtml;
  const parts = [];
  for (const ph of MP_PHASES) {
    const p = mpProgress(m.id, ph);
    parts.push(`<h2>${esc(ph.long)} <small>${esc(ph.who)} · ${p.done}/${p.total}</small></h2>`);
    for (const sec of ph.sections) {
      const rows = [];
      for (const it of sec.items) {
        const v = mpField(m.id, ph.id, sec.id, it.id);
        if (it.type === 'check') rows.push(`<div class="c ${v === true ? 'on' : ''}"><i>${v === true ? '☑' : '☐'}</i>${esc(it.label)}</div>`);
        else if (it.type === 'table') { if (Array.isArray(v) && v.length) rows.push(`<div class="k">${esc(it.label)}</div><table><tr>${it.cols.map((c) => `<th>${esc(c)}</th>`).join('')}</tr>${v.map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join('')}</tr>`).join('')}</table>`); }
        else if (v != null && String(v).trim()) rows.push(`<div class="kv"><span>${esc(it.label.replace(/\s\*$/, ''))}</span><b>${esc(it.type === 'time' ? String(v).replace('T', ' ') : v)}</b></div>`);
      }
      if (rows.length) parts.push(`<h3>${esc(sec.title)}${sec.who ? ` <small>${esc(sec.who)}</small>` : ''}</h3>${rows.join('')}`);
    }
  }
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>
  body{font:10.5pt/1.35 "Segoe UI",Arial,sans-serif;color:#111;margin:0}h1{font-size:18pt;margin:0 0 2pt}h1 small{font-weight:400;color:#555;font-size:10pt}
  h2{font-size:13pt;margin:14pt 0 4pt;padding-bottom:2pt;border-bottom:2px solid #0b2a5b;page-break-after:avoid}h2 small,h3 small{font-weight:400;color:#666;font-size:9pt;margin-left:6pt}
  h3{font-size:11pt;margin:8pt 0 3pt;color:#0b2a5b;page-break-after:avoid}.c{padding:1pt 0}.c i{font-style:normal;margin-right:4pt}.c.on{color:#1b6f2f}
  .kv{display:flex;gap:6pt;padding:1.5pt 0;border-bottom:1px dotted #ccc}.kv span{flex:0 0 38%;color:#555}.kv b{font-weight:600;white-space:pre-wrap}
  .k{color:#555;margin-top:3pt}table{border-collapse:collapse;width:100%;margin:2pt 0 4pt;font-size:9.5pt}th,td{border:1px solid #bbb;padding:2pt 4pt;text-align:left}th{background:#eef2f8}
  .head{display:flex;justify-content:space-between;align-items:flex-end;border-bottom:3px solid #0b2a5b;padding-bottom:4pt}.head .r{text-align:right;font-size:9pt;color:#555}
  </style></head><body><div class="head"><div><h1>${esc(m.name)} <small>Mission Planning · SOMP</small></h1><div>Politie Afdeling Luchtvaart · TACSOP AW139 · Politie Intern</div></div><div class="r">Status: ${esc(m.status)}<br>Afgedrukt ${new Date().toLocaleString('nl-NL')}</div></div>${parts.join('')}</body></html>`;
  window.palv.plan.printPdf({ html, name: `missie-${m.name.replace(/[^\w-]+/g, '_')}.pdf`, pageSize: 'A4' }).then((r) => { if (r && r.ok) toast('PDF opgeslagen'); else if (r && r.error) toast(r.error, true); });
}
