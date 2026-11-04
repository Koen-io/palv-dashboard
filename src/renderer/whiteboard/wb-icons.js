'use strict';

/* ============================================================
   Whiteboard — de iconenbibliotheek: vectoren (SVG, 64 × 64) die in elke kleur en op elke grootte
   scherp blijven. Helikopters en vliegtuigen, voertuigen, vaartuigen, personen, gebouwen en
   infrastructuur, natuur en dieren, en de tactische symbolen uit de TACSOP (lead-in, gate, holding,
   hot zone, deconflictie, LP/PUP/DP, no fire area, CP).
   ============================================================ */
const WB_CATS = { air: 'Luchtvaart', veh: 'Voertuigen', sea: 'Vaartuigen', per: 'Personen', inf: 'Gebouwen en infra', nat: 'Natuur en dieren', tac: 'Tactisch', mrk: 'Markeringen' };
// Every icon: id, name, category, keywords, and the SVG inside a 64 × 64 box. Strokes use currentColor;
// `fill` marks what gets the colour as fill (solid shapes). Text in an icon is drawn in the same colour.
const WB_ICONS = [];
// `extra`: size (a standard size on the board, for a diagram used as a base) and own (keeps its own colours).
const wbIcon = (id, name, cat, svg, kw = '', extra = {}) => WB_ICONS.push({ id, name, cat, kw: (name + ' ' + kw).toLowerCase(), svg, ...extra });
const WB_S = 'fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"';
const WB_T = (x, y, txt, size = 14) => `<text x="${x}" y="${y}" font-family="Bahnschrift,Segoe UI,Arial,sans-serif" font-weight="700" font-size="${size}" text-anchor="middle" fill="currentColor" stroke="none">${txt}</text>`;

