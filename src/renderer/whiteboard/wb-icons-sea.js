'use strict';

/* ============================================================
   Whiteboard — iconen: de vaartuigen in zijaanzicht (categorie 'sea'). Boeg links, water onderaan
   (WB_WAVES), kiel op y≈54. Elk schip heeft zijn echte silhouet: romp, opbouw met brugramen, masten, radar,
   kranen, lading. Van de oude basis- en detailversies is er nu één icoon per type; de oude detail-ids
   (containerd, tankerd, …) wijzen via wbAlias naar het icoon van nu.
   ============================================================ */

/* ---------- hulpen ---------- */
// Romp in zijaanzicht: boeg (links) op x0, spiegel op x1, dek op yd, kiel op 54. Schuine steven;
// met `bulb` een bulbsteven onder water. Vulling body.
const SEA_HULL = (x0, x1, yd = 40, rake = 6, bulb = false, fill = WB_FILL.body) => {
  const bow = bulb ? `H${x0 + rake}Q${x0 + rake - 4} 54 ${x0 + rake - 3} 51.5L${x0} ${yd}` : `H${x0 + rake}L${x0} ${yd}`;
  return `<path d="M${x0} ${yd}H${x1}L${x1 - 2} 54${bow}Z" ${fill}/>`;
};
// Boeggolf: het water dat tegen de steven opspat (x = steven op de waterlijn).
const SEA_BOW = (x, y = 49) => `<path d="M${x} ${y}c-2 1-3 3-4 5" stroke-width="1.3"/>`;
// Mast met radarbalk en toplicht: voet op (x, y0), top op y1.
const SEA_MAST = (x, y0, y1, radar = true) => `<path d="M${x} ${y0}V${y1}" stroke-width="1.3"/>${radar ? `<path d="M${x - 3} ${y1 + 2.5}h6" stroke-width="1.6"/>` : ''}<circle cx="${x}" cy="${y1 - 1}" r="1.2" ${WB_FILL.solid} stroke="none"/>`;
// Schoorsteen: voet op (x, y), breedte w, hoogte h, met een donkere kap.
const SEA_FUNNEL = (x, y, w = 5, h = 6) => `<path d="M${x} ${y}v-${h}h${w}v${h}" ${WB_FILL.body}/><rect x="${x}" y="${y - h}" width="${w}" height="2" ${WB_FILL.glass} stroke="none"/>`;
// Opblaasbare tube langs het boord (RIB, reddingboot): een dikke, half dekkende lijn.
const SEA_TUBE = (d, w = 4) => `<path d="${d}" stroke-width="${w}" stroke-opacity="0.55"/>`;
// Containers: kolommen van `heights` (aantal hoog) vanaf x, elke box 6 breed en 5 hoog, bovenop dek y.
const SEA_BOXES = (x, y, heights, w = 6, h = 5) => {
  let s = '';
  heights.forEach((n, i) => {
    for (let k = 0; k < n; k += 1) s += `<rect x="${x + i * w}" y="${y - (k + 1) * h}" width="${w}" height="${h}" ${(i + k) % 3 === 1 ? WB_FILL.glass : WB_FILL.body} stroke-width="1"/>`;
  });
  return s;
};
// Laadkraan: post op x vanaf dek y tot top yt, giek naar (jx, jy), haak eronder.
const SEA_CRANE = (x, y, yt, jx, jy) => `<path d="M${x} ${y}V${yt}M${x} ${yt + 2}L${jx} ${jy}" stroke-width="1.4"/><path d="M${jx} ${jy}v3" stroke-width="1"/>`;

/* ---------- kleine, snelle vaartuigen ---------- */
wbIcon('rib', 'RIB / snelle boot', 'sea', `<g ${WB_S}>
<path d="M4 38C14 36 32 34 58 38L56 50H16Q8 50 4 38Z" ${WB_FILL.body}/>
${SEA_TUBE('M6 38C16 36 32 34 56 38', 4.2)}
<path d="M28 34v-9h10l4 9" ${WB_FILL.body}/><path d="M30 26.5h6.5l2.5 6H30Z" ${WB_FILL.glass} stroke="none"/>
<path d="M44 34l2-10h4l2 10" stroke-width="1.3"/><circle cx="48" cy="23" r="1.3" ${WB_FILL.solid} stroke="none"/>
<circle cx="24" cy="31" r="2.2" ${WB_FILL.glass} stroke-width="1"/>
<path d="M56 38h4v6h-4M58 44v7" stroke-width="1.4"/>
<path d="M8 46H22" stroke-width="1"/>
${SEA_BOW(8, 47)}${WB_WAVES}</g>`, 'rib rubberboot snelle boot speedboot');
wbAlias('ribd', 'rib');

