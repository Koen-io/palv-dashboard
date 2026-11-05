'use strict';

/* ============================================================
   Whiteboard-iconen — voertuigen en personen.
   Voertuigen als zijaanzicht met de neus links (wielen via wbWheel, wielkasten in de omtrek), drie van
   boven voor op een stuk kaart (neus omhoog). Personen staand, met hoofd, romp, armen en benen als
   gesloten vormen en de uitrusting (pet, vest, helm, schild, hond, controller) als herkenningsteken.
   Hulpen hier heten VEH_… en PER_…; alle renderer-scripts delen één naamruimte.
   ============================================================ */

/* ---------- hulpen voertuigen ---------- */
// Koplamp of achterlicht: een klein glazen vlak.
const VEH_LAMP = (x, y, w = 3, h = 2.6) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="0.7" ${WB_FILL.glass} stroke="none"/>`;
// Zijspiegel aan de A-stijl.
const VEH_MIRROR = (x, y) => `<rect x="${x}" y="${y}" width="3" height="2.6" rx="0.7" ${WB_FILL.solid} stroke="none"/>`;
// Lichtbalk op het dak (zijaanzicht): een lage glazen balk met twee tussenschotten.
const VEH_BAR = (x, y, w, h = 4) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="1.2" ${WB_FILL.glass}/><path d="M${(x + w / 3).toFixed(1)} ${y}v${h}M${(x + (2 * w) / 3).toFixed(1)} ${y}v${h}"/>`;
// Wielkast in de omtrek: van rechts naar links over het wiel heen (straal r om cx, op de dorpellijn y).
const VEH_ARCH = (cx, y, r = 7) => `H${cx + r}a${r} ${r} 0 0 0 ${-2 * r} 0`;
// Banden van boven: twee donkere blokjes per as, net buiten de carrosserie.
const VEH_TYRES = (xl, xr, y, h = 7.5) => `<rect x="${xl}" y="${y}" width="3" height="${h}" rx="1" ${WB_FILL.solid} stroke="none"/><rect x="${xr}" y="${y}" width="3" height="${h}" rx="1" ${WB_FILL.solid} stroke="none"/>`;

/* ---------- voertuigen (zijaanzicht, neus links; dorpel op y 45, wielen op y 45) ---------- */
// Politieauto: hoge hatchback (B-klasse/Touran), lichtbalk, striping als lijn.
wbIcon('police', 'Politieauto', 'veh', `<g ${WB_S}>
<path d="M3 45v-8q0-4 4-4h6l7-10q2-2 5-2h15q3 0 5 2l7 10h5q4 0 4 4v8${VEH_ARCH(48, 45)}H23${VEH_ARCH(16, 45)}Z" ${WB_FILL.body}/>
<path d="M14.5 32l6-9h10v9ZM33 23h11l6 9H33Z" ${WB_FILL.glass} stroke="none"/>
<g ${WB_D}><path d="M31.5 23v22M5 38.5h55"/>${VEH_BAR(24, 16.5, 18, 4.5)}</g>
${VEH_MIRROR(11.5, 29.5)}${VEH_LAMP(3.6, 34)}${VEH_LAMP(57.4, 34)}
${wbWheel(16, 45, 5.5)}${wbWheel(48, 45, 5.5)}</g>`, 'politie auto voertuig patrouille noodhulp');
wbAlias('policed', 'police');

// Onopvallende personenauto: sedan met kofferbak, geen lichtbalk.
wbIcon('car', 'Personenauto (onopvallend)', 'veh', `<g ${WB_S}>
<path d="M3 45v-8q0-4 4-4h6l7-10q2-2 5-2h13q3 0 5 2l7 10h7q4 0 4 4v8${VEH_ARCH(48, 45)}H23${VEH_ARCH(16, 45)}Z" ${WB_FILL.body}/>
<path d="M14.5 32l6-9h10v9ZM33 23h9l6 9H33Z" ${WB_FILL.glass} stroke="none"/>
<g ${WB_D}><path d="M31.5 23v22M50 33h8"/></g>
${VEH_MIRROR(11.5, 29.5)}${VEH_LAMP(3.6, 34)}${VEH_LAMP(57.4, 34)}
${wbWheel(16, 45, 5.5)}${wbWheel(48, 45, 5.5)}</g>`, 'auto voertuig onopvallend civiel verdacht sedan');

