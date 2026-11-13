'use strict';

/* ============================================================
   E-mail vanaf het dashboard (1.51): de verzend-pop-up en de bevestiging
   Elk tabblad dat iets kan mailen roept openMailDialog() aan met wat het verstuurt; het bericht zelf
   (huisstijl, handtekening, disclaimer) maakt src/main/mail-template.js, het versturen src/main/mail.js,
   altijd vanaf het ene afzenderadres van de eenheid (gekoppeld met scripts/mail-wachtwoord.js).
   ============================================================ */

// The formats the dashboard can attach, and per kind of content which of them make sense. Only those are
// offered in the dialog: a choice that does not fit the content (a kneeboard card as a Word file, a route
// as a picture only) is never shown. `ready: false`: decided, but the tab does not send it yet.
const MAIL_FORMATS = {
  pdf: { label: 'PDF', icon: 'file', desc: 'Om af te drukken of te bewaren; opent overal hetzelfde' },
  png: { label: 'Afbeelding (PNG)', icon: 'image', desc: 'Direct te bekijken op een telefoon of tablet, zonder bijlage te openen' },
  docx: { label: 'Word (DOCX)', icon: 'note', desc: 'Om verder te bewerken' },
  gpx: { label: 'GPX', icon: 'route', desc: 'Route voor een GPS of tablet (ForeFlight, SkyDemon, Garmin)' },
  kml: { label: 'KML', icon: 'globe', desc: 'Route of gebied voor Google Earth' },
  csv: { label: 'CSV', icon: 'layout', desc: 'Lijst voor Excel' },
};
const MAIL_KINDS = {
  // The COA Planner: one graphic kneeboard card (A5 portrait) with the four COAs, nothing to edit. PDF for
  // print and the archive, PNG to look at on a phone; the summary of every COA is in the mail itself.
  // Word: no (a drawing with tables, nothing to write in). Data formats: no (there is no route).
  coa: { label: 'COA Planner', formats: ['pdf', 'png'], preset: ['pdf'] },
  // Planned for later; the tabs still send nothing.
  route: { label: 'Zoek & Plan', formats: ['pdf', 'gpx', 'kml', 'png'], preset: ['pdf', 'gpx'], ready: false },
  mission: { label: 'Mission Planning', formats: ['pdf', 'docx'], preset: ['pdf'], ready: false },
  whiteboard: { label: 'Whiteboard', formats: ['png', 'pdf'], preset: ['png'], ready: false },
  timings: { label: 'Timings', formats: ['pdf', 'csv'], preset: ['pdf'], ready: false },
};