wbIcon('policeboat', 'Politieboot', 'sea', `<g ${WB_S}>
<path d="M4 40C14 36 30 34 56 36L54 50H14Q6 50 4 40Z" ${WB_FILL.body}/>
${SEA_TUBE('M6 39C14 35 30 33 54 35', 4)}
<path d="M20 34V26h20l4 8" ${WB_FILL.body}/>${wbWindows(22.5, 28, 3, 4.5, 4, 1.4)}
<rect x="26" y="22.5" width="9" height="2.5" rx="0.8" ${WB_FILL.solid} stroke="none"/>
<path d="M38 26v-5M35.5 22h5" stroke-width="1.3"/>
<path d="M54 36h4v5h-4M56.5 41v9" stroke-width="1.4"/>
<path d="M8 45h10" stroke-width="1"/>
${SEA_BOW(7, 46)}${WB_WAVES}</g>`, 'politie boot politieboot waterpolitie rhib');

wbIcon('speedboat', 'Speedboot / motorjacht', 'sea', `<g ${WB_S}>
<path d="M4 42C14 38 34 36 58 38L56 50H16Q7 50 4 42Z" ${WB_FILL.body}/>
<path d="M22 36l4-7h16l3 7Z" ${WB_FILL.glass} stroke-width="1.2"/>
<path d="M24 36h28" stroke-width="1.2"/><path d="M46 36v-3h4v3" stroke-width="1.1"/>
<path d="M8 40h16" stroke-width="1"/><path d="M10 46h46" stroke-width="1" stroke-opacity="0.6"/>
<path d="M56 40l3 1v4l-3 1M58 46v5" stroke-width="1.3"/>
${SEA_BOW(6, 47)}${WB_WAVES}</g>`, 'speedboot motorjacht jacht');

wbIcon('jetski', 'Waterscooter', 'sea', `<g ${WB_S}>
<path d="M4 46C6 40 16 38 28 38H46C54 38 58 42 58 48L56 50H10Q5 50 4 46Z" ${WB_FILL.body}/>
<path d="M28 38C36 33 46 33 52 37Z" ${WB_FILL.glass} stroke-width="1.2"/>
<path d="M8 40Q16 35 28 38" stroke-width="1.1"/>
<path d="M22 38l5-9M24 29h7" stroke-width="1.6"/>
<circle cx="37" cy="20" r="3" ${WB_FILL.solid} stroke="none"/>
<path d="M34 36c0-6 1-10 3-12" stroke-width="3.2" stroke-opacity="0.95"/><path d="M36 27l-8 2.5M34 36l-5 3" stroke-width="2"/>
<path d="M58 46l4 3" stroke-width="1.3"/>
${WB_WAVES}</g>`, 'waterscooter jetski');

wbIcon('kayak', 'Kajak', 'sea', `<g ${WB_S}>
<path d="M3 46C10 42 54 42 61 46C54 50 10 50 3 46Z" ${WB_FILL.body}/>
<ellipse cx="31" cy="45" rx="7" ry="1.8" ${WB_FILL.glass} stroke-width="1"/>
<circle cx="31" cy="27" r="3.2" ${WB_FILL.solid} stroke="none"/>
<path d="M31 31v12" stroke-width="3.4"/>
<path d="M13 31L49 41" stroke-width="1.6"/>
<ellipse cx="13" cy="31" rx="2" ry="3.8" transform="rotate(-74 13 31)" ${WB_FILL.solid} stroke="none"/>
<ellipse cx="49" cy="41" rx="2" ry="3.8" transform="rotate(-74 49 41)" ${WB_FILL.solid} stroke="none"/>
<path d="M31 35l-9-2M31 36l9 2.5" stroke-width="1.6"/>
${WB_WAVES}</g>`, 'kajak kano');

wbIcon('dinghy', 'Rubberboot (klein)', 'sea', `<g ${WB_S}>
<path d="M4 44C10 39 20 38 32 38S54 39 60 44L56 52H10Q6 52 4 44Z" ${WB_FILL.body}/>
${SEA_TUBE('M6 43C12 38 22 37 32 37S52 38 58 43', 4)}
<circle cx="16" cy="33" r="2.5" ${WB_FILL.solid} stroke="none"/><circle cx="25" cy="32" r="2.5" ${WB_FILL.solid} stroke="none"/><circle cx="34" cy="32" r="2.5" ${WB_FILL.solid} stroke="none"/><circle cx="43" cy="33" r="2.5" ${WB_FILL.solid} stroke="none"/>
<path d="M12 38q4-3 8 0M21 37q4-3 8 0M30 37q4-3 8 0M39 38q4-3 8 0" stroke-width="1.4"/>
<path d="M58 42h3v5h-3M59.5 47v5" stroke-width="1.3"/>
${WB_WAVES}</g>`, 'rubberboot bootje migranten dinghy');

