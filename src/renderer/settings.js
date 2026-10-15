'use strict';

/* ============================================================
   Instellingen
   ============================================================ */
function openSettings(startTab) {
  const s = state.settings;
  const pane = h('div', { class: 'settings-pane' });
  const nav = h('div', { class: 'settings-nav' });
  const zones = (() => { try { return ['UTC', ...Intl.supportedValuesOf('timeZone')]; } catch { return ['UTC', 'Europe/Amsterdam']; } })();
  const changed = (fn) => (...a) => { fn(...a); save(); };
  const when = (t) => (t ? `${new Date(t).toLocaleDateString('nl-NL', { weekday: 'short', day: 'numeric', month: 'short' })} ${new Date(t).toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' })}` : '—');

  const tabs = {
    weergave: {
      label: 'Weergave', icon: 'sun',
      build() {
        const autoBox = h('div', { style: 'display:flex;flex-direction:column;gap:0.9rem' });
        const paintAuto = () => {
          autoBox.replaceChildren();
          if (s.theme !== 'auto') return;
          const { rise, set } = ASTRO.sunTimes(new Date(), 52.31, 4.76);
          const hm = (d) => `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
          const times = h('div', { class: 'row' },
            field('Licht vanaf', h('input', { class: 'input', type: 'time', value: s.lightFrom, onchange: changed((e) => { s.lightFrom = e.target.value; applyTheme(true); }) })),
            field('Donker vanaf', h('input', { class: 'input', type: 'time', value: s.darkFrom, onchange: changed((e) => { s.darkFrom = e.target.value; applyTheme(true); }) })));
          times.style.display = s.autoMode === 'times' ? '' : 'none';
          autoBox.append(
            h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'Automatisch schakelen op basis van'),
              segmented([{ value: 'sun', label: 'Zonsopkomst en -ondergang' }, { value: 'times', label: 'Vaste tijden' }], s.autoMode, changed((v) => { s.autoMode = v; times.style.display = v === 'times' ? '' : 'none'; applyTheme(true); })),
              h('div', { class: 'hint' }, `Vandaag: zon op ${hm(rise)}, zon onder ${hm(set)} (Schiphol). De overgang verloopt met een vloeiende fade.`)),
            times
          );
        };
        const el = [
          h('h3', {}, 'Thema'),
          segmented([{ value: 'auto', label: 'Automatisch', icon: 'auto' }, { value: 'light', label: 'Licht', icon: 'sun' }, { value: 'dark', label: 'Donker', icon: 'moon' }], s.theme, changed((v) => { s.theme = v; applyTheme(true); renderTitlebar(); paintAuto(); })),
          autoBox,
          h('hr'),
          h('h3', {}, 'Schaal'),
          field('Grootte van tekst en bediening', (() => {
            const sel = h('select', { class: 'input', onchange: changed((e) => { s.uiScale = parseFloat(e.target.value); applyScale(); }) }, [0.8, 0.9, 1, 1.1, 1.25, 1.4].map((v) => h('option', { value: v }, `${Math.round(v * 100)} %`)));
            sel.value = String(s.uiScale);
            return sel;
          })(), 'De weergave schaalt automatisch mee met de resolutie van het scherm; hiermee stel je bij voor de kijkafstand.'),
        ];
        paintAuto();
        return el;
      },
    },
    scherm: {
      label: 'Scherm', icon: 'monitor',
      build: () => [
        h('h3', {}, 'Opstarten'),
        checkbox('Starten in volledig scherm (zonder randen en menubalk)', s.startFullscreen, changed((v) => (s.startFullscreen = v))),
        checkbox('Elke nacht om 04:00 vernieuwen (houdt het dashboard fris als het dagenlang aan staat)', s.nightlyReload, changed((v) => (s.nightlyReload = v))),
        checkbox(IS_MAC ? 'P-ALV Dashboard automatisch starten bij het inloggen op deze Mac' : 'P-ALV Dashboard automatisch starten met Windows', s.autoStart, changed(async (v) => { s.autoStart = v; await window.palv.app.setAutoStart(v); })),
        h('hr'),
        h('h3', {}, 'Onbeheerd scherm'),
        checkbox('Scherm altijd aan houden (slaapstand en schermbeveiliging blokkeren zolang het dashboard draait)', s.keepAwake, changed(async (v) => { s.keepAwake = v; await window.palv.app.keepAwake(v); })),
        checkbox('OLED-bescherming tegen inbranden', s.oledCare, changed((v) => { s.oledCare = v; oledTick(); oledPointer(); })),
        h('div', { class: 'hint' }, 'Het hele beeld schuift heel langzaam een paar pixels heen en weer (één stap per minuut, nooit meer dan 3 pixels), de muisaanwijzer verdwijnt na 4 seconden stilstand en ’s nachts gaat de helderheid 4 % omlaag. Je ziet het niet, maar geen pixel brandt uren op dezelfde manier. Een vastgelopen dashboard of ingesloten pagina wordt automatisch opnieuw gestart.'),
        h('hr'),
        h('h3', {}, 'Pagina\'s'),
        field('Automatisch wisselen tussen pagina\'s (seconden)', h('input', { class: 'input', type: 'number', min: 0, step: 5, value: s.rotate, onchange: changed((e) => { s.rotate = Math.max(0, parseInt(e.target.value, 10) || 0); }) }), '0 = niet automatisch wisselen. Handig wanneer het dashboard onbeheerd op de tv draait.'),
        h('hr'),
        h('p', {}, `Volledig scherm: ${FS_KEY} of de knop in de menubalk. Verlaat het met Esc of ${FS_KEY}. ` + 'Beweeg in volledig scherm de muis naar de bovenrand om de menubalk tijdelijk te tonen.'),
      ],
    },
    klokken: {
      label: 'Klokken', icon: 'clock',
      build: () => [
        ...s.clocks.flatMap((c, i) => {
          const sel = h('select', { class: 'input', onchange: changed((e) => { c.tz = e.target.value; renderClocks(); }) }, zones.map((z) => h('option', { value: z }, z)));
          sel.value = c.tz;
          return [
            h('h3', {}, `Klok ${i + 1}`),
            h('div', { class: 'row' },
              field('Label', textInput(c.label, { maxlength: 16, oninput: changed((e) => { c.label = e.target.value; renderClocks(); }) })),
              field('Tijdzone', sel),
              h('div', { class: 'field', style: 'flex:0 0 5rem' }, h('label', {}, 'Achtervoegsel'), textInput(c.suffix, { maxlength: 3, oninput: changed((e) => { c.suffix = e.target.value; renderClocks(); }) }))),
            i === 0 ? h('hr') : null,
          ];
        }),
        h('hr'),
        checkbox('Seconden tonen', s.showSeconds, changed((v) => { s.showSeconds = v; tickClocks(); })),
      ],
    },
    adsb: {
      label: 'Eigen eenheden', icon: 'shield',
      build: () => {
        const refresh = () => { remountType('adsb'); remountType('fleet'); trafficWatch(); };
        const area = (key, label) => field(label, h('textarea', { class: 'input', value: s.hex[key], onchange: changed((e) => { s.hex[key] = e.target.value; refresh(); }) }));
        return [
          h('h3', {}, 'Eigen eenheden'),
          h('p', {}, 'De categorieën Politie, Trauma en Kustwacht op de Vluchtradar en de widget "In de lucht" volgen de toestellen met onderstaande Mode-S hexcodes (ICAO 24-bit adres), gescheiden door komma\'s. Pas de lijsten aan wanneer de vloot wijzigt. Met het tandwiel op "In de lucht" kies je per widget welke eenheden hij toont.'),
          area('police', 'Politie (PH-PXA t/m PXF, PXX, PXY, PXZ)'),
          area('hems', 'Traumahelikopters / ambulancehelikopters'),
          area('coastguard', 'Kustwacht (vliegtuigen en SAR-helikopters)'),
          h('div', {}, h('button', { class: 'btn', onclick: () => { s.hex = { ...DEFAULT_HEX }; save(); refresh(); show('adsb'); } }, icon('refresh'), 'Standaardlijsten herstellen')),
        ];
      },
    },
    meldingen: {
      label: 'Meldingen', icon: 'alert',
      build: () => [
        h('h3', {}, 'Noodsquawk'),
        h('p', {}, 'Het dashboard bewaakt al het vliegverkeer boven Nederland, ook als er geen Vluchtradar in beeld is. Zendt een toestel squawk 7500 (kaping), 7600 (radio-uitval) of 7700 (noodsituatie) uit, of meldt het een noodtoestand via ADS-B, dan verschijnt bovenaan een rode melding met het toestel, de hoogte, de afstand tot Schiphol en een knop om het op de Vluchtradar te tonen. Toestellen op de grond en verouderde posities tellen niet mee; een medische vlucht (lifeguard) is geen noodsituatie.'),
        checkbox('Melding tonen bij een noodsquawk', s.emergencyAlert, changed((v) => { s.emergencyAlert = v; trafficWatch(); if (!v) { emergency.active.clear(); paintEmergency(); } })),
        checkbox('Geluidssignaal bij een nieuwe melding', s.emergencySound, changed((v) => (s.emergencySound = v))),
        h('div', {}, h('button', { class: 'btn', onclick: () => chime() }, icon('alert'), 'Geluid testen')),
        h('div', { class: 'hint' }, 'Een bevestigde melding verdwijnt en komt terug zodra het toestel een andere noodcode uitzendt. Elke melding komt ook in het logboek.'),
      ],
    },
    weerradar: {
      label: 'Weerradar', icon: 'radar',
      build: () => {
        const num = (key, max, step) => h('input', { class: 'input', type: 'number', min: 0, max, step, value: s[key], onchange: changed((e) => { s[key] = clamp(parseInt(e.target.value, 10) || 0, 0, max); e.target.value = s[key]; applyWxMargins(); }) });
        return [
          h('h3', {}, 'Marge voor "marginaal"'),
          h('p', {}, 'Een meetstation dat binnen de BOM-limieten valt, kleurt oranje zodra de wolkenbasis of het zicht minder dan deze marge boven de limiet ligt. De limieten zelf (groen of rood) veranderen hier niet door.'),
          h('div', { class: 'row' }, field('Wolkenbasis (ft)', num('wxMarginFt', 2000, 100)), field('Zicht (m)', num('wxMarginM', 5000, 100))),
          h('div', { class: 'hint field' }, h('div', { class: 'hint' }, 'Standaard 200 ft en 1000 m. Met 0 vervalt de marge voor dat onderdeel; oranje blijft dan alleen bij een verwachte verslechtering tot onder de limiet.')),
          h('div', {}, h('button', { class: 'btn', onclick: () => { s.wxMarginFt = 200; s.wxMarginM = 1000; save(); applyWxMargins(); show('weerradar'); } }, icon('refresh'), 'Standaardmarges herstellen')),
        ];
      },
    },
    indeling: {
      label: 'Indeling', icon: 'layout',
      build: () => {
        const list = h('div', { class: 'bk-list' }, h('div', { class: 'hint' }, 'Laden…'));
        window.palv.config.backups().then((items) => {
          list.replaceChildren(...(items.length ? items.slice(0, 12).map((b) => h('div', { class: 'bk-row' },
            icon('history'),
            h('div', { class: 'bk-main' }, h('b', {}, when(b.time)), h('span', {}, [b.label, b.pages != null ? `${b.pages} pagina's, ${b.widgets} widgets` : null].filter(Boolean).join(' · '))),
            h('button', { class: 'btn', disabled: b.reason === 'broken', onclick: () => confirmDialog('Reservekopie terugzetten', `De indeling van ${when(b.time)} terugzetten? De huidige indeling wordt eerst zelf als reservekopie bewaard.`, 'Terugzetten', async () => {
              const cfg = await window.palv.config.loadBackup(b.name).catch(() => null);
              if (!cfg) return toast('Deze reservekopie kon niet worden gelezen.', true);
              await replaceConfig(cfg, 'restore');
            }) }, 'Terugzetten'))) : [h('div', { class: 'hint' }, 'Nog geen reservekopieën.')]));
        });
        return [
          h('h3', {}, 'Bewerken'),
          checkbox('Widgets uitlijnen op raster bij verplaatsen en schalen', s.snap, changed((v) => (s.snap = v))),
          h('hr'),
          h('h3', {}, 'Automatische reservekopieën'),
          h('p', {}, 'Het dashboard bewaart vanzelf eerdere versies van de indeling: hooguit één per uur bij wijzigingen, en altijd vóór een import, het herstellen van de standaard en een nieuwe versie van de app. De laatste 30 blijven bewaard. Is de indeling ooit onleesbaar, dan wordt de nieuwste goede kopie automatisch teruggezet.'),
          list,
          h('div', {}, h('button', { class: 'btn', onclick: () => window.palv.config.openBackups() }, icon('folder'), 'Map met reservekopieën openen')),
          h('hr'),
          h('h3', {}, 'Exporteren en importeren'),
          h('p', {}, 'Bewaar de volledige indeling (pagina\'s, widgets, tegels en instellingen) als bestand, bijvoorbeeld om op een andere pc te gebruiken.'),
          h('div', { style: 'display:flex;gap:0.5rem;flex-wrap:wrap' },
            h('button', { class: 'btn', onclick: async () => { if (await window.palv.config.exportFile(state)) toast('Indeling geëxporteerd'); } }, 'Exporteren…'),
            h('button', { class: 'btn', onclick: async () => {
              const res = await window.palv.config.importFile();
              if (!res) return;
              if (res.error || !Array.isArray(res.pages)) return toast(res.error || 'Dit is geen geldige dashboard-indeling.', true);
              confirmImport(res);
            } }, 'Importeren…'),
            h('button', { class: 'btn danger', onclick: () => confirmDialog('Standaardindeling herstellen', 'Alle pagina\'s, widgets en instellingen worden teruggezet naar de standaard. De huidige indeling wordt eerst als reservekopie bewaard.', 'Herstellen', () => replaceConfig(defaultState(), 'reset')) }, 'Standaardindeling herstellen')),
        ];
      },
    },
    systeem: {
      label: 'Systeem', icon: 'system',
      build: () => {
        const box = h('div', { class: 'sys-update' });
        box.paint = () => {
          const u = upd.st || {};
          const busy = ['checking', 'downloading', 'installing'].includes(u.state);
          const pct = Math.round((u.progress || 0) * 100);
          const line = {
            off: 'Automatisch bijwerken is niet ingesteld.',
            idle: 'Eerste controle volgt kort na het opstarten.',
            checking: 'Bezig met controleren…',
            current: 'Je hebt de nieuwste versie.',
            downloading: `Versie ${u.latest} wordt gedownload: ${pct} % (${MB(u.received || 0)} van ${MB(u.total || 0)} MB${u.speed ? `, ${MB(u.speed)} MB/s` : ''})`,
            ready: `Versie ${u.latest} is gedownload en gecontroleerd, en wordt zo geïnstalleerd.`,
            installing: 'Installeren…',
            error: `Laatste poging mislukt: ${u.lastError || 'onbekende fout'}. Wordt automatisch opnieuw geprobeerd.`,
          }[u.state] || '';
          box.replaceChildren(
            h('div', { class: 'sys-ver' },
              h('div', {}, h('span', {}, 'Geïnstalleerd'), h('b', {}, 'v' + (u.current || '—'))),
              h('div', {}, h('span', {}, 'Nieuwste op GitHub'), h('b', {}, u.latest ? 'v' + u.latest : '—')),
              h('div', {}, h('span', {}, 'Laatst gecontroleerd'), h('b', {}, when(u.lastCheck)))),
            h('div', { class: 'sys-line ' + (u.state || '') }, u.state === 'downloading' ? h('span', { class: 'sys-bar' }, h('i', { style: `width:${pct}%` })) : null, line),
            h('div', { style: 'display:flex;gap:0.5rem;flex-wrap:wrap' },
              h('button', { class: 'btn primary', disabled: busy || u.state === 'off', onclick: async () => { const r = await window.palv.update.check(); onUpdateStatus(r); if (r.state === 'current') toast('Je hebt de nieuwste versie'); } }, icon('refresh'), 'Nu controleren'),
              u.state === 'ready' ? h('button', { class: 'btn', onclick: () => { closeModalTop(); showUpdateReady(true); } }, icon('download'), 'Nu installeren') : null),
            h('p', { class: 'hint-p' }, `Elke 30 minuten wordt bij GitHub (${u.repo || '—'}) gekeken of er een nieuwe versie is. Die wordt op de achtergrond gedownload, gecontroleerd met een SHA-256-controlegetal en daarna automatisch geïnstalleerd, met een aftelling van ${COUNTDOWN_S} seconden waarin je kunt uitstellen. Het dashboard start daarna vanzelf opnieuw.`));
        };
        box.paint();
        const wd = h('div', { class: 'sys-ver' }, h('div', {}, h('span', {}, 'Laden…')));
        window.palv.app.health().then((x) => wd.replaceChildren(
          h('div', {}, h('span', {}, 'Draait sinds'), h('b', {}, when(x.startedAt))),
          h('div', {}, h('span', {}, 'Automatisch hersteld'), h('b', {}, `${x.reloads}× dashboard · ${x.webviewCrashes}× pagina`)),
          h('div', {}, h('span', {}, 'Scherm blijft aan'), h('b', {}, x.awake ? 'Ja' : 'Nee'))));
        return [
          h('h3', {}, 'Updates'),
          box,
          h('hr'),
          h('h3', {}, 'Bewaking'),
          wd,
          h('p', {}, 'Crasht of hangt het dashboard, of een ingesloten pagina zoals Windy, dan wordt het automatisch opnieuw gestart. Alles wat er gebeurt (bronnen die wegvallen, herstarts, noodsquawks, updates) komt in het logboek; de logboeken van de laatste 14 dagen blijven bewaard.'),
          h('div', { style: 'display:flex;gap:0.5rem;flex-wrap:wrap' },
            h('button', { class: 'btn', onclick: () => window.palv.app.openLogs() }, icon('folder'), 'Logboek openen'),
            h('button', { class: 'btn', onclick: () => { closeModalTop(); openScreens(); } }, icon('screens'), 'Schermoverzicht')),
        ];
      },
    },
    over: {
      label: 'Over', icon: 'info',
      build: () => {
        const ver = h('span', {}, '');
        window.palv.app.version().then((v) => (ver.textContent = v));
        return [
          h('h3', {}, 'P-ALV Dashboard'),
          h('p', {}, 'Versie ', ver),
          h('hr'),
          h('h3', {}, 'Gegevensbronnen'),
          h('p', {}, 'Versheid: elke widget met gegevens toont in zijn titelbalk een bolletje met de tijd en de leeftijd van wat hij laat zien. Groen: actueel. Oranje: vertraagd, of de verbinding hapert. Rood: verouderd of geen verbinding. Beweeg de muis erover voor de grenzen per bron.'),
          h('p', {}, 'Luchtvaartweer (METAR/TAF): aviationweather.gov — elke minuut ververst, ook de meetstations op de weerradar.'),
          h('p', {}, 'Meetstations op de weerradar: getoetst aan de weerminima uit de tabel van het BOM, per gekozen profiel. Groen: binnen limieten. Oranje: binnen limieten maar marginaal (minder marge dan ingesteld onder Weerradar, standaard 200 ft of 1000 m) of volgens de trend binnen 2 uur eronder. Rood: buiten limieten. Grijs: zicht of bewolking niet gemeten, of waarneming ouder dan 90 minuten. Verticaal zicht (VV) telt niet als wolkenbasis. Pijl: trend uit de METAR, anders uit de TAF, anders het waargenomen verloop. Plus: buiten Aided Nacht maar binnen Advanced Operations, alleen AW139.'),
          h('p', {}, 'Temperatuur en dauwpunt: naast de waarden staat het verschil (Δ) en de relatieve vochtigheid. Bij 3 °C of minder verschil kleurt het oranje (kans op mist), bij 1 °C of minder rood.'),
          h('p', {}, 'UDP: 15 minuten vóór zonsopkomst tot 15 minuten na zonsondergang op 52°N 005°E, volgens de KNMI-tabellen voor 2026 en 2027. Voor latere jaren wordt gerekend (hooguit één minuut verschil met de tabel) en staat er "BEREKEND" in de balk, tot de tabel van dat jaar is toegevoegd. Het profiel op de weerradar schakelt op deze tijden automatisch tussen het laatst gebruikte dag- en nachtprofiel.'),
          h('p', {}, 'Maan: fase, verlicht percentage, maanop en maanonder voor 52°N 005°E, berekend met de hoofdtermen uit Meeus (Astronomical Algorithms); tijden op een minuut of twee nauwkeurig. Lichtniveau: geschatte verlichtingssterkte op de grond van zon, schemering en maan samen, voor een onbewolkte hemel zonder lichtvervuiling — in lux, onder 1 lux in millilux (mlx). Volle maan hoog aan de hemel geeft zo’n 0,1 tot 0,3 lux; een maanloze sterrenhemel ongeveer 0,6 mlx. Bewolking en stadslicht veranderen de werkelijke waarde sterk.'),
          h('p', {}, 'Actueel baangebruik: live waargenomen uit het vliegverkeer rond Schiphol (ADS-B-gegevens van adsb.lol, reserve adsb.fi), elke 12 seconden bijgewerkt. Een baan wordt getoond wanneer er in het laatste kwartier toestellen op eindnadering of net na de start zijn gezien.'),
          h('p', {}, 'Vluchtradar en In de lucht: één gezamenlijke live-bron. Posities van adsb.fi, elke seconde opgehaald en direct doorgegeven, aangevuld met adsb.lol; per toestel wint steeds het nieuwste bericht. Op de kaart schuift een toestel tussen twee berichten hooguit 4 seconden door langs zijn koers met zijn grondsnelheid; een positie ouder dan 20 seconden wordt vervaagd getoond, ouder dan 60 seconden niet meer. De vliegtijd telt vanaf de start in de gevlogen route bij ADS-B Exchange; met ≈ vanaf de eerste waarneming, met ≥ als het toestel al vloog toen het dashboard startte.'),
          h('p', {}, 'Kaarten op de Vluchtradar: OpenStreetMap (overdag licht, in de avond vloeiend donker), satelliet Sentinel-2 cloudless van EOX (Copernicus) met de luchtfoto van PDOK boven Nederland, en de topografische kaart van PDOK (Kadaster). Luchtruim: openFlightMaps. Neerslagradar: RainViewer.'),
          h('p', {}, 'Rode melding rechts in de tabbalk: een bron levert al een tijd geen verse gegevens (ADS-B langer dan 3 minuten, weerradarbeeld ouder dan een half uur, METAR Schiphol ouder dan 75 minuten of onbereikbaar). Beweeg de muis erover voor de details.'),
          h('p', {}, 'Vliegverkeer: adsb.fi en adsb.lol, routes van ADS-B Exchange. Weerradar: Windy.com.'),
          h('p', {}, 'Dit dashboard is een hulpmiddel voor situationeel overzicht en vervangt geen officiële briefing- of vluchtvoorbereidingsbronnen.'),
        ];
      },
    },
  };

  const show = (key) => {
    [...nav.children].forEach((b) => b.classList.toggle('on', b.dataset.k === key));
    pane.replaceChildren(...tabs[key].build().filter(Boolean));
  };
  for (const [key, t] of Object.entries(tabs)) nav.append(h('button', { 'data-k': key, onclick: () => show(key) }, icon(t.icon), t.label));
  openModal({ title: 'Instellingen', body: h('div', { class: 'settings' }, nav, pane), wide: true, bare: true });
  show(tabs[startTab] ? startTab : 'weergave');
}
const closeModalTop = () => { const m = $('#modal-root').lastChild; if (m) m.remove(); };

