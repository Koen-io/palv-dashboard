'use strict';

/* ============================================================
   Whiteboard — iconen, COA: de symbolen waarmee een COA wordt uitgetekend (assault helo en sniper helo,
   met fastrope en sniper aan de linker-, rechter- of beide kanten), en het tactische schip van de COA
   Planner: de lege romp met bakboord rood en stuurboord groen en de peilingen 45, 90 en 139 graden.
   De symbolen zijn als vector nagetekend, dus scherp op elke grootte, in de kleur van de pen en te draaien.
   ============================================================ */
// The symbol in a 64 x 64 box, standing up: the head (circle: assault helo, triangle: sniper helo) at the
// top, the stem below it with a short foot to the left. A fastrope is an arch beside the head that drops
// down; a sniper a thin chevron beside the head, pointing at it. Left (LH) is the mirror of right (RH).
const COA_SYM_LINE = 'fill="none" stroke="currentColor" stroke-linecap="square" stroke-linejoin="miter"';
const COA_SYM = {
  // The head, the stem and the foot.
  assault: `<circle cx="32" cy="17" r="8.6" stroke-width="2.9"/><path d="M32 25.6V51.5H25.5" stroke-width="2.9"/>`,
  sniper: `<path d="M32 6.5 41.6 25H22.4Z" stroke-width="2.8"/><path d="M32 25V51.5H25.5" stroke-width="2.9"/>`,
  // The fastrope arch on the right of the head (mirrored for the left), for each head.
  ropeAssault: '<path d="M40.2 14.6c.6-4.3 2.9-6.8 5.2-6.8s4.6 2.7 4.6 7.1V38.5" stroke-width="2.5"/>',
  ropeSniper: '<path d="M37.4 16c.7-4.3 2.9-6.8 5.2-6.8s4.6 2.7 4.6 7.1V38.5" stroke-width="2.5"/>',
  // The sniper chevron on the left of the head, its point towards the head (mirrored for the right).
  chevAssault: '<path d="M13.6 11 20.2 17 13.6 23" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round"/>',
  chevSniper: '<path d="M16.4 12.6 22.8 18.4 16.4 24.2" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round"/>',
};
const coaSymMirror = (s) => `<g transform="matrix(-1 0 0 1 64 0)">${s}</g>`;
// One symbol: head 'assault' or 'sniper', fastrope 'L', 'R' or 'LR', sniper 'L', 'R' or 'LR'.
function coaSymSvg(head, rope = '', snipe = '') {
  const a = head === 'assault';
  const R = a ? COA_SYM.ropeAssault : COA_SYM.ropeSniper, C = a ? COA_SYM.chevAssault : COA_SYM.chevSniper;
  let s = COA_SYM[head];
  if (rope.includes('R')) s += R;
  if (rope.includes('L')) s += coaSymMirror(R);
  if (snipe.includes('L')) s += C;
  if (snipe.includes('R')) s += coaSymMirror(C);
  return `<g ${COA_SYM_LINE}>${s}</g>`;
}
// The set, in the order of the COA form symbology (TACSOP AW139 4.6.4.1).
const COA_SYMBOLS = [
  ['coa_ah', 'assault', '', '', 'Assault helo'],
  ['coa_ah_rf', 'assault', 'R', '', 'Assault helo · RH fastrope'],
  ['coa_ah_lf', 'assault', 'L', '', 'Assault helo · LH fastrope'],
  ['coa_ah_df', 'assault', 'LR', '', 'Assault helo · dual fastrope'],
  ['coa_ah_rf_ls', 'assault', 'R', 'L', 'Assault helo · RH fastrope, LH sniper'],
  ['coa_ah_lf_rs', 'assault', 'L', 'R', 'Assault helo · LH fastrope, RH sniper'],
  ['coa_ah_ds', 'assault', '', 'LR', 'Assault helo · dual sniper'],
  ['coa_sh', 'sniper', '', '', 'Sniper helo'],
  ['coa_sh_ls', 'sniper', '', 'L', 'Sniper helo · LH sniper'],
  ['coa_sh_rs', 'sniper', '', 'R', 'Sniper helo · RH sniper'],
  ['coa_sh_ds', 'sniper', '', 'LR', 'Sniper helo · dual sniper'],
  ['coa_sh_ls_rf', 'sniper', 'R', 'L', 'Sniper helo · LH sniper, RH fastrope'],
  ['coa_sh_df', 'sniper', 'LR', '', 'Sniper helo · dual fastrope'],
  ['coa_sh_rs_lf', 'sniper', 'L', 'R', 'Sniper helo · RH sniper, LH fastrope'],
];
for (const [id, head, rope, snipe, name] of COA_SYMBOLS) {
  const kw = ['coa symbool tacsop helo helikopter', head === 'assault' ? 'assault aanval trooping' : 'sniper scherpschutter overwatch',
    rope ? `fastrope fast rope ${rope === 'LR' ? 'dual beide' : rope === 'L' ? 'lh links' : 'rh rechts'}` : '',
    snipe && head === 'assault' ? `sniper ${snipe === 'LR' ? 'dual beide' : snipe === 'L' ? 'lh links' : 'rh rechts'}` : snipe ? `${snipe === 'LR' ? 'dual beide' : snipe === 'L' ? 'lh links' : 'rh rechts'}` : ''].join(' ');
  wbIcon(id, name, 'coa', coaSymSvg(head, rope, snipe), kw);
}

