'use strict';

/* ============================================================
   Whiteboard-iconen — tactisch, natuur en dieren, markeringen.
   Tactische symbolen zoals de TACSOP ze bedoelt (1LEAD cirkel 3 min, 1GATE vierkant 2 min, de
   deconflictie-standaard met N-E-S-W, LP/PUP/DP als cirkels met tekst), de scheepssectoren als
   ondergrond met eigen kleuren, dieren als nette silhouetten van opzij (kop links) en markeringen
   als strakke badges. Alles in currentColor behalve de scheepssectoren; tekst via WB_T, nooit kleiner
   dan 9. Geladen na wb-icons.js.
   ============================================================ */

/* ---------- hulpen voor deze categorieën ---------- */
// A flame: outer tongue with a smaller inner tongue; drawn about (cx, cy) at scale s (1 = 40 units high).
const TAC_FLAME = (cx, cy, s = 1) => `<g transform="translate(${cx} ${cy}) scale(${s})"><path d="M0-20c3 10 14 15 14 29A14 14 0 0 1-14 9c0-7 4-11 7-14 0 6 2 9 5 9 5-4 1-17 2-24Z" ${WB_FILL.body}/><path d="M0 2c2 4 6 6 6 11a6 6 0 0 1-12 0c0-3 2-5 3-7 0 3 1 4 2 4 2-2 0-5 1-8Z" ${WB_FILL.glass} stroke="none"/></g>`;
// A starburst: n spikes alternating between radius r1 and r2 about (cx, cy), slightly irregular.
const tacBurst = (cx, cy, n, r1, r2) => {
  let d = '';
  for (let i = 0; i < 2 * n; i += 1) {
    const a = -Math.PI / 2 + (i * Math.PI) / n, r = i % 2 ? r2 : r1 * (i % 4 === 0 ? 1 : 0.86);
    d += `${i ? 'L' : 'M'}${(cx + r * Math.cos(a)).toFixed(1)} ${(cy + r * Math.sin(a)).toFixed(1)}`;
  }
  return d + 'Z';
};
// A conifer: three tiers of branches from the top down, trunk to the ground line at y = base.
const tacPine = (cx, top, h, w, base = 58) => `<path d="M${cx} ${top}l${-w * 0.5} ${h * 0.34}h${w * 0.16}l${-w * 0.3} ${h * 0.3}h${w * 0.2}l${-w * 0.36} ${h * 0.36}h${2 * w}l${-w * 0.36} ${-h * 0.36}h${w * 0.2}l${-w * 0.3} ${-h * 0.3}h${w * 0.16}Z" ${WB_FILL.body}/><path d="M${cx} ${top + h}V${base}" stroke-width="2.4"/>`;
// A gull in flight about (cx, cy), wingspan 28 × s.
const tacBird = (cx, cy, s = 1) => `<path transform="translate(${cx} ${cy}) scale(${s})" d="M-14 0c4-6 9-7 14-2 5-5 10-4 14 2-5-2-9-1-14 4-5-5-9-6-14-4Z" ${WB_FILL.solid} stroke="none"/>`;
// Four legs of an animal seen from the side: pairs at xf (front) and xb (back), from y0 to the ground.
const tacLegs = (xf, xb, y0, y1 = 58, gap = 6) => `<path d="M${xf} ${y0}V${y1}M${xf + gap} ${y0}V${y1}M${xb} ${y0}V${y1}M${xb + gap} ${y0}V${y1}" stroke-width="2.6"/>`;
// A round badge (markers): disc with the body fill and a firm rim.
const TAC_DISC = `<circle cx="32" cy="32" r="26" ${WB_FILL.body} stroke-width="2.6"/>`;

