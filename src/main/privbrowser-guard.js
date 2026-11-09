'use strict';

/* ============================================================
   Bescherming tegen vingerafdrukken voor het tabblad Browser, in elk frame van elke pagina, vóór de
   eigen scripts van de site (preload van de browsersessie, src/main/privbrowser.js).

   Zoals Brave: wat een site kan meten om dit scherm te herkennen geeft óf een gewone, vaste waarde
   (processorkernen, geheugen, taal, scherm, videokaart, stemmen, batterij), óf een heel klein beetje
   ruis (canvas, WebGL-pixels, audio). De ruis hangt af van de sessie en de site: binnen een site blijft
   alles gelijk, een andere site of een nieuwe identiteit ziet een ander toestel. De tijdzone (UTC) en de
   landinstelling (en-US) zet src/main/privbrowser.js via Chromium zelf. Uit met het schild van de site.
   ============================================================ */
const { contextBridge, ipcRenderer } = require('electron');

let cfg = null;
try {
  const ancestors = location.ancestorOrigins ? [...location.ancestorOrigins] : [];
  const top = ancestors.length ? ancestors[ancestors.length - 1] : location.origin;
  cfg = ipcRenderer.sendSync('palv-priv:guard', top, location.href);
} catch { /* no answer: the page runs without, as with the shield off */ }