// ME-bus / bestelbus: hoge daklijn, zijruiten, schuifdeur, blauwe lampen op het dak.
wbIcon('van', 'Bus / bestelbus (ME)', 'veh', `<g ${WB_S}>
<path d="M3 45V30q0-3 1.5-5l5-7q2-3 5-3h41q4 0 4 4v26${VEH_ARCH(46, 45, 6.5)}H22.5${VEH_ARCH(16, 45, 6.5)}Z" ${WB_FILL.body}/>
<path d="M6.5 28l5-9h8.5v9Z" ${WB_FILL.glass} stroke="none"/>
${wbWindows(23, 19, 3, 9, 8, 2)}
<g ${WB_D}><path d="M21 19v26M43.5 19v26M5 36h54"/>${VEH_BAR(26, 11, 12, 3.5)}</g>
${VEH_MIRROR(9.5, 26.5)}${VEH_LAMP(3.6, 33)}${VEH_LAMP(57.4, 33)}
${wbWheel(16, 45, 5.5)}${wbWheel(46, 45, 5.5)}</g>`, 'bus bestelbus busje me mobiele eenheid sprinter');
wbAlias('vand', 'van');

// Vrachtwagen: trekker met oplegger.
wbIcon('truck', 'Vrachtwagen', 'veh', `<g ${WB_S}>
<path d="M3 45V31q0-2 1-4l4-8q1-2 3.5-2H22v28h-3.5${VEH_ARCH(13, 45, 6)}Z" ${WB_FILL.body}/>
<path d="M5.5 29l3.5-9h6v9Z" ${WB_FILL.glass} stroke="none"/><rect x="16.5" y="20" width="4" height="9" rx="0.8" ${WB_FILL.glass} stroke="none"/>
<path d="M24 13h37v28H24Z" ${WB_FILL.body}/>
<g ${WB_D}><path d="M31 15v24M38.5 15v24M46 15v24M53.5 15v24M24 41v3h37v-3M8 36h8v4H8"/></g>
${VEH_LAMP(3.6, 36)}${VEH_LAMP(57.4, 42, 3, 2)}
${wbWheel(13, 45, 5.5)}${wbWheel(26, 45, 5.5)}${wbWheel(47, 45, 5.5)}${wbWheel(57, 45, 5.5)}</g>`, 'vrachtwagen truck lorry oplegger trekker');

// Motor: twee grote wielen, voorvork, tank, zadel, koffers.
wbIcon('moto', 'Motor', 'veh', `<g ${WB_S}>
<path d="M7.5 42a8.5 8.5 0 0 1 15 0" />
<path d="M15 46l7-22" stroke-width="2.4"/><path d="M17 23h10" />
<path d="M22 23l-1-9h8l1 6" ${WB_FILL.glass} stroke-width="1.2"/>
<path d="M21 34l3-9q2-3 6-3h6l5 7-1 5H21Z" ${WB_FILL.body}/>
<path d="M38 34h10q4 0 5 4v2H39Z" ${WB_FILL.glass} stroke-width="1.1"/>
<rect x="26" y="38" width="12" height="7" rx="1.2" ${WB_FILL.glass}/>
<rect x="50" y="27" width="8" height="7" rx="1.5" ${WB_FILL.body}/>
<path d="M38 45h14l3-3M38 42l11 4M22 34l3 4" />
<circle cx="15" cy="46" r="8.5" ${WB_FILL.solid}/><circle cx="15" cy="46" r="3.5" fill="#000" fill-opacity="0.35" stroke="none"/>
<circle cx="49" cy="46" r="8.5" ${WB_FILL.solid}/><circle cx="49" cy="46" r="3.5" fill="#000" fill-opacity="0.35" stroke="none"/>
${VEH_LAMP(18.5, 25, 3, 3.5)}</g>`, 'motor motorfiets motorrijder');

