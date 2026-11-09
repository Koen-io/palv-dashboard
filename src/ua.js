// The names this dashboard goes by on the internet, in one place.
//
// Nothing that goes out may tell who is asking: no name of the dashboard, the unit or the police, no
// version and no address of the code. Two names only:
// - APP: for the open data services (maps, weather, search, platforms, photos). A plain, common name
//   that many map programs use, so the services can tell it is a program and not a person (Overpass and
//   Wikimedia refuse programs that pretend to be a browser), without it pointing at anyone.
// - BROWSER: for the few sources that are web pages meant for a browser (ADS-B Exchange, the icons of
//   app tiles) and for the embedded web pages; the same as an ordinary Chrome on Windows.
// The window itself (Chromium) also leaves the dashboard's name out: see main.js (userAgentFallback).
const APP = 'MapViewer/1.0';
const BROWSER = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';

module.exports = { APP, BROWSER };