/* ---------- tactisch ---------- */
wbIcon('leadin', 'LEAD · lead-in (3 min)', 'tac', `<g ${WB_S}><circle cx="32" cy="27" r="21" stroke-width="3.2" ${WB_FILL.body}/>${WB_T(32, 32, 'LEAD', 12.5)}${WB_T(32, 61, '3 MIN', 10)}</g>`, 'lead in ingress 3 minuten cirkel');
wbIcon('gate', 'GATE · gate (2 min)', 'tac', `<g ${WB_S}><rect x="10" y="6" width="44" height="42" stroke-width="3.2" ${WB_FILL.body}/>${WB_T(32, 32, 'GATE', 12.5)}${WB_T(32, 61, '2 MIN', 10)}</g>`, 'gate ingress 2 minuten vierkant');
wbIcon('onemin', '1-minuutpunt', 'tac', `<g ${WB_S}><path d="M32 60V12" stroke-dasharray="5 4" stroke-width="2"/><path d="M25 14l7-8 7 8" stroke-width="2.2"/><path d="M20 36h24" stroke-width="4"/>${WB_T(47, 30, '1 MIN', 9.5)}</g>`, '1 minuut streep ingress tijdmerk');
wbIcon('target', 'Doel', 'tac', `<g ${WB_S}><circle cx="32" cy="32" r="23"/><circle cx="32" cy="32" r="13" ${WB_FILL.body}/><circle cx="32" cy="32" r="3.5" ${WB_FILL.solid}/><path d="M32 3v12M32 49v12M3 32h12M49 32h12" stroke-width="2.2"/></g>`, 'doel target objective tgt');
wbIcon('hotzone', 'Hot zone', 'tac', `<g ${WB_S}><circle cx="32" cy="32" r="27" stroke-dasharray="7 4" stroke-width="3"/>${TAC_FLAME(32, 25, 0.72)}${WB_T(32, 52, 'HOT', 10)}</g>`, 'hot zone deconflictie gebied');
wbIcon('deconf', 'Deconflictie-standaard (4/5 km, N-E-S-W)', 'tac', `<g ${WB_S}><circle cx="32" cy="32" r="29" stroke-dasharray="4 3" stroke-width="1.6"/><circle cx="32" cy="32" r="22" stroke-width="2" ${WB_FILL.body}/><path d="M32 3v4M32 18v25M32 54v7M3 32h8M21 32h22M53 32h8" stroke-width="1.6"/><circle cx="32" cy="32" r="3" ${WB_FILL.solid}/>${WB_T(32, 16, 'N', 10)}${WB_T(48, 35.5, 'E', 10)}${WB_T(32, 52, 'S', 10)}${WB_T(16, 35.5, 'W', 10)}</g>`, 'deconflictie sectoren hoogtebanden holding areas');
wbIcon('lp', 'LP · landingspunt', 'tac', `<g ${WB_S}><circle cx="32" cy="32" r="25" stroke-width="2.2" ${WB_FILL.body}/><circle cx="32" cy="32" r="20" stroke-dasharray="3 3" stroke-width="1.1"/>${WB_T(32, 39, 'LP', 20)}</g>`, 'landing point landingspunt lz');
wbIcon('pup', 'PUP · pick-up point', 'tac', `<g ${WB_S}><circle cx="32" cy="32" r="25" stroke-width="2.2" ${WB_FILL.body}/><path d="M26 19l6-7 6 7M32 12v9" stroke-width="2.2"/>${WB_T(32, 44, 'PUP', 16)}</g>`, 'pick up point oppikpunt troepen');
wbIcon('dp', 'DP · drop point', 'tac', `<g ${WB_S}><circle cx="32" cy="32" r="25" stroke-width="2.2" ${WB_FILL.body}/><path d="M26 45l6 7 6-7M32 52v-9" stroke-width="2.2"/>${WB_T(32, 36, 'DP', 18)}</g>`, 'drop point afzetpunt');
wbIcon('lz', 'LZ · landing zone', 'tac', `<g ${WB_S}><rect x="7" y="7" width="50" height="50" rx="6" ${WB_FILL.body} stroke-dasharray="6 4" stroke-width="2"/><path d="M13 19v-6h6M45 13h6v6M51 45v6h-6M19 51h-6v-6" stroke-width="2"/>${WB_T(32, 40, 'LZ', 20)}</g>`, 'landing zone landingszone');
wbIcon('farp', 'FARP / refuel', 'tac', `<g ${WB_S}><rect x="12" y="10" width="26" height="46" rx="3" ${WB_FILL.body}/><rect x="16" y="15" width="18" height="12" rx="1.5" ${WB_FILL.glass} stroke="none"/><path d="M38 24h5a4 4 0 0 1 4 4v15a3.5 3.5 0 0 0 7 0V27l-6-6" stroke-width="1.8"/><path d="M8 56h36" stroke-width="2"/>${WB_T(25, 46, 'FARP', 9.5)}</g>`, 'brandstof tanken farp refuel reload');
wbIcon('cp', 'CP · commandopost', 'tac', `<g ${WB_S}><path d="M4 54 32 18l28 36Z" ${WB_FILL.body}/><path d="M24 54l8-12 8 12" ${WB_FILL.glass}/><path d="M32 18V5"/><path d="M32 5h9l-2 3.5 2 3.5h-9Z" ${WB_FILL.solid}/>${WB_T(32, 38, 'CP', 12)}</g>`, 'command post commandopost opco tent');
wbIcon('op', 'OP · observatiepost', 'tac', `<g ${WB_S}><path d="M4 50a28 28 0 0 1 56 0Z" ${WB_FILL.body}/><path d="M4 50h56"/><path d="M19 33q13-13 26 0q-13 13-26 0Z" ${WB_FILL.glass}/><circle cx="32" cy="33" r="4" ${WB_FILL.solid}/>${WB_T(32, 61, 'OP', 10)}</g>`, 'observatie post uitkijk oog');
wbIcon('rv', 'RV · verzamelpunt', 'tac', `<g ${WB_S}><path d="M32 4 60 32 32 60 4 32Z" ${WB_FILL.body}/><path d="M32 12 52 32 32 52 12 32Z" stroke-dasharray="3 3" stroke-width="1.1"/>${WB_T(32, 38, 'RV', 16)}</g>`, 'rendez vous verzamelpunt assembly');
wbIcon('nfa', 'No fire area', 'tac', `<g ${WB_S}><circle cx="32" cy="29" r="23" stroke-dasharray="4 3" ${WB_FILL.body}/><path d="M15 12l34 34" stroke-width="3.5"/>${WB_T(32, 61, 'NFA', 10)}</g>`, 'no fire area geen vuur');
wbIcon('phaseline', 'Fase-lijn', 'tac', `<g ${WB_S}><path d="M4 40h56" stroke-width="3"/><path d="M4 34v12M60 34v12" stroke-width="2"/><rect x="19" y="12" width="26" height="16" rx="3" ${WB_FILL.body}/><path d="M32 28v9"/>${WB_T(32, 24, 'PL', 11)}</g>`, 'phase line faselijn');
wbIcon('ingress', 'Ingress-pijl', 'tac', `<g ${WB_S}><path d="M6 32h36" stroke-width="4.5"/><path d="M40 19 57 32 40 45Z" ${WB_FILL.solid}/>${WB_T(20, 53, 'IN', 11)}</g>`, 'ingress aanvliegroute');
wbIcon('egress', 'Egress-pijl', 'tac', `<g ${WB_S}><path d="M58 32H22" stroke-width="4.5" stroke-dasharray="7 5"/><path d="M24 19 7 32l17 13Z" ${WB_FILL.solid}/>${WB_T(44, 53, 'OUT', 11)}</g>`, 'egress wegvliegroute');
wbIcon('sniper', 'Sniper / EPS', 'tac', `<g ${WB_S}><circle cx="32" cy="32" r="21"/><circle cx="32" cy="32" r="21" ${WB_FILL.body} stroke="none"/><path d="M32 4v15M32 45v15M4 32h15M45 32h15" stroke-width="2"/><path d="M32 23v18M23 32h18" stroke-width="1.1"/><circle cx="32" cy="32" r="2.4" ${WB_FILL.solid}/><path d="M27 32h-2M39 32h-2M32 27v-2M32 39v-2" stroke-width="1.1"/></g>`, 'eps sniper scherpschutter richtkruis');
wbIcon('arc', 'Vuur-/kijksector', 'tac', `<g ${WB_S}><path d="M32 58 8 16.4A48 48 0 0 1 56 16.4Z" ${WB_FILL.body}/><path d="M17 32a30 30 0 0 1 30 0" stroke-dasharray="3 3" stroke-width="1.1"/><circle cx="32" cy="58" r="3" ${WB_FILL.solid}/></g>`, 'sector arc fire field of view');
wbIcon('camera', 'Camera / sensor', 'tac', `<g ${WB_S}><rect x="6" y="22" width="34" height="22" rx="4" ${WB_FILL.body}/><rect x="14" y="15" width="14" height="7" rx="2" ${WB_FILL.body}/><path d="M40 28l17-7v22l-17-7Z" ${WB_FILL.glass}/><circle cx="21" cy="33" r="6.5"/><circle cx="21" cy="33" r="2.6" ${WB_FILL.solid}/><circle cx="34" cy="28" r="1.6" ${WB_FILL.solid}/><path d="M14 44v6h20v-6" stroke-width="1.1"/></g>`, 'camera video flir sensor downlink');
wbIcon('antenna', 'Antenne / repeater', 'tac', `<g ${WB_S}><path d="M32 58V24"/><path d="M32 44 20 58M32 44l12 14M24 53h16" stroke-width="1.4"/><path d="M16 58h32" stroke-width="2"/><circle cx="32" cy="24" r="3.5" ${WB_FILL.solid}/><path d="M22 15a14 14 0 0 1 20 0M15 8a24 24 0 0 1 34 0" stroke-width="2.2"/><path d="M25 32h14" stroke-width="1.4"/></g>`, 'antenne radio repeater c2000 mast');
wbIcon('hazard', 'Gevaar', 'tac', `<g ${WB_S}><path d="M29.5 7.5 4.5 51a3 3 0 0 0 2.6 4.5h49.8A3 3 0 0 0 59.5 51L34.5 7.5a3 3 0 0 0-5 0Z" ${WB_FILL.body}/><path d="M32 23v15" stroke-width="4"/><circle cx="32" cy="46" r="2.6" ${WB_FILL.solid}/></g>`, 'gevaar waarschuwing let op hazard');
wbIcon('nogo', 'No-go', 'tac', `<g ${WB_S}><circle cx="32" cy="32" r="24" stroke-width="4.5" ${WB_FILL.body}/><path d="M15 15l34 34" stroke-width="4.5"/></g>`, 'verboden no go');
wbIcon('explosion', 'Explosie / incident', 'tac', `<g ${WB_S}><path d="${tacBurst(32, 33, 12, 29, 15)}" ${WB_FILL.body}/><path d="${tacBurst(32, 33, 8, 11, 5)}" ${WB_FILL.glass} stroke="none"/></g>`, 'explosie incident knal');
wbIcon('fire', 'Brand', 'tac', `<g ${WB_S}>${TAC_FLAME(32, 28, 1.3)}<path d="M14 58h36" stroke-width="2"/></g>`, 'brand vuur fire');
wbIcon('flag', 'Vlag', 'tac', `<g ${WB_S}><path d="M14 60V8"/><circle cx="14" cy="6" r="2.2" ${WB_FILL.solid}/><path d="M14 10h36l-8 10 8 10H14Z" ${WB_FILL.body}/><path d="M14 16h27M14 24h27" stroke-width="1.1"/><path d="M8 60h12" stroke-width="2"/></g>`, 'vlag start punt');
wbIcon('cordon', 'Afzetting / cordon', 'tac', `<g ${WB_S}><circle cx="32" cy="32" r="24" stroke-width="5" stroke-opacity="0.3"/><circle cx="32" cy="32" r="24" stroke-width="5" stroke-dasharray="5 5" stroke-linecap="butt"/><circle cx="32" cy="8" r="3" ${WB_FILL.solid}/><circle cx="56" cy="32" r="3" ${WB_FILL.solid}/><circle cx="32" cy="56" r="3" ${WB_FILL.solid}/><circle cx="8" cy="32" r="3" ${WB_FILL.solid}/></g>`, 'afzetting cordon afzetlint lint perimeter');
wbIcon('roadblock', 'Wegversperring', 'tac', `<g ${WB_S}><rect x="4" y="24" width="56" height="12" ${WB_FILL.body}/><path d="M10 36l6-12h6l-6 12ZM26 36l6-12h6l-6 12ZM42 36l6-12h6l-6 12Z" ${WB_FILL.glass} stroke="none"/><path d="M8 58l6-22M20 58l-6-22M44 58l6-22M56 58l-6-22" stroke-width="2.2"/><path d="M4 58h56" stroke-width="2"/></g>`, 'wegversperring blokkade roadblock barrier hek');
wbIcon('wind', 'Windpijl (vaantjes)', 'tac', `<g ${WB_S}><circle cx="18" cy="46" r="4.5" ${WB_FILL.body}/><path d="M21.2 42.8 48 16" stroke-width="2.4"/><path d="M48 16l8.5 8.5M43 21l8.5 8.5M38 26l4.2 4.2" stroke-width="2.4"/>${WB_T(14, 24, 'WIND', 9.5)}</g>`, 'wind windpijl windvaan knopen richting barb');
wbIcon('nvg', 'Nachtzicht (NVG)', 'tac', `<g ${WB_S}><path d="M10 30a22 22 0 0 1 44 0" stroke-width="2.4"/><circle cx="21" cy="36" r="9.5" ${WB_FILL.body}/><circle cx="43" cy="36" r="9.5" ${WB_FILL.body}/><circle cx="21" cy="36" r="4.5" ${WB_FILL.glass} stroke="none"/><circle cx="43" cy="36" r="4.5" ${WB_FILL.glass} stroke="none"/><rect x="29" y="33" width="6" height="6" rx="1.5" ${WB_FILL.solid} stroke="none"/>${WB_T(32, 61, 'NVG', 10)}</g>`, 'nachtzicht nvg nachtkijker night vision donker');