/* ---------- luchtvaart ---------- */
// AW139 from above: wide cabin, five blades, long tail with the tail rotor at the right.
wbIcon('aw139', 'AW139 (bovenaanzicht)', 'air', `<g ${WB_S}><path d="M32 8 32 56" stroke-width="2"/><ellipse cx="32" cy="30" rx="7" ry="16" fill="currentColor" fill-opacity="0.25"/><path d="M27 17 37 17M25 24h14M25 36h14"/><path d="M32 46 32 58M29 58h6"/><g stroke-width="2.2"><path d="M32 30 32 6"/><path d="M32 30 54.8 37.4"/><path d="M32 30 46.1 49.4"/><path d="M32 30 17.9 49.4"/><path d="M32 30 9.2 37.4"/></g><circle cx="32" cy="30" r="2.6" fill="currentColor"/><path d="M28 60h8" stroke-width="2"/></g>`, 'helikopter heli politie aw agusta trooping');
// EC135 from above: shorter, four blades, fenestron tail.
wbIcon('ec135', 'EC135 (bovenaanzicht)', 'air', `<g ${WB_S}><ellipse cx="32" cy="30" rx="6.5" ry="13" fill="currentColor" fill-opacity="0.25"/><path d="M27 21h10M26 30h12"/><path d="M32 43 32 55"/><circle cx="32" cy="57" r="3.5"/><g stroke-width="2.2"><path d="M32 30V9M32 30h21M32 30v21M32 30H11"/></g><circle cx="32" cy="30" r="2.4" fill="currentColor"/></g>`, 'helikopter heli politie ec eurocopter airbus h135');
wbIcon('heli', 'Helikopter (zijaanzicht)', 'air', `<g ${WB_S}><path d="M8 20h40M28 20v-4M22 30c0-5 4-8 10-8h8c6 0 10 4 10 10v2c0 4-3 6-7 6H26c-3 0-4-2-4-5Z" fill="currentColor" fill-opacity="0.2"/><path d="M22 32 8 28M8 24v8M18 46h20M24 40v6M36 40v6"/></g>`, 'helikopter heli generiek');
wbIcon('h145', 'H145 / trauma', 'air', `<g ${WB_S}><ellipse cx="32" cy="31" rx="6.5" ry="13" fill="currentColor" fill-opacity="0.25"/><path d="M32 44v10M26 56h12"/><g stroke-width="2.2"><path d="M32 31V9M32 31h22M32 31v22M32 31H10"/></g><circle cx="32" cy="31" r="2.4" fill="currentColor"/><path d="M32 23v8M28 27h8" stroke-width="3"/></g>`, 'trauma ambulance lifeliner helikopter');
wbIcon('aw189', 'AW189 / SAR kustwacht', 'air', `<g ${WB_S}><ellipse cx="32" cy="30" rx="7.5" ry="17" fill="currentColor" fill-opacity="0.25"/><path d="M32 47v9M28 58h8"/><g stroke-width="2.2"><path d="M32 30 32 6M32 30 54.8 37.4M32 30 46.1 49.4M32 30 17.9 49.4M32 30 9.2 37.4"/></g><circle cx="32" cy="30" r="2.6" fill="currentColor"/><path d="M40 20h8" stroke-width="2"/></g>`, 'sar kustwacht rescue helikopter');
wbIcon('drone', 'Drone / UAV', 'air', `<g ${WB_S}><rect x="26" y="26" width="12" height="12" rx="3" fill="currentColor" fill-opacity="0.3"/><path d="M26 26 16 16M38 26l10-10M26 38 16 48M38 38l10 10"/><circle cx="14" cy="14" r="6"/><circle cx="50" cy="14" r="6"/><circle cx="14" cy="50" r="6"/><circle cx="50" cy="50" r="6"/></g>`, 'rpas uav quadcopter onbemand');
wbIcon('fixedwing', 'Vliegtuig', 'air', `<g ${WB_S}><path d="M32 6c3 0 4 3 4 8v10l20 11v5l-20-6v12l6 5v4l-10-3-10 3v-4l6-5V34L8 40v-5l20-11V14c0-5 1-8 4-8Z" fill="currentColor" fill-opacity="0.3"/></g>`, 'vliegtuig dash 8 kustwacht fixed wing');
wbIcon('helipad', 'Helipad', 'air', `<g ${WB_S}><circle cx="32" cy="32" r="24"/><circle cx="32" cy="32" r="19" stroke-dasharray="4 3"/>${WB_T(32, 42, 'H', 30)}</g>`, 'helipad helidek landingsplaats h');
wbIcon('runway', 'Start- en landingsbaan', 'air', `<g ${WB_S}><path d="M22 4h20v56H22Z" fill="currentColor" fill-opacity="0.25"/><path d="M32 10v8M32 24v8M32 38v8M32 52v6M26 6v6M38 6v6M26 52v6M38 52v6" stroke-width="2"/></g>`, 'baan runway landingsbaan vliegveld');
wbIcon('airport', 'Vliegveld', 'air', `<g ${WB_S}><circle cx="32" cy="32" r="24"/><path d="M32 12c2 0 3 2 3 6v8l16 9v4l-16-5v10l5 4v3l-8-2-8 2v-3l5-4V34l-16 5v-4l16-9v-8c0-4 1-6 3-6Z" fill="currentColor" fill-opacity="0.4"/></g>`, 'vliegveld airport luchthaven');
wbIcon('windsock', 'Windzak', 'air', `<g ${WB_S}><path d="M14 10v48M14 14l36 6v10l-36 6Z" fill="currentColor" fill-opacity="0.3"/><path d="M26 16v18M38 18v14"/></g>`, 'wind windzak');
wbIcon('holding', 'Holding (rechtsom, 80 kt, 500 ft)', 'air', `<g ${WB_S}><path d="M20 18h24a12 12 0 0 1 0 24H20a12 12 0 0 1 0-24Z" stroke-dasharray="6 4"/><path d="M40 18l-5-4M40 18l-5 4"/><path d="M24 42l5-4M24 42l5 4"/>${WB_T(32, 56, 'HOLD', 11)}</g>`, 'holding wachtpatroon orbit');
wbIcon('leadin', '1LEAD · lead-in (3 min)', 'tac', `<g ${WB_S}><circle cx="32" cy="30" r="20" stroke-width="3.2"/>${WB_T(32, 35, 'LEAD', 12)}${WB_T(32, 60, '3 MIN', 10)}</g>`, 'lead in ingress 3 minuten cirkel');
wbIcon('gate', '1GATE · gate (2 min)', 'tac', `<g ${WB_S}><rect x="10" y="12" width="44" height="36" stroke-width="3.2"/>${WB_T(32, 35, 'GATE', 12)}${WB_T(32, 60, '2 MIN', 10)}</g>`, 'gate ingress 2 minuten vierkant');
wbIcon('onemin', '1-minuutpunt', 'tac', `<g ${WB_S}><path d="M32 8v48" stroke-dasharray="5 4" stroke-width="2"/><path d="M10 32h20" stroke-width="4"/>${WB_T(16, 24, '1', 16)}</g>`, '1 minuut streep ingress');
wbIcon('target', 'Doel', 'tac', `<g ${WB_S}><circle cx="32" cy="32" r="22"/><circle cx="32" cy="32" r="12"/><circle cx="32" cy="32" r="3" fill="currentColor"/><path d="M32 4v10M32 50v10M4 32h10M50 32h10"/></g>`, 'doel target objective tgt');
wbIcon('hotzone', 'Hot zone', 'tac', `<g ${WB_S}><circle cx="32" cy="32" r="26" stroke-dasharray="7 4" stroke-width="3"/><path d="M22 44l10-24 10 24Z" fill="currentColor" fill-opacity="0.35"/>${WB_T(32, 60, 'HOT', 10)}</g>`, 'hot zone deconflictie gebied');
wbIcon('deconf', 'Deconflictie-standaard (4/5 km, N-E-S-W)', 'tac', `<g ${WB_S}><circle cx="32" cy="32" r="29" stroke-width="1.8" stroke-dasharray="4 3"/><circle cx="32" cy="32" r="23" stroke-width="2"/><path d="M32 3v58M3 32h58" stroke-width="1.6"/><circle cx="32" cy="32" r="3" fill="currentColor"/>${WB_T(32, 14, 'N', 11)}${WB_T(50, 36, 'E', 11)}${WB_T(32, 56, 'S', 11)}${WB_T(14, 36, 'W', 11)}</g>`, 'deconflictie sectoren hoogtebanden holding areas');
wbIcon('lp', 'LP · landingspunt', 'tac', `<g ${WB_S}><circle cx="32" cy="32" r="24" fill="currentColor" fill-opacity="0.15"/>${WB_T(32, 39, 'LP', 20)}</g>`, 'landing point landingspunt lz');
wbIcon('pup', 'PUP · pick-up point', 'tac', `<g ${WB_S}><circle cx="32" cy="32" r="24" fill="currentColor" fill-opacity="0.15"/>${WB_T(32, 39, 'PUP', 17)}</g>`, 'pick up point oppikpunt troepen');
wbIcon('dp', 'DP · drop point', 'tac', `<g ${WB_S}><circle cx="32" cy="32" r="24" fill="currentColor" fill-opacity="0.15"/>${WB_T(32, 39, 'DP', 20)}</g>`, 'drop point afzetpunt');
wbIcon('lz', 'LZ · landing zone', 'tac', `<g ${WB_S}><rect x="8" y="8" width="48" height="48" rx="6" fill="currentColor" fill-opacity="0.15" stroke-dasharray="6 4"/>${WB_T(32, 39, 'LZ', 20)}</g>`, 'landing zone landingszone');
wbIcon('farp', 'FARP / refuel', 'tac', `<g ${WB_S}><path d="M14 56V14a4 4 0 0 1 4-4h18a4 4 0 0 1 4 4v42Z" fill="currentColor" fill-opacity="0.2"/><path d="M18 22h18M40 26h4a4 4 0 0 1 4 4v14a3 3 0 0 0 6 0V22l-6-6M10 56h34"/></g>`, 'brandstof tanken farp refuel reload');
wbIcon('cp', 'CP · commandopost', 'tac', `<g ${WB_S}><path d="M8 54V18l24-10 24 10v36Z" fill="currentColor" fill-opacity="0.15"/>${WB_T(32, 42, 'CP', 18)}</g>`, 'command post commandopost opco');
wbIcon('op', 'OP · observatiepost', 'tac', `<g ${WB_S}><path d="M8 40 32 12l24 28Z" fill="currentColor" fill-opacity="0.15"/><circle cx="32" cy="32" r="5"/><path d="M8 52h48"/>${WB_T(32, 60, 'OP', 10)}</g>`, 'observatie post uitkijk');
wbIcon('rv', 'RV · verzamelpunt', 'tac', `<g ${WB_S}><path d="M32 6 58 32 32 58 6 32Z" fill="currentColor" fill-opacity="0.15"/>${WB_T(32, 38, 'RV', 17)}</g>`, 'rendez vous verzamelpunt assembly');
wbIcon('nfa', 'No fire area', 'tac', `<g ${WB_S}><circle cx="32" cy="32" r="24" stroke-dasharray="3 3"/><path d="M14 14l36 36" stroke-width="3.5"/>${WB_T(32, 60, 'NFA', 10)}</g>`, 'no fire area geen vuur');
wbIcon('phaseline', 'Fase-lijn', 'tac', `<g ${WB_S}><path d="M4 32h56" stroke-width="3"/><path d="M4 28v8M60 28v8"/>${WB_T(32, 24, 'PL', 11)}</g>`, 'phase line faselijn');
wbIcon('ingress', 'Ingress-pijl', 'tac', `<g ${WB_S}><path d="M6 32h40" stroke-width="4"/><path d="M38 20l14 12-14 12" stroke-width="4"/>${WB_T(24, 50, 'IN', 11)}</g>`, 'ingress aanvliegroute');
wbIcon('egress', 'Egress-pijl', 'tac', `<g ${WB_S}><path d="M58 32H18" stroke-width="4" stroke-dasharray="8 5"/><path d="M26 20 12 32l14 12" stroke-width="4"/>${WB_T(40, 50, 'OUT', 11)}</g>`, 'egress wegvliegroute');
wbIcon('sniper', 'Sniper / EPS', 'tac', `<g ${WB_S}><circle cx="32" cy="32" r="18"/><path d="M32 8v10M32 46v10M8 32h10M46 32h10"/><circle cx="32" cy="32" r="4" fill="currentColor"/><path d="M20 20l6 6M38 38l6 6M44 20l-6 6M20 44l6-6" stroke-width="2"/></g>`, 'eps sniper scherpschutter');
wbIcon('arc', 'Vuur-/kijksector', 'tac', `<g ${WB_S}><path d="M32 54 12 14a30 30 0 0 1 40 0Z" fill="currentColor" fill-opacity="0.2"/><circle cx="32" cy="54" r="3" fill="currentColor"/></g>`, 'sector arc fire field of view');
wbIcon('camera', 'Camera / sensor', 'tac', `<g ${WB_S}><rect x="8" y="20" width="36" height="24" rx="4" fill="currentColor" fill-opacity="0.2"/><path d="M44 28l12-6v20l-12-6"/><circle cx="24" cy="32" r="6"/></g>`, 'camera video flir sensor downlink');
wbIcon('antenna', 'Antenne / repeater', 'tac', `<g ${WB_S}><path d="M32 58V26M20 58h24"/><circle cx="32" cy="22" r="4"/><path d="M20 14a16 16 0 0 1 24 0M14 8a24 24 0 0 1 36 0" stroke-width="2.2"/></g>`, 'antenne radio repeater c2000 mast');
wbIcon('hazard', 'Gevaar', 'tac', `<g ${WB_S}><path d="M32 6 60 56H4Z" fill="currentColor" fill-opacity="0.2"/><path d="M32 24v16M32 46v2" stroke-width="3.5"/></g>`, 'gevaar waarschuwing let op hazard');
wbIcon('nogo', 'No-go', 'tac', `<g ${WB_S}><circle cx="32" cy="32" r="24" stroke-width="4"/><path d="M15 15l34 34" stroke-width="4"/></g>`, 'verboden no go');
wbIcon('explosion', 'Explosie / incident', 'tac', `<g ${WB_S}><path d="M32 6l5 14 12-8-4 14 15 4-13 7 9 12-14-4-2 15-8-12-10 11 1-15-14 2 11-9-12-9h15Z" fill="currentColor" fill-opacity="0.25"/></g>`, 'explosie incident brand');
wbIcon('fire', 'Brand', 'tac', `<g ${WB_S}><path d="M32 6c2 10 12 14 12 26a12 12 0 0 1-24 0c0-6 4-9 6-12 0 5 2 7 4 7 4-3 1-14 2-21Z" fill="currentColor" fill-opacity="0.3"/></g>`, 'brand vuur fire');
wbIcon('flag', 'Vlag', 'tac', `<g ${WB_S}><path d="M14 58V8"/><path d="M14 10h34l-8 10 8 10H14Z" fill="currentColor" fill-opacity="0.35"/></g>`, 'vlag start punt');