wbIcon('liferaft', 'Reddingsvlot', 'sea', `<g ${WB_S}>
<path d="M10 44C12 28 52 28 54 44Z" ${WB_FILL.body}/>
<ellipse cx="32" cy="46" rx="24" ry="5.5" ${WB_FILL.glass}/>
<path d="M25 44C25 34 39 34 39 44Z" ${WB_FILL.glass} stroke-width="1.2"/>
<path d="M32 30v-3" stroke-width="1.3"/><circle cx="32" cy="26" r="1.5" ${WB_FILL.solid} stroke="none"/>
<path d="M14 40h6M44 40h6" stroke-width="1"/>
${WB_WAVES}</g>`, 'reddingsvlot vlot liferaft');

/* ---------- reddings-, loods-, politie- en kustwachtvaartuigen ---------- */
wbIcon('lifeboat', 'Reddingboot (KNRM)', 'sea', `<g ${WB_S}>
<path d="M4 42C12 40 48 38 60 40L58 52H10Q5 52 4 42Z" ${WB_FILL.body}/>
${SEA_TUBE('M6 42C14 40 48 38 58 40', 3.2)}
<path d="M22 40V28h20l4 12" ${WB_FILL.body}/>${wbWindows(25, 30.5, 3, 4, 4, 1.4)}
${SEA_MAST(34, 28, 16)}
<path d="M8 38h10M50 37h6" stroke-width="1"/>
${SEA_BOW(7, 47)}${WB_WAVES}</g>`, 'knrm reddingboot sar rescue');
wbAlias('lifeboatd', 'lifeboat');

wbIcon('knrmarie', 'Reddingboot Arie Visser-klasse (KNRM)', 'sea', `<g ${WB_S}>
<path d="M4 42C12 39 48 38 60 39L58 52H12Q5 52 4 42Z" ${WB_FILL.body}/>
${SEA_TUBE('M6 42C14 39 48 38 58 39', 3.2)}
<path d="M16 40V30l4-5h20v15" ${WB_FILL.body}/>
<path d="M17 30.5l3-4.5h2v4.5Z" ${WB_FILL.glass} stroke="none"/>${wbWindows(24, 27, 3, 4, 4, 1.4)}
<path d="M42 40l4-18 4 18M44 31h4" stroke-width="1.4"/>
<path d="M43 22h6" stroke-width="1.6"/><circle cx="46" cy="20" r="1.3" ${WB_FILL.solid} stroke="none"/>
<path d="M8 38h7M52 37h5" stroke-width="1"/>
${SEA_BOW(7, 47)}${WB_WAVES}</g>`, 'knrm reddingboot arie visser sar rescue');

wbIcon('pilot', 'Loodsboot', 'sea', `<g ${WB_S}>
<path d="M4 38C12 40 30 42 60 42L58 52H12Q5 52 4 38Z" ${WB_FILL.body}/>
<path d="M6 39.5C14 41.5 30 43.5 58 43.5" stroke-width="2.2" stroke-opacity="0.5"/>
<path d="M18 42V32h22l4 10" ${WB_FILL.body}/><path d="M20 32v-6h16l2 6" ${WB_FILL.body}/>${wbWindows(22, 27.5, 3, 3.5, 3.5, 1.4)}
${SEA_MAST(30, 26, 16)}
<path d="M8 36h8" stroke-width="1"/>
${SEA_BOW(6, 46)}${WB_WAVES}</g>`, 'loodsboot pilot loods');

wbIcon('patrol', 'Patrouillevaartuig (politie/kustwacht)', 'sea', `<g ${WB_S}>
${SEA_HULL(4, 60, 40, 7)}
<path d="M16 40V32h24l4 8" ${WB_FILL.body}/><path d="M20 32v-7h16l2 7" ${WB_FILL.body}/>${wbWindows(22, 27.5, 3, 3.5, 3.5, 1.3)}
${SEA_MAST(28, 25, 13)}<path d="M25.5 19.5h5" stroke-width="1.1"/>
<path d="M48 40v-4h6v4" stroke-width="1.2"/><path d="M8 38h6" stroke-width="1"/>
<path d="M12 44H58" stroke-width="1" stroke-opacity="0.6"/>
${SEA_BOW(9, 49)}${WB_WAVES}</g>`, 'politieboot kustwacht patrouille vaartuig');
wbAlias('patrold', 'patrol');

wbIcon('coastguard', 'Kustwachtcutter', 'sea', `<g ${WB_S}>
<path d="M4 36C14 38 36 40 60 40L58 54H14Q6 54 4 36Z" ${WB_FILL.body}/>
<path d="M14 40V28h22l4 12" ${WB_FILL.body}/><path d="M18 28v-7h14l2 7" ${WB_FILL.body}/>${wbWindows(20, 23, 3, 3, 3, 1.3)}
${SEA_MAST(27, 21, 9)}<path d="M23 15h8" stroke-width="1.1"/>
${SEA_CRANE(46, 40, 30, 54, 36)}
<path d="M56 40v-5h2" stroke-width="1.2"/>
<path d="M10 41l3 12M14 41l3 12" stroke-width="1.6"/>
${SEA_BOW(8, 48)}${WB_WAVES}</g>`, 'kustwacht cutter patrouille coastguard');