/* ---------- scheepssectoren: de ondergrond om eenheden op te plaatsen ---------- */
// Port red, starboard green, bow / mid / stern, with the relative bearings 0, 45, 90, 139 and 180 degrees
// on both sides. Own colours (not the pen colour), and large by default: units are drawn on top of it.
wbIcon('shipsectors', 'Scheepssectoren (bow / mid / stern, bakboord / stuurboord)', 'tac', `<g stroke-linecap="round" stroke-linejoin="round">
<clipPath id="wbShipL"><path d="M32 4C22 12 17 22 17 32s5 20 15 28V4Z"/></clipPath><clipPath id="wbShipR"><path d="M32 4c10 8 15 18 15 28s-5 20-15 28V4Z"/></clipPath>
<path d="M32 4C22 12 17 22 17 32s5 20 15 28V4Z" fill="#e5191f"/><path d="M32 4c10 8 15 18 15 28s-5 20-15 28V4Z" fill="#22b43a"/>
<g stroke-width="0.7" fill="none"><path d="M10 10 32 32" stroke="#e5191f"/><path d="M4 32h28" stroke="#e5191f"/><path d="M10 54 32 32" stroke="#e5191f"/><path d="M54 10 32 32" stroke="#22b43a"/><path d="M60 32H32" stroke="#22b43a"/><path d="M54 54 32 32" stroke="#22b43a"/></g>
<g stroke="#000" stroke-width="1" fill="none"><path d="M32 4C22 12 17 22 17 32s5 20 15 28c10-8 15-18 15-28S42 12 32 4Z"/><path d="M32 4v56M18.4 22h27.2M18.4 42h27.2"/></g>
<g font-family="Bahnschrift,Segoe UI,Arial,sans-serif" font-weight="700" text-anchor="middle" stroke="none">
<text x="32" y="15" font-size="4.6" fill="#111">BOW</text><text x="32" y="33.6" font-size="4.6" fill="#111">MID</text><text x="32" y="52" font-size="4.6" fill="#111">STERN</text>
<text x="32" y="2.8" font-size="3.4" fill="#fff" stroke="#000" stroke-width="0.5" paint-order="stroke">0°</text><text x="32" y="63.4" font-size="3.4" fill="#fff" stroke="#000" stroke-width="0.5" paint-order="stroke">180°</text>
<text x="7" y="8.6" font-size="3.4" fill="#e5191f">45°</text><text x="4" y="29.4" font-size="3.4" fill="#e5191f">90°</text><text x="7" y="58.6" font-size="3.4" fill="#e5191f">139°</text>
<text x="57" y="8.6" font-size="3.4" fill="#22b43a">45°</text><text x="60" y="29.4" font-size="3.4" fill="#22b43a">90°</text><text x="57" y="58.6" font-size="3.4" fill="#22b43a">139°</text>
</g></g>`, 'schip sectoren bakboord stuurboord port starboard bow mid stern peiling boarding ondergrond', { size: 520, own: true });