// Ambulance: cabine met hoge opbouw, ster van het leven, lampen op de opbouw.
wbIcon('ambulance', 'Ambulance', 'veh', `<g ${WB_S}>
<path d="M3 45V30q0-3 1.5-5l5-7q2-3 5-3h12v-3h31q3 0 3 3v30${VEH_ARCH(46, 45, 6.5)}H22.5${VEH_ARCH(16, 45, 6.5)}Z" ${WB_FILL.body}/>
<path d="M6.5 28l5-9h8.5v9Z" ${WB_FILL.glass} stroke="none"/><rect x="22" y="19" width="5" height="9" rx="0.8" ${WB_FILL.glass} stroke="none"/>
<rect x="30" y="16" width="11" height="7" rx="0.8" ${WB_FILL.glass} stroke="none"/>
<path d="M50 20v16M43 24l14 8M57 24l-14 8" stroke-width="3"/>
<g ${WB_D}><path d="M20.5 19v26M28.5 12v33M5 40h54"/></g>
<rect x="29" y="9" width="5" height="3" rx="1" ${WB_FILL.solid} stroke="none"/><rect x="54" y="9" width="5" height="3" rx="1" ${WB_FILL.solid} stroke="none"/>
${VEH_MIRROR(9.5, 26.5)}${VEH_LAMP(3.6, 33)}
${wbWheel(16, 45, 5.5)}${wbWheel(46, 45, 5.5)}</g>`, 'ambulance ziekenauto ambu medisch');

// Brandweer: tankautospuit met rolluiken en ladder op het dak.
wbIcon('firetruck', 'Brandweer', 'veh', `<g ${WB_S}>
<path d="M3 45V31q0-2 1-4l4-8q1-2 3.5-2H22v28h-3.5${VEH_ARCH(13, 45, 6)}Z" ${WB_FILL.body}/>
<path d="M5.5 29l3.5-9h6v9Z" ${WB_FILL.glass} stroke="none"/><rect x="16.5" y="20" width="4" height="9" rx="0.8" ${WB_FILL.glass} stroke="none"/>
<path d="M23 17h38v24H23Z" ${WB_FILL.body}/>
<rect x="26" y="20" width="9" height="12" rx="0.8" ${WB_FILL.glass} stroke="none"/><rect x="38" y="20" width="9" height="12" rx="0.8" ${WB_FILL.glass} stroke="none"/><rect x="50" y="20" width="8" height="12" rx="0.8" ${WB_FILL.glass} stroke="none"/>
<g ${WB_D}><path d="M8 13h53M8 10h53M12 10v3M20 10v3M28 10v3M36 10v3M44 10v3M52 10v3M60 10v3M25 36h34M23 41v3h38v-3"/></g>
${VEH_LAMP(3.6, 36)}${VEH_LAMP(57.4, 43, 3, 2)}
${wbWheel(13, 45, 5.5)}${wbWheel(48, 45, 5.5)}</g>`, 'brandweer brandweerauto tankautospuit tas ladder');

// Gepantserd voertuig: schuine pantserplaten, kijksleuven, torentje op het dak, grote wielen.
wbIcon('armored', 'Gepantserd voertuig', 'veh', `<g ${WB_S}>
<path d="M3 44v-9l5-8h5l4-7h30q3 0 4 2l7 13v9${VEH_ARCH(48, 44, 8)}H24${VEH_ARCH(16, 44, 8)}Z" ${WB_FILL.body}/>
<path d="M9.5 26.5l3.5-6h6v6Z" ${WB_FILL.glass} stroke="none"/>
${wbWindows(22, 22, 3, 6, 3.5, 2)}
<rect x="28" y="12" width="13" height="8.5" rx="1.5" ${WB_FILL.glass}/>
<g ${WB_D}><path d="M41 15.5h12M31 12v-3h7v3M5 37h54M15 30h34"/></g>
${VEH_LAMP(3.6, 36.5, 3, 2.6)}
${wbWheel(16, 44, 6.5)}${wbWheel(48, 44, 6.5)}</g>`, 'gepantserd pantser dsi voertuig bearcat');
wbAlias('armoredd', 'armored');

// Fiets: twee grote wielen, diamantframe, zadel, stuur, crank.
wbIcon('bike', 'Fiets', 'veh', `<g ${WB_S}>
<circle cx="13" cy="44" r="10"/><circle cx="51" cy="44" r="10"/>
<circle cx="13" cy="44" r="1.6" ${WB_FILL.solid}/><circle cx="51" cy="44" r="1.6" ${WB_FILL.solid}/>
<path d="M13 44L21 21M21 21h17L30 40ZM21 21l9 19M38 21l13 23M30 40l21 4"/>
<circle cx="30" cy="40" r="3" ${WB_FILL.solid}/>
<path d="M17 19h7" stroke-width="2.2"/>
<path d="M34 19h8" stroke-width="2.8"/></g>`, 'fiets rijwiel bike fietser');

