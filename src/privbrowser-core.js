'use strict';

/* ============================================================
   De rekenkant van het tabblad Browser, zonder Electron of DOM, zodat het in Node te toetsen is
   (`node --test`): wat er in de adresbalk is getypt, de maat van het beeld (letterboxing), welke
   adressen nooit mogen, het opwaarderen naar https en de instellingen en meldingen van Tor.
   Gebruikt door src/main/privbrowser.js en src/main/tor.js en, via een script-tag, door het tabblad zelf.
   ============================================================ */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.PRIV_CORE = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  // Search engines without an account, without tracking and reachable over Tor. DuckDuckGo first: it
  // works best over Tor and also has an .onion address.
  const ENGINES = {
    ddg: { name: 'DuckDuckGo', url: 'https://duckduckgo.com/?q=%s', home: 'https://duckduckgo.com/' },
    startpage: { name: 'Startpage', url: 'https://www.startpage.com/do/search?q=%s', home: 'https://www.startpage.com/' },
    brave: { name: 'Brave Search', url: 'https://search.brave.com/search?q=%s', home: 'https://search.brave.com/' },
    mojeek: { name: 'Mojeek', url: 'https://www.mojeek.com/search?q=%s', home: 'https://www.mojeek.com/' },
  };

  // What was typed in the address bar: an address (with or without https://) or something to search for.
  // Only http and https; javascript:, file:, data: and the like are searched for as text.
  function toUrl(input, engine) {
    const text = String(input || '').trim();
    const search = () => (ENGINES[engine] || ENGINES.ddg).url.replace('%s', encodeURIComponent(text));
    if (!text) return null;
    if (/^https?:\/\//i.test(text)) {
      try { return new URL(text).toString(); } catch { return search(); }
    }
    if (/\s/.test(text) || /^[a-z][a-z0-9+.-]*:(?!\d)/i.test(text)) return search();
    // A host with a dot (example.nl, sub.example.co.uk/path) or an .onion address: as an address.
    const m = /^([a-z0-9-]+(\.[a-z0-9-]+)+)(:\d{1,5})?(\/.*)?$/i.exec(text);
    if (m && /[a-z]{2,}$/i.test(m[1]) && !/^\d+(\.\d+)+$/.test(m[1])) {
      try { return new URL('https://' + text).toString(); } catch { return search(); }
    }
    return search();
  }

  // Letterboxing as in Tor Browser and Mullvad Browser: the page gets a viewport rounded down to steps
  // of 200 by 100 pixels, so the size of the screen and window does not single anyone out. The rest is
  // a quiet margin around the page.
  function letterbox(width, height, on = true) {
    const w = Math.max(0, Math.floor(width)), hgt = Math.max(0, Math.floor(height));
    if (!on) return { w, h: hgt };
    const step = (v, s, min) => (v < min ? v : Math.max(min, Math.floor(v / s) * s));
    return { w: step(w, 200, 400), h: step(hgt, 100, 300) };
  }

  // Addresses the browser never opens: this computer and the networks of the building. A page on the
  // internet could otherwise reach the dashboards themselves (port 47800/47801) or other equipment.
  function isLocalHost(host) {
    const hst = String(host || '').toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
    if (!hst) return true;
    if (hst === 'localhost' || hst.endsWith('.localhost') || hst.endsWith('.local') || hst.endsWith('.internal') || hst.endsWith('.lan') || hst.endsWith('.home.arpa')) return true;
    const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(hst);
    if (v4) {
      const [a, b] = [+v4[1], +v4[2]];
      return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || a >= 224;
    }
    if (hst.includes(':')) {
      return hst === '::' || hst === '::1' || /^f[cd]/.test(hst) || /^fe[89ab]/.test(hst) || /^::ffff:/.test(hst);
    }
    // A bare name without a dot is a name on the local network.
    return !hst.includes('.');
  }

  // Plain http is fetched as https (HTTPS-Only, as in Mullvad Browser), except .onion addresses (Tor
  // encrypts those itself) and sites for which http was explicitly allowed this session.
  function httpsUpgrade(url, allowed) {
    let u;
    try { u = new URL(url); } catch { return null; }
    if (u.protocol !== 'http:' || u.hostname.endsWith('.onion')) return null;
    if (allowed && allowed.has(u.hostname)) return null;
    u.protocol = 'https:';
    if (u.port === '80') u.port = '';
    return u.toString();
  }

  // A number from a text, the same every time: the seed for the noise of a site within one session.
  function hash32(text) {
    let h = 2166136261 >>> 0;
    for (let i = 0; i < text.length; i += 1) { h ^= text.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
    return h >>> 0;
  }

  /* ---------- Tor ---------- */
  // The torrc of the dashboard's own Tor: a client only, on ports of its own choosing, controlled by the
  // dashboard, with bridges when the network blocks Tor. `pt` is the pt_config.json of the bundle.
  function torrc({ dataDir, geoip, geoip6, ctlFile, cookieFile, bridges, lyrebird, pt }) {
    const lines = [
      `DataDirectory ${dataDir}`,
      `GeoIPFile ${geoip}`,
      `GeoIPv6File ${geoip6}`,
      'SocksPort 127.0.0.1:auto',
      'ControlPort 127.0.0.1:auto',
      `ControlPortWriteToFile ${ctlFile}`,
      'CookieAuthentication 1',
      `CookieAuthFile ${cookieFile}`,
      'ClientOnly 1',
      'AvoidDiskWrites 1',
      'Log notice stdout',
    ];
    const kind = { obfs4: 'obfs4', snowflake: 'snowflake', meek: 'meek' }[bridges];
    const list = kind && pt && pt.bridges ? pt.bridges[kind] || [] : [];
    if (list.length) {
      lines.push('UseBridges 1');
      lines.push(kind === 'snowflake' ? `ClientTransportPlugin snowflake exec ${lyrebird}` : `ClientTransportPlugin meek_lite,obfs4 exec ${lyrebird}`);
      for (const b of list) lines.push(`Bridge ${b}`);
    }
    return lines.join('\n') + '\n';
  }

  // One line of Tor's log: how far it is, its SOCKS port, or a warning.
  function torLine(line) {
    let m = /Bootstrapped (\d+)% \(([^)]+)\): (.*)$/.exec(line);
    if (m) return { progress: +m[1], tag: m[2], summary: m[3].trim() };
    m = /Socks listener listening on port (\d+)\./.exec(line);
    if (m) return { socksPort: +m[1] };
    m = /\[(warn|err)\] (.*)$/.exec(line);
    if (m) return { warn: m[2].trim(), level: m[1] };
    return null;
  }

  return { ENGINES, toUrl, letterbox, isLocalHost, httpsUpgrade, hash32, torrc, torLine };
});