/* ---------- handelsvaart ---------- */
wbIcon('ship', 'Schip / vrachtschip', 'sea', `<g ${WB_S}>
${SEA_HULL(4, 60, 40, 7, true)}
<path d="M5 40v-4h8v4" stroke-width="1.2"/>
<rect x="15" y="36" width="12" height="4" ${WB_FILL.body} stroke-width="1.1"/><rect x="31" y="36" width="12" height="4" ${WB_FILL.body} stroke-width="1.1"/>
<path d="M29 36V16M29 19L18 32M29 19l11 13" stroke-width="1.4"/>
<path d="M46 40V26h10v14" ${WB_FILL.body}/>${wbWindows(48, 28, 2, 3, 3, 1.5)}
${SEA_FUNNEL(51, 26, 4, 5)}${SEA_MAST(48, 26, 16)}
${SEA_BOW(9, 49)}${WB_WAVES}</g>`, 'schip vrachtschip cargo stukgoed');

wbIcon('container', 'Containerschip', 'sea', `<g ${WB_S}>
${SEA_HULL(4, 60, 40, 6, true)}
<path d="M5 40v-4h7v4" stroke-width="1.2"/>
${SEA_BOXES(12, 40, [2, 3, 3, 4, 4, 3])}
<path d="M50 40V20h8v20" ${WB_FILL.body}/>${wbWindows(51.5, 22, 1, 5, 3)}${wbWindows(51.5, 28, 1, 5, 3)}
${SEA_MAST(54, 20, 11)}
${SEA_BOW(8, 49)}${WB_WAVES}</g>`, 'container schip vracht containerschip');
wbAlias('containerd', 'container');

wbIcon('tanker', 'Tanker', 'sea', `<g ${WB_S}>
${SEA_HULL(4, 60, 40, 6, true)}
<path d="M5 40v-3h7v3M10 37v-8" stroke-width="1.2"/>
<path d="M12 37h34" stroke-width="1.2"/><path d="M16 37v-2M22 37v-2M38 37v-2M44 37v-2" stroke-width="1.1"/>
<path d="M26 37v-5h8v5" ${WB_FILL.body} stroke-width="1.2"/><path d="M28 32v-3M32 32v-3" stroke-width="1.1"/>
<path d="M46 40V22h10v18" ${WB_FILL.body}/>${wbWindows(48, 24.5, 2, 3, 3, 1.5)}${wbWindows(48, 30.5, 2, 3, 3, 1.5)}
${SEA_FUNNEL(51, 22, 4, 5)}${SEA_MAST(48, 22, 13)}
${SEA_BOW(8, 49)}${WB_WAVES}</g>`, 'tanker olie gas chemie schip');
wbAlias('tankerd', 'tanker');

wbIcon('bulk', 'Bulkcarrier', 'sea', `<g ${WB_S}>
${SEA_HULL(4, 60, 40, 6, true)}
<path d="M5 40v-3h8v3M10 37v-7" stroke-width="1.2"/>
<rect x="14" y="36.5" width="8" height="3.5" ${WB_FILL.body} stroke-width="1.1"/><rect x="24" y="36.5" width="8" height="3.5" ${WB_FILL.body} stroke-width="1.1"/><rect x="34" y="36.5" width="8" height="3.5" ${WB_FILL.body} stroke-width="1.1"/><rect x="44" y="36.5" width="5" height="3.5" ${WB_FILL.body} stroke-width="1.1"/>
${SEA_CRANE(23, 36.5, 24, 30, 31)}${SEA_CRANE(43, 36.5, 24, 50, 31)}
<path d="M51 40V22h7v18" ${WB_FILL.body}/>${wbWindows(52.5, 24.5, 1, 4, 3)}${wbWindows(52.5, 30, 1, 4, 3)}
${SEA_MAST(54.5, 22, 13)}
${SEA_BOW(8, 49)}${WB_WAVES}</g>`, 'bulk carrier bulkcarrier erts graan kolen');

wbIcon('lng', 'LNG-tanker', 'sea', `<g ${WB_S}>
${SEA_HULL(4, 60, 40, 6, true)}
<path d="M6 40a6.5 6.5 0 0 1 13 0Z" ${WB_FILL.body}/><path d="M20 40a6.5 6.5 0 0 1 13 0Z" ${WB_FILL.body}/><path d="M34 40a6.5 6.5 0 0 1 13 0Z" ${WB_FILL.body}/>
<path d="M8 37h9M22 37h9M36 37h9" stroke-width="1" stroke-opacity="0.6"/>
<path d="M49 40V22h9v18" ${WB_FILL.body}/>${wbWindows(50.5, 24.5, 1, 6, 3)}${wbWindows(50.5, 30, 1, 6, 3)}
${SEA_FUNNEL(55, 22, 3, 5)}${SEA_MAST(52, 22, 12)}
${SEA_BOW(8, 49)}${WB_WAVES}</g>`, 'lng gas tanker bolvormig moss');