// Tractor: grote achterwielen, kleine voorwielen, motorkap met uitlaat, cabine.
wbIcon('tractor', 'Tractor / landbouw', 'veh', `<g ${WB_S}>
${wbWheel(48, 42, 12)}
<path d="M4 44V30q0-2 2-2h18v16Z" ${WB_FILL.body}/>
<path d="M24 44V17q0-2 2-2h10q2 0 2 2v13h2a10 10 0 0 1 10 10v4Z" ${WB_FILL.body}/>
<rect x="27" y="18" width="8" height="11" rx="1" ${WB_FILL.glass} stroke="none"/>
<path d="M22 15h18M11 28V14" stroke-width="2"/>
<path d="M6 33h12M6 38h12" ${WB_D.replace('fill="none" ', '')}/>
${wbWheel(13, 48, 6.5)}</g>`, 'tractor trekker landbouw boer');

// Trein: kop van een treinstel met gestroomlijnde neus, raampartij, deuren, draaistellen op het spoor.
wbIcon('train', 'Trein', 'veh', `<g ${WB_S}>
<path d="M3 46V28q0-6 5-9l6-4q3-1 6-1h38q3 0 3 3v29Z" ${WB_FILL.body}/>
<path d="M7 27q0-4 4-6l4-2h5v8Z" ${WB_FILL.glass} stroke="none"/>
${wbWindows(24, 18, 4, 7, 7, 2)}
<g ${WB_D}><path d="M22 18v28M48 18v28M34 14l4-5h8l4 5M38 9v-2h8v2M5 38h54"/></g>
<circle cx="8" cy="36" r="2" ${WB_FILL.glass} stroke="none"/>
<path d="M2 52h60"/>
<circle cx="12" cy="49" r="3.5" ${WB_FILL.solid}/><circle cx="20" cy="49" r="3.5" ${WB_FILL.solid}/><circle cx="44" cy="49" r="3.5" ${WB_FILL.solid}/><circle cx="52" cy="49" r="3.5" ${WB_FILL.solid}/></g>`, 'trein spoor treinstel ns');

/* ---------- voertuigen van boven (neus omhoog, voor op een stuk kaart) ---------- */
// Politieauto van boven: motorkap, voorruit, dak met lichtbalk, achterruit, spiegels en banden.
wbIcon('policetop', 'Politieauto (bovenaanzicht)', 'veh', `<g ${WB_S}>
<path d="M23 3h18q5 0 5 5v48q0 5-5 5H23q-5 0-5-5V8q0-5 5-5Z" ${WB_FILL.body}/>
<path d="M20.5 26l2.5-8h18l2.5 8ZM20.5 45l2.5 7h18l2.5-7Z" ${WB_FILL.glass} stroke="none"/>
<rect x="20" y="30" width="24" height="5" rx="1.5" ${WB_FILL.glass}/>
<g ${WB_D}><path d="M28 30v5M36 30v5M22 8h20M22 57h20"/></g>
${VEH_TYRES(15.5, 45.5, 11)}${VEH_TYRES(15.5, 45.5, 46)}
<rect x="15" y="22" width="3.5" height="3.5" rx="0.8" ${WB_FILL.solid} stroke="none"/><rect x="45.5" y="22" width="3.5" height="3.5" rx="0.8" ${WB_FILL.solid} stroke="none"/>
${VEH_LAMP(20, 4, 5, 2.4)}${VEH_LAMP(39, 4, 5, 2.4)}${VEH_LAMP(20, 57.6, 5, 2.4)}${VEH_LAMP(39, 57.6, 5, 2.4)}</g>`, 'politie auto bovenaanzicht kaart top');

// Personenauto van boven.
wbIcon('cartop', 'Personenauto (bovenaanzicht)', 'veh', `<g ${WB_S}>
<path d="M23 3h18q5 0 5 5v48q0 5-5 5H23q-5 0-5-5V8q0-5 5-5Z" ${WB_FILL.body}/>
<path d="M20.5 26l2.5-8h18l2.5 8ZM20.5 45l2.5 7h18l2.5-7Z" ${WB_FILL.glass} stroke="none"/>
<g ${WB_D}><path d="M22 8h20M22 57h20M32 6v10"/></g>
${VEH_TYRES(15.5, 45.5, 11)}${VEH_TYRES(15.5, 45.5, 46)}
<rect x="15" y="22" width="3.5" height="3.5" rx="0.8" ${WB_FILL.solid} stroke="none"/><rect x="45.5" y="22" width="3.5" height="3.5" rx="0.8" ${WB_FILL.solid} stroke="none"/>
${VEH_LAMP(20, 4, 5, 2.4)}${VEH_LAMP(39, 4, 5, 2.4)}${VEH_LAMP(20, 57.6, 5, 2.4)}${VEH_LAMP(39, 57.6, 5, 2.4)}</g>`, 'auto bovenaanzicht kaart top onopvallend');