/* ---------- het tactische schip van de COA Planner ---------- */
// The empty hull of the COA board (bow up, red port half, green starboard half), with the dashed heading
// ahead of the bow and the rays 45, 90 and 139 degrees from the bow on both sides, each with its figure.
// Own colours; placed large by default, so the helicopters and arrows go on top of it.
{
  const P = '#d0262a', S = '#1f8f3e', INK = '#0b121c';
  const at = (r, a) => [32 + r * Math.sin((a * Math.PI) / 180), 32 - r * Math.cos((a * Math.PI) / 180)].map((v) => +v.toFixed(2));
  let rays = '', figs = '';
  for (const rel of [45, 90, 139]) for (const side of [1, -1]) {
    const a = side * rel, c = side > 0 ? S : P;
    const [x0, y0] = at(13.5, a), [x1, y1] = at(27.5, a), [lx, ly] = at(23.2, a + side * 13);
    rays += `<path d="M${x0} ${y0}L${x1} ${y1}" stroke="${c}" stroke-width="0.9"/>`;
    figs += `<text x="${lx}" y="${(ly + 1.3).toFixed(2)}" fill="${c}">${rel}°</text>`;
  }
  const hull = 'M0 -50C6.5 -45 13 -32 13 -14L13 45Q13 49 9.5 49L-9.5 49Q-13 49 -13 45L-13 -14C-13 -32 -6.5 -45 0 -50Z';
  const halfS = 'M0 -50C6.5 -45 13 -32 13 -14L13 45Q13 49 9.5 49L0 49Z', halfP = 'M0 -50C-6.5 -45 -13 -32 -13 -14L-13 45Q-13 49 -9.5 49L0 49Z';
  wbIcon('coaship', 'Schip tactisch (COA, bakboord rood / stuurboord groen, 45-90-139°)', 'coa', `<g stroke-linecap="round" stroke-linejoin="round">
<circle cx="32" cy="32" r="28" fill="none" stroke="#8ea2bf" stroke-width="0.6" stroke-opacity="0.8"/>
${rays}<path d="M32 13V3.6" stroke="${INK}" stroke-width="0.9" stroke-dasharray="1.8 1.3"/>
<g transform="translate(32 32) scale(0.36)"><path d="${halfP}" fill="${P}"/><path d="${halfS}" fill="${S}"/><path d="${hull}" fill="none" stroke="${INK}" stroke-width="2.4"/></g>
<g font-family="Bahnschrift,Segoe UI,Arial,sans-serif" font-weight="800" font-size="3.6" text-anchor="middle" stroke="#ffffff" stroke-width="0.7" paint-order="stroke">${figs}<text x="32" y="2.9" fill="${INK}" font-size="3">0°</text></g>
</g>`, 'schip tactisch coa bakboord stuurboord port starboard rood groen peiling 45 90 139 boeg ondergrond', { size: 360, own: true });
}
