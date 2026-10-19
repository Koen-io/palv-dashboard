'use strict';

/* ============================================================
   Zoek & Plan — de eigen vloot live op de kaart: positie, gevlogen route, en waar ze over een paar
   minuten zijn op deze koers en snelheid.
   ============================================================ */
// From the same live feed as the Vluchtradar (feeds.js): no extra questions to the sources.
const ZP_FLEET_GROUPS = { police: 'Politie', hems: 'Trauma', coastguard: 'Kustwacht', other: 'Overig verkeer' };

function zpFleet(ctx) {
  const { map, cfg } = ctx;
  const F = cfg.fleet;
  let snap = null;
  const area = () => {
    if (!F.on || !onScreen(ctx.body) || !map._loaded) return null;
    if (!F.groups.includes('other')) return null; // own units are always covered by their codes
    const b = map.getBounds(), c = b.getCenter();
    return { lat: c.lat, lon: c.lng, nm: Math.min(250, (map.distance(c, b.getNorthEast()) / 1852) * 1.1 + 5) };
  };
  const unwatch = watchTraffic((s) => { snap = s; if (F.on && onScreen(ctx.body)) ctx.cv.request(); }, area);
  ctx.cleanups.push(unwatch);
  // Redrawn a few times a second so the aircraft glide between messages.
  ctx.timers.push(setInterval(() => { if (F.on && snap && onScreen(ctx.body)) ctx.cv.request(); }, 400));

  const rem = () => parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
  const wanted = (a) => (a.group ? F.groups.includes(a.group) : F.groups.includes('other'));
  ctx.cv.add(80, (c) => {
    if (!F.on || !snap) return;
    const { g } = c;
    const now = Date.now();
    const dpr = window.devicePixelRatio > 1 ? 2 : 1;
    const font = `700 ${(0.64 * rem()).toFixed(1)}px ${getComputedStyle(document.body).fontFamily}`;
    for (const a of snap.ac) {
      if (a.lat == null || !wanted(a) || (now - a.posAt) / 1000 > VR_HIDE_S) continue;
      const pos = vrNow(a, now);
      const p = c.P(pos[0], pos[1]);
      if (!c.inView(p, 80)) continue;
      const own = !!a.group;
      let pills = null;
      // The route flown so far.
      if (F.trails && own) {
        const t = vrTrails.get(a.hex);
        if (t && t.length > 1) {
          g.lineWidth = 2.4; g.strokeStyle = (VR_GROUP_COLOR[a.group] || '#c6d4e8') + 'aa';
          g.beginPath(); t.forEach((q, i) => { const pp = c.P(q[1], q[2]); if (i) g.lineTo(pp[0], pp[1]); else g.moveTo(pp[0], pp[1]); }); g.lineTo(p[0], p[1]); g.stroke();
        }
      }
      // Where it will be in 1, 2 and 5 minutes on this track and speed (ticks on a dashed line).
      if (F.vectors && a.gs > 20 && a.track != null && a.alt !== 'ground') {
        const mins = F.vectors === 1 ? [1] : F.vectors === 2 ? [1, 2, 5] : [1, 2, 5, 10];
        const far = PlanGeo.dest({ lat: pos[0], lon: pos[1] }, a.track, (a.gs * 1852 * mins[mins.length - 1]) / 60);
        const fp = c.P(far.lat, far.lon);
        const col = own ? VR_GROUP_COLOR[a.group] : '#c6d4e8';
        // A dark edge under the dashes keeps the line visible on light maps and on the satellite photo.
        g.lineCap = 'round';
        g.lineWidth = 4; g.strokeStyle = 'rgba(5,9,16,0.6)';
        g.beginPath(); g.moveTo(p[0], p[1]); g.lineTo(fp[0], fp[1]); g.stroke();
        g.setLineDash([6, 4]); g.lineWidth = 2; g.strokeStyle = col;
        g.beginPath(); g.moveTo(p[0], p[1]); g.lineTo(fp[0], fp[1]); g.stroke(); g.setLineDash([]); g.lineCap = 'butt';
        // The minutes in a small dark box with the unit's colour round it, beside the line (right of the
        // track), so they read the same on every base map.
        const tr = ((a.track ?? 0) * Math.PI) / 180, nx = Math.cos(tr), ny = Math.sin(tr);
        pills = [];
        for (const m of mins) {
          const q = PlanGeo.dest({ lat: pos[0], lon: pos[1] }, a.track, (a.gs * 1852 * m) / 60), qp = c.P(q.lat, q.lon);
          g.beginPath(); g.arc(qp[0], qp[1], 3.6, 0, Math.PI * 2); g.fillStyle = col; g.fill(); g.lineWidth = 1.5; g.strokeStyle = '#0a0f18'; g.stroke();
          if (own) pills.push({ text: `${m} min`, x: qp[0], y: qp[1], nx, ny, accent: col });
        }
      }
      const shape = vrShape(a);
      const px = 1.45 * rem() * VR_SHAPES[shape].s * (own ? 1.3 : 0.95);
      const sp = vrSprite(shape, own ? VR_GROUP_COLOR[a.group] : vrAltColor(a.alt), 'contrast', px, own, dpr);
      g.save(); g.translate(p[0], p[1]); g.rotate(((a.track ?? 0) * Math.PI) / 180); g.drawImage(sp.c, -sp.size / 2, -sp.size / 2, sp.size, sp.size); g.restore();
      let tagBox = null;
      if (F.labels && (own || c.zoom >= 10)) {
        const nm = UNIT_NAMES(a.hex);
        tagBox = zpTag(g, [a.flight || a.reg || (nm && nm.reg) || a.hex.toUpperCase(), `${vrAltText(a)} · ${a.gs == null ? '—' : Math.round(a.gs) + ' kt'}`], p[0] + px * 0.6, p[1], { font, accent: own ? VR_GROUP_COLOR[a.group] : vrAltColor(a.alt) });
      }
      // The minute labels last, each only where it overlaps neither the aircraft, its label nor another one;
      // the farthest first, so a slow helicopter at a low zoom keeps its 5 min.
      if (pills) {
        const avoid = [{ x: p[0] - px * 0.5, y: p[1] - px * 0.5, w: px, h: px }];
        if (tagBox) avoid.push(tagBox);
        const tagFont = `700 ${(0.7 * rem()).toFixed(1)}px ${getComputedStyle(document.body).fontFamily}`;
        for (const q of pills.reverse()) zpPill(g, q.text, q.x, q.y, q.nx, q.ny, { font: tagFont, accent: q.accent, avoid });
      }
      c.hit({ x: p[0], y: p[1], r: Math.max(12, px * 0.5), kind: 'aircraft', item: a, z: 8 });
    }
  });

  ctx.on('hit', ({ hit }) => {
    if (hit.kind !== 'aircraft') return;
    const a = hit.item, nm = UNIT_NAMES(a.hex) || {};
    const pos = vrNow(a, Date.now());
    ctx.select({ lat: pos[0], lon: pos[1], label: a.flight || a.reg || nm.reg || a.hex.toUpperCase(), kind: 'aircraft', item: a });
    ctx.showCard({
      title: a.flight || a.reg || nm.reg || a.hex.toUpperCase(),
      sub: [a.reg || nm.reg, a.type || nm.type, a.group ? FLEET_GROUPS[a.group] : null].filter(Boolean).join(' · '),
      color: a.group ? VR_GROUP_COLOR[a.group] : vrAltColor(a.alt), point: { lat: pos[0], lon: pos[1] },
      rows: [
        ['Hoogte', vrAltText(a)], ['Snelheid', a.gs == null ? '—' : `${Math.round(a.gs)} kt GS`], ['Koers', a.track == null ? '—' : ctx.fmt.course(a.track, pos[0], pos[1])],
        ['Squawk', a.squawk || '—'], ['Positie', `${((Date.now() - a.posAt) / 1000).toFixed(0)} s oud · ${a.src || ''}`],
      ],
    });
  });
  return {};
}