// Bus van boven: korte neus, voorruit ver naar voren, lang dak met dakribben, achterdeuren.
wbIcon('vantop', 'Bus (bovenaanzicht)', 'veh', `<g ${WB_S}>
<path d="M24 2h16q4 0 4 4v52q0 4-4 4H24q-4 0-4-4V6q0-4 4-4Z" ${WB_FILL.body}/>
<path d="M22 17l2.5-7h15l2.5 7Z" ${WB_FILL.glass} stroke="none"/>
<g ${WB_D}><path d="M22 24h20M22 32h20M22 40h20M22 48h20M32 54v6M22 6h20"/></g>
${VEH_TYRES(17.5, 43.5, 10)}${VEH_TYRES(17.5, 43.5, 46)}
<rect x="16.5" y="17" width="4" height="4" rx="0.8" ${WB_FILL.solid} stroke="none"/><rect x="43.5" y="17" width="4" height="4" rx="0.8" ${WB_FILL.solid} stroke="none"/>
${VEH_LAMP(21.5, 3.2, 5, 2.4)}${VEH_LAMP(37.5, 3.2, 5, 2.4)}${VEH_LAMP(21.5, 58.4, 5, 2.4)}${VEH_LAMP(37.5, 58.4, 5, 2.4)}</g>`, 'bus bestelbus bovenaanzicht kaart top me');

/* ---------- hulpen personen ---------- */
// Een ledemaat of schoen: een afgeronde staaf van (x1,y1) naar (x2,y2), breedte w.
const PER_CAP = (x1, y1, x2, y2, w, fill = WB_FILL.body) => {
  const dx = x2 - x1, dy = y2 - y1, l = Math.hypot(dx, dy) || 1, r = w / 2, px = (-dy / l) * r, py = (dx / l) * r;
  const f = (v) => (+v).toFixed(1);
  return `<path d="M${f(x1 + px)} ${f(y1 + py)}L${f(x2 + px)} ${f(y2 + py)}A${r} ${r} 0 0 0 ${f(x2 - px)} ${f(y2 - py)}L${f(x1 - px)} ${f(y1 - py)}A${r} ${r} 0 0 0 ${f(x1 + px)} ${f(y1 + py)}Z" ${fill}/>`;
};
// Hoofd (cirkel) op cx, met de kruin op y.
const PER_HEAD = (cx, top, r = 4.8, fill = WB_FILL.body) => `<circle cx="${cx}" cy="${top + r}" r="${r}" ${fill}/>`;
// Romp en broek in één silhouet: schouders op y s, heupen op y h, voeten op y f; sw = halve schouderbreedte.
const PER_TRUNK = (cx, s, h, f, sw = 9, fill = WB_FILL.body) => `<path d="M${cx - sw} ${s + 2.5}q0-2.5 2.5-2.5h${2 * sw - 5}q2.5 0 2.5 2.5V${h - 3}l1 3-1 ${f - h}h-5.5l-2 -${(f - h) * 0.7}-2 ${(f - h) * 0.7}h-5.5l-1 -${f - h}l1-3Z" ${fill}/>`;
// Twee schoenen onder de benen, op y.
const PER_SHOES = (cx, y) => PER_CAP(cx - 9, y, cx - 3.5, y, 3.6, WB_FILL.glass) + PER_CAP(cx + 3.5, y, cx + 9, y, 3.6, WB_FILL.glass);
// Een arm van de schouder (sx,sy) naar de hand (hx,hy), met de hand als cirkel.
const PER_ARM = (sx, sy, hx, hy, w = 5.2) => PER_CAP(sx, sy, hx, hy, w) + `<circle cx="${hx}" cy="${hy}" r="2.5" ${WB_FILL.body}/>`;
// Standaardfiguur: hoofd op y 3, schouders 15, heupen 37, benen tot 57, schoenen 59.5; armen naar de opgegeven handen.
const PER_FIG = (cx, lh = [cx - 12, 36], rh = [cx + 12, 36], head = true) => `${head ? PER_HEAD(cx, 3) : ''}<path d="M${cx - 2} 12.5h4v3h-4Z" ${WB_FILL.body} stroke="none"/>${PER_TRUNK(cx, 15, 37, 57)}${PER_ARM(cx - 10.5, 18.5, lh[0], lh[1])}${PER_ARM(cx + 10.5, 18.5, rh[0], rh[1])}${PER_SHOES(cx, 59.6)}`;
// Scherfvest / plaatdrager over de romp.
const PER_VEST = (cx, y = 18, h = 16, w = 14) => `<path d="M${cx - w / 2} ${y + 2}q0-2 2-2h${w - 4}q2 0 2 2v${h - 2}H${cx - w / 2}Z" ${WB_FILL.glass} stroke-width="1.1"/>`;
// Politiepet: platte bovenkant, band en klep (neus naar links).
const PER_CAP_POLICE = (cx, top) => `<path d="M${cx - 6} ${top + 3.5}q0-3.5 6-3.5t6 3.5Z" ${WB_FILL.solid} stroke="none"/><path d="M${cx - 7.5} ${top + 3.5}h15" stroke-width="1.8"/><path d="M${cx - 7.5} ${top + 2.6}h-3l1.5 2.6h3Z" ${WB_FILL.solid} stroke-width="1.1"/>`;
// Baseballcap: koepel en klep naar links.
const PER_CAP_BASE = (cx, top) => `<path d="M${cx - 5} ${top + 4}q0-4 5-4t5 4Z" ${WB_FILL.solid} stroke="none"/><path d="M${cx - 9} ${top + 4}h14" stroke-width="1.6"/>`;