wbIcon('roro', 'Ro-ro / autoschip', 'sea', `<g ${WB_S}>
${SEA_HULL(4, 60, 40, 7, true)}
<path d="M8 40V22l4-6h46v24" ${WB_FILL.body}/>
<path d="M10 32h48M11 24h47" stroke-width="1" stroke-opacity="0.6"/>
${wbWindows(14, 18, 4, 3.5, 3, 1.5)}
<path d="M54 40V26h4" stroke-width="1.1"/><path d="M58 40l5-6" stroke-width="1.4"/>
${SEA_FUNNEL(48, 16, 5, 5)}${SEA_MAST(22, 16, 7)}
${SEA_BOW(9, 49)}${WB_WAVES}</g>`, 'roro autoschip car carrier');

wbIcon('ferry', 'Veerboot / passagiersschip', 'sea', `<g ${WB_S}>
${SEA_HULL(4, 60, 40, 6, true)}
<path d="M8 40v-8h50v8" ${WB_FILL.body}/><path d="M10 32v-8h46v8" ${WB_FILL.body}/><path d="M14 24v-6h36v6" ${WB_FILL.body}/>
${wbWindows(12, 26, 8, 3.5, 3, 1.6)}${wbWindows(16, 19.5, 6, 3.5, 3, 1.6)}
${SEA_FUNNEL(51, 24, 5, 7)}${SEA_MAST(18, 18, 9)}
<path d="M58 40l4-6" stroke-width="1.4"/><path d="M8 40v-6" stroke-width="1.1"/>
${SEA_BOW(8, 49)}${WB_WAVES}</g>`, 'veerboot ferry passagiers');
wbAlias('ferryd', 'ferry');

wbIcon('cruise', 'Cruiseschip', 'sea', `<g ${WB_S}>
${SEA_HULL(4, 60, 42, 8, true)}
<path d="M10 42v-8h48v8" ${WB_FILL.body}/><path d="M12 34v-8h44v8" ${WB_FILL.body}/><path d="M14 26v-8h38v8" ${WB_FILL.body}/><path d="M14 18v-6h20v6" ${WB_FILL.body}/>
${wbWindows(12, 36.5, 8, 3, 3, 2.5)}${wbWindows(13, 28.5, 8, 3.2, 3, 2)}${wbWindows(15, 20.5, 7, 3.2, 3, 2)}
<path d="M43 18l2-8h8l-1 8" ${WB_FILL.body}/><rect x="45.5" y="10" width="7.5" height="2" ${WB_FILL.glass} stroke="none"/>
${SEA_MAST(20, 12, 5)}
${SEA_BOW(10, 49)}${WB_WAVES}</g>`, 'cruise cruiseschip passagiers');

wbIcon('barge', 'Duwbak / binnenvaart', 'sea', `<g ${WB_S}>
<path d="M3 42H61L59 52H8Q4 52 3 42Z" ${WB_FILL.body}/>
<path d="M8 42v-4h36v4" ${WB_FILL.body}/><path d="M14 38v4M20 38v4M26 38v4M32 38v4M38 38v4" stroke-width="1" stroke-opacity="0.6"/>
<path d="M52 42v-8" stroke-width="2.2"/>
<path d="M46 34v-7h12v7" ${WB_FILL.body}/>${wbWindows(47.5, 28.5, 2, 4, 3, 1.5)}
<path d="M55 27v-5" stroke-width="1.2"/><circle cx="55" cy="21" r="1.2" ${WB_FILL.solid} stroke="none"/>
<path d="M5 44v4" stroke-width="1.2"/>
${WB_WAVES}</g>`, 'duwbak binnenvaart binnenschip barge');

/* ---------- visserij ---------- */
wbIcon('fishing', 'Visserschip', 'sea', `<g ${WB_S}>
<path d="M4 36C14 38 30 40 58 40L56 54H10Q5 54 4 36Z" ${WB_FILL.body}/>
<path d="M40 40V30h12v10" ${WB_FILL.body}/>${wbWindows(42, 32, 2, 3.5, 3.5, 1.5)}
<path d="M22 40V12" stroke-width="1.5"/><path d="M19 18h6" stroke-width="1.2"/>
<path d="M22 30L36 20" stroke-width="1.4"/><path d="M22 12L6 36" stroke-width="0.9"/>
${SEA_MAST(46, 30, 23)}
<path d="M8 44h48" stroke-width="1" stroke-opacity="0.6"/>
${SEA_BOW(7, 48)}${WB_WAVES}</g>`, 'vissersboot kotter visserij vissersschip');
wbAlias('fishingd', 'fishing');