/* ---------- natuur en dieren (dieren van opzij, kop links) ---------- */
wbIcon('tree', 'Boom', 'nat', `<g ${WB_S}><path d="M29 58V40h6v18" ${WB_FILL.glass}/><path d="M32 5c6 0 10 4 11 9 5 1 9 5 9 11 0 7-6 12-13 12H25c-7 0-13-5-13-12 0-6 4-10 9-11 1-5 5-9 11-9Z" ${WB_FILL.body}/><path d="M20 58h24" stroke-width="2"/></g>`, 'boom obstakel loofboom');
wbIcon('forest', 'Bos', 'nat', `<g ${WB_S}>${tacPine(12, 20, 32, 10)}${tacPine(52, 22, 30, 10)}${tacPine(32, 6, 46, 11)}<path d="M4 58h56" stroke-width="2"/></g>`, 'bos bomen naaldbos');
wbIcon('birds', 'Vogels (birdtam)', 'nat', `<g ${WB_S}>${tacBird(20, 22, 1)}${tacBird(45, 13, 0.8)}${tacBird(36, 42, 1.15)}${tacBird(14, 46, 0.65)}${tacBird(52, 32, 0.6)}</g>`, 'vogels birdtam zwerm vogelgebied meeuwen');
wbIcon('deer', 'Wild / ree', 'nat', `<g ${WB_S}><path d="M13 9 10 1M13 9 6 3M16 10l4-8M16 10l6-5" stroke-width="1.6"/><path d="M54 31c3 0 6 3 6 7v5c0 2-1 3-3 3H21c-2 0-4-1-4-3v-5c0-2 1-4 3-5L11 19c-5 1-8-1-8-4s2-6 6-6h3c3 0 5 2 6 4l1 3 8 15Z" ${WB_FILL.body}/><circle cx="8" cy="13" r="1.3" ${WB_FILL.solid}/><path d="M60 34l4-3" stroke-width="2"/>${tacLegs(21, 46, 46)}</g>`, 'ree hert wild dier gewei');
wbIcon('cattle', 'Vee / koeien', 'nat', `<g ${WB_S}><path d="M6 26c-3-4-3-8 0-8M20 26c3-4 3-8 0-8" stroke-width="1.6"/><path d="M8 24h10a4 4 0 0 1 4 4v2h26c5 0 8 3 8 8v4c0 2-1 3-3 3H18c-2 0-4-1-4-3v-5h-3c-4 0-7-3-7-7v-2a4 4 0 0 1 4-4Z" ${WB_FILL.body}/><path d="M7 30c0 2 2 3 4 3h3" stroke-width="1.1"/><circle cx="36" cy="36" r="4" ${WB_FILL.glass} stroke="none"/><circle cx="47" cy="40" r="2.6" ${WB_FILL.glass} stroke="none"/><circle cx="13" cy="28" r="1.3" ${WB_FILL.solid}/><path d="M56 32c4 3 4 12 1 18" stroke-width="2"/><path d="M32 45c2 3 6 3 8 0" stroke-width="1.4"/>${tacLegs(20, 42, 45)}</g>`, 'vee koeien koe rund dieren');
wbIcon('seal', 'Zeehonden', 'nat', `<g ${WB_S}><path d="M4 52c8-4 20-6 28-6s20 2 28 6v4H4Z" ${WB_FILL.body}/><path d="M6 32c0-4 3-7 7-7 5 0 8 4 9 9 2 3 10 6 20 8 6 1 11 3 14 6l2 4H16c-5 0-9-3-10-7l-1-7Z" ${WB_FILL.glass}/><path d="M22 46l-6 6M30 46l-5 6" stroke-width="2"/><circle cx="10" cy="30" r="1.4" ${WB_FILL.solid}/><path d="M6 33l-3 1M6 35l-3 2" stroke-width="1.1"/><path d="M4 60c6-4 10-4 16 0 6-4 10-4 16 0 6-4 10-4 16 0" stroke-width="1.6"/></g>`, 'zeehond zeehonden zandbank rust');
wbIcon('dogbody', 'Hond', 'nat', `<g ${WB_S}><path d="M10 20l-2-7 6 3" ${WB_FILL.glass}/><path d="M8 22a4 4 0 0 1 4-4h8a4 4 0 0 1 4 4v8h22c4 0 6 3 6 7v4c0 2-1 3-3 3H22c-2 0-4-1-4-3v-7h-6a4 4 0 0 1-4-4Z" ${WB_FILL.body}/><path d="M8 30h8" stroke-width="1.1"/><circle cx="7" cy="30" r="1.6" ${WB_FILL.solid}/><circle cx="13" cy="23" r="1.3" ${WB_FILL.solid}/><path d="M52 32c4-3 5-8 3-12" stroke-width="2.2"/>${tacLegs(21, 42, 44)}</g>`, 'hond dier');
wbIcon('horsebody', 'Paard', 'nat', `<g ${WB_S}><path d="M16 11l-2-6M21 10l1-6" stroke-width="1.6"/><path d="M52 30c4 0 7 3 7 7v6c0 2-1 3-3 3H21c-2 0-3-1-3-3v-5l-4-5-9 1c-2 0-3-2-2-4l6-8 6-10c1-2 3-3 5-3h2c3 0 4 2 4 5l5 16Z" ${WB_FILL.body}/><path d="M22 9c4 3 7 10 9 21h-4c-1-10-4-16-7-19Z" ${WB_FILL.glass} stroke="none"/><circle cx="11" cy="22" r="1.3" ${WB_FILL.solid}/><path d="M59 34c5 3 5 12 2 20" stroke-width="2.2"/>${tacLegs(22, 46, 46)}</g>`, 'paard dier');
wbIcon('fishbody', 'Vis / visgebied', 'nat', `<g ${WB_S}><path d="M8 32c6-10 18-14 30-10 4 2 7 5 9 10-2 5-5 8-9 10-12 4-24 0-30-10Z" ${WB_FILL.body}/><path d="M47 32l11-10v20Z" ${WB_FILL.glass}/><path d="M26 23c3-6 8-7 13-5M26 41c3 6 8 7 13 5" stroke-width="1.4"/><path d="M22 26c-2 4-2 8 0 12" stroke-width="1.1"/><circle cx="16" cy="30" r="2" ${WB_FILL.solid}/><path d="M4 56c6-4 10-4 16 0 6-4 10-4 16 0 6-4 10-4 16 0" stroke-width="1.6"/></g>`, 'vis visgebied visserij');