/* ---------- personen (staand, hoofd boven) ---------- */
// Verdachte: capuchon op, handen in de zakken.
wbIcon('suspect', 'Verdachte', 'per', `<g ${WB_S}>
${PER_FIG(32, [25, 37], [39, 37], false)}
<path d="M24 16q-1-12.5 8-12.5t8 12.5Z" ${WB_FILL.body}/>
<ellipse cx="32" cy="11" rx="3" ry="3.8" ${WB_FILL.glass} stroke="none"/>
<path d="M28 44h8" ${WB_D.replace('fill="none" ', '')}/></g>`, 'verdachte suspect persoon dader');

// Eigen eenheid te voet: zwaait met een hand omhoog, hesje met band.
wbIcon('friendly', 'Eigen eenheid (persoon)', 'per', `<g ${WB_S}>
${PER_FIG(32, [20, 36], [46, 10])}
${PER_VEST(32, 18, 17, 15)}
<path d="M25.5 27h13" ${WB_D.replace('fill="none" ', '')}/></g>`, 'eigen persoon friendly collega te voet');

// Politieagent: pet, uniform met vest, koppel, portofoon op de borst.
wbIcon('officer', 'Politieagent', 'per', `<g ${WB_S}>
${PER_FIG(32, [20, 37], [44, 37])}
${PER_CAP_POLICE(32, 2.5)}
${PER_VEST(32, 18, 17, 15)}
<rect x="34.5" y="20.5" width="3" height="4.5" rx="0.6" ${WB_FILL.solid} stroke="none"/>
<path d="M25 37h14" stroke-width="2.2"/></g>`, 'agent politie politieagent uniform');
wbAlias('officerd', 'officer');

// Handhaver / BOA: baseballcap, hesje met twee reflecterende banden.
wbIcon('boa', 'Handhaver / BOA', 'per', `<g ${WB_S}>
${PER_FIG(32, [20, 37], [44, 37])}
${PER_CAP_BASE(32, 2.5)}
${PER_VEST(32, 18, 17, 15)}
<path d="M25.5 24h13M25.5 29h13" ${WB_D.replace('fill="none" ', '')}/>
<path d="M25 37h14" stroke-width="2.2"/></g>`, 'boa handhaver handhaving toezichthouder gemeente');

