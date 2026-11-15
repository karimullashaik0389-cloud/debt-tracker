/* The ONE module that talks to the backend. POST, text/plain (no CORS preflight), JSON body {action, token, ...}.
 * Only the session token is kept on the phone: localStorage when "Remember this device" is ticked (30 days),
 * otherwise sessionStorage (gone when the browser closes). No money data is stored or cached on the phone. */
(function () {
  var KEY = 'dt_token', onAuthLost = function () {};
  function store(kind) { try { return kind === 'local' ? localStorage : sessionStorage; } catch (e) { return null; } }
  function getToken() {
    var l = store('local'), s = store('session');
    return (l && l.getItem(KEY)) || (s && s.getItem(KEY)) || '';
  }
  function setToken(t, remember) {
    var l = store('local'), s = store('session');
    try { l && l.removeItem(KEY); s && s.removeItem(KEY); if (t) (remember ? l : s).setItem(KEY, t); } catch (e) {}
  }
  function ApiError(code, message, extra) { var e = new Error(message || code); e.code = code; e.extra = extra || {}; return e; }
  function call(action, params, opts) {
    opts = opts || {};
    if (!window.DT_CONFIG.API_URL) return Promise.reject(ApiError('not_ready', "The app isn't connected yet."));
    if (!navigator.onLine) return Promise.reject(ApiError('offline', "You're offline. Connect to the internet and try again."));
    var body = Object.assign({ action: action, token: getToken() }, params || {});
    var ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var timer = ctrl ? setTimeout(function () { ctrl.abort(); }, opts.timeout || 60000) : null;
    return fetch(window.DT_CONFIG.API_URL, {
      method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(body),
      redirect: 'follow', cache: 'no-store', credentials: 'omit', signal: ctrl ? ctrl.signal : undefined
    }).then(function (r) {
      if (!r.ok) throw ApiError('http', 'Server error (' + r.status + '). Please try again.');
      return r.json();
    }, function () {
      throw ApiError(navigator.onLine ? 'network' : 'offline', navigator.onLine ? 'Could not reach the server. Please try again.' : "You're offline. Connect and try again.");
    }).then(function (res) {
      if (timer) clearTimeout(timer);
      if (!res || res.ok !== true) {
        if (res && res.error === 'auth') { setToken(''); onAuthLost(res.message); }
        throw ApiError((res && res.error) || 'unknown', (res && res.message) || 'Something went wrong', res);
      }
      return res;
    }, function (e) { if (timer) clearTimeout(timer); throw e; });
  }
  window.DTApi = {
    hasToken: function () { return !!getToken(); },
    onAuthLost: function (fn) { onAuthLost = fn; },
    who: function () { return call('who'); },
    login: function (user, pin, remember) {
      return call('login', { user: user, pin: pin, remember: !!remember }).then(function (r) { setToken(r.token, remember); return r; });
    },
    logout: function () { var p = call('logout').catch(function () {}); setToken(''); return p; },
    changePin: function (oldPin, newPin) { return call('changePin', { oldPin: oldPin, newPin: newPin }); },
    data: function () { return call('data'); },
    addPayment: function (p, proof) { return call('addPayment', { payment: p, proof: proof || null }, { timeout: 120000 }); },
    updatePayment: function (id, p, proof, removeProof) { return call('updatePayment', { id: id, payment: p, proof: proof || null, removeProof: !!removeProof }, { timeout: 120000 }); },
    deletePayment: function (id) { return call('deletePayment', { id: id }); },
    getProof: function (id, kind) { return call('getProof', { id: id, kind: kind || 'payment' }, { timeout: 90000 }); },
    addSpend: function (s) { return call('addSpend', { spend: s }); },
    updateSpend: function (id, s) { return call('updateSpend', { id: id, spend: s }); },
    deleteSpend: function (id) { return call('deleteSpend', { id: id }); },
    addLedger: function (kind, e, proof) { return call('addLedger', { kind: kind, entry: e, proof: proof || null }, { timeout: 120000 }); },
    updateLedger: function (kind, id, e, proof, removeProof) { return call('updateLedger', { kind: kind, id: id, entry: e, proof: proof || null, removeProof: !!removeProof }, { timeout: 120000 }); },
    deleteLedger: function (kind, id) { return call('deleteLedger', { kind: kind, id: id }); },
    markOutgoing: function (id, paid, e, proof) { return call('markOutgoing', { id: id, paid: !!paid, entry: e || {}, proof: proof || null }, { timeout: 120000 }); },
    saveDebt: function (id, d) { return call('saveDebt', { id: id || '', debt: d }); },
    saveSettings: function (s) { return call('saveSettings', { settings: s }); },
    addUser: function (name, pin) { return call('addUser', { name: name, pin: pin }); },
    revokeUser: function (name) { return call('revokeUser', { name: name }); }
  };
})();