/* ---------- markeringen ---------- */
for (let i = 1; i <= 9; i += 1) wbIcon(`num${i}`, `Cijfer ${i}`, 'mrk', `<g ${WB_S}>${TAC_DISC}${WB_T(32, 44, String(i), 34)}</g>`, `nummer ${i} cijfer`);
for (const L of ['A', 'B', 'C', 'D', 'E', 'X', 'Y', 'Z']) wbIcon(`let${L}`, `Letter ${L}`, 'mrk', `<g ${WB_S}><rect x="6" y="6" width="52" height="52" rx="10" ${WB_FILL.body} stroke-width="2.6"/>${WB_T(32, 44, L, 34)}</g>`, `letter ${L}`);
wbIcon('pin', 'Speld', 'mrk', `<g ${WB_S}><ellipse cx="32" cy="58" rx="11" ry="3" ${WB_FILL.glass} stroke="none"/><path d="M32 57S12 34 12 23a20 20 0 0 1 40 0c0 11-20 34-20 34Z" ${WB_FILL.body}/><circle cx="32" cy="23" r="7" ${WB_FILL.solid}/></g>`, 'speld pin punt locatie');
wbIcon('star', 'Ster', 'mrk', `<g ${WB_S}><path d="m32 5 8.2 17.4L59 25 45.5 37.6 48.9 56 32 46.8 15.1 56l3.4-18.4L5 25l18.8-2.6Z" ${WB_FILL.body}/><path d="m32 20 4 8.5 9.2 1.3-6.6 6.2 1.6 9L32 40.5 23.8 45l1.6-9-6.6-6.2 9.2-1.3Z" ${WB_FILL.glass} stroke="none"/></g>`, 'ster belangrijk favoriet');
wbIcon('check', 'Vinkje', 'mrk', `<g ${WB_S}>${TAC_DISC}<path d="m18 33 10 10 18-20" stroke-width="5"/></g>`, 'vinkje check ok gereed');
wbIcon('cross', 'Kruis', 'mrk', `<g ${WB_S}>${TAC_DISC}<path d="m21 21 22 22M43 21 21 43" stroke-width="5"/></g>`, 'kruis fout nee');
wbIcon('question', 'Vraagteken', 'mrk', `<g ${WB_S}>${TAC_DISC}${WB_T(32, 44, '?', 34)}</g>`, 'vraag onbekend rfi');
wbIcon('clockic', 'Tijd', 'mrk', `<g ${WB_S}>${TAC_DISC}<path d="M32 9v4M55 32h-4M32 55v-4M9 32h4" stroke-width="2"/><path d="M32 32V17M32 32l10 7" stroke-width="3.5"/><circle cx="32" cy="32" r="2.4" ${WB_FILL.solid}/></g>`, 'tijd klok timing');
wbIcon('north', 'Noordpijl', 'mrk', `<g ${WB_S}><path d="M32 4 20 48l12-7Z" ${WB_FILL.solid}/><path d="M32 4l12 44-12-7Z" ${WB_FILL.body}/>${WB_T(32, 62, 'N', 13)}</g>`, 'noord noordpijl kompas');
wbIcon('scale', 'Schaalbalk', 'mrk', `<g ${WB_S}><rect x="4" y="36" width="56" height="7" ${WB_FILL.body}/><rect x="4" y="36" width="14" height="7" ${WB_FILL.solid} stroke="none"/><rect x="32" y="36" width="14" height="7" ${WB_FILL.solid} stroke="none"/><path d="M4 30v19M32 32v15M60 30v19" stroke-width="2"/>${WB_T(32, 26, '1 km', 11)}${WB_T(5, 58, '0', 9.5)}${WB_T(59, 58, '1', 9.5)}</g>`, 'schaal schaalbalk afstand');