/* ---------- scheepssectoren: de ondergrond om eenheden op te plaatsen ---------- */
// Port red, starboard green, bow / mid / stern, with the relative bearings 0, 45, 90, 139 and 180 degrees
// on both sides. Own colours (not the pen colour), and large by default: units are drawn on top of it.
wbIcon('shipsectors', 'Scheepssectoren (bow / mid / stern, bakboord / stuurboord)', 'tac', `<g stroke-linecap="round" stroke-linejoin="round">
<clipPath id="wbShipL"><path d="M32 4C22 12 17 22 17 32s5 20 15 28V4Z"/></clipPath><clipPath id="wbShipR"><path d="M32 4c10 8 15 18 15 28s-5 20-15 28V4Z"/></clipPath>
<path d="M32 4C22 12 17 22 17 32s5 20 15 28V4Z" fill="#e5191f"/><path d="M32 4c10 8 15 18 15 28s-5 20-15 28V4Z" fill="#22b43a"/>
<g stroke="#000" stroke-width="0.9" fill="none"><path d="M32 4C22 12 17 22 17 32s5 20 15 28c10-8 15-18 15-28S42 12 32 4Z"/><path d="M32 4v56M18.4 22h27.2M18.4 42h27.2"/></g>
<g stroke-width="0.7" fill="none"><path d="M10 10 32 32" stroke="#e5191f"/><path d="M4 32h28" stroke="#e5191f"/><path d="M10 54 32 32" stroke="#e5191f"/><path d="M54 10 32 32" stroke="#22b43a"/><path d="M60 32H32" stroke="#22b43a"/><path d="M54 54 32 32" stroke="#22b43a"/></g>
<g font-family="Bahnschrift,Segoe UI,Arial,sans-serif" font-weight="700" text-anchor="middle" stroke="none">
<text x="32" y="15" font-size="4.6" fill="#111">BOW</text><text x="32" y="33.6" font-size="4.6" fill="#111">MID</text><text x="32" y="52" font-size="4.6" fill="#111">STERN</text>
<text x="32" y="2.8" font-size="3.4" fill="#fff" stroke="#000" stroke-width="0.5" paint-order="stroke">0°</text><text x="32" y="63.4" font-size="3.4" fill="#fff" stroke="#000" stroke-width="0.5" paint-order="stroke">180°</text>
<text x="7" y="8.6" font-size="3.4" fill="#e5191f">45°</text><text x="4" y="29.4" font-size="3.4" fill="#e5191f">90°</text><text x="7" y="58.6" font-size="3.4" fill="#e5191f">139°</text>
<text x="57" y="8.6" font-size="3.4" fill="#22b43a">45°</text><text x="60" y="29.4" font-size="3.4" fill="#22b43a">90°</text><text x="57" y="58.6" font-size="3.4" fill="#22b43a">139°</text>
</g></g>`, 'schip sectoren bakboord stuurboord port starboard bow mid stern peiling boarding ondergrond', { size: 520, own: true });

