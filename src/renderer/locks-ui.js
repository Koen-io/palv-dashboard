'use strict';

/* ============================================================
   Vergrendelen van een whiteboard of een missieplan: het slot-venster (pincode aanmaken met een
   geheugensteuntje, pincode invoeren op een ander scherm, hier verbergen, slot opheffen) en de
   vergrendelde weergave. De cryptografie zit in het hoofdproces (src/plan/locks.js); hier alleen de
   bediening. Een pincode gaat één keer over de IPC naar het hoofdproces en wordt nergens bewaard.
   ============================================================ */
const LOCK_WORDS = { boards: { thing: 'bord', Thing: 'Bord' }, missions: { thing: 'missie', Thing: 'Missie' } };

// The lock button for a toolbar: closed and amber when locked, open when not.
function lockButton(getItem, onClick) {
  const btn = h('button', { class: 'btn zp-btn lock-btn', onclick: onClick }, icon('unlock'), 'Slot');
  btn.paint = () => {
    const it = getItem();
    const locked = !!(it && it.lock);
    btn.classList.toggle('locked', locked);
    btn.classList.toggle('closed', locked && !it.lockOpen);
    btn.disabled = !it;
    btn.replaceChildren(icon(locked ? 'lock' : 'unlock'), locked ? (it.lockOpen ? 'Vergrendeld' : 'Vergrendeld · pincode') : 'Slot');
    btn.title = !it ? '' : locked ? (it.lockOpen ? 'Vergrendeld: alleen zichtbaar op dit scherm en op schermen waar de pincode is ingevoerd. Tik voor het slotmenu.' : 'Vergrendeld op een ander scherm: voer de pincode in om de inhoud hier te zien.') : 'Vergrendelen: de inhoud is dan alleen op dit scherm zichtbaar, tot de pincode op een ander scherm wordt ingevoerd.';
  };
  btn.paint();
  return btn;
}

const pinInput = (placeholder) => h('input', { class: 'input lock-pin', type: 'password', inputmode: 'numeric', autocomplete: 'off', maxlength: 12, pattern: '[0-9]*', placeholder: placeholder || '6 tot 12 cijfers' });
const pinOk = (v) => /^\d{6,12}$/.test(v);