function guard(c) {
  const rnd = (seed) => () => {
    seed = (seed + 0x6d2b79f5) >>> 0;
    let t = seed;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const SEED = c.seed >>> 0;
  const done = new WeakSet();
  // Every replacement points back to the browser's own function, so toString shows the real name
  // ("function toDataURL() { [native code] }") and nothing gives the replacement away.
  const real = new WeakMap();

  const apply = (win) => {
    if (!win || done.has(win)) return;
    done.add(win);
    let W;
    try { W = win; void W.Navigator; } catch { return; }
    const Px = W.Proxy, Reflect = W.Reflect;
    const P = function (target, handler) { const p = new Px(target, handler); real.set(p, real.get(target) || target); return p; };
    const FP = W.Function.prototype;
    const toStr = FP.toString;
    Object.defineProperty(FP, 'toString', { ...Object.getOwnPropertyDescriptor(FP, 'toString'), value: P(toStr, { apply: (t, self, args) => Reflect.apply(t, real.get(self) || self, args) }) });
    // A replacement that still looks like the browser's own function (toString, name, length).
    const wrap = (obj, name, make) => {
      const d = obj && Object.getOwnPropertyDescriptor(obj, name);
      if (!d || typeof d.value !== 'function') return;
      const orig = d.value;
      d.value = P(orig, { apply: (t, self, args) => make(orig, self, args) });
      Object.defineProperty(obj, name, d);
    };
    const getter = (obj, name, value) => {
      const d = obj && Object.getOwnPropertyDescriptor(obj, name);
      if (!d || !d.get) return;
      d.get = P(d.get, { apply: (t, self, args) => (typeof value === 'function' ? value(Reflect.apply(t, self, args), self) : value) });
      Object.defineProperty(obj, name, d);
    };

    /* ---------- the device: common, fixed values ---------- */
    const N = W.Navigator && W.Navigator.prototype;
    getter(N, 'hardwareConcurrency', 4);
    getter(N, 'deviceMemory', 8);
    getter(N, 'language', 'en-US');
    getter(N, 'languages', () => W.Object.freeze(['en-US', 'en']));
    getter(N, 'maxTouchPoints', 0);
    // WebGPU stays off, as in Mullvad Browser (not yet audited, and a strong fingerprint).
    if (N && 'gpu' in N) { try { delete N.gpu; } catch { /* stays */ } }
    if (N) wrap(N, 'getBattery', () => W.Promise.resolve(W.Object.freeze({ charging: true, chargingTime: 0, dischargingTime: Infinity, level: 1, addEventListener() {}, removeEventListener() {}, onchargingchange: null, onlevelchange: null, onchargingtimechange: null, ondischargingtimechange: null })));
    const NI = W.NetworkInformation && W.NetworkInformation.prototype;
    getter(NI, 'rtt', 100);
    getter(NI, 'downlink', 10);
    getter(NI, 'effectiveType', '4g');
    getter(NI, 'saveData', false);
    const MD = W.MediaDevices && W.MediaDevices.prototype;
    wrap(MD, 'enumerateDevices', () => W.Promise.resolve([]));
    // The installed voices tell the language packs of Windows.
    const SS = W.SpeechSynthesis && W.SpeechSynthesis.prototype;
    wrap(SS, 'getVoices', () => []);
    // The keyboard layout (azerty, qwerty, …).
    const KB = W.Keyboard && W.Keyboard.prototype;
    wrap(KB, 'getLayoutMap', () => W.Promise.reject(new W.DOMException('Not allowed', 'NotAllowedError')));
    // The detailed browser data (client hints): only what every Chrome on Windows says.
    const UAD = W.NavigatorUAData && W.NavigatorUAData.prototype;
    wrap(UAD, 'getHighEntropyValues', (orig, self, args) => Reflect.apply(orig, self, args).then((v) => {
      const out = { ...v };
      if ('platformVersion' in out) out.platformVersion = '10.0.0';
      if ('architecture' in out) out.architecture = 'x86';
      if ('bitness' in out) out.bitness = '64';
      if ('model' in out) out.model = '';
      if ('wow64' in out) out.wow64 = false;
      if (Array.isArray(out.fullVersionList)) out.fullVersionList = out.fullVersionList.map((b) => ({ brand: b.brand, version: String(b.version).split('.')[0] + '.0.0.0' }));
      if ('uaFullVersion' in out) out.uaFullVersion = String(out.uaFullVersion).split('.')[0] + '.0.0.0';
      return out;
    }));
    // The heap limit of Chrome tells the size of the memory.
    const PF = W.Performance && W.Performance.prototype;
    getter(PF, 'memory', () => W.Object.freeze({ jsHeapSizeLimit: 4294705152, totalJSHeapSize: 20000000, usedJSHeapSize: 15000000 }));

    /* ---------- the screen: the most common one, the window is the page ---------- */
    const S = W.Screen && W.Screen.prototype;
    getter(S, 'width', 1920);
    getter(S, 'height', 1080);
    getter(S, 'availWidth', 1920);
    getter(S, 'availHeight', 1032);
    getter(S, 'availLeft', 0);
    getter(S, 'availTop', 0);
    getter(S, 'colorDepth', 24);
    getter(S, 'pixelDepth', 24);
    const WP = W.Window && W.Window.prototype;
    for (const [obj, k] of [[W, 'outerWidth'], [W, 'outerHeight'], [W, 'screenX'], [W, 'screenY'], [W, 'screenLeft'], [W, 'screenTop']]) {
      const d = Object.getOwnPropertyDescriptor(obj, k) || (WP && Object.getOwnPropertyDescriptor(WP, k));
      if (!d || !d.get) continue;
      const v = k === 'outerWidth' ? () => W.innerWidth : k === 'outerHeight' ? () => W.innerHeight : () => 0;
      Object.defineProperty(obj, k, { ...d, get: P(d.get, { apply: v }) });
    }

    /* ---------- canvas, WebGL and audio: a little noise per site ---------- */
    const SMALL = 1000 * 1000; // fingerprints use small canvases; maps, games and video stay untouched and fast
    const farble = (data, w, h) => {
      const n = (w * h) | 0;
      if (!data || !n || n > SMALL) return;
      const r = rnd(SEED ^ Math.imul(w, 73856093) ^ Math.imul(h, 19349663));
      for (let p = Math.floor(r() * 23); p < n; p += 11 + Math.floor(r() * 37)) {
        const i = p * 4 + Math.floor(r() * 3);
        data[i] = data[i] ^ 1;
      }
    };
    const C2D = W.CanvasRenderingContext2D && W.CanvasRenderingContext2D.prototype;
    const getImageData = C2D && C2D.getImageData;
    wrap(C2D, 'getImageData', (orig, self, args) => { const img = Reflect.apply(orig, self, args); farble(img.data, img.width, img.height); return img; });
    const OC2D = W.OffscreenCanvasRenderingContext2D && W.OffscreenCanvasRenderingContext2D.prototype;
    wrap(OC2D, 'getImageData', (orig, self, args) => { const img = Reflect.apply(orig, self, args); farble(img.data, img.width, img.height); return img; });
    // Exporting a canvas: a noisy copy is exported, the canvas on the page stays as it is.
    const noisyCopy = (canvas) => {
      const w = canvas.width, h = canvas.height;
      if (!w || !h || w * h > SMALL) return null;
      try {
        const copy = W.document.createElement('canvas');
        copy.width = w; copy.height = h;
        const ctx = copy.getContext('2d');
        ctx.drawImage(canvas, 0, 0);
        const img = Reflect.apply(getImageData, ctx, [0, 0, w, h]);
        farble(img.data, w, h);
        ctx.putImageData(img, 0, 0);
        return copy;
      } catch { return null; }
    };
    const HC = W.HTMLCanvasElement && W.HTMLCanvasElement.prototype;
    wrap(HC, 'toDataURL', (orig, self, args) => Reflect.apply(orig, noisyCopy(self) || self, args));
    wrap(HC, 'toBlob', (orig, self, args) => Reflect.apply(orig, noisyCopy(self) || self, args));
    for (const GL of [W.WebGLRenderingContext, W.WebGL2RenderingContext]) {
      const G = GL && GL.prototype;
      if (!G) continue;
      wrap(G, 'getParameter', (orig, self, args) => {
        if (args[0] === 37445) return 'Google Inc. (Intel)';
        if (args[0] === 37446) return 'ANGLE (Intel, Intel(R) UHD Graphics (0x00009BC4) Direct3D11 vs_5_0 ps_5_0, D3D11)';
        return Reflect.apply(orig, self, args);
      });
      wrap(G, 'readPixels', (orig, self, args) => {
        const out = Reflect.apply(orig, self, args);
        const px = args[6];
        if (px && px.BYTES_PER_ELEMENT === 1 && args[2] > 0 && args[3] > 0) farble(px, args[2], args[3]);
        return out;
      });
    }
    const AB = W.AudioBuffer && W.AudioBuffer.prototype;
    const seen = new W.WeakSet();
    const noiseAudio = (d) => {
      if (!d || seen.has(d)) return;
      seen.add(d);
      const r = rnd(SEED ^ d.length);
      for (let i = Math.floor(r() * 97); i < d.length; i += 50 + Math.floor(r() * 100)) d[i] += (r() - 0.5) * 2e-7;
    };
    wrap(AB, 'getChannelData', (orig, self, args) => { const d = Reflect.apply(orig, self, args); noiseAudio(d); return d; });
    wrap(AB, 'copyFromChannel', (orig, self, args) => { const out = Reflect.apply(orig, self, args); const r = rnd(SEED ^ 0x5bd1e995); const d = args[0]; if (d && d.length) for (let i = 0; i < d.length; i += 64) d[i] += (r() - 0.5) * 2e-7; return out; });
    const AN = W.AnalyserNode && W.AnalyserNode.prototype;
    wrap(AN, 'getFloatFrequencyData', (orig, self, args) => { const out = Reflect.apply(orig, self, args); const d = args[0]; const r = rnd(SEED ^ 0x27d4eb2d); if (d) for (let i = 0; i < d.length; i += 1) d[i] += (r() - 0.5) * 1e-4; return out; });

    /* ---------- cookies of other sites in a frame ---------- */
    if (c.thirdParty) {
      const D = W.Document && W.Document.prototype;
      const d = D && Object.getOwnPropertyDescriptor(D, 'cookie');
      if (d) Object.defineProperty(D, 'cookie', { ...d, get: P(d.get, { apply: () => '' }), set: P(d.set, { apply: () => undefined }) });
    }

    /* ---------- frames made by the page itself (about:blank) get the same ---------- */
    const IF = W.HTMLIFrameElement && W.HTMLIFrameElement.prototype;
    for (const k of ['contentWindow', 'contentDocument']) {
      getter(IF, k, (v, self) => {
        try {
          const cw = k === 'contentWindow' ? v : v && v.defaultView;
          if (cw) apply(cw);
        } catch { /* another site: its own preload */ }
        void self;
        return v;
      });
    }
  };
  apply(window);
}

if (cfg && cfg.on) {
  try { contextBridge.executeInMainWorld({ func: guard, args: [cfg] }); } catch { /* an old Electron: without */ }
}