/* ---------- voertuigen ---------- */
const CAR = (extra = '') => `<g ${WB_S}><path d="M8 40v-8l6-12h36l6 12v8Z" fill="currentColor" fill-opacity="0.25"/><path d="M14 20h36M8 40h48M10 32h44"/><circle cx="18" cy="46" r="5" fill="currentColor"/><circle cx="46" cy="46" r="5" fill="currentColor"/>${extra}</g>`;
wbIcon('police', 'Politieauto', 'veh', CAR('<path d="M26 10h12M32 10v6" stroke-width="3"/><path d="M22 32h8M34 32h8" stroke-width="3"/>'), 'politie auto voertuig');
wbIcon('car', 'Personenauto (onopvallend)', 'veh', CAR(), 'auto voertuig onopvallend civiel verdacht');
wbIcon('van', 'Bus / bestelbus', 'veh', `<g ${WB_S}><path d="M6 42V22a4 4 0 0 1 4-4h32l16 12v12Z" fill="currentColor" fill-opacity="0.25"/><path d="M38 18v12h20M6 42h52"/><circle cx="18" cy="46" r="5" fill="currentColor"/><circle cx="46" cy="46" r="5" fill="currentColor"/></g>`, 'bus bestelbus busje me');
wbIcon('truck', 'Vrachtwagen', 'veh', `<g ${WB_S}><rect x="4" y="16" width="34" height="26" fill="currentColor" fill-opacity="0.25"/><path d="M38 24h12l8 8v10H38Z" fill="currentColor" fill-opacity="0.25"/><circle cx="14" cy="46" r="5" fill="currentColor"/><circle cx="30" cy="46" r="5" fill="currentColor"/><circle cx="50" cy="46" r="5" fill="currentColor"/></g>`, 'vrachtwagen truck lorry');
wbIcon('moto', 'Motor', 'veh', `<g ${WB_S}><circle cx="14" cy="44" r="9"/><circle cx="50" cy="44" r="9"/><path d="M14 44l10-16h14l6 8h6M24 28l-4-8h8M38 28l8 16" /></g>`, 'motor motorfiets');
wbIcon('ambulance', 'Ambulance', 'veh', `<g ${WB_S}><path d="M6 42V18h30l6 8h14v16Z" fill="currentColor" fill-opacity="0.25"/><path d="M20 24v12M14 30h12" stroke-width="3.5"/><circle cx="18" cy="46" r="5" fill="currentColor"/><circle cx="46" cy="46" r="5" fill="currentColor"/></g>`, 'ambulance ziekenauto');
wbIcon('firetruck', 'Brandweer', 'veh', `<g ${WB_S}><path d="M4 42V20h40l12 10v12Z" fill="currentColor" fill-opacity="0.25"/><path d="M8 14h20M14 20v-6M44 20v10h12"/><circle cx="16" cy="46" r="5" fill="currentColor"/><circle cx="46" cy="46" r="5" fill="currentColor"/></g>`, 'brandweer brandweerauto');
wbIcon('armored', 'Gepantserd voertuig', 'veh', `<g ${WB_S}><path d="M6 40 12 24h40l6 16Z" fill="currentColor" fill-opacity="0.3"/><rect x="22" y="14" width="20" height="10" rx="2" fill="currentColor" fill-opacity="0.3"/><path d="M42 18h14"/><circle cx="16" cy="46" r="5" fill="currentColor"/><circle cx="32" cy="46" r="5" fill="currentColor"/><circle cx="48" cy="46" r="5" fill="currentColor"/></g>`, 'gepantserd pantser dsi voertuig');
wbIcon('bike', 'Fiets / scooter', 'veh', `<g ${WB_S}><circle cx="14" cy="44" r="10"/><circle cx="50" cy="44" r="10"/><path d="M14 44l12-20h12l12 20M26 24l-4-6h8M32 44l6-20"/></g>`, 'fiets scooter');
wbIcon('tractor', 'Tractor / landbouw', 'veh', `<g ${WB_S}><circle cx="16" cy="44" r="11"/><circle cx="48" cy="48" r="7"/><path d="M26 44h14M22 24h14v12M36 36h10v8M24 24v-8h8"/></g>`, 'tractor trekker landbouw boer');
wbIcon('train', 'Trein', 'veh', `<g ${WB_S}><rect x="8" y="12" width="48" height="32" rx="6" fill="currentColor" fill-opacity="0.25"/><path d="M8 30h48M16 18h12v8H16zM36 18h12v8H36z"/><circle cx="20" cy="50" r="4" fill="currentColor"/><circle cx="44" cy="50" r="4" fill="currentColor"/><path d="M12 58l8-8M52 58l-8-8"/></g>`, 'trein spoor');