// The lock menu for a board or mission. `kind` 'boards' | 'missions', `item` the board or mission (with
// `lock` and `lockOpen` as the store shows them), `onChange` runs after a change.
function lockDialog(kind, item, onChange) {
  const W = LOCK_WORDS[kind];
  const name = item.name || W.Thing;
  const done = (msg) => { if (msg) toast(msg); if (onChange) onChange(); };
  const fail = (r, fallback) => toast((r && r.error) || fallback, true);

  if (!item.lock) {
    // Not locked: make a lock.
    const pin = pinInput(), pin2 = pinInput('Nog een keer');
    const hint = textInput('', { maxlength: 120, placeholder: 'bv. "postcode van de basis" (geheugensteuntje, voor iedereen leesbaar)' });
    const ok = async (close) => {
      if (!pinOk(pin.value)) { toast('De pincode bestaat uit 6 tot 12 cijfers', true); pin.focus(); return false; }
      if (pin.value !== pin2.value) { toast('De twee pincodes zijn niet gelijk', true); pin2.focus(); return false; }
      const r = await window.palv.lock.create(kind, item.id, pin.value, hint.value.trim());
      pin.value = ''; pin2.value = '';
      if (!r || !r.ok) { fail(r, 'Vergrendelen mislukt'); return false; }
      done(`${W.Thing} vergrendeld: alleen hier zichtbaar`);
      if (close) close();
      return true;
    };
    const close = openModal({
      title: `${W.Thing} vergrendelen`, cls: 'lock-modal',
      body: [
        h('div', { class: 'lock-head' }, icon('lock'), h('div', {}, h('b', {}, name), h('small', {}, `Na het vergrendelen is de inhoud van ${W.thing === 'bord' ? 'dit bord' : 'deze missie'} alleen op dit scherm te zien. Op de andere schermen van de eenheid staat alleen de naam, met een slot en het geheugensteuntje; wie daar de pincode invoert ziet de inhoud ook.`))),
        h('div', { class: 'row' }, field('Pincode', pin), field('Herhaal de pincode', pin2)),
        field('Geheugensteuntje', hint, 'Staat bij het slot op elk scherm; zet er dus niet de pincode zelf in.'),
        h('p', { class: 'lock-note' }, 'De inhoud wordt versleuteld opgeslagen en uitgewisseld (AES-256, sleutel uit de pincode). Zonder de pincode is er geen weg terug: schrijf hem ergens veilig op. Bewerken van een vergrendeld ' + W.thing + ' kan alleen op een scherm dat de pincode kent.'),
      ],
      actions: [{ label: 'Annuleren' }, { label: 'Vergrendelen', primary: true, keepOpen: true, onClick: (c) => { ok(c); return false; } }],
    });
    pin2.addEventListener('keydown', (e) => { if (e.key === 'Enter') ok(close); });
    pin.focus();
    return;
  }

  if (item.lockOpen) {
    // Locked and readable here: hide here, or take the lock off (with the PIN).
    const pin = pinInput('Pincode om het slot op te heffen');
    const when = item.lock.createdAt ? new Date(item.lock.createdAt).toLocaleString('nl-NL', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '';
    const close = openModal({
      title: `${W.Thing} is vergrendeld`, cls: 'lock-modal',
      body: [
        h('div', { class: 'lock-head on' }, icon('lock'), h('div', {}, h('b', {}, name), h('small', {}, `Vergrendeld${item.lock.by ? ' op ' + item.lock.by : ''}${when ? ' · ' + when : ''}. Zichtbaar op dit scherm; op een ander scherm alleen na de pincode.`))),
        item.lock.hint ? h('div', { class: 'lock-hint' }, h('small', {}, 'GEHEUGENSTEUNTJE'), h('b', {}, item.lock.hint)) : null,
        h('hr'),
        h('div', { class: 'row' }, h('div', { class: 'field' }, h('label', {}, 'Op dit scherm verbergen'), h('button', { class: 'btn', onclick: async () => { const r = await window.palv.lock.hide(kind, item.id); if (!r || !r.ok) return fail(r, 'Verbergen mislukt'); close(); done(`${W.Thing} hier verborgen; de pincode maakt het weer zichtbaar`); } }, icon('unlock'), 'Verbergen'), h('div', { class: 'hint' }, 'Het slot blijft; dit scherm vergeet alleen de sleutel.'))),
        h('hr'),
        field('Slot opheffen', pin, 'Met de pincode gaat de inhoud weer open voor alle schermen van de eenheid.'),
      ],
      actions: [{ label: 'Sluiten' }, { label: 'Slot opheffen', danger: true, keepOpen: true, onClick: async () => {
        if (!pinOk(pin.value)) { toast('Vul de pincode in (6 tot 12 cijfers)', true); pin.focus(); return false; }
        const r = await window.palv.lock.remove(kind, item.id, pin.value);
        pin.value = '';
        if (!r || !r.ok) { fail(r, 'Slot opheffen mislukt'); return false; }
        close(); done(`Slot opgeheven: ${W.thing} weer op alle schermen zichtbaar`);
        return false;
      } }],
    });
    return;
  }

  // Locked elsewhere: the PIN makes it readable here.
  lockOpenDialog(kind, item, onChange);
}

// Just the PIN, for a locked board or mission from another screen; also used by the locked overlay.
function lockOpenDialog(kind, item, onChange) {
  const W = LOCK_WORDS[kind];
  const pin = pinInput();
  const ok = async (close) => {
    if (!pinOk(pin.value)) { toast('De pincode bestaat uit 6 tot 12 cijfers', true); pin.focus(); return false; }
    const r = await window.palv.lock.open(kind, item.id, pin.value);
    pin.value = '';
    if (!r || !r.ok) { toast((r && r.error) || 'Dat lukte niet', true); return false; }
    if (!r.open) { toast('Verkeerde pincode', true); pin.focus(); return false; }
    toast(`${W.Thing} zichtbaar op dit scherm`);
    if (close) close();
    if (onChange) onChange();
    return true;
  };
  const close = openModal({
    title: `${W.Thing} is vergrendeld`, cls: 'lock-modal',
    body: [
      h('div', { class: 'lock-head on' }, icon('lock'), h('div', {}, h('b', {}, item.name || W.Thing), h('small', {}, `Vergrendeld${item.lock && item.lock.by ? ' op ' + item.lock.by : ''}. De inhoud is hier pas te zien na de pincode; daarna blijft ${W.thing === 'bord' ? 'het bord' : 'de missie'} op dit scherm zichtbaar.`))),
      item.lock && item.lock.hint ? h('div', { class: 'lock-hint' }, h('small', {}, 'GEHEUGENSTEUNTJE'), h('b', {}, item.lock.hint)) : null,
      field('Pincode', pin),
    ],
    actions: [{ label: 'Annuleren' }, { label: 'Zichtbaar maken', primary: true, keepOpen: true, onClick: (c) => { ok(c); return false; } }],
  });
  pin.addEventListener('keydown', (e) => { if (e.key === 'Enter') ok(close); });
  pin.focus();
}

// The cover over a locked board or mission on a screen without the key.
function lockedCover(kind, item, onChange) {
  const W = LOCK_WORDS[kind];
  return h('div', { class: 'lock-cover' },
    h('div', { class: 'lock-cover-box' },
      icon('lock'),
      h('b', {}, item.name || W.Thing),
      h('span', {}, `Dit ${W.thing} is vergrendeld${item.lock && item.lock.by ? ' op ' + item.lock.by : ''}. De inhoud staat versleuteld op dit scherm en is pas te zien na de pincode.`),
      item.lock && item.lock.hint ? h('div', { class: 'lock-hint' }, h('small', {}, 'GEHEUGENSTEUNTJE'), h('b', {}, item.lock.hint)) : null,
      h('button', { class: 'btn primary', onclick: () => lockOpenDialog(kind, item, onChange) }, icon('unlock'), 'Pincode invoeren')));
}
