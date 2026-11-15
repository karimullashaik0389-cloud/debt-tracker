/* Debt Tracker – personal debts, spending limit, payoff plan, and the business ledgers (rent, interest, business loan,
 * profit, salaries). All maths runs on the phone from the live data; nothing is cached on the device. */
(function () {
  'use strict';
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var API = window.DTApi;
  var D = null, view = 'home', debtsTab = 'list', logTab = 'spending', planAmt = null, planOrder = null;
  var pinUser = '', pin = '', lastPin = '';
  var MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function r2(n) { return Math.round(n * 100) / 100; }
  function gbp(n, whole) {
    n = r2(Number(n) || 0);
    var pence = !whole && Math.abs(n % 1) > 0.004;
    return (n < 0 ? '−£' : '£') + Math.abs(n).toLocaleString('en-GB', { minimumFractionDigits: pence ? 2 : 0, maximumFractionDigits: pence ? 2 : 0 });
  }
  function monthLabel(ym) { return MON[Number(ym.slice(5, 7)) - 1] + ' ' + ym.slice(0, 4); }
  function addMonths(ym, k) { var y = Number(ym.slice(0, 4)), m = Number(ym.slice(5, 7)) - 1 + k; y += Math.floor(m / 12); m = ((m % 12) + 12) % 12; return y + '-' + ('0' + (m + 1)).slice(-2); }
  function niceDate(d) { if (!d) return ''; var p = d.split('-'); return Number(p[2]) + ' ' + MON[Number(p[1]) - 1] + ' ' + p[0]; }
  function niceWhen(w) { if (!w) return ''; return niceDate(w.slice(0, 10)) + (w.length > 10 ? ', ' + w.slice(11, 16) : ''); }
  function ukNow() {
    var p = {}; new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
      .formatToParts(new Date()).forEach(function (x) { p[x.type] = x.value; });
    return p.year + '-' + p.month + '-' + p.day + ' ' + p.hour + ':' + p.minute;
  }
  function sum(a, f) { return a.reduce(function (t, x) { return t + (f ? f(x) : x); }, 0); }
  function toast(msg, bad) { var t = $('#toast'); t.textContent = msg; t.className = 'toast' + (bad ? ' bad' : ''); t.hidden = false; clearTimeout(toast._t); toast._t = setTimeout(function () { t.hidden = true; }, 2600); }
  function busy(on, txt) { $('#busy').hidden = !on; if (txt) $('#busy-text').textContent = txt; }
  function confirmBox(title, text, okLabel, danger) {
    return new Promise(function (res) {
      $('#dialog-title').textContent = title; $('#dialog-text').textContent = text;
      var ok = $('#dialog-ok'); ok.textContent = okLabel || 'OK'; ok.className = 'btn ' + (danger === false ? 'btn-ice' : 'btn-danger');
      $('#dialog').hidden = false;
      function done(v) { $('#dialog').hidden = true; ok.onclick = null; $('#dialog-cancel').onclick = null; res(v); }
      ok.onclick = function () { done(true); }; $('#dialog-cancel').onclick = function () { done(false); };
    });
  }
  function shareWord(r) { return Math.abs(r - 2 / 3) < 0.001 ? 'two-thirds' : Math.abs(r - 1 / 3) < 0.001 ? 'one-third' : Math.abs(r - 0.5) < 0.001 ? 'half' : Math.round(r * 100) + '%'; }
  function mini(k, v, sub) { return '<div class="mini"><div class="k">' + esc(k) + '</div><div class="v">' + v + '</div>' + (sub ? '<div class="k">' + esc(sub) + '</div>' : '') + '</div>'; }
  /* ---------- the maths ---------- */
  function calc() {
    var st = D.settings, now = D.nowUk || ukNow(), today = now.slice(0, 10), ym = today.slice(0, 7);
    var units = st.partners, sp = st.splits;
    var debts = D.debts.map(function (d) {
      var paid = r2(sum(D.payments.filter(function (p) { return p.debtId === d.id; }), function (p) { return p.amount; }));
      var left = r2(Math.max(0, d.owed - paid));
      return { id: d.id, name: d.name, kind: d.kind, owed: d.owed, order: d.order, paid: paid, left: left,
        status: left <= 0.005 ? 'Paid' : paid > 0 ? 'Part-paid' : 'Not paid' };
    });
    var total = sum(debts, function (d) { return d.owed; }), paid = sum(debts, function (d) { return Math.min(d.paid, d.owed); }), left = sum(debts, function (d) { return d.left; });
    var monthSpend = D.spending.filter(function (s) { return s.when.slice(0, 7) === ym; });
    var spent = r2(sum(monthSpend, function (s) { return s.amount; }));
    var debtPaidMonth = r2(sum(D.payments.filter(function (p) { return p.date.slice(0, 7) === ym; }), function (p) { return p.amount; }));
    var limit = st.spendLimit, debtShare = r2(st.cushion - limit), weekly = r2(limit * 12 / 52);
    var dt = new Date(today + 'T12:00:00Z'), dow = (dt.getUTCDay() + 6) % 7, mon = new Date(dt.getTime() - dow * 86400000);
    var weekStart = mon.toISOString().slice(0, 10);
    var weekSpent = r2(sum(D.spending.filter(function (s) { return s.when.slice(0, 10) >= weekStart && s.when.slice(0, 10) <= today; }), function (s) { return s.amount; }));
    var daysInMonth = new Date(Date.UTC(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)), 0)).getUTCDate();
    var c = { st: st, now: now, today: today, ym: ym, debts: debts, total: total, paid: paid, left: left, spent: spent, debtPaidMonth: debtPaidMonth,
      cushionLeft: r2(st.cushion - spent - debtPaidMonth), limit: limit, debtShare: debtShare, weekly: weekly, weekSpent: weekSpent, weekStart: weekStart,
      daysLeft: daysInMonth - Number(today.slice(8, 10)), monthSpend: monthSpend, units: units, sp: sp };
    c.pct = limit > 0 ? spent / limit : (spent > 0 ? 9 : 0);
    c.plan = plan(debts, planAmt || debtShare, planOrder || st.order, ym);
    c.basePlan = plan(debts, debtShare, st.order, ym);
    var U0 = units[0], U1 = units[1];
    function tally(list, ratio) {
      var o = {}; o[U0] = 0; o[U1] = 0;
      list.forEach(function (e) { if (e.paidBy === U0) o[U0] += e.amount; else if (e.paidBy === U1) o[U1] += e.amount; else { o[U0] += e.amount * ratio; o[U1] += e.amount * (1 - ratio); } });
      return o;
    }
    var outs = D.outgoings || [];
    var rentDue = sum(outs.filter(function (o) { return o.type === 'Rent' && o.month <= ym; }), function (o) { return o.amount; });
    var intDue = sum(outs.filter(function (o) { return o.type === 'Interest' && o.month <= ym; }), function (o) { return o.amount; });
    var unpaid = outs.filter(function (o) { return o.status === 'Unpaid'; }).sort(function (a, b) { return a.month === b.month ? (a.type < b.type ? 1 : -1) : (a.month < b.month ? -1 : 1); });
    c.biz = { U0: U0, U1: U1, outs: outs, unpaid: unpaid, unpaidTotal: sum(unpaid, function (o) { return o.amount; }),
      unpaidShare0: sum(unpaid, function (o) { return o.amount * (o.type === 'Rent' ? sp.rent : sp.interest); }),
      rentDue: rentDue, intDue: intDue, rentPaid: tally(D.rent, sp.rent),
      intPaid: tally(outs.filter(function (o) { return o.type === 'Interest' && o.status === 'Paid'; }), sp.interest),
      loanPaid: tally(D.loan, sp.loan), monthlyInterest: r2(st.loanTotal * st.interestRate / 100 / 12),
      rentTotalPaid: sum(D.rent, function (e) { return e.amount; }), rentCount: D.rent.length,
      loanRepaid: sum(D.loan, function (e) { return e.amount; }), profitTotal: sum(D.profit, function (e) { return e.amount; }),
      salaryBy: (D.lists.salaryPeople || []).map(function (n) { var l = D.salaries.filter(function (s) { return s.receivedBy === n; }); return { name: n, total: sum(l, function (s) { return s.amount; }), count: l.length }; }),
      thisMonth: outs.filter(function (o) { return o.month === ym; }) };
    return c;
  }
  function orderDebts(debts, order) {
    return debts.filter(function (d) { return d.left > 0.005; }).sort(function (a, b) {
      if (order === 'cards') { var ga = a.kind === 'Personal loan' ? 1 : 0, gb = b.kind === 'Personal loan' ? 1 : 0; if (ga !== gb) return ga - gb; }
      return a.left - b.left || a.order - b.order;
    });
  }
  /* Month-by-month plan starting next month: the monthly amount goes to the debts in order until each is cleared. */
  function plan(debts, monthly, order, ym) {
    var ordered = orderDebts(debts, order), bal = ordered.map(function (d) { return d.left; }), clear = ordered.map(function () { return ''; }), months = [];
    var m = 0, start = addMonths(ym, 1);
    while (monthly > 0 && bal.some(function (b) { return b > 0.005; }) && m < 120) {
      var pot = monthly, pays = ordered.map(function () { return 0; });
      for (var i = 0; i < bal.length && pot > 0.005; i++) {
        if (bal[i] <= 0.005) continue;
        var p = Math.min(pot, bal[i]); bal[i] = r2(bal[i] - p); pot = r2(pot - p); pays[i] = r2(p);
        if (bal[i] <= 0.005) clear[i] = addMonths(start, m);
      }
      months.push({ ym: addMonths(start, m), pays: pays, left: r2(sum(bal)) }); m++;
    }
    return { ordered: ordered, clear: clear, months: months, count: m, end: m ? addMonths(start, m - 1) : '' };
  }
  /* ---------- lock / login ---------- */
  function showLock(msg) {
    $('#app').hidden = true; $('#lock').hidden = false; closeSheet();
    if (!window.DT_CONFIG.API_URL) { $('#lock-notready').hidden = false; $('#lock-users').hidden = true; $('#lock-pin').hidden = true; return; }
    $('#lock-notready').hidden = true; $('#lock-pin').hidden = true; $('#lock-users').hidden = false;
    $('#users-msg').textContent = msg || '';
    var cached = []; try { cached = JSON.parse(localStorage.getItem('dt_people') || '[]'); } catch (e) {}
    drawUsers(cached);
    API.who().then(function (r) { try { localStorage.setItem('dt_people', JSON.stringify(r.users)); } catch (e) {} drawUsers(r.users); })
      .catch(function (e) { if (!cached.length) $('#users-msg').textContent = e.message; });
  }
  function drawUsers(list) {
    $('#user-picks').innerHTML = list.map(function (n) {
      return '<button type="button" class="user-pick" data-user="' + esc(n) + '"><span class="up-av tk">' + esc(n.charAt(0)) + '</span><span>' + esc(n) + '</span></button>';
    }).join('');
    $$('.user-pick').forEach(function (b) { b.onclick = function () { pickUser(b.getAttribute('data-user')); }; });
  }
  function pickUser(u) { pinUser = u; pin = ''; $('#lock-users').hidden = true; $('#lock-pin').hidden = false; $('#pin-ask').textContent = 'Hi ' + u + ', enter your PIN'; $('#lock-msg').textContent = ''; dots(); }
  function dots() { var h = ''; for (var i = 0; i < Math.max(6, pin.length); i++) h += '<i class="' + (i < pin.length ? 'on' : '') + '"></i>'; $('#pin-dots').innerHTML = h; }
  function key(k) {
    if (k === 'del') { pin = pin.slice(0, -1); dots(); return; }
    if (k === 'ok') { if (pin.length >= 4) unlock(); return; }
    if (pin.length >= 8) return;
    pin += k; dots();
  }
  function unlock() {
    var p = pin; $('#k-ok').disabled = true; $('#lock-msg').textContent = 'Checking…';
    API.login(pinUser, p, $('#remember').checked).then(function (r) {
      $('#k-ok').disabled = false; pin = ''; dots(); lastPin = p; $('#lock-msg').textContent = '';
      openApp(!!r.mustChangePin);
    }).catch(function (e) {
      $('#k-ok').disabled = false; pin = ''; dots();
      $('#pin-dots').classList.remove('shake'); void $('#pin-dots').offsetWidth; $('#pin-dots').classList.add('shake');
      $('#lock-msg').textContent = e.code === 'bad_pin' ? 'Wrong PIN. ' + (e.extra.remaining || 0) + ' tries left.' : e.message;
    });
  }
  function openApp(mustChange) {
    $('#lock').hidden = true; $('#app').hidden = false;
    if (mustChange) { changePinSheet(true); return; }
    view = 'home'; load();
  }

  /* ---------- load + render ---------- */
  function load(silent) {
    if (!silent) $('#view-home').innerHTML = '<div class="skeleton"></div><div class="skeleton"></div>';
    return API.data().then(function (r) { D = r; render(); }).catch(function (e) {
      if (e.code === 'must_change_pin') { changePinSheet(true); return; }
      if (e.code !== 'auth') toast(e.message, true);
    });
  }
  function render() {
    if (!D) return;
    var c = calc();
    $$('.view').forEach(function (v) { v.hidden = v.id !== 'view-' + view; });
    $$('.tab[data-view]').forEach(function (t) { t.classList.toggle('active', t.getAttribute('data-view') === view); });
    $('#view-title').textContent = { home: 'Home', debts: 'My debts', biz: 'Business', log: 'Log' }[view];
    if (view === 'home') renderHome(c);
    if (view === 'debts') renderDebts(c);
    if (view === 'biz') renderBiz(c);
    if (view === 'log') renderLog(c);
  }
  function bindGo() { $$('[data-go]').forEach(function (b) { b.onclick = function () { view = b.getAttribute('data-go'); render(); window.scrollTo(0, 0); }; }); }
  /* Spending state: on track below 75%, careful from 75%, "Don't spend" at 100% or more. */
  function spendState(c) {
    if (c.limit >= 0 && c.spent > 0 && c.spent >= c.limit) {
      var over = r2(c.spent - c.limit), wk = c.debtShare > 0 ? Math.max(1, Math.ceil(over / (c.debtShare * 12 / 52))) : 0;
      return { cls: 'red', title: "Don't spend.", text: c.spent > c.limit ? 'Over limit by ' + gbp(over) + '. This delays debt-free by about ' + wk + ' week' + (wk === 1 ? '' : 's') + '.' :
        "You've used the whole " + gbp(c.limit) + ' limit for this month.' };
    }
    if (c.pct >= 0.75) return { cls: 'amber', title: 'Careful with spending.', text: "You've spent " + gbp(c.spent) + ' of ' + gbp(c.limit) + '. Only ' + gbp(c.limit - c.spent) + ' is left this month.' };
    return { cls: 'ok', title: 'Spending is on track.', text: gbp(c.spent) + ' of ' + gbp(c.limit) + ' spent so far this month, so ' + gbp(c.limit - c.spent) + ' is left.' };
  }
  function renderHome(c) {
    var ordered = c.basePlan.ordered, cur = ordered[0], nextD = ordered[1];
    var cleared = c.debts.filter(function (d) { return d.left <= 0.005; }).length;
    var weekPut = cur ? r2(Math.min(cur.left, c.debtShare / 4)) : 0;
    var planPct = c.total > 0 ? Math.round(c.paid / c.total * 100) : 0;
    var ss = spendState(c), b = c.biz, h = '';
    // 1. current payoff step + 4. next action
    h += '<div class="card hero" id="step-card"><div class="hero-label">Your position right now</div>';
    if (cur) h += '<h3 class="step-title">Step ' + (cleared + 1) + ' of ' + c.debts.length + ': clearing ' + esc(cur.name) + '</h3>' +
      '<p class="step-text">' + gbp(cur.left) + ' left on ' + esc(cur.name) + '.' + (nextD ? ' After that comes ' + esc(nextD.name) + '.' : " It's the last one.") + '</p>' +
      '<div class="alert info" id="next-action"><b>Next action</b>Put ' + gbp(weekPut) + ' toward ' + esc(cur.name) + ' this week.' +
      '<button type="button" class="btn btn-ice" id="btn-next-pay">Record a payment to ' + esc(cur.name) + '</button></div>';
    else h += '<h3 class="step-title">All personal debts cleared 🎉</h3>';
    h += '</div>';
    // the three entry buttons
    h += '<div class="entry3"><button type="button" class="btn btn-primary" id="btn-add-spend">＋ Spending</button>' +
      '<button type="button" class="btn" id="btn-add-profit">＋ Profit</button><button type="button" class="btn" id="btn-add-salary">＋ Salary</button></div>';
    // 2. status at a glance
    h += '<div class="grid2 glance" id="glance">' +
      mini('Personal debts left', gbp(c.left, true), 'of ' + gbp(c.total, true)) +
      mini('Business unpaid', gbp(b.unpaidTotal), 'Your ' + shareWord(c.sp.rent) + ': ' + gbp(b.unpaidShare0)) +
      mini('Cushion left this month', gbp(c.cushionLeft), gbp(c.st.cushion) + ' less spending and debt payments') +
      mini('Plan done', planPct + '%', c.basePlan.count ? c.basePlan.count + ' month' + (c.basePlan.count === 1 ? '' : 's') + ' to go, debt-free by ' + monthLabel(c.basePlan.end) : 'Done') + '</div>';
    // 3. spending
    h += '<div class="card" id="spend-card"><div class="card-head"><h3>Spending this month</h3><span class="muted">' + gbp(c.spent) + ' / ' + gbp(c.limit) + '</span></div>' +
      '<div class="bar ' + ss.cls + '"><i style="width:' + Math.min(100, Math.round(c.pct * 100)) + '%"></i></div>' +
      '<div class="pot-line"><span>' + Math.round(c.pct * 100) + '% of the limit</span><span>' + gbp(Math.max(0, c.limit - c.spent)) + ' left</span></div>' +
      '<div class="alert ' + ss.cls + '" id="spend-alert"><b>' + ss.title + '</b>' + esc(ss.text) + '</div>' +
      '<div class="stat-row" style="margin-top:10px"><span>This week (from Mon ' + niceDate(c.weekStart).replace(/ \d{4}$/, '') + ')</span><b>' + gbp(c.weekSpent) + ' of about ' + gbp(c.weekly) + '</b></div>' +
      '<div class="stat-row"><span>Debt payments this month</span><b>' + gbp(c.debtPaidMonth) + '</b></div>' +
      '<div class="stat-row"><span>Monthly split</span><b>' + gbp(c.limit) + ' spending + ' + gbp(c.debtShare) + ' debts</b></div></div>';
    // month end: suggest the unspent limit as an extra debt payment
    var unspent = r2(c.limit - c.spent);
    if (cur && unspent > 0 && c.daysLeft <= 6) {
      h += '<div class="alert ok" id="move-it"><b>' + gbp(unspent) + ' of your spending limit is unspent.</b>The month ends in ' + (c.daysLeft + 1) + ' day' + (c.daysLeft ? 's' : '') +
        '. Move it to your next debt, ' + esc(cur.name) + ', as an extra payment.<button type="button" class="btn btn-ice" id="btn-move">Move ' + gbp(Math.min(unspent, cur.left)) + ' to ' + esc(cur.name) + '</button></div>';
    }
    if (b.unpaid.length) {
      h += '<div class="card"><div class="card-head"><h3>Unpaid business outgoings</h3><button type="button" class="link-btn" data-go="biz">Open</button></div>' +
        b.unpaid.slice(0, 4).map(function (o) { return '<div class="stat-row"><span>' + monthLabel(o.month) + ' ' + (o.type === 'Rent' ? 'rent' : 'interest') + '</span><b>' + gbp(o.amount) + '</b></div>'; }).join('') + '</div>';
    }
    h += '<div class="card guide" id="guide"><h3>How this works</h3><ol>' +
      '<li>Pay the minimum on every card first, so there are no late fees.</li>' +
      "<li>Then the priority is cutting spending. Every £1 you don't spend goes to the card debts, which charge interest.</li>" +
      '<li>Debts are cleared smallest first (or cards before friends, if you switch it in the plan).</li>' +
      '<li>The plan uses your debt share (' + gbp(c.debtShare) + ' a month) and works out the debt-free date live.</li>' +
      '<li>Past the ' + gbp(c.limit) + " limit, the rule is simple: don't spend.</li></ol></div>";
    h += '<div class="card"><div class="stat-row"><span>Cushion each month</span><b>' + gbp(c.st.cushion) + '</b></div>' +
      '<div class="stat-row"><span>Business outgoings (separate)</span><b>' + gbp(c.st.businessRent + b.monthlyInterest) + ' a month</b></div>' +
      '<p class="note" style="margin:8px 0 0">The cushion is after rent, transport, food, EMIs, loans and buffer. Business rent and interest are on the Business tab and never touch the cushion or the limit.</p></div>';
    h += "<p class=\"note center\">Private: only the people in Settings can open this, each with their own PIN. It isn't linked to the F&amp;F tracker.</p>";
    $('#view-home').innerHTML = h;
    bindGo();
    if (cur) $('#btn-next-pay').onclick = function () { paymentSheet(null, { debtId: cur.id, amount: weekPut }); };
    $('#btn-add-spend').onclick = function () { spendSheet(); };
    $('#btn-add-profit').onclick = function () { ledgerSheet('profit'); };
    $('#btn-add-salary').onclick = function () { ledgerSheet('salary'); };
    if ($('#btn-move')) $('#btn-move').onclick = function () { paymentSheet(null, { debtId: cur.id, amount: Math.min(unspent, cur.left), note: 'Unspent spending limit ' + monthLabel(c.ym) }); };
  }
  function renderDebts(c) {
    var h = '<div class="seg" id="debts-seg"><button type="button" data-t="list" class="' + (debtsTab === 'list' ? 'on' : '') + '">My debts</button><button type="button" data-t="plan" class="' + (debtsTab === 'plan' ? 'on' : '') + '">Payoff plan</button></div>';
    if (debtsTab === 'list') {
      h += '<div class="card hero"><div class="hero-label">Still to pay</div><div class="hero-amount" id="still-to-pay">' + gbp(c.left) + '</div><div class="hero-row">' +
        '<span class="pill">Total ' + gbp(c.total) + '</span><span class="pill ice">Paid ' + gbp(c.paid) + '</span></div></div>';
      h += '<div class="card" id="debt-list">' + c.basePlan.ordered.concat(c.debts.filter(function (d) { return d.left <= 0.005; })).map(function (d) {
        var cls = d.status === 'Paid' ? 'paid' : d.status === 'Part-paid' ? 'part' : 'none', pct = d.owed ? Math.round(Math.min(d.paid, d.owed) / d.owed * 100) : 0;
        var idx = c.basePlan.ordered.indexOf(d), by = idx >= 0 ? c.basePlan.clear[idx] : '';
        return '<div class="debt" data-debt="' + d.id + '"><div class="debt-top"><div style="min-width:0"><div class="debt-name">' + esc(d.name) + '</div><div class="debt-kind">' + esc(d.kind) +
          (by ? ' · cleared by ' + monthLabel(by) : '') + '</div></div><span class="status ' + cls + '">' + d.status + '</span></div>' +
          '<div class="bar ok"><i style="width:' + pct + '%"></i></div>' +
          '<div class="debt-nums"><span>Owed<b>' + gbp(d.owed) + '</b></span><span>Paid<b>' + gbp(d.paid) + '</b></span><span>Left<b>' + gbp(d.left) + '</b></span></div>' +
          '<div class="debt-actions">' + (d.left > 0.005 ? '<button type="button" class="btn btn-ice" data-pay="' + d.id + '">Record payment</button>' : '') +
          '<button type="button" class="btn" data-edit-debt="' + d.id + '">Edit</button></div></div>';
      }).join('') + '</div>';
      h += '<button type="button" class="btn" id="btn-add-debt">＋ Add a debt</button>';
    } else {
      var amts = [c.debtShare, c.st.cushion, 1200, 800].filter(function (v, i, a) { return v > 0 && a.indexOf(v) === i; });
      var amt = planAmt || c.debtShare, ord = planOrder || c.st.order, p = c.plan;
      h += '<div class="seg four" id="plan-amt">' + amts.map(function (v) { return '<button type="button" data-a="' + v + '" class="' + (v === amt ? 'on' : '') + '">' + gbp(v) + (v === c.debtShare ? '<br><small>debt share</small>' : '') + '</button>'; }).join('') + '</div>';
      h += '<div class="seg" id="plan-ord"><button type="button" data-o="small" class="' + (ord === 'small' ? 'on' : '') + '">Smallest first</button><button type="button" data-o="cards" class="' + (ord === 'cards' ? 'on' : '') + '">Cards first, friends last</button></div>';
      h += '<div class="card hero" id="plan-summary"><div class="hero-label">Debt-free</div><div class="hero-amount">' + (p.count ? monthLabel(p.end) : 'Now') + '</div><div class="hero-row"><span class="pill">' +
        p.count + ' month' + (p.count === 1 ? '' : 's') + ' at ' + gbp(amt) + ' a month</span><span class="pill ice">Starts ' + monthLabel(addMonths(c.ym, 1)) + '</span></div></div>';
      var max = Math.max.apply(null, [c.left].concat(p.months.map(function (m) { return m.left; }))) || 1;
      h += '<div class="card"><h3>Debt left after each month</h3><div class="cols">' + p.months.slice(0, 24).map(function (m) {
        return '<div class="c" title="' + gbp(m.left) + '"><i style="height:' + Math.max(2, Math.round(m.left / max * 100)) + '%"></i><span>' + MON[Number(m.ym.slice(5, 7)) - 1] + '</span></div>'; }).join('') + '</div></div>';
      h += '<div class="card" id="plan-months">' + p.months.map(function (m) {
        return '<div class="month"><div class="month-head"><span>' + monthLabel(m.ym) + '</span><small>' + gbp(m.left) + ' left after</small></div><div class="month-pays">' +
          m.pays.map(function (v, i) { return v > 0 ? esc(p.ordered[i].name) + ' <b>' + gbp(v) + '</b>' + (p.clear[i] === m.ym ? ' ✓' : '') : ''; }).filter(Boolean).join(' · ') + '</div></div>';
      }).join('') + '</div>';
      h += "<p class=\"note\">Smallest first clears the overdraft and small cards quickest, so there are fewer bills. Cards first leaves personal loans from friends to the end, since they usually charge no interest. Card interest isn't included because the rates aren't known. Payments you make this month count straight away.</p>";
    }
    $('#view-debts').innerHTML = h;
    $$('#debts-seg button').forEach(function (b) { b.onclick = function () { debtsTab = b.getAttribute('data-t'); render(); }; });
    $$('#plan-amt button').forEach(function (b) { b.onclick = function () { planAmt = Number(b.getAttribute('data-a')); render(); }; });
    $$('#plan-ord button').forEach(function (b) { b.onclick = function () { planOrder = b.getAttribute('data-o'); render(); }; });
    $$('[data-pay]').forEach(function (b) { b.onclick = function () { paymentSheet(null, { debtId: b.getAttribute('data-pay') }); }; });
    $$('[data-edit-debt]').forEach(function (b) { b.onclick = function () { debtSheet(b.getAttribute('data-edit-debt')); }; });
    if ($('#btn-add-debt')) $('#btn-add-debt').onclick = function () { debtSheet(null); };
  }
  function renderBiz(c) {
    var b = c.biz, sp = c.sp, U0 = b.U0, U1 = b.U1, st = c.st;
    function two(v0, v1) { return '<td>' + v0 + '</td><td>' + v1 + '</td>'; }
    var h = '<p class="note">Business money is kept separate from personal debts. None of it changes the cushion, the spending limit or the payoff plan.</p>';
    h += '<div class="card" id="unpaid-card"><div class="card-head"><h3>Unpaid business outgoings</h3><span class="muted">' + gbp(b.unpaidTotal) + '</span></div>';
    h += b.unpaid.length ? b.unpaid.map(function (o) {
      var r = o.type === 'Rent' ? sp.rent : sp.interest;
      return '<div class="item"><div class="item-main"><div class="item-title">' + monthLabel(o.month) + ' ' + (o.type === 'Rent' ? 'rent' : 'loan interest') + ' · ' + gbp(o.amount) + '</div><div class="item-sub">' +
        esc(U0) + ' ' + gbp(o.amount * r) + ' · ' + esc(U1) + ' ' + gbp(o.amount * (1 - r)) + '</div></div>' +
        '<button type="button" class="btn btn-ice small-btn" data-paid="' + o.id + '">We paid</button></div>';
    }).join('') : "<div class=\"empty\"><b>All paid</b>Next month's rent and interest appear here on the 29th (the 28th in February).</div>";
    h += '</div>';
    var tm = b.thisMonth;
    h += '<div class="card" id="biz-month"><h3>Business outgoings this month</h3>' + ['Rent', 'Interest'].map(function (t) {
      var o = tm.filter(function (x) { return x.type === t; })[0];
      return '<div class="stat-row"><span>' + (t === 'Rent' ? 'Rent' : 'Interest (' + st.interestRate + '% a year on ' + gbp(st.loanTotal) + ')') + '</span><b>' + gbp(o ? o.amount : (t === 'Rent' ? st.businessRent : b.monthlyInterest)) +
        ' <span class="status ' + (o && o.status === 'Paid' ? 'paid' : 'none') + '">' + (o ? o.status : '—') + '</span></b></div>';
    }).join('') + '<div class="stat-row"><span>Total</span><b>' + gbp(st.businessRent + b.monthlyInterest) + '</b></div></div>';
    var loan0 = st.loanTotal * sp.loan, loan1 = st.loanTotal * (1 - sp.loan);
    var rent0 = st.businessRent * sp.rent, rent1 = st.businessRent * (1 - sp.rent), int0 = b.monthlyInterest * sp.interest, int1 = b.monthlyInterest * (1 - sp.interest);
    var prof0 = sum(D.profit, function (e) { return e.amount * sp.profit; }), prof1 = b.profitTotal - prof0;
    h += '<div class="card" id="full-picture"><h3>Full picture</h3><div class="tbl-wrap"><table class="tbl"><thead><tr><th></th><th>' + esc(U0) + '</th><th>' + esc(U1) + '</th></tr></thead><tbody>' +
      '<tr><th>Rent share / month</th>' + two(gbp(rent0), gbp(rent1)) + '</tr>' +
      '<tr><th>Interest share / month</th>' + two(gbp(int0), gbp(int1)) + '</tr>' +
      '<tr class="tot"><th>Total / month</th>' + two(gbp(rent0 + int0), gbp(rent1 + int1)) + '</tr>' +
      '<tr><th>Rent outstanding</th>' + two(gbp(b.rentDue * sp.rent - b.rentPaid[U0]), gbp(b.rentDue * (1 - sp.rent) - b.rentPaid[U1])) + '</tr>' +
      '<tr><th>Interest outstanding</th>' + two(gbp(b.intDue * sp.interest - b.intPaid[U0]), gbp(b.intDue * (1 - sp.interest) - b.intPaid[U1])) + '</tr>' +
      '<tr><th>' + esc(st.loanLender) + ' loan share</th>' + two(gbp(loan0), gbp(loan1)) + '</tr>' +
      '<tr><th>' + esc(st.loanLender) + ' loan left</th>' + two(gbp(loan0 - b.loanPaid[U0]), gbp(loan1 - b.loanPaid[U1])) + '</tr>' +
      '<tr><th>Profit share so far</th>' + two(gbp(prof0), gbp(prof1)) + '</tr>' +
      '</tbody></table></div><p class="note">Split: ' + esc(U0) + ' ' + shareWord(sp.rent) + ', ' + esc(U1) + ' ' + shareWord(1 - sp.rent) + ' (rent, loan, interest and profit each have their own setting). Personal debts left: ' + gbp(c.left) + ' (separate, not shared). Salaries so far: ' +
      b.salaryBy.map(function (s) { return esc(s.name) + ' ' + gbp(s.total); }).join(', ') + '.</p></div>';
    h += '<div class="card" id="rent-card"><div class="card-head"><h3>Business rent</h3><span class="muted">' + gbp(st.businessRent) + ' / month</span></div>' +
      '<div class="grid2">' + mini('Rent paid so far', gbp(b.rentTotalPaid), b.rentCount + ' payment' + (b.rentCount === 1 ? '' : 's')) + mini('Due so far', gbp(b.rentDue), 'since ' + monthLabel(st.rentStart)) + '</div>' +
      shareTable([['Share / month', rent0, rent1], ['Due so far', b.rentDue * sp.rent, b.rentDue * (1 - sp.rent)], ['Paid', b.rentPaid[U0], b.rentPaid[U1]],
        ['Outstanding', b.rentDue * sp.rent - b.rentPaid[U0], b.rentDue * (1 - sp.rent) - b.rentPaid[U1]]], U0, U1) +
      '<button type="button" class="btn btn-ice" id="btn-rent">Log rent payment</button>' + ledgerList('rent', D.rent) + '</div>';
    h += '<div class="card" id="rentmonths-card"><h3>Rent by month</h3>' + b.outs.filter(function (o) { return o.type === 'Rent'; }).map(outRow).join('') + '</div>';
    h += '<div class="card" id="interest-card"><div class="card-head"><h3>Loan interest</h3><span class="muted">' + gbp(b.monthlyInterest) + ' / month</span></div>' +
      shareTable([['Share / month', int0, int1], ['Due so far', b.intDue * sp.interest, b.intDue * (1 - sp.interest)], ['Paid', b.intPaid[U0], b.intPaid[U1]]], U0, U1) +
      b.outs.filter(function (o) { return o.type === 'Interest'; }).map(outRow).join('') + '</div>';
    h += '<div class="card" id="loan-card"><div class="card-head"><h3>' + esc(st.loanLender) + ' business loan</h3><span class="muted">' + gbp(st.loanTotal) + '</span></div>' +
      '<div class="grid2">' + mini('Repaid', gbp(b.loanRepaid), D.loan.length + ' repayment' + (D.loan.length === 1 ? '' : 's')) + mini('Still owed to ' + st.loanLender, gbp(st.loanTotal - b.loanRepaid)) + '</div>' +
      shareTable([['Share', loan0, loan1], ['Repaid', b.loanPaid[U0], b.loanPaid[U1]], ['Left', loan0 - b.loanPaid[U0], loan1 - b.loanPaid[U1]]], U0, U1) +
      '<button type="button" class="btn btn-ice" id="btn-loan">Log loan repayment</button>' + ledgerList('loan', D.loan) + '</div>';
    h += '<div class="card" id="profit-card"><div class="card-head"><h3>Business profit</h3><span class="muted">' + gbp(b.profitTotal) + '</span></div>' +
      shareTable([['Share so far', prof0, prof1]], U0, U1) + '<button type="button" class="btn btn-ice" id="btn-profit">＋ Add profit</button>' +
      (D.profit.length ? D.profit.slice().reverse().map(function (e) {
        return '<div class="item"><button type="button" class="item-btn" data-edit-profit="' + e.id + '"><div class="item-main"><div class="item-title">' + gbp(e.amount) + (e.note ? ' · ' + esc(e.note) : '') + '</div>' +
          '<div class="item-sub">' + esc(U0) + ' ' + gbp(e.amount * sp.profit) + ' · ' + esc(U1) + ' ' + gbp(e.amount * (1 - sp.profit)) + '</div><div class="item-sub">' + niceWhen(e.when) + ' · by <span class="by">' + esc(e.addedBy) + '</span></div></div></button></div>';
      }).join('') : '<p class="note">No profit logged yet.</p>') + '</div>';
    h += '<div class="card" id="salary-card"><div class="card-head"><h3>Salaries</h3></div><div class="grid2">' +
      b.salaryBy.map(function (s) { return mini(s.name, gbp(s.total), s.count + ' payment' + (s.count === 1 ? '' : 's')); }).join('') + '</div>' +
      '<button type="button" class="btn btn-ice" id="btn-salary" style="margin-top:10px">＋ Add salary</button>' +
      (D.salaries.length ? D.salaries.slice().reverse().map(function (e) {
        return '<div class="item"><button type="button" class="item-btn" data-edit-salary="' + e.id + '"><div class="item-main"><div class="item-title">' + gbp(e.amount) + ' to ' + esc(e.receivedBy) + '</div>' +
          '<div class="item-sub">' + niceWhen(e.when) + ' · by <span class="by">' + esc(e.addedBy) + '</span>' + (e.note ? ' · ' + esc(e.note) : '') + '</div></div></button></div>';
      }).join('') : '<p class="note">No salaries logged yet.</p>') + '</div>';
    $('#view-biz').innerHTML = h;
    $$('[data-paid]').forEach(function (x) { x.onclick = function () { outgoingSheet(x.getAttribute('data-paid')); }; });
    $$('[data-out]').forEach(function (x) { x.onclick = function () { outgoingSheet(x.getAttribute('data-out')); }; });
    $('#btn-rent').onclick = function () { ledgerSheet('rent'); };
    $('#btn-loan').onclick = function () { ledgerSheet('loan'); };
    $('#btn-profit').onclick = function () { ledgerSheet('profit'); };
    $('#btn-salary').onclick = function () { ledgerSheet('salary'); };
    $$('[data-edit-ledger]').forEach(function (x) { x.onclick = function () { var p = x.getAttribute('data-edit-ledger').split(':'); ledgerSheet(p[0], p[1]); }; });
    $$('[data-edit-profit]').forEach(function (x) { x.onclick = function () { ledgerSheet('profit', x.getAttribute('data-edit-profit')); }; });
    $$('[data-edit-salary]').forEach(function (x) { x.onclick = function () { ledgerSheet('salary', x.getAttribute('data-edit-salary')); }; });
    bindProofLinks();
  }
  function shareTable(rows, U0, U1) {
    return '<div class="tbl-wrap"><table class="tbl"><thead><tr><th></th><th>' + esc(U0) + '</th><th>' + esc(U1) + '</th></tr></thead><tbody>' +
      rows.map(function (r) { return '<tr><th>' + r[0] + '</th><td>' + gbp(r[1]) + '</td><td>' + gbp(r[2]) + '</td></tr>'; }).join('') + '</tbody></table></div>';
  }
  function outRow(o) {
    return '<div class="item"><button type="button" class="item-btn" data-out="' + o.id + '"><div class="item-main"><div class="item-title">' + monthLabel(o.month) + ' <span class="status ' + (o.status === 'Paid' ? 'paid' : 'none') + '">' + o.status + '</span></div>' +
      '<div class="item-sub">' + (o.status === 'Paid' ? 'Paid ' + niceDate(o.paidOn) + ' by ' + esc(o.paidBy) + ' · marked by <span class="by">' + esc(o.markedBy) + '</span>' : 'Not paid yet – tap to mark paid') + '</div></div>' +
      '<div class="item-amt">' + gbp(o.amount) + '</div></button>' + (o.proofFileId ? '<button type="button" class="bill-link" data-proof="outgoing:' + o.id + '">Proof</button>' : '') + '</div>';
  }
  function ledgerList(kind, list) {
    if (!list.length) return '<p class="note">Nothing logged yet.</p>';
    return list.slice().sort(function (a, b) { return a.date < b.date ? 1 : -1; }).map(function (e) {
      return '<div class="item"><button type="button" class="item-btn" data-edit-ledger="' + kind + ':' + e.id + '"><div class="item-main"><div class="item-title">' + gbp(e.amount) + ' · paid by ' + esc(e.paidBy) + '</div>' +
        '<div class="item-sub">' + niceDate(e.date) + ' · logged by <span class="by">' + esc(e.addedBy) + '</span>' + (e.note ? ' · ' + esc(e.note) : '') + '</div></div></button>' +
        (e.proofFileId ? '<button type="button" class="bill-link" data-proof="' + kind + ':' + e.id + '">Proof</button>' : '') + '</div>';
    }).join('');
  }
  function renderLog(c) {
    var h = '<div class="seg three" id="log-seg">' + [['spending', 'Spending'], ['payments', 'Debt payments'], ['changes', 'Changes']].map(function (t) {
      return '<button type="button" data-t="' + t[0] + '" class="' + (logTab === t[0] ? 'on' : '') + '">' + t[1] + '</button>'; }).join('') + '</div>';
    if (logTab === 'spending') {
      h += '<button type="button" class="btn btn-primary" id="btn-log-spend" style="margin-bottom:14px">＋ Add spending</button>';
      var byMonth = {};
      D.spending.forEach(function (s) { (byMonth[s.when.slice(0, 7)] = byMonth[s.when.slice(0, 7)] || []).push(s); });
      var months = Object.keys(byMonth).sort().reverse();
      h += months.length ? months.map(function (m) {
        var l = byMonth[m].sort(function (a, b) { return a.when < b.when ? 1 : -1; });
        return '<div class="card"><div class="card-head"><h3>' + monthLabel(m) + '</h3><span class="muted">' + gbp(sum(l, function (s) { return s.amount; })) + '</span></div>' +
          l.map(function (s) {
            return '<div class="item"><button type="button" class="item-btn" data-edit-spend="' + s.id + '"><div class="item-main"><div class="item-title">' + esc(s.what) + (s.overLimit ? '<span class="badge-over">OVER LIMIT</span>' : '') + '</div>' +
              '<div class="item-sub">' + niceWhen(s.when) + ' · ' + esc(s.category) + ' · by <span class="by">' + esc(s.addedBy) + '</span></div></div><div class="item-amt">' + gbp(s.amount) + '</div></button></div>';
          }).join('') + '</div>';
      }).join('') : '<div class="card empty"><b>Nothing logged yet</b>Tap ＋ Add spending each time you spend.</div>';
    } else if (logTab === 'payments') {
      var l = D.payments.slice().sort(function (a, b) { return a.date === b.date ? (a.createdAt < b.createdAt ? 1 : -1) : (a.date < b.date ? 1 : -1); });
      h += '<div class="card">' + (l.length ? l.map(function (p) {
        return '<div class="item"><button type="button" class="item-btn" data-edit-pay="' + p.id + '"><div class="item-main"><div class="item-title">' + esc(p.debtName) + '</div>' +
          '<div class="item-sub">' + niceDate(p.date) + ' · by <span class="by">' + esc(p.addedBy) + '</span>' + (p.note ? ' · ' + esc(p.note) : '') + '</div></div><div class="item-amt">' + gbp(p.amount) + '</div></button>' +
          (p.proofFileId ? '<button type="button" class="bill-link" data-proof="payment:' + p.id + '">Proof</button>' : '') + '</div>';
      }).join('') : '<div class="empty"><b>No payments yet</b>Record one from the Debts tab.</div>') + '</div>';
    } else {
      h += '<div class="card" id="changes">' + (D.changes.length ? D.changes.map(function (x) {
        return '<div class="chg"><div class="chg-top"><span>' + esc(x.action) + ' · ' + esc(x.type) + '</span><small>' + niceWhen(x.when) + '</small></div><div class="chg-d"><span class="by">' + esc(x.who) + '</span> – ' + esc(x.details) + '</div></div>';
      }).join('') : '<div class="empty">No changes yet.</div>') + '</div><p class="note">Every add, edit and delete is listed here with who did it. Deleted entries keep their details here.</p>';
    }
    $('#view-log').innerHTML = h;
    $$('#log-seg button').forEach(function (b) { b.onclick = function () { logTab = b.getAttribute('data-t'); render(); }; });
    if ($('#btn-log-spend')) $('#btn-log-spend').onclick = function () { spendSheet(); };
    $$('[data-edit-spend]').forEach(function (b) { b.onclick = function () { spendSheet(b.getAttribute('data-edit-spend')); }; });
    $$('[data-edit-pay]').forEach(function (b) { b.onclick = function () { paymentSheet(b.getAttribute('data-edit-pay')); }; });
    bindProofLinks();
  }

  /* ---------- sheet + form helpers ---------- */
  function openSheet(title, html, opts) {
    opts = opts || {};
    $('#sheet-title').textContent = title; $('#sheet-body').innerHTML = html; $('#sheet').hidden = false;
    $$('#sheet [data-close]').forEach(function (b) { if (b.tagName === 'BUTTON') b.style.visibility = opts.locked ? 'hidden' : ''; b.onclick = opts.locked ? null : closeSheet; });
    $('#sheet-body').scrollTop = 0;
  }
  function closeSheet() { $('#sheet').hidden = true; $('#sheet-body').innerHTML = ''; }
  function field(label, inner, opt) { return '<div class="field"><label>' + label + (opt ? ' <span class="opt">(optional)</span>' : '') + '</label>' + inner + '</div>'; }
  function moneyInput(id, v) { return '<div class="money"><span>£</span><input class="input" id="' + id + '" inputmode="decimal" autocomplete="off" placeholder="0.00" value="' + (v ? r2(v) : '') + '"></div>'; }
  function readMoney(id) { var v = Number(String($('#' + id).value).replace(/[£,\s]/g, '')); return v > 0 ? r2(v) : 0; }
  function proofField(existing) {
    return field('Proof (photo or PDF)', '<label class="btn" for="f-proof">' + (existing ? 'Replace proof' : 'Add photo or PDF') + '</label>' +
      '<input type="file" id="f-proof" accept="image/*,application/pdf" class="file-hidden"><div id="proof-prev"></div>' +
      (existing ? '<label class="remember" style="justify-content:flex-start"><input type="checkbox" id="f-rmproof"> Remove the saved proof</label>' : ''), true);
  }
  var pendingProof = null;
  function bindProof() {
    pendingProof = null;
    var inp = $('#f-proof'); if (!inp) return;
    inp.onchange = function () {
      var f = inp.files && inp.files[0]; if (!f) return;
      $('#proof-prev').innerHTML = '<div class="photo-prev">Preparing…</div>';
      prepareFile(f).then(function (p) {
        pendingProof = p;
        $('#proof-prev').innerHTML = '<div class="photo-prev" id="proof-ready">' + (p.mime === 'application/pdf' ? '<div class="pdf">PDF</div>' : '<img alt="" src="data:' + p.mime + ';base64,' + p.data + '">') +
          '<div style="min-width:0"><b class="item-title" style="display:block">' + esc(f.name || 'file') + '</b><div class="muted">' + Math.round(p.data.length * 0.75 / 1024) + ' KB · saved to your private Drive folder</div></div></div>';
      }).catch(function (e) { pendingProof = null; $('#proof-prev').innerHTML = '<p class="err">' + esc(e.message) + '</p>'; });
    };
  }
  function readAsB64(f) { return new Promise(function (res, rej) { var r = new FileReader(); r.onload = function () { res(String(r.result).split(',')[1]); }; r.onerror = function () { rej(new Error('Could not read the file')); }; r.readAsDataURL(f); }); }
  function prepareFile(f) {
    var type = (f.type || '').toLowerCase();
    if (type === 'application/pdf' || /\.pdf$/i.test(f.name)) {
      if (f.size > 8 * 1024 * 1024) return Promise.reject(new Error('That PDF is over 8 MB'));
      return readAsB64(f).then(function (d) { return { mime: 'application/pdf', data: d }; });
    }
    return new Promise(function (res, rej) {
      var url = URL.createObjectURL(f), img = new Image();
      img.onload = function () {
        var max = 1800, w = img.naturalWidth, h = img.naturalHeight, k = Math.min(1, max / Math.max(w, h));
        var cv = document.createElement('canvas'); cv.width = Math.round(w * k); cv.height = Math.round(h * k);
        cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height); URL.revokeObjectURL(url);
        res({ mime: 'image/jpeg', data: cv.toDataURL('image/jpeg', 0.82).split(',')[1] });
      };
      img.onerror = function () {
        URL.revokeObjectURL(url);
        if (f.size > 8 * 1024 * 1024) { rej(new Error('Could not read that photo')); return; }
        readAsB64(f).then(function (d) { res({ mime: type || 'image/jpeg', data: d }); }, rej);
      };
      img.src = url;
    });
  }
  function err(msg) { var e = $('#f-err'); if (e) e.textContent = msg || ''; }
  function save(promise, okMsg) {
    busy(true, 'Saving…');
    return promise.then(function () { busy(false); closeSheet(); toast(okMsg); return load(true); })
      .catch(function (e) { busy(false); err(e.message); toast(e.message, true); });
  }
  function delBtn() { return '<button type="button" class="btn btn-ghost danger-text" id="f-del">Delete</button>'; }
  function myUnit() { var u = D.settings.partners, me = D.me.user; return (me === 'Karimulla' || me === 'Thanmayee') ? u[0] : (u.indexOf(me) >= 0 ? me : D.lists.shared); }
  /* ---------- add menu ---------- */
  function addMenu() {
    openSheet('Add', '<div class="form">' +
      '<button type="button" class="btn btn-primary" data-add="spend">＋ Spending</button>' +
      '<button type="button" class="btn" data-add="pay">Record a debt payment</button>' +
      '<button type="button" class="btn" data-add="profit">＋ Profit</button>' +
      '<button type="button" class="btn" data-add="salary">＋ Salary</button>' +
      '<button type="button" class="btn" data-add="rent">Log rent payment</button>' +
      '<button type="button" class="btn" data-add="loan">Log loan repayment</button></div>');
    $$('[data-add]').forEach(function (b) { b.onclick = function () {
      var k = b.getAttribute('data-add');
      if (k === 'spend') spendSheet(); else if (k === 'pay') paymentSheet(); else ledgerSheet(k);
    }; });
  }

  /* ---------- spending (with the "Don't spend." screen) ---------- */
  function spendSheet(id) {
    var s = id ? D.spending.filter(function (x) { return x.id === id; })[0] : null, cat = s ? s.category : 'Food';
    openSheet(s ? 'Edit spending' : 'Add spending', '<div class="form">' +
      field('Amount', moneyInput('f-amt', s && s.amount)) +
      field('What was it?', '<input class="input" id="f-what" maxlength="200" placeholder="e.g. Lunch at work" value="' + esc(s ? s.what : '') + '">') +
      field('Category', '<div class="choice three" id="f-cat">' + D.lists.categories.map(function (c) { return '<button type="button" data-c="' + c + '" class="' + (c === cat ? 'on' : '') + '">' + c + '</button>'; }).join('') + '</div>') +
      (s ? field('When (UK time)', '<input class="input" id="f-when" value="' + esc(s.when) + '" placeholder="yyyy-mm-dd hh:mm">') + '<p class="note">Added by ' + esc(s.addedBy) + (s.editedBy ? ', last edited by ' + esc(s.editedBy) : '') + (s.overLimit ? ' · logged over the limit' : '') + '</p>'
        : "<p class=\"note\">Saved with today's date and time (UK) and your name. It comes off this month's " + gbp(D.settings.spendLimit) + ' spending limit.</p>') +
      '<p class="err" id="f-err"></p><button type="button" class="btn btn-primary" id="f-save">' + (s ? 'Save changes' : 'Add spending') + '</button>' + (s ? delBtn() : '') + '</div>');
    $$('#f-cat button').forEach(function (b) { b.onclick = function () { cat = b.getAttribute('data-c'); $$('#f-cat button').forEach(function (x) { x.classList.toggle('on', x === b); }); }; });
    $('#f-save').onclick = function () {
      var amt = readMoney('f-amt'), what = $('#f-what').value.trim();
      if (!amt) return err('Type the amount');
      if (!what) return err('Say what it was for');
      if (s) { save(API.updateSpend(s.id, { amount: amt, what: what, category: cat, when: $('#f-when').value.trim() }), 'Saved'); return; }
      var c = calc(), after = r2(c.spent + amt);
      if (after > c.limit) { dontSpend(r2(after - c.limit), { amount: amt, what: what, category: cat }); return; }
      save(API.addSpend({ amount: amt, what: what, category: cat }), 'Added');
    };
    if (s) $('#f-del').onclick = function () { confirmBox('Delete this entry?', gbp(s.amount) + ' ' + s.what + '. The change log keeps a record.', 'Delete').then(function (ok) { if (ok) save(API.deleteSpend(s.id), 'Deleted'); }); };
  }
  function dontSpend(over, entry) {
    $('#stop-text').innerHTML = "You're over your limit by <b>" + gbp(over) + '</b>. This money should go to your debts.';
    $('#stop').hidden = false;
    $('#stop-ok').onclick = function () { $('#stop').hidden = true; closeSheet(); toast('Good call. Nothing was logged.'); };
    $('#stop-log').onclick = function () { $('#stop').hidden = true; entry.overLimit = true; save(API.addSpend(entry), 'Logged as over the limit'); };
  }

  /* ---------- debt payment ---------- */
  function paymentSheet(id, pre) {
    var p = id ? D.payments.filter(function (x) { return x.id === id; })[0] : null; pre = pre || {};
    var c = calc(), debtId = p ? p.debtId : pre.debtId || (c.basePlan.ordered[0] || c.debts[0]).id;
    openSheet(p ? 'Edit payment' : 'Record a payment', '<div class="form">' +
      field('Which debt?', '<select class="input" id="f-debt">' + c.debts.map(function (d) { return '<option value="' + d.id + '"' + (d.id === debtId ? ' selected' : '') + '>' + esc(d.name) + ' – ' + gbp(d.left) + ' left</option>'; }).join('') + '</select>') +
      field('Amount', moneyInput('f-amt', p ? p.amount : pre.amount)) +
      field('Date', '<input class="input" type="date" id="f-date" value="' + (p ? p.date : c.today) + '">') +
      field('Note', '<input class="input" id="f-note" maxlength="500" value="' + esc(p ? p.note : pre.note || '') + '" placeholder="e.g. Paid by bank transfer">', true) +
      proofField(p && p.proofFileId) +
      (p ? '<p class="note">Added by ' + esc(p.addedBy) + (p.editedBy ? ', last edited by ' + esc(p.editedBy) : '') + '</p>' : '') +
      '<p class="err" id="f-err"></p><button type="button" class="btn btn-primary" id="f-save">' + (p ? 'Save changes' : 'Save payment') + '</button>' + (p ? delBtn() : '') + '</div>');
    bindProof();
    $('#f-save').onclick = function () {
      var amt = readMoney('f-amt'), did = $('#f-debt').value, d = c.debts.filter(function (x) { return x.id === did; })[0];
      if (!amt) return err('Type the amount');
      var room = r2(d.left + (p && p.debtId === did ? p.amount : 0));
      var go = function () {
        var body = { debtId: did, amount: amt, date: $('#f-date').value, note: $('#f-note').value }, rm = $('#f-rmproof') && $('#f-rmproof').checked;
        save(p ? API.updatePayment(p.id, body, pendingProof, rm && !pendingProof) : API.addPayment(body, pendingProof), p ? 'Saved' : 'Payment saved');
      };
      if (amt > room + 0.005) confirmBox("More than what's left?", 'Only ' + gbp(room) + ' is left on ' + d.name + '. Save ' + gbp(amt) + ' anyway?', 'Save anyway', false).then(function (ok) { if (ok) go(); });
      else go();
    };
    if (p) $('#f-del').onclick = function () { confirmBox('Delete this payment?', gbp(p.amount) + ' to ' + p.debtName + '. Its proof goes to the Drive bin.', 'Delete').then(function (ok) { if (ok) save(API.deletePayment(p.id), 'Deleted'); }); };
  }
  function debtSheet(id) {
    var d = id ? D.debts.filter(function (x) { return x.id === id; })[0] : null;
    openSheet(d ? 'Edit debt' : 'Add a debt', '<div class="form">' +
      field('Name', '<input class="input" id="f-name" maxlength="60" value="' + esc(d ? d.name : '') + '">') +
      field('Type', '<select class="input" id="f-kind">' + D.lists.kinds.map(function (k) { return '<option' + (d && d.kind === k ? ' selected' : '') + '>' + k + '</option>'; }).join('') + '</select>') +
      field('Amount owed (starting amount)', moneyInput('f-amt', d && d.owed)) +
      '<p class="err" id="f-err"></p><button type="button" class="btn btn-primary" id="f-save">Save</button></div>');
    $('#f-save').onclick = function () {
      var amt = readMoney('f-amt'); if (!amt) return err('Type the amount owed');
      save(API.saveDebt(d ? d.id : '', { name: $('#f-name').value, kind: $('#f-kind').value, owed: amt }), 'Saved');
    };
  }
  /* ---------- business ledgers: rent, loan, profit, salary ---------- */
  function ledgerSheet(kind, id) {
    var list = { rent: D.rent, loan: D.loan, profit: D.profit, salary: D.salaries }[kind];
    var e = id ? list.filter(function (x) { return x.id === id; })[0] : null, st = D.settings, units = st.partners, me = D.me.user;
    var titles = { rent: ['Log rent payment', 'Edit rent payment'], loan: ['Log loan repayment', 'Edit loan repayment'], profit: ['Add profit', 'Edit profit'], salary: ['Add salary', 'Edit salary'] };
    var html = '<div class="form">' + field('Amount', moneyInput('f-amt', e ? e.amount : kind === 'rent' ? st.businessRent : ''));
    if (kind === 'rent') html += '<div class="choice" id="f-quick"><button type="button" data-q="' + st.businessRent + '">Full ' + gbp(st.businessRent) + '</button><button type="button" data-q="' + r2(st.businessRent * st.splits.rent) + '">' + esc(units[0]) + ' share ' + gbp(st.businessRent * st.splits.rent) + '</button></div>';
    if (kind === 'rent' || kind === 'loan') {
      var opts = units.concat([D.lists.shared, D.lists.business]), cur = e ? e.paidBy : myUnit();
      html += field('Paid by', '<select class="input" id="f-by">' + opts.map(function (o) { return '<option' + (o === cur ? ' selected' : '') + '>' + esc(o) + '</option>'; }).join('') + '</select>') +
        '<p class="note">Payments by Karimulla or Thanmayee count toward ' + esc(units[0]) + '. "' + esc(D.lists.shared) + '" and "' + esc(D.lists.business) + '" are shared ' + shareWord(st.splits[kind]) + ' / ' + shareWord(1 - st.splits[kind]) + '.</p>' +
        field('Date', '<input class="input" type="date" id="f-date" value="' + (e ? e.date : (D.nowUk || ukNow()).slice(0, 10)) + '">');
    }
    var rcv = '';
    if (kind === 'salary') {
      rcv = e ? e.receivedBy : (D.lists.salaryPeople.indexOf(me) >= 0 ? me : D.lists.salaryPeople[0]);
      html += field('Received by', '<div class="choice" id="f-rcv">' + D.lists.salaryPeople.map(function (n) { return '<button type="button" data-r="' + esc(n) + '" class="' + (n === rcv ? 'on' : '') + '">' + esc(n) + '</button>'; }).join('') + '</div>');
    }
    if ((kind === 'profit' || kind === 'salary') && e) html += field('When (UK time)', '<input class="input" id="f-when" value="' + esc(e.when) + '">');
    html += field('Note', '<input class="input" id="f-note" maxlength="500" value="' + esc(e ? e.note : '') + '">', true);
    if (kind === 'profit') html += '<p class="note" id="profit-split">Split: ' + esc(units[0]) + ' ' + shareWord(st.splits.profit) + ', ' + esc(units[1]) + ' ' + shareWord(1 - st.splits.profit) + '.</p>';
    if (kind === 'rent' || kind === 'loan') html += proofField(e && e.proofFileId);
    html += (e ? '<p class="note">Added by ' + esc(e.addedBy) + (e.editedBy ? ', last edited by ' + esc(e.editedBy) : '') + '</p>' : '<p class="note">Saved with your name and the UK date and time.</p>') +
      '<p class="err" id="f-err"></p><button type="button" class="btn btn-primary" id="f-save">' + (e ? 'Save changes' : 'Save') + '</button>' + (e ? delBtn() : '') + '</div>';
    openSheet(titles[kind][e ? 1 : 0], html);
    bindProof();
    $$('#f-rcv button').forEach(function (b) { b.onclick = function () { rcv = b.getAttribute('data-r'); $$('#f-rcv button').forEach(function (x) { x.classList.toggle('on', x === b); }); }; });
    $$('#f-quick button').forEach(function (b) { b.onclick = function () { $('#f-amt').value = b.getAttribute('data-q'); }; });
    if (kind === 'profit') $('#f-amt').oninput = function () { var a = readMoney('f-amt'); $('#profit-split').textContent = a ? units[0] + ' gets ' + gbp(a * st.splits.profit) + ', ' + units[1] + ' gets ' + gbp(a * (1 - st.splits.profit)) + '.' : ''; };
    $('#f-save').onclick = function () {
      var amt = readMoney('f-amt'); if (!amt) return err('Type the amount');
      var body = { amount: amt, note: $('#f-note').value };
      if ($('#f-by')) body.paidBy = $('#f-by').value;
      if ($('#f-date')) body.date = $('#f-date').value;
      if ($('#f-when')) body.when = $('#f-when').value.trim();
      if (kind === 'salary') body.receivedBy = rcv;
      var rm = $('#f-rmproof') && $('#f-rmproof').checked;
      save(e ? API.updateLedger(kind, e.id, body, pendingProof, rm && !pendingProof) : API.addLedger(kind, body, pendingProof), 'Saved');
    };
    if (e) $('#f-del').onclick = function () { confirmBox('Delete this entry?', gbp(e.amount) + '. The change log keeps a record.', 'Delete').then(function (ok) { if (ok) save(API.deleteLedger(kind, e.id), 'Deleted'); }); };
  }

  /* ---------- business outgoings: "We paid" ---------- */
  function outgoingSheet(id) {
    var o = D.outgoings.filter(function (x) { return x.id === id; })[0], st = D.settings, units = st.partners;
    var label = monthLabel(o.month) + ' ' + (o.type === 'Rent' ? 'rent' : 'interest');
    if (o.status === 'Paid') {
      openSheet(label, '<div class="form"><div class="detail-amt">' + gbp(o.amount) + '</div><dl class="detail-grid"><dt>Status</dt><dd>Paid</dd><dt>Paid on</dt><dd>' + niceDate(o.paidOn) + '</dd>' +
        '<dt>Paid by</dt><dd>' + esc(o.paidBy) + '</dd><dt>Marked by</dt><dd>' + esc(o.markedBy) + '</dd>' + (o.note ? '<dt>Note</dt><dd>' + esc(o.note) + '</dd>' : '') + '</dl>' +
        (o.proofFileId ? '<button type="button" class="btn" data-proof="outgoing:' + o.id + '">View proof</button>' : '') +
        '<p class="err" id="f-err"></p><button type="button" class="btn btn-ghost danger-text" id="f-unpay">Mark as unpaid (mistake)</button></div>');
      bindProofLinks();
      $('#f-unpay').onclick = function () { confirmBox('Mark as unpaid?', label + ' goes back on the unpaid list.' + (o.type === 'Rent' ? ' The linked rent entry is removed.' : ''), 'Mark unpaid').then(function (ok) { if (ok) save(API.markOutgoing(o.id, false), 'Marked unpaid'); }); };
      return;
    }
    var opts = units.concat([D.lists.shared, D.lists.business]), def = o.type === 'Interest' ? D.lists.business : myUnit();
    openSheet('We paid ' + label, '<div class="form">' + field('Amount', moneyInput('f-amt', o.amount)) +
      field('Paid by', '<select class="input" id="f-by">' + opts.map(function (x) { return '<option' + (x === def ? ' selected' : '') + '>' + esc(x) + '</option>'; }).join('') + '</select>') +
      field('Date', '<input class="input" type="date" id="f-date" value="' + (D.nowUk || ukNow()).slice(0, 10) + '">') +
      field('Note', '<input class="input" id="f-note" maxlength="500">', true) + proofField(false) +
      (o.type === 'Rent' ? '<p class="note">This also adds it to the rent ledger, so the running total and each share update.</p>' : '') +
      '<p class="err" id="f-err"></p><button type="button" class="btn btn-primary" id="f-save">Mark paid</button></div>');
    bindProof();
    $('#f-save').onclick = function () {
      var amt = readMoney('f-amt'); if (!amt) return err('Type the amount');
      save(API.markOutgoing(o.id, true, { amount: amt, paidBy: $('#f-by').value, date: $('#f-date').value, note: $('#f-note').value }, pendingProof), 'Marked paid');
    };
  }

  /* ---------- proof viewer ---------- */
  function bindProofLinks() {
    $$('[data-proof]').forEach(function (b) { b.onclick = function (ev) { ev.stopPropagation(); var p = b.getAttribute('data-proof').split(':'); viewProof(p[0], p[1]); }; });
  }
  function viewProof(kind, id) {
    busy(true, 'Opening…');
    API.getProof(id, kind).then(function (r) {
      busy(false);
      var url = 'data:' + r.mime + ';base64,' + r.data;
      try { var bin = atob(r.data), arr = new Uint8Array(bin.length); for (var i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i); url = URL.createObjectURL(new Blob([arr], { type: r.mime })); } catch (e) {}
      $('#viewer-body').innerHTML = r.mime === 'application/pdf' ? '<iframe title="Proof" src="' + url + '"></iframe>' : '<img alt="Proof" id="proof-img" src="' + url + '">';
      $('#viewer-open').href = r.url; $('#viewer').hidden = false;
    }).catch(function (e) { busy(false); toast(e.message, true); });
  }
  /* ---------- settings ---------- */
  function settingsSheet() {
    var st = D.settings, owner = D.me.isOwner;
    var h = '<div class="form"><p class="note">Signed in as <b>' + esc(D.me.user) + '</b>' + (owner ? ' (owner)' : '') + '.</p>' +
      '<button type="button" class="btn" id="s-pin">Change my PIN</button>';
    if (owner) {
      var splitOpt = function (k) { var v = st.splits[k]; return '<select class="input" id="s-split-' + k + '">' + [[2 / 3, 'Two-thirds / one-third'], [0.5, 'Half / half']].map(function (o) {
        return '<option value="' + o[0] + '"' + (Math.abs(o[0] - v) < 0.001 ? ' selected' : '') + '>' + o[1] + '</option>'; }).join('') + '</select>'; };
      h += '<h3 class="section-title">Money (owner only)</h3>' +
        field('Monthly cushion', moneyInput('s-cushion', st.cushion)) +
        field('Spending limit a month', moneyInput('s-limit', st.spendLimit)) +
        '<p class="note" id="s-split">Debts get ' + gbp(st.cushion - st.spendLimit) + ' a month. Weekly allowance about ' + gbp(st.spendLimit * 12 / 52) + '.</p>' +
        field('Payoff order', '<select class="input" id="s-order"><option value="small"' + (st.order === 'small' ? ' selected' : '') + '>Smallest first</option><option value="cards"' + (st.order === 'cards' ? ' selected' : '') + '>Cards first, friends last</option></select>') +
        '<h3 class="section-title">Business (owner only)</h3>' +
        field('Business rent a month', moneyInput('s-rent', st.businessRent)) +
        field('Rent starts (month)', '<input class="input" type="month" id="s-rentstart" value="' + st.rentStart + '">') +
        field(esc(st.loanLender) + ' loan total', moneyInput('s-loan', st.loanTotal)) +
        field('Interest rate (% a year)', '<input class="input" id="s-rate" inputmode="decimal" value="' + st.interestRate + '">') +
        field('Interest starts (month)', '<input class="input" type="month" id="s-intstart" value="' + st.interestStart + '">') +
        '<p class="note">Splits: ' + esc(st.partners[0]) + ' / ' + esc(st.partners[1]) + '.</p>' +
        field('Rent split', splitOpt('rent')) + field('Loan split', splitOpt('loan')) + field('Interest split', splitOpt('interest')) + field('Profit split', splitOpt('profit')) +
        '<p class="err" id="f-err"></p><button type="button" class="btn btn-primary" id="s-save">Save settings</button>' +
        '<h3 class="section-title">People who can open this</h3><div class="card" id="people">' + (D.people || []).map(function (p) {
          return '<div class="person"><div><b>' + esc(p.name) + '</b><div class="muted" style="font-size:13px">' + (p.role === 'owner' ? 'Owner' : 'Member') + (p.mustChange ? ' · first PIN not changed yet' : '') + '</div></div>' +
            (p.role === 'owner' ? '' : '<button type="button" class="btn btn-ghost danger-text" data-revoke="' + esc(p.name) + '">Remove</button>') + '</div>';
        }).join('') + '</div>' +
        field('Add a person', '<input class="input" id="s-newname" maxlength="30" placeholder="Name">') +
        field('Their first PIN (4–8 digits)', '<input class="input" id="s-newpin" type="password" inputmode="numeric" autocomplete="new-password" maxlength="8">') +
        '<p class="note">Tell them the PIN in person. They must choose their own PIN the first time they open the app.</p>' +
        '<p class="err" id="f-err2"></p><button type="button" class="btn btn-ice" id="s-add">Give access</button>';
    } else h += '<p class="note">Only the owner can change the limits, splits and who has access.</p>';
    h += '<button type="button" class="btn btn-ghost" id="s-out" style="margin-top:10px">Sign out on this device</button></div>';
    openSheet('Settings', h);
    $('#s-pin').onclick = function () { changePinSheet(false); };
    $('#s-out').onclick = function () { API.logout(); D = null; showLock('Signed out'); };
    if (!owner) return;
    var upd = function () { var c = readMoney('s-cushion'), l = Number($('#s-limit').value) || 0; $('#s-split').textContent = 'Debts get ' + gbp(c - l) + ' a month. Weekly allowance about ' + gbp(l * 12 / 52) + '.'; };
    $('#s-cushion').oninput = upd; $('#s-limit').oninput = upd;
    $('#s-save').onclick = function () {
      var lim = Number(String($('#s-limit').value).replace(/[£,\s]/g, ''));
      save(API.saveSettings({ cushion: readMoney('s-cushion'), spendLimit: isFinite(lim) ? lim : 0, order: $('#s-order').value, businessRent: readMoney('s-rent'),
        rentStart: $('#s-rentstart').value, loanTotal: readMoney('s-loan'), interestRate: Number($('#s-rate').value), interestStart: $('#s-intstart').value,
        splits: { rent: Number($('#s-split-rent').value), loan: Number($('#s-split-loan').value), interest: Number($('#s-split-interest').value), profit: Number($('#s-split-profit').value) } }), 'Settings saved');
    };
    $('#s-add').onclick = function () {
      var n = $('#s-newname').value.trim(), p = $('#s-newpin').value.trim(), e2 = $('#f-err2');
      if (!n) { e2.textContent = 'Type a name'; return; } if (!/^\d{4,8}$/.test(p)) { e2.textContent = 'First PIN must be 4–8 digits'; return; }
      busy(true); API.addUser(n, p).then(function (r) { busy(false); D.people = r.people; toast(n + ' can now open the app'); settingsSheet(); }).catch(function (e) { busy(false); e2.textContent = e.message; });
    };
    $$('[data-revoke]').forEach(function (b) { b.onclick = function () {
      var n = b.getAttribute('data-revoke');
      confirmBox('Remove ' + n + '?', n + ' will be signed out everywhere and can no longer open the app.', 'Remove').then(function (ok) {
        if (!ok) return; busy(true); API.revokeUser(n).then(function (r) { busy(false); D.people = r.people; toast(n + ' removed'); settingsSheet(); }).catch(function (e) { busy(false); toast(e.message, true); });
      });
    }; });
  }
  function changePinSheet(first) {
    openSheet(first ? 'Choose your own PIN' : 'Change PIN', '<div class="form">' + (first ? '<p class="note">This is your first time in. Choose a PIN only you know (4–8 digits).</p>' :
      field('Current PIN', '<input class="input" id="p-old" type="password" inputmode="numeric" autocomplete="current-password" maxlength="8">')) +
      field('New PIN', '<input class="input" id="p-new" type="password" inputmode="numeric" autocomplete="new-password" maxlength="8">') +
      field('New PIN again', '<input class="input" id="p-new2" type="password" inputmode="numeric" autocomplete="new-password" maxlength="8">') +
      '<p class="err" id="f-err"></p><button type="button" class="btn btn-primary" id="p-save">Save PIN</button>' +
      (first ? '<button type="button" class="btn btn-ghost" id="p-cancel">Cancel and sign out</button>' : '') + '</div>', { locked: first });
    $('#p-save').onclick = function () {
      var o = first ? lastPin : $('#p-old').value, n = $('#p-new').value, n2 = $('#p-new2').value;
      if (!/^\d{4,8}$/.test(n)) return err('PIN must be 4–8 digits'); if (n !== n2) return err("The two new PINs don't match");
      busy(true); API.changePin(o, n).then(function () { busy(false); lastPin = ''; closeSheet(); toast('PIN changed'); view = 'home'; load(); }).catch(function (e) { busy(false); err(e.message); });
    };
    if (first) $('#p-cancel').onclick = function () { API.logout(); showLock(); };
  }

  /* ---------- wiring ---------- */
  $$('#keypad button').forEach(function (b) { b.onclick = function () { key(b.getAttribute('data-k')); }; });
  document.addEventListener('keydown', function (e) {
    if ($('#lock-pin').hidden || $('#lock').hidden) return;
    if (/^\d$/.test(e.key)) key(e.key); else if (e.key === 'Backspace') key('del'); else if (e.key === 'Enter') key('ok');
  });
  $('#not-you').onclick = function () { showLock(); };
  $$('.tab[data-view]').forEach(function (t) { t.onclick = function () { view = t.getAttribute('data-view'); render(); window.scrollTo(0, 0); }; });
  $('#tab-add').onclick = addMenu;
  $('#btn-refresh').onclick = function () { load(true).then(function () { toast('Up to date'); }); };
  $('#btn-settings').onclick = function () { if (D) settingsSheet(); };
  $('#viewer-close').onclick = function () { $('#viewer').hidden = true; $('#viewer-body').innerHTML = ''; };
  API.onAuthLost(function (m) { D = null; showLock(m); });
  function online() { var off = !navigator.onLine; $('#offline-bar').hidden = !off; document.body.classList.toggle('is-offline', off); }
  window.addEventListener('online', online); window.addEventListener('offline', online); online();
  if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(function () {});
  if (window.DT_CONFIG.API_URL && API.hasToken()) { $('#lock').hidden = true; $('#app').hidden = false; load(); } else showLock();
})();