/* ---------- vaartuigen ---------- */
const BOAT = (top, extra = '') => `<g ${WB_S}><path d="M6 40h52l-8 14H14Z" fill="currentColor" fill-opacity="0.3"/>${top}${extra}<path d="M4 58c6-4 10-4 16 0 6-4 10-4 16 0 6-4 10-4 16 0" stroke-width="2"/></g>`;
wbIcon('rib', 'RIB / snelle boot', 'sea', `<g ${WB_S}><path d="M4 36c10-8 30-12 56-8-6 8-14 12-24 14H14Z" fill="currentColor" fill-opacity="0.3"/><path d="M34 28v-8h8"/><path d="M4 50c6-4 10-4 16 0 6-4 10-4 16 0 6-4 10-4 16 0" stroke-width="2"/></g>`, 'rib rubberboot snelle boot speedboot');
wbIcon('patrol', 'Patrouillevaartuig (politie/kustwacht)', 'sea', BOAT('<path d="M18 40V28h20l6 12M24 28v-8h12M30 20v-8" />'), 'politieboot kustwacht patrouille vaartuig');
wbIcon('ship', 'Schip / vrachtschip', 'sea', BOAT('<path d="M12 40V26h14v-8h12v8h12v14"/><path d="M40 22v-8" stroke-width="2"/>'), 'schip vrachtschip cargo');
wbIcon('tanker', 'Tanker', 'sea', BOAT('<rect x="12" y="28" width="30" height="12" fill="currentColor" fill-opacity="0.2"/><path d="M44 40V22h10v18M16 28v-6h8v6"/>'), 'tanker olie gas schip');
wbIcon('container', 'Containerschip', 'sea', BOAT('<path d="M10 40V30h8v-8h8v8h8v-8h8v8h8v10"/><path d="M10 34h40" stroke-width="1.8"/>'), 'container schip vracht');
wbIcon('fishing', 'Visserschip', 'sea', BOAT('<path d="M20 40V30h14v10M26 30V12M26 14l14 8"/>'), 'vissersboot kotter visserij');
wbIcon('sail', 'Zeilboot', 'sea', `<g ${WB_S}><path d="M10 44h44l-6 10H16Z" fill="currentColor" fill-opacity="0.3"/><path d="M30 44V6l20 36M30 20 14 44" fill="currentColor" fill-opacity="0.15"/><path d="M4 58c6-4 10-4 16 0 6-4 10-4 16 0 6-4 10-4 16 0" stroke-width="2"/></g>`, 'zeilboot zeiljacht');
wbIcon('ferry', 'Veerboot / passagiersschip', 'sea', BOAT('<path d="M10 40V24h44v16M10 32h44M16 24v-8h32v8"/>'), 'veerboot ferry passagiers cruise');
wbIcon('lifeboat', 'Reddingboot (KNRM)', 'sea', BOAT('<path d="M14 40c2-10 34-10 36 0" fill="currentColor" fill-opacity="0.2"/><path d="M26 30v-6h12v6M32 24v-6"/>'), 'knrm reddingboot sar');
wbIcon('jetski', 'Waterscooter', 'sea', `<g ${WB_S}><path d="M8 42c8-6 24-8 48-4l-4 8H14Z" fill="currentColor" fill-opacity="0.3"/><path d="M30 38l6-12h8M36 26l-4 12"/><path d="M4 54c6-4 10-4 16 0 6-4 10-4 16 0 6-4 10-4 16 0" stroke-width="2"/></g>`, 'waterscooter jetski');
wbIcon('tug', 'Sleepboot / supply', 'sea', BOAT('<path d="M14 40V26h12v-8h12v8h4v14"/><path d="M44 36h12" stroke-dasharray="3 3"/>'), 'sleepboot supply vessel offshore');
wbIcon('buoy', 'Boei', 'sea', `<g ${WB_S}><path d="M24 44l4-24h8l4 24Z" fill="currentColor" fill-opacity="0.3"/><circle cx="32" cy="14" r="5"/><path d="M20 44h24"/><path d="M4 56c6-4 10-4 16 0 6-4 10-4 16 0 6-4 10-4 16 0" stroke-width="2"/></g>`, 'boei betonning markering');

/* ---------- personen ---------- */
const PERSON = (extra = '', fo = 0.3) => `<g ${WB_S}><circle cx="32" cy="12" r="7" fill="currentColor" fill-opacity="${fo}"/><path d="M18 58V36a14 14 0 0 1 28 0v22" fill="currentColor" fill-opacity="${fo}"/>${extra}</g>`;
wbIcon('suspect', 'Verdachte', 'per', PERSON('<path d="M22 24l20 20M42 24 22 44" stroke-width="3"/>', 0.15), 'verdachte suspect persoon');
wbIcon('friendly', 'Eigen eenheid (persoon)', 'per', PERSON('<path d="M24 38l6 6 10-12" stroke-width="3"/>'), 'eigen persoon friendly');
wbIcon('officer', 'Politieagent', 'per', PERSON('<path d="M22 10h20l-2-5H24Z" fill="currentColor"/><path d="M27 42h10" stroke-width="3"/>'), 'agent politie');
wbIcon('team', 'Team / groep', 'per', `<g ${WB_S}><circle cx="20" cy="14" r="6" fill="currentColor" fill-opacity="0.3"/><circle cx="44" cy="14" r="6" fill="currentColor" fill-opacity="0.3"/><circle cx="32" cy="24" r="6" fill="currentColor" fill-opacity="0.3"/><path d="M8 50V36a12 12 0 0 1 24 0M32 36a12 12 0 0 1 24 0v14M20 58V48a12 12 0 0 1 24 0v10" fill="currentColor" fill-opacity="0.2"/></g>`, 'team groep ploeg dsi at');
wbIcon('dsi', 'DSI / arrestatieteam', 'per', PERSON('<rect x="24" y="26" width="16" height="14" rx="2" fill="currentColor" fill-opacity="0.5"/><path d="M12 30l6 6M52 30l-6 6" stroke-width="3"/>', 0.3), 'dsi at arrestatieteam interventie');
wbIcon('dog', 'Hondengeleider', 'per', PERSON('<path d="M44 48h10l4 10h-4l-2-5-2 5h-4l1-5M48 48v-6l4-2 4 3" stroke-width="2.2"/>'), 'hond hondengeleider k9');
wbIcon('horse', 'Bereden politie', 'per', `<g ${WB_S}><path d="M10 54V36c0-6 4-10 10-10h18l8-10 6 2-6 12v24M18 54V42M40 54V42M28 26v-8l6 2" fill="currentColor" fill-opacity="0.2"/><circle cx="34" cy="12" r="5" fill="currentColor" fill-opacity="0.3"/></g>`, 'paard bereden politie ruiter');
wbIcon('casualty', 'Slachtoffer', 'per', `<g ${WB_S}><circle cx="12" cy="40" r="7" fill="currentColor" fill-opacity="0.3"/><path d="M20 46h30a6 6 0 0 0 0-12H24" fill="currentColor" fill-opacity="0.3"/><path d="M44 20v12M38 26h12" stroke-width="3"/></g>`, 'slachtoffer gewonde casualty drenkeling');
wbIcon('operator', 'Drone-operator', 'per', PERSON('<rect x="40" y="30" width="14" height="10" rx="2" fill="currentColor" fill-opacity="0.3"/><path d="M47 30v-8l8-6" stroke-width="2.2"/>'), 'drone operator rpas piloot');
wbIcon('crowd', 'Menigte', 'per', `<g ${WB_S}><circle cx="14" cy="18" r="5" fill="currentColor" fill-opacity="0.3"/><circle cx="32" cy="14" r="5" fill="currentColor" fill-opacity="0.3"/><circle cx="50" cy="18" r="5" fill="currentColor" fill-opacity="0.3"/><circle cx="23" cy="32" r="5" fill="currentColor" fill-opacity="0.3"/><circle cx="41" cy="32" r="5" fill="currentColor" fill-opacity="0.3"/><path d="M6 58V48a8 8 0 0 1 16 0M24 58v-8a8 8 0 0 1 16 0M42 58V48a8 8 0 0 1 16 0" fill="currentColor" fill-opacity="0.2"/></g>`, 'menigte publiek groep mensen');

