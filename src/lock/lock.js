'use strict';
// Gedrag van het vergrendelscherm: de klok, de overgang naar het aanmeldbeeld bij de eerste aanraking, en
// het controleren van de toegangscode. De code gaat naar het hoofdproces (window.lock.verify); bij de juiste
// code sluit het hoofdproces dit venster. De echte controle en de wachttijd na te veel pogingen zitten daar.
(() => {
  const $ = (id) => document.getElementById(id);
  const body = document.body;
  const pin = $('pin'), msg = $('msg'), form = $('pinform');
  let waiting = false;

  body.classList.add('is-clock');
  // Op meerdere schermen toont maar één scherm het wachtwoordveld (role=primary); de andere schermen tonen
  // alleen het vergrendelbeeld met de klok (role=secondary) en reageren niet op toetsen of klikken.
  const secondary = new URLSearchParams(location.search).get('role') === 'secondary';

  /* ---------- klok en datum ---------- */
  const timeFmt = new Intl.DateTimeFormat('nl-NL', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  const dateFmt = new Intl.DateTimeFormat('nl-NL', { weekday: 'long', day: 'numeric', month: 'long' });
  function tick() {
    const now = new Date();
    $('time').textContent = timeFmt.format(now);
    $('date').textContent = dateFmt.format(now);
  }
  tick();
  setInterval(tick, 1000);

  /* ---------- naam, achtergrond, accentkleur en avatar ophalen ---------- */
  (async () => {
    try {
      const b = await window.lock.boot();
      if (b && b.name) $('name').textContent = b.name;
      if (b && b.wallpaper) $('bg').style.backgroundImage = `url("${b.wallpaper}")`;
      if (b && b.accent) document.documentElement.style.setProperty('--accent', b.accent);
      if (b && b.avatar) $('avatar').style.backgroundImage = `url("${b.avatar}")`;
    } catch { /* dan de naam leeg, de terugval-achtergrond en de standaardtegel */ }
  })();

  /* ---------- van klok naar aanmelden ---------- */
  function toSignin(seed) {
    if (body.classList.contains('is-signin')) return;
    body.classList.remove('is-clock');
    body.classList.add('is-signin');
    if (seed) pin.value = seed;
    showGo();
    setTimeout(() => pin.focus(), 60);
  }
  function toClock() {
    body.classList.remove('is-signin');
    body.classList.add('is-clock');
    pin.value = ''; msg.textContent = ''; showGo();
  }

  // De eerste aanraking (toets, klik, scrollen) brengt het aanmeldbeeld, net als Windows. Een cijfertoets
  // komt meteen in het veld te staan.
  // Alleen het scherm met het wachtwoordveld reageert op een aanraking; de andere schermen tonen enkel beeld.
  if (!secondary) {
    window.addEventListener('keydown', (e) => {
      if (body.classList.contains('is-signin')) {
        if (e.key === 'Escape') { e.preventDefault(); toClock(); }
        return;
      }
      if (e.key === 'Tab' || e.key === 'Shift' || e.key === 'Control' || e.key === 'Alt' || e.key === 'Meta') return;
      e.preventDefault();
      // Spatie en Enter tonen alleen het aanmeldvenster (zoals Windows), zonder een teken in te voeren; een
      // gewoon teken komt meteen in het wachtwoordveld.
      toSignin(e.key.length === 1 && e.key !== ' ' ? e.key : '');
    }, true);
    for (const ev of ['mousedown', 'wheel', 'touchstart']) {
      window.addEventListener(ev, () => { if (!body.classList.contains('is-signin')) toSignin(''); }, { passive: true });
    }
  }

  /* ---------- toegangscode ---------- */
  const go = $('go');
  const showGo = () => { go.hidden = pin.value.length === 0; };
  pin.addEventListener('input', () => {
    if (pin.value.length > 64) pin.value = pin.value.slice(0, 64);
    if (msg.textContent) msg.textContent = '';
    showGo();
  });

  let countdown = null;
  function startWait(sec) {
    waiting = true; pin.disabled = true;
    clearInterval(countdown);
    const paint = () => { msg.textContent = `Te veel pogingen. Probeer het over ${sec} ${sec === 1 ? 'seconde' : 'seconden'} opnieuw.`; };
    paint();
    countdown = setInterval(() => {
      sec -= 1;
      if (sec <= 0) { clearInterval(countdown); waiting = false; pin.disabled = false; msg.textContent = ''; pin.focus(); }
      else paint();
    }, 1000);
  }

  const wrap = $('pinwrap'), spin = $('spin');
  const checking = (on) => { wrap.style.display = on ? 'none' : ''; spin.hidden = !on; };
  async function submit() {
    if (waiting) return;
    const value = pin.value;
    if (!value) { shake(); return; }
    pin.disabled = true; checking(true); msg.textContent = '';
    try {
      const res = await window.lock.verify(value);
      if (res && res.ok) return; // het hoofdproces sluit dit venster
      pin.disabled = false; checking(false);
      if (res && res.wait > 0) { startWait(res.wait); return; }
      msg.textContent = 'Het wachtwoord is onjuist. Probeer het opnieuw.';
      pin.value = ''; showGo(); shake(); pin.focus();
    } catch {
      pin.disabled = false; checking(false);
      msg.textContent = 'Er ging iets mis. Probeer het opnieuw.';
    }
  }
  form.addEventListener('submit', (e) => { e.preventDefault(); submit(); });
  $('pinopt').addEventListener('click', () => pin.focus());

  function shake() {
    const box = $('signin');
    box.classList.remove('shake');
    void box.offsetWidth;   // de animatie opnieuw laten starten
    box.classList.add('shake');
  }

  // Geen rechtermuismenu of slepen op het vergrendelscherm.
  window.addEventListener('contextmenu', (e) => e.preventDefault());
  window.addEventListener('dragstart', (e) => e.preventDefault());
})();