wbIcon('trawler', 'Trawler (boomkor)', 'sea', `<g ${WB_S}>
<path d="M4 36C14 38 34 40 60 40L58 54H12Q6 54 4 36Z" ${WB_FILL.body}/>
<path d="M12 40V30h18v10" ${WB_FILL.body}/>${wbWindows(14, 32, 3, 4, 4, 1.6)}
<path d="M26 30v-6" stroke-width="1.3"/>
<path d="M36 40V12" stroke-width="1.5"/><path d="M36 38L26 14M36 38l10-24" stroke-width="1.5"/>
<circle cx="26" cy="13" r="1.3" ${WB_FILL.solid} stroke="none"/><circle cx="46" cy="13" r="1.3" ${WB_FILL.solid} stroke="none"/>
<path d="M52 40v-7h5" stroke-width="1.3"/>
<path d="M8 44h50" stroke-width="1" stroke-opacity="0.6"/>
${SEA_BOW(7, 48)}${WB_WAVES}</g>`, 'trawler boomkor kotter visserij');

/* ---------- zeilen ---------- */
wbIcon('sail', 'Zeilboot', 'sea', `<g ${WB_S}>
<path d="M6 44H58L54 54H14Q8 54 6 44Z" ${WB_FILL.glass}/>
<path d="M30 44V8" stroke-width="1.5"/>
<path d="M31 10V40h20Z" ${WB_FILL.body}/><path d="M29 12L9 42h20Z" ${WB_FILL.body}/>
<path d="M30 41h22" stroke-width="1.3"/>
${WB_WAVES}</g>`, 'zeilboot zeiljacht sloep');

wbIcon('sailyacht', 'Zeiljacht (groot)', 'sea', `<g ${WB_S}>
<path d="M4 44H60L58 52H14Q7 52 4 44Z" ${WB_FILL.glass}/>
<path d="M26 44v-3h20l4 3" stroke-width="1.2"/>
<path d="M32 44V4" stroke-width="1.5"/>
<path d="M33 6V39h25Z" ${WB_FILL.body}/><path d="M31 8L6 43h25Z" ${WB_FILL.body}/>
<path d="M32 40h27" stroke-width="1.3"/><path d="M26 20h12" stroke-width="0.9"/><path d="M32 4L60 44" stroke-width="0.9"/>
${WB_WAVES}</g>`, 'zeiljacht zeilboot zeilschip');

/* ---------- sleep- en werkvaart, offshore-schepen ---------- */
wbIcon('tug', 'Sleepboot / supply', 'sea', `<g ${WB_S}>
<path d="M6 34C16 38 36 40 58 40L56 54H12Q6 54 6 34Z" ${WB_FILL.body}/>
<path d="M7 36Q6 44 8 50" stroke-width="2.6" stroke-opacity="0.55"/>
<path d="M22 40V30h18v10" ${WB_FILL.body}/><path d="M26 30v-8h10v8" ${WB_FILL.body}/>${wbWindows(27.5, 24, 2, 3, 3.5, 1.5)}
${SEA_FUNNEL(41, 40, 5, 10)}${SEA_MAST(31, 22, 13)}
<path d="M50 40v-3h4v3M54 38h6" stroke-width="1.3"/>
<circle cx="18" cy="44" r="1.8" ${WB_FILL.solid} stroke="none"/><circle cx="48" cy="45" r="1.8" ${WB_FILL.solid} stroke="none"/>
${SEA_BOW(8, 49)}${WB_WAVES}</g>`, 'sleepboot supply vessel offshore tug');

wbIcon('psv', 'Bevoorradingsschip (PSV)', 'sea', `<g ${WB_S}>
${SEA_HULL(4, 60, 40, 7, true)}
<path d="M8 40V26h18v14" ${WB_FILL.body}/><path d="M10 26v-7h14v7" ${WB_FILL.body}/>
${wbWindows(11.5, 21, 3, 3.2, 3.2, 1.4)}${wbWindows(11, 29, 3, 3, 3, 1.5)}
${SEA_MAST(17, 19, 9)}<path d="M26 26v-4" stroke-width="1.3"/>
<rect x="30" y="35" width="8" height="5" ${WB_FILL.body} stroke-width="1.1"/><rect x="40" y="35" width="8" height="5" ${WB_FILL.glass} stroke-width="1.1"/>
<path d="M50 40v-3h6v3" stroke-width="1.2"/>
${SEA_BOW(9, 49)}${WB_WAVES}</g>`, 'psv platform supply vessel bevoorrading offshore supply');