/* ---------- gebouwen en infra ---------- */
wbIcon('house', 'Woning', 'inf', `<g ${WB_S}><path d="M8 30 32 10l24 20v26H8Z" fill="currentColor" fill-opacity="0.2"/><path d="M26 56V40h12v16"/></g>`, 'huis woning pand');
wbIcon('flat', 'Flat / appartementen', 'inf', `<g ${WB_S}><rect x="14" y="6" width="36" height="52" fill="currentColor" fill-opacity="0.2"/><path d="M22 14h6v6h-6zM36 14h6v6h-6zM22 26h6v6h-6zM36 26h6v6h-6zM22 38h6v6h-6zM36 38h6v6h-6zM28 58v-8h8v8"/></g>`, 'flat appartement gebouw');
wbIcon('warehouse', 'Loods / bedrijfspand', 'inf', `<g ${WB_S}><path d="M6 56V26l26-14 26 14v30Z" fill="currentColor" fill-opacity="0.2"/><path d="M6 32h52M18 56V40h12v16M38 40h10v8H38z"/></g>`, 'loods bedrijfspand hal industrie');
wbIcon('hangar', 'Hangar', 'inf', `<g ${WB_S}><path d="M4 56V34c0-14 12-24 28-24s28 10 28 24v22Z" fill="currentColor" fill-opacity="0.2"/><path d="M18 56V36h28v20M32 36v20"/></g>`, 'hangar vliegtuigloods');
wbIcon('farm', 'Boerderij', 'inf', `<g ${WB_S}><path d="M4 56V30l14-12 14 12v26Z" fill="currentColor" fill-opacity="0.2"/><path d="M32 56V36h24v20Z" fill="currentColor" fill-opacity="0.2"/><path d="M12 56V44h8v12M40 42h8v8h-8z"/></g>`, 'boerderij schuur stal');
wbIcon('school', 'School', 'inf', `<g ${WB_S}><rect x="6" y="24" width="52" height="32" fill="currentColor" fill-opacity="0.2"/><path d="M6 24 32 10l26 14M26 56V42h12v14M14 34h6v6h-6zM44 34h6v6h-6z"/></g>`, 'school');
wbIcon('hospital', 'Ziekenhuis', 'inf', `<g ${WB_S}><rect x="8" y="12" width="48" height="44" rx="3" fill="currentColor" fill-opacity="0.2"/><path d="M32 22v20M22 32h20" stroke-width="5"/></g>`, 'ziekenhuis hospital helipad');
wbIcon('station', 'Politiebureau', 'inf', `<g ${WB_S}><rect x="8" y="20" width="48" height="36" fill="currentColor" fill-opacity="0.2"/><path d="M8 20l24-12 24 12M26 56V42h12v14"/><path d="M32 26l2.5 6h6l-5 4 2 6-5.5-4-5.5 4 2-6-5-4h6Z" fill="currentColor"/></g>`, 'politiebureau bureau');
wbIcon('bridge', 'Brug', 'inf', `<g ${WB_S}><path d="M4 40h56" stroke-width="3.5"/><path d="M4 40c8-18 20-26 28-26s20 8 28 26M16 40V26M32 40V14M48 40V26"/><path d="M8 52h48" stroke-width="2"/></g>`, 'brug viaduct');
wbIcon('tunnel', 'Tunnel', 'inf', `<g ${WB_S}><path d="M8 56V36a24 24 0 0 1 48 0v20" fill="currentColor" fill-opacity="0.2"/><path d="M18 56V38a14 14 0 0 1 28 0v18" fill="currentColor" fill-opacity="0.4"/><path d="M4 56h56"/></g>`, 'tunnel');
wbIcon('tower', 'Toren / mast', 'inf', `<g ${WB_S}><path d="M26 58 30 8h4l4 50Z" fill="currentColor" fill-opacity="0.2"/><path d="M28 24h8M27 40h10M20 58h24M32 8V4"/></g>`, 'toren mast zendmast obstakel');
wbIcon('pylon', 'Hoogspanningsmast', 'inf', `<g ${WB_S}><path d="M22 58 28 10h8l6 48"/><path d="M14 20h36M12 30h40M18 42h28M24 22l16 20M40 22 24 42"/><path d="M14 20v6M50 20v6M12 30v6M52 30v6"/></g>`, 'hoogspanning mast powerline pylon obstakel');
wbIcon('powerline', 'Hoogspanningslijn', 'inf', `<g ${WB_S}><path d="M8 58 12 14h6l4 44M42 58l4-44h6l4 44"/><path d="M4 22h22M38 22h22M4 32h22M38 32h22"/><path d="M26 22c6 8 6 8 12 0M26 32c6 8 6 8 12 0" stroke-width="2"/></g>`, 'hoogspanningslijn powerline kabels draden obstakel');
wbIcon('turbine', 'Windturbine', 'inf', `<g ${WB_S}><path d="M30 58 32 22l2 36Z" fill="currentColor" fill-opacity="0.3"/><circle cx="32" cy="20" r="3.5" fill="currentColor"/><path d="M32 20 34 2M32 20l16 10M32 20 16 30" stroke-width="3"/><path d="M22 58h20"/></g>`, 'windturbine windmolen obstakel');
wbIcon('windfarm', 'Windpark', 'inf', `<g ${WB_S}><path d="M14 56V30M38 56V22M54 56V34"/><circle cx="14" cy="28" r="2.5" fill="currentColor"/><circle cx="38" cy="20" r="2.5" fill="currentColor"/><circle cx="54" cy="32" r="2.5" fill="currentColor"/><path d="M14 28l2-12M14 28l10 5M14 28 4 34M38 20l2-14M38 20l12 7M38 20l-12 7M54 32l2-10M54 32l8 5M54 32l-8 6" stroke-width="2.2"/></g>`, 'windpark windmolens zee');
wbIcon('platform', 'Platform (olie/gas)', 'inf', `<g ${WB_S}><path d="M10 32h44v8H10Z" fill="currentColor" fill-opacity="0.3"/><path d="M14 40v16M50 40v16M22 40l4 16M42 40l-4 16"/><path d="M14 32V20h12v12M40 32V12l6-4v24"/><path d="M26 24h14" stroke-width="2"/><circle cx="20" cy="26" r="2" fill="currentColor"/><path d="M4 58c6-4 10-4 16 0 6-4 10-4 16 0 6-4 10-4 16 0" stroke-width="2"/></g>`, 'platform booreiland olie gas offshore installatie helidek');
wbIcon('lighthouse', 'Vuurtoren', 'inf', `<g ${WB_S}><path d="M24 58 27 20h10l3 38Z" fill="currentColor" fill-opacity="0.2"/><path d="M26 32h12M25 44h14M20 58h24M26 20l6-10 6 10"/><path d="M12 14l8 4M52 14l-8 4M8 24h10M46 24h10" stroke-width="2"/></g>`, 'vuurtoren kust');
wbIcon('harbour', 'Haven', 'inf', `<g ${WB_S}><path d="M32 8v44M18 22h28M14 36c6 12 30 12 36 0" /><circle cx="32" cy="16" r="5"/><path d="M4 58c6-4 10-4 16 0 6-4 10-4 16 0 6-4 10-4 16 0" stroke-width="2"/></g>`, 'haven anker port');
wbIcon('fuelstation', 'Tankstation', 'inf', `<g ${WB_S}><path d="M12 56V12a4 4 0 0 1 4-4h20a4 4 0 0 1 4 4v44Z" fill="currentColor" fill-opacity="0.2"/><path d="M16 18h20v12H16zM40 24h6a4 4 0 0 1 4 4v18a3 3 0 0 0 6 0V22l-6-6M8 56h36"/></g>`, 'tankstation benzine');
wbIcon('church', 'Kerk', 'inf', `<g ${WB_S}><path d="M14 56V30l10-8 10 8v26Z" fill="currentColor" fill-opacity="0.2"/><path d="M24 22V8M20 12h8M34 56V36h16v20"/><path d="M20 56V44h8v12"/></g>`, 'kerk toren');
wbIcon('parking', 'Parkeerplaats', 'inf', `<g ${WB_S}><rect x="8" y="8" width="48" height="48" rx="4" fill="currentColor" fill-opacity="0.2"/>${WB_T(32, 44, 'P', 32)}</g>`, 'parkeerplaats parkeren');
wbIcon('road', 'Weg', 'inf', `<g ${WB_S}><path d="M16 4 8 60M48 4l8 56" /><path d="M32 8v8M32 24v8M32 40v8M32 56v4" stroke-width="2" stroke-dasharray="6 4"/></g>`, 'weg snelweg straat');
wbIcon('railway', 'Spoor', 'inf', `<g ${WB_S}><path d="M20 4v56M44 4v56"/><path d="M14 12h36M14 24h36M14 36h36M14 48h36" stroke-width="2"/></g>`, 'spoor spoorlijn rails');
wbIcon('river', 'Water / rivier', 'inf', `<g ${WB_S}><path d="M4 16c8-6 12 6 20 0s12 6 20 0 12 6 16 0M4 32c8-6 12 6 20 0s12 6 20 0 12 6 16 0M4 48c8-6 12 6 20 0s12 6 20 0 12 6 16 0" stroke-width="2.4"/></g>`, 'water rivier kanaal meer zee');
wbIcon('fence', 'Hek / muur', 'inf', `<g ${WB_S}><path d="M4 24h56M4 40h56" stroke-width="3"/><path d="M12 14v38M24 14v38M36 14v38M48 14v38"/></g>`, 'hek muur afrastering');
wbIcon('gatebar', 'Slagboom / toegang', 'inf', `<g ${WB_S}><path d="M10 58V30M8 30h4"/><path d="M12 30l44-8" stroke-width="4"/><circle cx="24" cy="28" r="2" fill="currentColor"/><circle cx="40" cy="25" r="2" fill="currentColor"/><path d="M4 58h20"/></g>`, 'slagboom toegang poort');
wbIcon('dune', 'Duin / strand', 'inf', `<g ${WB_S}><path d="M4 44c10-14 20-16 30-8s16 8 26 0" /><path d="M4 56c8-4 12-4 20 0s12 4 20 0 12-4 16 0" stroke-width="2"/><path d="M14 36c2-3 4-3 6 0M36 30c2-3 4-3 6 0" stroke-width="2"/></g>`, 'duin strand kust zand');
wbIcon('field', 'Veld / weiland', 'inf', `<g ${WB_S}><rect x="6" y="14" width="52" height="36" fill="currentColor" fill-opacity="0.15"/><path d="M6 26h52M6 38h52M18 14v36M30 14v36M42 14v36" stroke-width="1.6"/></g>`, 'veld weiland akker land');

