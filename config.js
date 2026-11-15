// Where the app sends its requests.
//  - On the box (local tests): "/api"
//  - Live: the private Apps Script web-app URL (empty until the backend is deployed)
(function () {
  var LIVE = '';
  var host = (typeof location !== 'undefined' && location.hostname) || '';
  var local = host === 'localhost' || host === '127.0.0.1';
  window.DT_CONFIG = { API_URL: local ? '/api' : LIVE };
})();
