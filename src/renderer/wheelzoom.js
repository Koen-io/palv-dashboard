'use strict';

/* ============================================================
   Smooth zooming with the mouse wheel and the trackpad, the same on Windows and macOS, for the Vluchtradar
   and Zoek & Plan maps.

   Leaflet's own wheel zoom drops every notch that comes in while a zoom step is still animating (250 ms),
   and it reads the wheel in pixels: on macOS a notch arrives as a few pixels where Windows gives a hundred,
   so zooming there was many times slower whatever the scroll speed in macOS. Here every notch or swipe
   moves a target zoom at once, and the map glides to it frame by frame around the point under the cursor.
   During the glide the tiles are only scaled (as with a pinch on a phone); new tiles are fetched a few
   times per second and when the glide ends, so a slow computer keeps up.
   ============================================================ */
const VR_WHEEL = {
  NOTCH: 0.5,     // zoom levels per wheel notch
  SWIPE: 1 / 220, // zoom levels per pixel of a trackpad swipe
  PINCH: 1 / 60,  // zoom levels per pixel of a trackpad pinch (comes in with ctrlKey)
  TAU: 75,        // ms: how quickly the map closes in on the target zoom
  TILES_MS: 300,  // during a glide the tiles follow this often
  MAC_TICK: 4.000244140625,
};

// Zoom levels for one wheel event: positive zooms in.
function vrWheelLevels(e) {
  const dy = e.deltaY;
  if (!dy) return 0;
  const sign = dy < 0 ? 1 : -1;
  if (e.deltaMode === 1) return sign * VR_WHEEL.NOTCH * Math.min(Math.abs(dy) / 3, 3);
  if (e.deltaMode === 2) return sign * VR_WHEEL.NOTCH * 2;
  if (e.ctrlKey) return -dy * VR_WHEEL.PINCH;
  const a = Math.abs(dy);
  // A wheel with notches: on macOS a multiple of 4.000244 pixels, elsewhere a multiple of 120 in wheelDelta.
  const ticks = a / VR_WHEEL.MAC_TICK;
  if (Math.abs(ticks - Math.round(ticks)) < 1e-3) return sign * VR_WHEEL.NOTCH * Math.min(Math.round(ticks), 3);
  const wd = Math.abs(e.wheelDeltaY || 0);
  if (wd >= 120 && wd % 120 === 0) return sign * VR_WHEEL.NOTCH * Math.min(wd / 120, 3);
  // A trackpad or a free-spinning wheel: in proportion to the distance.
  return Math.max(-2, Math.min(2, -dy * VR_WHEEL.SWIPE));
}

L.Map.mergeOptions({ smoothWheel: false });

L.Map.SmoothWheel = L.Handler.extend({
  addHooks() {
    L.DomEvent.on(this._map._container, 'wheel', this._onWheel, this);
    this._map.on('dragstart', this._stopGlide, this);
  },
  removeHooks() {
    L.DomEvent.off(this._map._container, 'wheel', this._onWheel, this);
    this._map.off('dragstart', this._stopGlide, this);
    this._stopGlide();
  },

  _onWheel(e) {
    L.DomEvent.stop(e);
    const map = this._map;
    const levels = vrWheelLevels(e);
    vrWheelSample(e, levels);
    if (!levels) return;
    const start = !this._gliding;
    const zoom = map.getZoom();
    this._target = Math.max(map.getMinZoom(), Math.min(map.getMaxZoom(), (start ? zoom : this._target) + levels));
    // The point under the cursor stays where it is.
    this._mouse = map.mouseEventToContainerPoint(e);
    this._anchor = map.containerPointToLatLng(this._mouse);
    this._lastInput = performance.now();
    if (start) {
      if (map._animatingZoom) return; // a button zoom is landing; the next notch starts the glide
      map._stop();
      this._gliding = true;
      map._wheelZooming = true;
      L.DomUtil.addClass(map._container, 'vr-wheel');
      this._tilesAt = performance.now();
      this._frameAt = performance.now();
      map._moveStart(true, false);
      this._raf = requestAnimationFrame(() => this._frame());
    }
  },

  _frame() {
    const map = this._map;
    if (!this._gliding) return;
    const now = performance.now();
    const dt = Math.min(100, now - this._frameAt);
    this._frameAt = now;
    const z0 = map.getZoom();
    const k = 1 - Math.exp(-dt / VR_WHEEL.TAU);
    let z = z0 + (this._target - z0) * k;
    const done = Math.abs(this._target - z) < 0.004;
    if (done) z = this._target;
    // Keep the anchor under the cursor: centre = anchor projected at the new zoom, minus the cursor offset.
    const offset = this._mouse.subtract(map.getSize().divideBy(2));
    const center = map.unproject(map.project(this._anchor, z).subtract(offset), z);
    const tiles = done || now - this._tilesAt > VR_WHEEL.TILES_MS;
    if (tiles) this._tilesAt = now;
    map._move(center, z, { pinch: !tiles });
    if (done && now - this._lastInput > 60) { this._end(); return; }
    this._raf = requestAnimationFrame(() => this._frame());
  },

  _end() {
    const map = this._map;
    cancelAnimationFrame(this._raf);
    if (!this._gliding) return;
    this._gliding = false;
    map._wheelZooming = false;
    L.DomUtil.removeClass(map._container, 'vr-wheel');
    map._moveEnd(true);
  },

  _stopGlide() { this._end(); },
});
L.Map.addInitHook('addHandler', 'smoothWheel', L.Map.SmoothWheel);

// A few wheel events per start in the log, so the behaviour of a mouse on another computer can be checked.
let vrWheelLogged = 0;
function vrWheelSample(e, levels) {
  if (vrWheelLogged >= 12) return;
  vrWheelLogged += 1;
  plog('info', 'wielzoom', `deltaY ${+e.deltaY.toFixed(4)} mode ${e.deltaMode} wheelDeltaY ${e.wheelDeltaY} ctrl ${e.ctrlKey ? 1 : 0} -> ${levels.toFixed(3)} niveau`);
}