wbIcon('sov', 'Service operation vessel (SOV)', 'sea', `<g ${WB_S}>
${SEA_HULL(4, 60, 40, 7, true)}
<path d="M10 40V20h28v20" ${WB_FILL.body}/><path d="M12 20v-7h22v7" ${WB_FILL.body}/>
${wbWindows(13.5, 15.5, 4, 3.5, 3, 1.5)}${wbWindows(12, 24, 5, 3, 3, 2)}${wbWindows(12, 30, 5, 3, 3, 2)}
<path d="M4 12h26" stroke-width="2"/><path d="M5 12l6 8" stroke-width="1.2"/>
${SEA_MAST(32, 13, 5)}
<path d="M44 40V24" stroke-width="1.6"/><path d="M44 26L60 17" stroke-width="2"/><circle cx="44" cy="26" r="1.6" ${WB_FILL.solid} stroke="none"/>
<path d="M50 40v-4h6v4" stroke-width="1.1"/>
${SEA_BOW(9, 49)}${WB_WAVES}</g>`, 'sov service operation vessel windpark gangway');

wbIcon('ctv', 'Crew transfer vessel (CTV)', 'sea', `<g ${WB_S}>
<path d="M4 44Q4 38 10 38H58L56 52H12Q5 52 4 44Z" ${WB_FILL.body}/>
<path d="M5 36Q2 42 5 48" stroke-width="3" stroke-opacity="0.6"/>
<path d="M18 38V28h26l4 10" ${WB_FILL.body}/>${wbWindows(21, 30, 4, 4, 4, 1.5)}
${SEA_MAST(32, 28, 18)}
<path d="M10 38v-3h8" stroke-width="1"/><path d="M50 38v-3h6" stroke-width="1"/>
<path d="M12 46h44" stroke-width="1" stroke-opacity="0.6"/>
${WB_WAVES}</g>`, 'ctv crew transfer vessel catamaran windpark');

wbIcon('windcat', 'Windcat (CTV catamaran)', 'sea', `<g ${WB_S}>
<path d="M4 44Q4 38 10 38H58L56 52H12Q5 52 4 44Z" ${WB_FILL.body}/>
<path d="M5 35Q1 42 5 49" stroke-width="3.2" stroke-opacity="0.6"/><rect x="3.5" y="37" width="3" height="8" rx="1" ${WB_FILL.glass} stroke="none"/>
<path d="M12 38V30l3-4h20l3 12" ${WB_FILL.body}/><path d="M13 30.5l2.5-3.5h2v3.5Z" ${WB_FILL.glass} stroke="none"/>${wbWindows(18.5, 28, 3, 4.2, 4.2, 1.4)}
${SEA_MAST(25, 26, 16)}
<path d="M40 38v-4h16" stroke-width="1"/><rect x="44" y="33" width="8" height="5" ${WB_FILL.glass} stroke-width="1"/>
<path d="M12 46h44" stroke-width="1" stroke-opacity="0.6"/>
${WB_WAVES}</g>`, 'windcat ctv crew transfer vessel catamaran windpark');

wbIcon('drillship', 'Boorschip', 'sea', `<g ${WB_S}>
${SEA_HULL(4, 60, 40, 6, true)}
<path d="M8 40V26h14v14" ${WB_FILL.body}/>${wbWindows(10, 28.5, 2, 4, 3.5, 1.5)}
<path d="M4 24h20" stroke-width="2"/><path d="M8 24v16" stroke-width="1.2"/>
<path d="M26 40L29 8h6l3 32" ${WB_FILL.body}/><path d="M27.5 32h9M28 24h8M28.5 16h7" stroke-width="1"/><path d="M32 8v-4" stroke-width="1.3"/>
${SEA_CRANE(48, 40, 26, 57, 34)}
<path d="M42 40v-6h4v6" stroke-width="1.2"/>
${SEA_BOW(8, 49)}${WB_WAVES}</g>`, 'boorschip drillship boortoren');

wbIcon('dredger', 'Baggerschip', 'sea', `<g ${WB_S}>
${SEA_HULL(4, 60, 40, 6, true)}
<path d="M8 40V24h16v16" ${WB_FILL.body}/>${wbWindows(10, 26.5, 3, 3.5, 3.5, 1.4)}${wbWindows(10, 33, 3, 3.5, 3, 1.4)}
${SEA_MAST(16, 24, 14)}
<path d="M26 40v-5h20v5" ${WB_FILL.glass} stroke-width="1.2"/>
<path d="M34 40V26h3" stroke-width="1.4"/><path d="M35 28L57 49" stroke-width="2.2"/><ellipse cx="57.5" cy="49.5" rx="3" ry="1.8" ${WB_FILL.solid} stroke="none"/>
${SEA_FUNNEL(50, 40, 4, 7)}
${SEA_BOW(8, 49)}${WB_WAVES}</g>`, 'baggerschip sleephopperzuiger dredger');