/* ---------- natuur en dieren ---------- */
wbIcon('tree', 'Boom', 'nat', `<g ${WB_S}><path d="M32 58V40"/><path d="M32 6c10 0 18 8 18 18 0 10-8 16-18 16S14 34 14 24C14 14 22 6 32 6Z" fill="currentColor" fill-opacity="0.3"/></g>`, 'boom obstakel');
wbIcon('forest', 'Bos', 'nat', `<g ${WB_S}><path d="M18 58V46M46 58V46M32 58V42"/><path d="M18 10 6 30h8l-6 14h20L22 30h8Z" fill="currentColor" fill-opacity="0.3"/><path d="M46 10 34 30h8l-6 14h20L50 30h8Z" fill="currentColor" fill-opacity="0.3"/></g>`, 'bos bomen');
wbIcon('birds', 'Vogels (birdtam)', 'nat', `<g ${WB_S}><path d="M6 24c6-6 10-6 14 0 4-6 8-6 14 0M22 40c6-6 10-6 14 0 4-6 8-6 14 0M30 14c4-5 8-5 12 0 4-5 8-5 12 0" stroke-width="2.4"/></g>`, 'vogels birdtam zwerm vogelgebied');
wbIcon('deer', 'Wild / ree', 'nat', `<g ${WB_S}><path d="M12 56V36l8-8h20l10 6v22M20 56V42M46 56V40M32 28V18l-6-10M32 18l6-10M26 12h-6M38 12h6"/><circle cx="34" cy="14" r="2" fill="currentColor"/></g>`, 'ree hert wild dier');
wbIcon('cattle', 'Vee / koeien', 'nat', `<g ${WB_S}><path d="M10 54V34c0-6 4-10 12-10h16c8 0 14 6 14 12v18M18 54V42M46 54V42"/><path d="M42 24l10-10M46 20h6v-6" stroke-width="2.2"/><circle cx="46" cy="30" r="2" fill="currentColor"/></g>`, 'vee koeien schapen dieren');
wbIcon('seal', 'Zeehonden', 'nat', `<g ${WB_S}><path d="M6 48c4-14 14-20 26-20 10 0 18 6 20 14l6 6H6Z" fill="currentColor" fill-opacity="0.25"/><circle cx="46" cy="32" r="2" fill="currentColor"/><path d="M4 58c6-4 10-4 16 0 6-4 10-4 16 0 6-4 10-4 16 0" stroke-width="2"/></g>`, 'zeehond zeehonden zandbank');
wbIcon('dogbody', 'Hond', 'nat', `<g ${WB_S}><path d="M12 52V36c0-6 4-10 10-10h14l8-8 8 4-4 8v22M18 52V42M42 52V42M40 18l-4-8"/><circle cx="42" cy="22" r="2" fill="currentColor"/></g>`, 'hond dier');
wbIcon('horsebody', 'Paard', 'nat', `<g ${WB_S}><path d="M10 54V34c0-6 4-10 10-10h16l10-12 8 2-6 14v26M18 54V42M46 54V42M40 12l-4-6"/><circle cx="40" cy="18" r="2" fill="currentColor"/></g>`, 'paard dier');
wbIcon('fishbody', 'Vis / visgebied', 'nat', `<g ${WB_S}><path d="M8 32c10-12 24-14 40-4-16 10-30 8-40 4Z" fill="currentColor" fill-opacity="0.25"/><path d="M48 28l10-8v24l-10-8"/><circle cx="18" cy="30" r="2" fill="currentColor"/></g>`, 'vis visgebied');

