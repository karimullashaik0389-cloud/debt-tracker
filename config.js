// Where the app sends its requests.
//  - On the box (local tests): "/api"
//  - Live: the private Apps Script web-app URL (deployed 15 Nov 2026)
(function () {
  var LIVE = 'https://script.google.com/macros/s/AKfycbzjktZpaFR7DjtBYSq3ccnVGv0qAHAD23LOJN-77cJyuqxRaLIUW3jy_xXsshngCrYu/exec';
  var host = (typeof location !== 'undefined' && location.hostname) || '';
  var local = host === 'localhost' || host === '127.0.0.1';
  window.DT_CONFIG = { API_URL: local ? '/api' : LIVE };
})();