const MAIL_RE = /^[^\s@<>()[\]\\,;:"]+@[^\s@<>()[\]\\,;:"]+\.[^\s@<>()[\]\\,;:"]{2,}$/;
const mailBy = { get() { try { return localStorage.getItem('palv-mail-by') || ''; } catch { return ''; } }, set(v) { try { localStorage.setItem('palv-mail-by', v); } catch { /* private */ } } };

// A field of addresses as chips: typed and closed with Enter, comma, semicolon or space; pasted lists too.
function mailChips({ placeholder, onChange }) {
  const list = [];
  const box = h('div', { class: 'ml-chips' });
  const inp = h('input', { class: 'ml-chip-in', type: 'email', placeholder, autocomplete: 'off', spellcheck: 'false', inputmode: 'email' });
  const paint = () => {
    box.replaceChildren(...list.map((a, i) => h('span', { class: 'ml-chip' + (MAIL_RE.test(a) ? '' : ' bad'), title: MAIL_RE.test(a) ? a : 'Geen geldig e-mailadres' },
      h('span', {}, a), h('button', { type: 'button', title: 'Weghalen', onclick: (e) => { e.stopPropagation(); list.splice(i, 1); paint(); onChange(); } }, icon('close')))), inp);
  };
  const add = (text) => {
    let n = 0;
    for (const p of String(text).split(/[\s,;]+/)) {
      const a = p.trim().replace(/^<|>$/g, '').toLowerCase();
      if (a && !list.includes(a)) { list.push(a); n++; }
    }
    if (n) { paint(); onChange(); }
    return n;
  };
  inp.addEventListener('keydown', (e) => {
    if (['Enter', ',', ';', ' ', 'Tab'].includes(e.key) && inp.value.trim()) { if (e.key !== 'Tab') e.preventDefault(); add(inp.value); inp.value = ''; }
    else if (e.key === 'Backspace' && !inp.value && list.length) { list.pop(); paint(); onChange(); }
  });
  inp.addEventListener('blur', () => { if (inp.value.trim()) { add(inp.value); inp.value = ''; } });
  inp.addEventListener('paste', (e) => { const t = e.clipboardData.getData('text'); if (/[\s,;]/.test(t.trim())) { e.preventDefault(); add(t); } });
  box.addEventListener('mousedown', (e) => { if (e.target === box) { e.preventDefault(); inp.focus(); } });
  paint();
  return { el: box, input: inp, list, add, pending: () => inp.value.trim() };
}

// opts: { kind, subject, content (for mail-template: module, kicker, title, subtitle, sections, table, lines,
// warnings), files: { pdf: () => ({ html, pageSize, landscape, name }), png: () => ({ html, width, name }) } }
async function openMailDialog(opts) {
  const kind = MAIL_KINDS[opts.kind];
  if (!kind) throw new Error('onbekende soort');
  const st = await window.palv.mail.status().catch(() => ({}));
  const formats = kind.formats.filter((f) => opts.files && opts.files[f]);
  const chosen = new Set(kind.preset.filter((f) => formats.includes(f)));

  /* ---------- the form ---------- */
  const errEl = h('div', { class: 'ml-err', hidden: true });
  const to = mailChips({ placeholder: 'naam@politie.nl', onChange: () => { paintRecent(); check(); } });
  const cc = mailChips({ placeholder: 'Kopie aan (optioneel)', onChange: () => check() });
  const ccField = h('div', { class: 'field', hidden: true }, h('label', {}, 'CC'), cc.el);
  const ccBtn = h('button', { type: 'button', class: 'ml-link', onclick: () => { ccField.hidden = false; ccBtn.hidden = true; cc.input.focus(); } }, '+ CC');
  const recentEl = h('div', { class: 'ml-recent' });
  function paintRecent() {
    const r = (st.recent || []).filter((a) => !to.list.includes(a) && !cc.list.includes(a)).slice(0, 6);
    recentEl.replaceChildren(...(r.length ? [h('small', {}, 'Recent'), ...r.map((a) => h('button', { type: 'button', class: 'ml-pill', title: `${a} toevoegen`, onclick: () => to.add(a) }, icon('plus'), a))] : []));
  }
  const subject = textInput(opts.subject || '', { maxlength: 160 });
  const message = h('textarea', { class: 'input ml-msg', rows: 3, maxlength: 4000, placeholder: 'Persoonlijke toelichting bij de bijlage (optioneel). Deze tekst komt bovenaan het bericht.' });
  const by = textInput(mailBy.get(), { maxlength: 60, placeholder: 'Bijv. J. de Vries, TCO' });
  const fmtEl = h('div', { class: 'ml-formats' });
  function paintFormats() {
    fmtEl.replaceChildren(...formats.map((f) => {
      const F = MAIL_FORMATS[f], on = chosen.has(f);
      return h('button', { type: 'button', class: 'ml-fmt' + (on ? ' on' : ''), 'aria-pressed': on ? 'true' : 'false', onclick: () => { if (on) chosen.delete(f); else chosen.add(f); paintFormats(); schedulePreview(); check(); } },
        h('span', { class: 'ml-fmt-ic' }, icon(F.icon)), h('span', { class: 'ml-fmt-tx' }, h('b', {}, F.label), h('small', {}, F.desc)), h('span', { class: 'ml-fmt-ck' }, icon('check')));
    }));
    fmtNote.textContent = chosen.size ? `Alleen de formaten die bij ${kind.label} passen staan hier. Het overzicht staat altijd ook in de e-mail zelf.` : 'Geen bijlage gekozen: alleen het overzicht in de e-mail zelf.';
  }
  const fmtNote = h('div', { class: 'hint' });

  /* ---------- the preview ---------- */
  // The message is 640 px wide, as in a mail client: the preview shows it whole, scaled to the column.
  const frame = h('iframe', { class: 'ml-frame', sandbox: '', title: 'Voorbeeld van de e-mail', tabindex: '-1' });
  const frameWrap = h('div', { class: 'ml-frame-wrap' }, frame);
  const fit = () => { if (!frameWrap.isConnected) { ro.disconnect(); return; } const w = frameWrap.clientWidth, hh = frameWrap.clientHeight; if (!w) return; const k = Math.min(1, w / 700); frame.style.transform = `scale(${k})`; frame.style.height = `${Math.ceil(hh / k)}px`; };
  const ro = new ResizeObserver(fit); ro.observe(frameWrap);
  let pvTimer = null;
  function schedulePreview() { clearTimeout(pvTimer); pvTimer = setTimeout(preview, 250); }
  async function preview() {
    const r = await window.palv.mail.preview(contentNow()).catch(() => null);
    if (r && r.ok) frame.srcdoc = r.html;
  }
  function contentNow() {
    const att = [...chosen].map((f) => { const g = opts.files[f](); return { name: `${g.name}.${f}`, label: g.label || MAIL_FORMATS[f].label }; });
    return { ...opts.content, message: message.value.trim(), by: by.value.trim(), attachments: att };
  }
  for (const el of [message, by]) el.addEventListener('input', schedulePreview);

  /* ---------- the account line ---------- */
  const ok = st.configured && st.usable;
  const from = h('div', { class: 'ml-from' + (ok ? '' : ' warn') },
    h('span', { class: 'ml-from-dot' }),
    h('span', { class: 'ml-from-tx' }, h('small', {}, 'Van'), h('b', {}, st.address ? `P-ALV Dashboard <${st.address}>` : 'P-ALV Dashboard')),
    h('span', { class: 'ml-from-tag' }, ok ? 'Automatisch · geen antwoord mogelijk' : (st.problem || 'Nog niet ingesteld')));

  const sendBtn = h('button', { class: 'btn primary ml-send', onclick: () => go() }, icon('send'), 'Verzenden');
  const body = h('div', { class: 'ml-body' },
    h('div', { class: 'ml-form' },
      from,
      h('div', { class: 'field' }, h('div', { class: 'ml-lab' }, h('label', {}, 'Aan'), ccBtn), to.el, recentEl),
      ccField,
      field('Onderwerp', subject),
      field('Bericht', message),
      field('Verstuurd door', by, 'Komt in de handtekening, zodat de ontvanger weet wie het stuurde. Dit scherm onthoudt het.'),
      h('div', { class: 'field' }, h('label', {}, 'Bijlage'), fmtEl, fmtNote),
      errEl),
    h('div', { class: 'ml-side' }, h('div', { class: 'ml-side-hd' }, icon('mail'), 'Voorbeeld van het bericht'), frameWrap));
  const foot = h('div', { class: 'ml-foot' },
    h('span', { class: 'ml-foot-note' }, icon('info'), `Verzonden vanaf ${st.address || 'het dashboardadres'} met handtekening en disclaimer. Antwoorden wordt niet gelezen.`),
    h('button', { class: 'btn', onclick: () => close() }, 'Annuleren'), sendBtn);
  const overlay = h('div', { class: 'ml-overlay', hidden: true });
  const wrap = h('div', { class: 'ml-wrap' }, body, foot, overlay);
  const close = openModal({ title: h('span', { class: 'ml-title' }, icon('mail'), `E-mail versturen · ${kind.label}`), body: wrap, bare: true, cls: 'ml-modal' });

  function check() {
    const bad = [...to.list, ...cc.list].filter((a) => !MAIL_RE.test(a));
    let why = '';
    if (!ok) why = st.configured ? (st.problem || 'Het mailaccount werkt nog niet') : 'Er is nog geen afzenderadres gekoppeld aan het dashboard';
    else if (bad.length) why = `Geen geldig e-mailadres: ${bad[0]}`;
    errEl.hidden = !why || (!bad.length && ok);
    errEl.textContent = why;
    sendBtn.disabled = !ok || !to.list.length && !to.pending() || bad.length > 0;
    return !sendBtn.disabled;
  }

  async function go() {
    if (to.pending()) { to.add(to.input.value); to.input.value = ''; }
    if (cc.pending()) { cc.add(cc.input.value); cc.input.value = ''; }
    if (!check()) return;
    mailBy.set(by.value.trim());
    const job = {
      to: to.list, cc: cc.list, subject: subject.value.trim() || opts.subject, by: by.value.trim(), message: message.value.trim(),
      content: opts.content,
      files: [...chosen].map((f) => ({ format: f, ...opts.files[f]() })),
    };
    sending();
    const started = Date.now();
    const r = await window.palv.mail.send(job).catch((err) => ({ ok: false, error: String(err.message || err) }));
    // The flight takes at least its own length, so a quick answer does not cut the animation short.
    await new Promise((res) => setTimeout(res, Math.max(0, 1900 - (Date.now() - started))));
    if (r && r.ok) done(r); else failed(r && r.error);
  }

  /* ---------- sending and the confirmation ---------- */
  function sending() {
    overlay.hidden = false;
    overlay.className = 'ml-overlay busy';
    overlay.replaceChildren(h('div', { class: 'ml-anim', html: `
<svg class="ml-fly" viewBox="0 0 240 160" aria-hidden="true">
  <circle class="ml-ring r1" cx="120" cy="96" r="18"/><circle class="ml-ring r2" cx="120" cy="96" r="18"/><circle class="ml-ring r3" cx="120" cy="96" r="18"/>
  <path class="ml-trail" d="M40 128 C 90 120, 110 104, 120 96 S 170 50, 214 26"/>
  <g class="ml-plane"><path d="M0 -9 L22 0 L0 9 L5 0 Z"/><path d="M5 0 L22 0" class="ml-plane-fold"/></g>
</svg>` }),
    h('div', { class: 'ml-ov-title' }, 'Het bericht wordt verzonden'));
  }
  function done(r) {
    overlay.className = 'ml-overlay done';
    const n = r.to.length + (r.cc ? r.cc.length : 0);
    overlay.replaceChildren(h('div', { class: 'ml-anim', html: `
<svg class="ml-ok" viewBox="0 0 120 120" aria-hidden="true">
  <circle class="ml-ok-glow" cx="60" cy="60" r="44"/>
  <circle class="ml-ok-ring" cx="60" cy="60" r="44"/>
  <path class="ml-ok-check" d="M40 61 L54 75 L82 46"/>
</svg>` }),
    h('div', { class: 'ml-ov-title' }, 'Verzonden'),
    h('div', { class: 'ml-ov-sub' }, `Aan ${r.to.join(', ')}${r.cc && r.cc.length ? ` · CC ${r.cc.join(', ')}` : ''}`),
    h('div', { class: 'ml-ov-meta' }, h('span', {}, icon('clock'), zulu(r.at || Date.now())), h('span', {}, icon('mail'), `${n} ontvanger${n > 1 ? 's' : ''}`), r.files && r.files.length ? h('span', {}, icon('file'), r.files.join(' · ')) : null),
    h('button', { class: 'btn primary', onclick: () => close() }, 'Sluiten'));
    toast(`E-mail verzonden aan ${n} ontvanger${n > 1 ? 's' : ''}`);
    setTimeout(() => { if (overlay.isConnected) close(); }, 6000);
  }
  function failed(error) {
    overlay.className = 'ml-overlay fail';
    overlay.replaceChildren(h('div', { class: 'ml-anim', html: `
<svg class="ml-x" viewBox="0 0 120 120" aria-hidden="true"><circle cx="60" cy="60" r="44"/><path d="M45 45 L75 75 M75 45 L45 75"/></svg>` }),
    h('div', { class: 'ml-ov-title' }, 'Niet verzonden'),
    h('div', { class: 'ml-ov-sub' }, error || 'Onbekende fout'),
    h('div', { class: 'ml-ov-btns' }, h('button', { class: 'btn', onclick: () => { overlay.hidden = true; } }, 'Terug naar het bericht'), h('button', { class: 'btn primary', onclick: () => go() }, icon('refresh'), 'Opnieuw proberen')));
  }

  paintRecent(); paintFormats(); check(); preview();
  setTimeout(() => to.input.focus(), 50);
}