// Team: drie figuren naast elkaar, de middelste voorop.
wbIcon('team', 'Team / groep', 'per', `<g ${WB_S}>
<g transform="translate(4.5 7) scale(0.86)">${PER_HEAD(12, 3)}${PER_TRUNK(12, 15, 37, 57, 8)}${PER_SHOES(12, 59.6)}${PER_HEAD(52, 3)}${PER_TRUNK(52, 15, 37, 57, 8)}${PER_SHOES(52, 59.6)}</g>
${PER_HEAD(32, 3)}<path d="M30 12.5h4v3h-4Z" ${WB_FILL.body} stroke="none"/>${PER_TRUNK(32, 15, 37, 57)}${PER_ARM(21.5, 18.5, 18, 36)}${PER_ARM(42.5, 18.5, 46, 36)}${PER_SHOES(32, 59.6)}</g>`, 'team groep ploeg eenheid koppel');

// DSI-operator: helm, plaatdrager, wapen schuin voor de borst, kniebeschermers.
wbIcon('dsi', 'DSI / arrestatieteam', 'per', `<g ${WB_S}>
${PER_FIG(32, [22, 30], [43, 24], false)}
<path d="M25.5 9a6.5 6.5 0 0 1 13 0v2.5h-13Z" ${WB_FILL.solid} stroke="none"/><path d="M25.5 13.5V9a6.5 6.5 0 0 1 13 0v4.5" />
<path d="M26.5 11.5h11v2h-11Z" ${WB_FILL.glass} stroke="none"/>
${PER_VEST(32, 17.5, 18, 15)}
<path d="M27.5 22h9M27.5 26h9M27.5 30h9" ${WB_D.replace('fill="none" ', '')}/>
<path d="M19 33L44 17" stroke-width="3.2"/><path d="M38 21l3 4" stroke-width="2"/>
<rect x="25.5" y="44" width="5" height="5" rx="1" ${WB_FILL.glass} stroke="none"/><rect x="33.5" y="44" width="5" height="5" rx="1" ${WB_FILL.glass} stroke="none"/></g>`, 'dsi at arrestatieteam interventie operator helm');
wbAlias('dsid', 'dsi');

// Hondengeleider: agent met pet, hond aan een lijn.
wbIcon('dog', 'Hondengeleider', 'per', `<g ${WB_S}>
${PER_FIG(21, [10, 37], [33, 35])}
${PER_CAP_POLICE(21, 2.5)}${PER_VEST(21, 18, 17, 15)}
<path d="M33 35q8 0 13 7" ${WB_D.replace('fill="none" ', '')}/>
<path d="M46 41.5q8-1 10 6l4 10.5h-3.5l-2.5-7h-1.5l1 7h-3.5l-1-7h-4l-0.5 7h-3.5l0.5-9q0-4 4-6.5Z" ${WB_FILL.body}/>
<path d="M58 50q4-2 3-8" stroke-width="2.2"/>
<path d="M41.5 35.5l-1.5-5.5 4.5 2.5ZM46.5 35.5l1.5-5.5-4.5 2.5Z" ${WB_FILL.body}/>
<circle cx="44" cy="38.5" r="4.2" ${WB_FILL.body}/>
<path d="M40.2 38.5l-3.2 1.2 2.8 2Z" ${WB_FILL.body}/>
<circle cx="42.5" cy="37.5" r="0.8" ${WB_FILL.solid} stroke="none"/></g>`, 'hond hondengeleider k9 diensthond');

// Bereden politie: paard met ruiter, kop links.
wbIcon('horse', 'Bereden politie', 'per', `<g ${WB_S}>
${PER_CAP(20, 45.5, 17, 58, 4)}${PER_CAP(25, 45.5, 25, 58, 4)}${PER_CAP(49, 45.5, 53, 58, 4)}${PER_CAP(55, 44.5, 58.5, 57, 4)}
<path d="M58 32q5 4 3 14" stroke-width="2.6"/>
<path d="M3 24.5L4 20q2-4 5-5l3-5 2.5 5.5q2.5 1.5 4.5 5.5l6 8q3 0 7 0h18q8 0 8 6l-1 7q-2 2.5-7 2.5H20q-4 0-4.5-4.5L12 30l-3-1.5q-5-.5-6-4Z" ${WB_FILL.body}/>
<path d="M15.5 15.5q-1-5 1.5-7l1.5 6.5Z" ${WB_FILL.body}/>
<circle cx="9" cy="18.5" r="0.9" ${WB_FILL.solid} stroke="none"/>
<path d="M14 16q3 3 5.5 8" ${WB_D.replace('fill="none" ', '')}/>
${PER_CAP(36.5, 30, 37.5, 44, 5, WB_FILL.glass)}${PER_CAP(35, 47, 40.5, 46.5, 3.6, WB_FILL.glass)}
<rect x="26" y="27.5" width="17" height="4.5" rx="1.5" ${WB_FILL.glass}/>
<path d="M28.5 16q0-2.5 2.5-2.5h8q2.5 0 2.5 2.5v12h-13Z" ${WB_FILL.body}/>
${PER_VEST(35, 16, 10, 11)}
${PER_CAP(28.5, 17.5, 21, 25, 4.5)}<circle cx="21" cy="25" r="2.2" ${WB_FILL.body}/>
<path d="M21 25L5 24" ${WB_D.replace('fill="none" ', '')}/>
${PER_HEAD(35, 2, 4.5)}<path d="M33 11h4v2.5h-4Z" ${WB_FILL.body} stroke="none"/>
${PER_CAP_POLICE(35, 1.5)}</g>`, 'paard bereden politie ruiter');

