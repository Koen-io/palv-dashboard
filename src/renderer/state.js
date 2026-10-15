'use strict';

/* ============================================================
   Toestand van het dashboard: de indeling, opslaan, en de eigen eenheden.
   ============================================================ */

let state = null;
let editing = false;
let winState = { maximized: false, fullscreen: false };
const pageEls = new Map(); // page id -> element
const instances = new Map(); // widget id -> { el, destroy }

let saveTimer = null;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => { saveTimer = null; window.palv.config.save(state); }, 350);
}
// Pending changes go to disk at once (closing, nightly reload, before an update).
function flushSave() {
  if (!saveTimer) return;
  clearTimeout(saveTimer);
  saveTimer = null;
  window.palv.config.saveSync(state);
}
// A whole new configuration (import, reset, backup): the current one is kept as a backup first,
// then the new one is written as it is and the dashboard starts over on it.
async function replaceConfig(cfg, reason) {
  clearTimeout(saveTimer);
  saveTimer = null;
  await window.palv.config.backup(reason || 'import');
  await window.palv.config.save(cfg);
  location.reload();
}

/* ---------- own units ---------- */
// Registration and type of the standard units, for the unit lists; units heard on the air add their own.
const UNIT_INFO = {
  '484a91': ['PH-PXA', 'EC135'], '484a92': ['PH-PXB', 'EC135'], '484a93': ['PH-PXC', 'EC135'], '484a94': ['PH-PXD', 'EC135'],
  '484a95': ['PH-PXE', 'EC135'], '484a96': ['PH-PXF', 'EC135'], '484ac0': ['PH-PXZ', 'AW139'], '484ac1': ['PH-PXY', 'AW139'], '485b2f': ['PH-PXX', 'AW139'],
  '4844c2': ['PH-MAA', 'EC135'], '484b58': ['PH-HVB', 'EC135'], '4853e2': ['PH-OOP', 'H145'], '4853f6': ['PH-HOW', 'H145'], '4857b3': ['PH-TTR', 'EC135'],
  '485e49': ['PH-DOC', 'EC135'], '48605b': ['PH-LLN', 'EC135'], '48605c': ['PH-UMC', 'EC135'],
  '485694': ['PH-CGA', 'Dash 8'], '4856f3': ['PH-CGB', 'Dash 8'], '486449': ['PH-SAR', 'AW189'], '48644b': ['PH-NCG', 'AW189'],
};
const UNIT_NAMES = (hex) => {
  const learned = state && state.settings.unitInfo && state.settings.unitInfo[hex];
  if (learned) return learned;
  const k = UNIT_INFO[hex];
  return k ? { reg: k[0], type: k[1] } : null;
};
const FLEET_GROUPS = { police: 'Politie', hems: 'Trauma', coastguard: 'Kustwacht' };
const hexList = (...keys) =>
  keys.flatMap((k) => String(state.settings.hex[k] || '').split(/[^0-9a-fA-F]+/)).filter((x) => /^[0-9a-fA-F]{6}$/.test(x)).map((x) => x.toLowerCase());