/* ---------- markeringen ---------- */
for (let i = 1; i <= 9; i += 1) wbIcon(`num${i}`, `Cijfer ${i}`, 'mrk', `<g ${WB_S}><circle cx="32" cy="32" r="26" fill="currentColor" fill-opacity="0.2" stroke-width="3"/>${WB_T(32, 44, String(i), 34)}</g>`, `nummer ${i} cijfer`);
for (const L of ['A', 'B', 'C', 'D', 'E', 'X', 'Y', 'Z']) wbIcon(`let${L}`, `Letter ${L}`, 'mrk', `<g ${WB_S}><rect x="8" y="8" width="48" height="48" rx="8" fill="currentColor" fill-opacity="0.2" stroke-width="3"/>${WB_T(32, 44, L, 34)}</g>`, `letter ${L}`);
wbIcon('pin', 'Speld', 'mrk', `<g ${WB_S}><path d="M32 58S12 36 12 24a20 20 0 0 1 40 0c0 12-20 34-20 34Z" fill="currentColor" fill-opacity="0.3"/><circle cx="32" cy="24" r="7" fill="currentColor"/></g>`, 'speld pin punt locatie');
wbIcon('star', 'Ster', 'mrk', `<g ${WB_S}><path d="m32 6 8 17 18 2-13 12 3 18-16-9-16 9 3-18L6 25l18-2Z" fill="currentColor" fill-opacity="0.35"/></g>`, 'ster belangrijk favoriet');
wbIcon('check', 'Vinkje', 'mrk', `<g ${WB_S}><circle cx="32" cy="32" r="26" fill="currentColor" fill-opacity="0.2"/><path d="m18 33 10 10 18-20" stroke-width="5"/></g>`, 'vinkje check ok gereed');
wbIcon('cross', 'Kruis', 'mrk', `<g ${WB_S}><circle cx="32" cy="32" r="26" fill="currentColor" fill-opacity="0.2"/><path d="m20 20 24 24M44 20 20 44" stroke-width="5"/></g>`, 'kruis fout nee');
wbIcon('question', 'Vraagteken', 'mrk', `<g ${WB_S}><circle cx="32" cy="32" r="26" fill="currentColor" fill-opacity="0.2"/>${WB_T(32, 44, '?', 34)}</g>`, 'vraag onbekend rfi');
wbIcon('clockic', 'Tijd', 'mrk', `<g ${WB_S}><circle cx="32" cy="32" r="26"/><path d="M32 14v18l12 8" stroke-width="3.5"/></g>`, 'tijd klok timing');
wbIcon('north', 'Noordpijl', 'mrk', `<g ${WB_S}><path d="M32 6 44 50 32 42 20 50Z" fill="currentColor" fill-opacity="0.35"/><path d="M32 6v36"/>${WB_T(32, 62, 'N', 14)}</g>`, 'noord noordpijl kompas');
wbIcon('scale', 'Schaalbalk', 'mrk', `<g ${WB_S}><path d="M4 40h56M4 34v12M34 34v12M60 34v12" stroke-width="3"/><rect x="4" y="38" width="30" height="4" fill="currentColor"/>${WB_T(32, 28, '1 km', 12)}</g>`, 'schaal schaalbalk afstand');

const wbIconById = (id) => WB_ICONS.find((i) => i.id === id) || null;
// Full SVG markup of one icon in one colour, for the library panel and the canvas.
const wbIconSvg = (ic, color = '#ffffff', size = 64) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="${size}" height="${size}" style="color:${color}">${ic.svg}</svg>`;
// Bitmaps of icons for the canvas, one per icon, colour and size; made on first use.
const wbIconCache = new Map();
function wbIconImage(id, color, px) {
  const key = `${id}|${color}|${px}`;
  let hit = wbIconCache.get(key);
  if (hit) return hit;
  const ic = wbIconById(id);
  if (!ic) return null;
  const img = new Image();
  img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(wbIconSvg(ic, color, px));
  hit = { img, ready: false };
  img.onload = () => { hit.ready = true; if (wbIconCache.onReady) wbIconCache.onReady(); };
  wbIconCache.set(key, hit);
  if (wbIconCache.size > 600) wbIconCache.delete(wbIconCache.keys().next().value);
  return hit;
}