// Slachtoffer: liggend persoon op de grond.
wbIcon('casualty', 'Slachtoffer', 'per', `<g ${WB_S}>
<path d="M3 54h58" ${WB_D.replace('fill="none" ', '')}/>
<circle cx="9.5" cy="46.5" r="4.8" ${WB_FILL.body}/>
<path d="M17 42h18l22 1q3 0 3 3v4H17q-3 0-3-3v-2q0-3 3-3Z" ${WB_FILL.body}/>
${PER_CAP(19, 38, 31, 37, 4.2)}<circle cx="32" cy="37" r="2.2" ${WB_FILL.body}/>
<path d="M57.5 44.5l1.5-2.5" ${WB_D.replace('fill="none" ', '')}/>
<rect x="54.5" y="40" width="7" height="3.5" rx="1" ${WB_FILL.glass} stroke="none"/>
<path d="M44 12v14M37 19h14" stroke-width="3.2"/></g>`, 'slachtoffer gewonde casualty drenkeling liggend');

// Drone-operator: kijkt omhoog, controller met antennes voor de buik, de drone rechtsboven.
wbIcon('operator', 'Drone-operator', 'per', `<g ${WB_S}>
${PER_FIG(28, [21, 32], [35, 32])}
<rect x="20" y="30" width="16" height="7" rx="1.5" ${WB_FILL.glass}/>
<path d="M23 30v-4M33 30v-4" ${WB_D.replace('fill="none" ', '')}/>
<path d="M50 14l8-8M58 14l-8-8" ${WB_D.replace('fill="none" ', '')}/>
<circle cx="50" cy="6" r="2.6"/><circle cx="58" cy="6" r="2.6"/><circle cx="50" cy="14" r="2.6"/><circle cx="58" cy="14" r="2.6"/>
<rect x="52" y="8" width="4" height="4" rx="1" ${WB_FILL.solid} stroke="none"/></g>`, 'drone operator rpas piloot uav');

// Menigte: twee rijen hoofden en schouders.
wbIcon('crowd', 'Menigte', 'per', `<g ${WB_S}>
${[10, 22, 34, 46, 56].map((x) => `${PER_HEAD(x, 12, 4.2)}<path d="M${x - 8} 40V30q0-6 8-6t8 6v10Z" ${WB_FILL.body}/>`).join('')}
${[16, 32, 48].map((x) => `${PER_HEAD(x, 26, 4.6, WB_FILL.glass)}<path d="M${x - 9} 58V45q0-7 9-7t9 7v13Z" ${WB_FILL.glass}/>`).join('')}</g>`, 'menigte publiek groep mensen massa');

// Hulpverlener: hesje met kruis, tas in de hand.
wbIcon('medic', 'Hulpverlener (medisch)', 'per', `<g ${WB_S}>
${PER_FIG(30, [18, 38], [43, 40])}
${PER_CAP_BASE(30, 2.5)}${PER_VEST(30, 18, 17, 15)}
<path d="M30 21v9M25.5 25.5h9" stroke-width="2.6"/>
<rect x="38" y="42" width="14" height="10" rx="1.5" ${WB_FILL.glass}/><path d="M42 42v-2h6v2" ${WB_D.replace('fill="none" ', '')}/>
<path d="M45 44.5v5M42.5 47h5" stroke-width="1.6"/></g>`, 'medic hulpverlener ehbo verpleegkundige ambulance tas');
