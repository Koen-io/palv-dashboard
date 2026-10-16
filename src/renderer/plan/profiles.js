'use strict';

/* ============================================================
   Zoek & Plan — de twee helikopterprofielen: EC135 P2+ en AW139.
   ============================================================ */
// What stands here is only what is openly published: the EASA type certificates (TCDS) and the
// manufacturers' technical data. The figures of the unit's own manuals (RFM, SOP, TACSOP) are internal
// and never go into this public code: they live in a private profile file on the screen itself
// (plan-private.json, see src/plan/store.js), which is laid over these values field by field.
// Every value is { v, unit, src } so the screen can always say where a number comes from.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.PlanProfiles = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  const TC135 = 'EASA TCDS R.009 (EC135), issue 20';
  const TD135 = 'Eurocopter EC135 P2+ Technical Data 135.07.101.01';
  const TC139 = 'EASA TCDS R.006 (AW139), issue 27';
  const LEO = 'Leonardo AW139 productgegevens';
  const val = (v, unit, src, note) => ({ v, unit, src, ...(note ? { note } : {}) });

  const BASE = {
    ec135: {
      id: 'ec135', name: 'EC135 P2+', type: 'EC135', maker: 'Airbus Helicopters', color: '#3d9bff',
      regs: ['PH-PXA', 'PH-PXB', 'PH-PXC', 'PH-PXD', 'PH-PXE', 'PH-PXF'],
      speeds: {
        vne: val(155, 'KIAS', TC135, 'Op zeeniveau; neemt af met gewicht, hoogte en temperatuur'),
        vneOei: val(110, 'KIAS', 'EC135 P2+ FM (publiek)', 'Of de VNE-tabel als die lager is'),
        vneAutorot: val(90, 'KIAS', 'EC135 P2+ FM (publiek)', 'Stabiele autorotatie'),
        vy: val(65, 'KIAS', 'EC135 P2+ FM (publiek)'),
        vtoss: val(40, 'KIAS', 'EC135 P2+ FM (publiek)'),
        cruiseFast: val(137, 'KTAS', TD135, 'Max. kruissnelheid op zeeniveau ISA bij 2910 kg (141 kt bij 2400 kg)'),
        cruiseEco: val(122, 'KTAS', TD135, 'Economische kruissnelheid (beste bereik), 121–124 kt'),
        endurance: val(65, 'KIAS', TD135, 'Snelheid voor maximale vliegduur'),
      },
      // Sea-level VNE per weight band (publicly available copy of the flight manual); the full chart
      // over altitude and temperature comes from the private profile.
      vneTable: [
        { weightKg: 2300, hpFt: 0, oatC: 30, kias: 155 }, { weightKg: 2300, hpFt: 0, oatC: 40, kias: 150 },
        { weightKg: 2720, hpFt: 0, oatC: 30, kias: 150 }, { weightKg: 2720, hpFt: 0, oatC: 40, kias: 145 },
        { weightKg: 2910, hpFt: 0, oatC: 30, kias: 140 }, { weightKg: 2910, hpFt: 0, oatC: 40, kias: 140 },
      ],
      vneTableSrc: 'EC135 P2+ FM (publiek), alleen zeeniveau',
      weights: {
        mtow: val(2910, 'kg', TC135, '2950 kg met RFMS 9.1-5/6/7 vanaf s/n 1055 of na SB 62-028'),
        empty: val(1455, 'kg', TD135, 'Standaarduitvoering'),
        planning: val(2700, 'kg', 'Standaard planning', 'Pas aan naar de werkelijke vlieggewicht'),
      },
      fuel: {
        usableKg: val(560, 'kg', TD135, '700,5 L bruikbaar (s/n ≥ 0250)'),
        densityKgL: val(0.8, 'kg/L', 'Jet A-1 nominaal'),
        flowFast: val(234.5, 'kg/u', TD135, 'Snelle kruisvlucht'),
        flowEco: val(201, 'kg/u', TD135, 'Economische kruisvlucht (193,5–208,5)'),
        flowEndurance: val(157, 'kg/u', TD135, 'Bij 65 KIAS (149,5–164,5)'),
        plan: val(220, 'kg/u', 'Standaard planning', 'Pas aan naar de SOP'),
        taxi: val(15, 'kg', 'Standaard planning'),
        reserveMin: val(20, 'min', 'Standaard planning', 'Eindreserve; pas aan naar de SOP'),
        bom: { contingencyPct: val(5, '%', 'Standaard planning'), frfMinDay: val(20, 'min', 'Standaard planning'), frfMinNight: val(30, 'min', 'Standaard planning') },
      },
      planning: { ias: val(120, 'KIAS', 'Standaard planning'), altFt: val(1000, 'ft', 'Standaard planning') },
      wind: {
        rotorStartStop: val(50, 'kt', 'EC135 P2+ FM (publiek)', 'Uit elke horizontale richting'),
        sideward: val(30, 'kt', 'Flight Safety Australia (secundair)', 'Niet geverifieerd in het vlieghandboek'),
        rearward: val(25, 'kt', 'Flight Safety Australia (secundair)', 'Niet geverifieerd in het vlieghandboek'),
      },
      perf: {
        hige: val(10000, 'ft', TD135, 'ISA, 2910 kg (certificeringsgrens)'),
        hoge: val(6600, 'ft', TD135, 'ISA, 2910 kg (14.750 ft bij 2400 kg)'),
        ceiling: val(10000, 'ft', TD135, 'Bij 2910 kg (20.000 ft bij 2400 kg)'),
        oeiCeiling: val(8900, 'ft', TD135, 'ISA, 2910 kg'),
        maxAlt: val(20000, 'ft', 'EC135 P2+ FM (publiek)', 'PA; lager boven 2720 kg'),
        slope: val(6, '°', 'EC135 P2+ FM (publiek)', 'In elke richting'),
        rangeNm: val(342, 'NM', TD135, 'Zonder reserve, economische kruisvlucht, 2910 kg'),
        enduranceMin: val(215, 'min', TD135, 'Zonder reserve, 65 KIAS, 2910 kg (3:35)'),
      },
      dims: {
        rotor: val(10.2, 'm', TC135, 'Lagerloze hoofdrotor, 4 bladen; fenestron 1,00 m'),
        dValue: val(12.2, 'm', 'Airbus Helicopters (D-waarde)', 'Totale lengte met draaiende rotoren'),
        height: val(3.35, 'm', TC135),
      },
      engines: { type: val('2× P&WC PW206B2', '', TC135), top: val(498, 'kW', TD135, 'Per motor, startvermogen'), mcp: val(457, 'kW', TD135, 'Per motor, max. continu') },
      crew: val('1 vlieger + 6 (7) inzittenden', '', TC135),
    },
    aw139: {
      id: 'aw139', name: 'AW139', type: 'AW139', maker: 'Leonardo', color: '#ffb941',
      regs: ['PH-PXX', 'PH-PXY', 'PH-PXZ'],
      speeds: {
        vne: val(167, 'KIAS', TC139, 'Neemt af met hoogte en temperatuur; aparte grafiek boven 6400 kg'),
        vneOei: val(147, 'KIAS', TC139, 'Ook motor uit (power-off)'),
        vneAutorot: val(147, 'KIAS', TC139),
        vy: val(80, 'KIAS', 'AW139 QRH (publiek)', '70 KIAS boven 10.000 ft Hp'),
        vtoss: val(40, 'KIAS', 'AW139 QRH (publiek)', 'Verticaal / kort veld; 50 KIAS clear area'),
        cruiseFast: val(165, 'KTAS', LEO, '5000 ft, ISA, MGW, MCP'),
      },
      vneTable: [],
      vneTableSrc: null,
      weights: {
        mtow: val(6400, 'kg', TC139, '6800 kg met RFM Suppl. 50, 7000 kg met Suppl. 90'),
        planning: val(6000, 'kg', 'Standaard planning', 'Pas aan naar de werkelijke vlieggewicht'),
      },
      fuel: {
        usableKg: val(1240, 'kg', TC139, '1588 L totaal, 20 L onbruikbaar (×0,79 kg/L)'),
        densityKgL: val(0.79, 'kg/L', 'Jet A-1 nominaal'),
        plan: val(500, 'kg/u', 'Standaard planning', 'Geen officieel gepubliceerd verbruik; pas aan naar de SOP'),
        taxi: val(30, 'kg', 'Standaard planning'),
        reserveMin: val(20, 'min', 'Standaard planning', 'Eindreserve; pas aan naar de SOP'),
        bom: { contingencyPct: val(5, '%', 'Standaard planning'), frfMinDay: val(20, 'min', 'Standaard planning'), frfMinNight: val(30, 'min', 'Standaard planning') },
      },
      planning: { ias: val(140, 'KIAS', 'Standaard planning'), altFt: val(1000, 'ft', 'Standaard planning') },
      wind: {
        rotorStartStop: val(50, 'kt', 'AW139 QRH (publiek)', 'Start of stop boven 27 kt vastleggen'),
        catACross: val(20, 'kt', 'AW139 QRH (publiek)', 'Cat A: max. dwarswind; geen staartwind'),
      },
      perf: {
        hige: val(15327, 'ft', LEO, 'ISA, MGW, TOP'),
        hoge: val(8123, 'ft', LEO, 'ISA, MGW, TOP'),
        maxAlt: val(20000, 'ft', TC139, 'PA of DA, wat het eerst bereikt wordt'),
        slope: val(5, '°', 'AW139 QRH (publiek)', 'In alle richtingen'),
        rangeNm: val(573, 'NM', 'AW139 Law Enforcement brochure', 'Zonder reserve'),
      },
      dims: {
        rotor: val(13.8, 'm', TC139, '5 bladen; staartrotor 2,70 m'),
        dValue: val(16.66, 'm', LEO, 'Totale lengte met draaiende rotoren'),
        height: val(4.98, 'm', LEO, 'Met draaiende rotoren'),
      },
      engines: { type: val('2× P&WC PT6C-67C', '', TC139), top: val(820, 'kW', TC139, 'Per motor, transmissiegrens AEO TOP'), mcp: val(746, 'kW', TC139, 'Per motor, AEO MCP') },
      crew: val('1 vlieger (VFR dag), 2 (VFR nacht/IFR) + 15 inzittenden', '', TC139),
    },
  };

  // The private file lays its values over these, field by field; a table replaces a table.
  function merge(base, over) {
    if (!over || typeof over !== 'object') return base;
    if (Array.isArray(base) || Array.isArray(over)) return over;
    if (over && typeof over === 'object' && 'v' in over) return { ...over };
    const out = { ...base };
    for (const [k, v] of Object.entries(over)) out[k] = base && base[k] && typeof base[k] === 'object' && typeof v === 'object' ? merge(base[k], v) : v;
    return out;
  }
  const profiles = (privateOver = {}, userOver = {}) => Object.fromEntries(Object.entries(BASE).map(([id, p]) => [id, merge(merge(p, privateOver[id]), userOver[id])]));
  const v = (field, fallback = null) => (field && field.v != null ? field.v : fallback);

  // The figures the planning uses, read from a (merged) profile.
  function planning(p) {
    return {
      ias: v(p.planning && p.planning.ias, 120),
      altFt: v(p.planning && p.planning.altFt, 1000),
      flowKgh: v(p.fuel.plan, 250),
      taxiKg: v(p.fuel.taxi, 0),
      reserveMin: v(p.fuel.reserveMin, 20),
      usableKg: v(p.fuel.usableKg, 0),
      density: v(p.fuel.densityKgL, 0.8),
      weightKg: v(p.weights.planning, v(p.weights.mtow, 0)),
      mtow: v(p.weights.mtow, null),
      vne: v(p.speeds.vne, null),
      rotorStartStop: v(p.wind && p.wind.rotorStartStop, null),
    };
  }

  return { BASE, merge, profiles, planning, v };
});