// An imported layout can contain app tiles that start programs. Those are listed before anything is
// replaced, so a file from elsewhere cannot quietly put a command on the dashboard.
function confirmImport(cfg) {
  const tiles = (cfg.pages || []).flatMap((p) => (p.widgets || []).filter((w) => w && w.type === 'tile' && w.cfg && w.cfg.kind !== 'url' && w.cfg.target).map((w) => ({ page: p.name, w })));
  const body = [h('p', { style: 'margin:0 0 0.8rem;line-height:1.5' }, `Deze indeling heeft ${cfg.pages.length} pagina('s) en vervangt de huidige. De huidige indeling wordt eerst als reservekopie bewaard.`)];
  if (tiles.length) {
    body.push(
      h('div', { class: 'imp-warn' }, icon('alert'), h('div', {}, h('b', {}, `Let op: ${tiles.length} app-tegel(s) starten een programma op deze computer`), h('span', {}, 'Importeer alleen als je deze programma\'s herkent en vertrouwt.'))),
      h('div', { class: 'imp-list' }, tiles.map(({ page, w }) => h('div', {}, h('b', {}, w.title || 'App-tegel'), h('code', {}, `${w.cfg.target}${w.cfg.args ? ' ' + w.cfg.args : ''}`), h('small', {}, `pagina "${page}"`)))));
  }
  openModal({ title: 'Indeling importeren', body, actions: [{ label: 'Annuleren' }, { label: tiles.length ? 'Ik vertrouw deze tegels, importeren' : 'Importeren', danger: tiles.length > 0, primary: !tiles.length, onClick: () => { replaceConfig(cfg, 'import'); } }] });
}