/* ---------- marine ---------- */
wbIcon('frigate', 'Fregat / marineschip', 'sea', `<g ${WB_S}>
<path d="M4 36C14 38 36 40 60 40L58 54H14Q7 54 4 36Z" ${WB_FILL.body}/>
<path d="M12 38v-4h7v4" ${WB_FILL.body} stroke-width="1.2"/><path d="M12 35.5l-7-1.5" stroke-width="1.4"/>
<path d="M22 40V30h20v10" ${WB_FILL.body}/><path d="M24 30v-8h12v8" ${WB_FILL.body}/>${wbWindows(25.5, 24, 3, 2.8, 3, 1.2)}
<path d="M38 30L40 8l2 22" ${WB_FILL.body} stroke-width="1.3"/><path d="M35 14h10" stroke-width="1.2"/><path d="M37 11h6" stroke-width="1.6"/><circle cx="40" cy="7" r="1.2" ${WB_FILL.solid} stroke="none"/>
<path d="M44 40V31h10v9" ${WB_FILL.body}/><circle cx="49" cy="29" r="2" ${WB_FILL.glass} stroke-width="1"/>
<path d="M54 40h5" stroke-width="1"/>
${SEA_BOW(7, 48)}${WB_WAVES}</g>`, 'fregat marine militair oorlogsschip');

wbIcon('submarine', 'Onderzeeboot', 'sea', `<g ${WB_S}>
<path d="M4 45C4 38 12 35 24 35H44C52 35 58 38 60 44C58 50 50 55 40 55H22C12 55 4 52 4 45Z" ${WB_FILL.body}/>
<path d="M25 35V21h10q2 0 2 2v12" ${WB_FILL.glass}/>
<path d="M28 21v-8M32 21v-6" stroke-width="1.4"/><path d="M26.5 13h3" stroke-width="1.3"/>
<path d="M20 27h5" stroke-width="1.6"/>
<path d="M53 36l1-6h4l1 6" stroke-width="1.3"/>
<ellipse cx="61" cy="45" rx="1.3" ry="4" ${WB_FILL.solid} stroke="none"/>
<path d="M8 45h4" stroke-width="1"/>
${WB_WAVES}</g>`, 'onderzeeboot onderzeeer submarine');

/* ---------- luchtkussenvaartuig, boei, lichtschip ---------- */
wbIcon('hovercraft', 'Hovercraft', 'sea', `<g ${WB_S}>
<path d="M5 42H59Q62 42 60 48Q58 55 50 55H14Q6 55 4 48Q2 42 5 42Z" ${WB_FILL.glass}/>
<path d="M11 42v13M18 42v13M25 42v13M32 42v13M39 42v13M46 42v13M53 42v13" stroke-width="0.9" stroke-opacity="0.5"/>
<path d="M6 42v-6h53v6" ${WB_FILL.body}/>
<path d="M10 36V26l4-4h20v14" ${WB_FILL.body}/>${wbWindows(13, 24.5, 4, 4, 4, 1.5)}
<circle cx="49" cy="27" r="8.5" ${WB_FILL.body}/>${wbBlades(3, 49, 27, 6.5, 2.2)}
<path d="M58.5 22v14" stroke-width="1.4"/>
${WB_WAVES}</g>`, 'hovercraft luchtkussenvaartuig');

wbIcon('buoy', 'Boei', 'sea', `<g ${WB_S}>
<path d="M20 44l4-8h16l4 8-2 10H22Z" ${WB_FILL.body}/>
<path d="M18 44h28" stroke-width="1.3"/>
<path d="M27 36V18h10v18" ${WB_FILL.body} stroke-width="1.3"/><path d="M27 18l10 18M37 18L27 36M27 27h10" stroke-width="0.9" stroke-opacity="0.7"/>
<rect x="29" y="11" width="6" height="7" rx="1" ${WB_FILL.glass}/><path d="M32 11V7" stroke-width="1.3"/><circle cx="32" cy="6" r="1.5" ${WB_FILL.solid} stroke="none"/>
${WB_WAVES}</g>`, 'boei betonning markering ton');

wbIcon('lightship', 'Lichtschip', 'sea', `<g ${WB_S}>
<path d="M4 38C12 40 30 42 60 42L58 54H12Q5 54 4 38Z" ${WB_FILL.body}/>
<path d="M20 42v-8h24v8" ${WB_FILL.body}/>${wbWindows(22, 36, 4, 3.5, 3, 1.6)}
<path d="M32 34V16" stroke-width="1.6"/><path d="M32 16L20 34M32 16l12 18" stroke-width="0.9" stroke-opacity="0.7"/>
<path d="M25 16h14" stroke-width="1.3"/><rect x="27" y="8" width="10" height="8" rx="1.5" ${WB_FILL.glass}/><path d="M32 8V5" stroke-width="1.3"/>
<path d="M50 42v-10" stroke-width="1.3"/>
<path d="M8 46h50" stroke-width="1" stroke-opacity="0.6"/>
${WB_WAVES}</g>`, 'lichtschip baken vuurschip');
