// Token Radar v6 — the page. No network, no framework: it reads window.RADAR
// (written by main.ts) and renders the board, the detail view and the filter.
(function () {
  'use strict';
  var R = window.RADAR || { meta: {}, rows: [] };
  var meta = R.meta || {};
  var rows = R.rows || [];

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function money(v) {
    if (v == null) return '—';
    if (v >= 1e9) return '$' + (v / 1e9).toFixed(2) + 'B';
    if (v >= 1e6) return '$' + (v / 1e6).toFixed(1) + 'M';
    if (v >= 1e3) return '$' + (v / 1e3).toFixed(1) + 'K';
    if (v < 10) return '$' + v.toFixed(2);
    return '$' + Math.round(v);
  }
  function mult(v) {
    if (v == null) return '—';
    if (v > 1000) return '>1000×';
    return v.toFixed(1) + '×';
  }
  function perHour(v) { return v == null ? '—' : '$' + v.toFixed(2) + '/h'; }
  function pct(v) { return v == null ? '—' : (v > 0 ? '+' : '') + v.toFixed(1) + '%'; }

  var metaEl = document.getElementById('meta');
  metaEl.textContent =
    'Snapshot ' + (meta.as_of || '?') + '\n' +
    meta.protocols + ' protocols · ' + meta.candidates + ' candidates · ' +
    meta.live + ' live · ' + meta.tracked + ' tracked\n' +
    'Watchlist ' + meta.watchlist_covered + '/' + meta.watchlist_total;

  var methodEl = document.getElementById('method');
  var split = meta.verdict_split || {};
  methodEl.innerHTML =
    '<h2>How the radar works</h2>' +
    '<p><b>Expected value = implied value &times; &radic;P(token).</b> Implied value is log market cap ' +
    'fitted by least squares on the launch-eligible peers that already record a token ' +
    '(log TVL, 7-day log growth). P(token) is a logistic fit on all ' + meta.protocols + ' protocols: ' +
    'age enters as a hinge, min(age, 4 years), and the growth term is fixed at an elasticity of -0.5.</p>' +
    '<p>Measured on this snapshot: implied value LOO median error <b>' + meta.implied_loo_median_error +
    '&times;</b>, walk-forward <b>' + meta.implied_walk_forward_median_error +
    '&times;</b>; token odds 5-fold CV AUC <b>' + meta.odds_cv_auc +
    '</b>, temporal AUC <b>' + meta.odds_temporal_auc +
    '</b>. Verdicts over candidates: <b>FARM ' + split.FARM + ' / THIN ' + split.THIN + ' / SKIP ' + split.SKIP + '</b>.</p>' +
    '<p>' + esc(meta.assumptions || '') + '</p>';

  var tab = 'CANDIDATE';
  var qEl = document.getElementById('q');
  var catEl = document.getElementById('cat');
  var verdictEl = document.getElementById('verdict');
  var sortEl = document.getElementById('sort');
  var hintEl = document.getElementById('hint');
  var rowsEl = document.getElementById('rows');
  var moreEl = document.getElementById('more');
  var detailEl = document.getElementById('detail');

  var cats = [];
  rows.forEach(function (r) { if (r.category && cats.indexOf(r.category) < 0) cats.push(r.category); });
  cats.sort();
  cats.forEach(function (c) {
    var o = document.createElement('option');
    o.value = c; o.textContent = c; catEl.appendChild(o);
  });

  function filtered() {
    var q = qEl.value.trim().toLowerCase();
    var cat = catEl.value;
    var ver = verdictEl.value;
    var list = rows.filter(function (r) {
      if (r.status !== tab) return false;
      if (cat && r.category !== cat) return false;
      if (ver && r.verdict !== ver) return false;
      if (q && (r.name + ' ' + r.slug + ' ' + (r.category || '')).toLowerCase().indexOf(q) < 0) return false;
      return true;
    });
    var sort = sortEl.value;
    var by = {
      blend: function (a, b) { return (a.blend_rank || 9999) - (b.blend_rank || 9999); },
      ev: function (a, b) { return b.expected_value_usd - a.expected_value_usd; },
      tvl: function (a, b) { return b.tvl_usd - a.tvl_usd; },
      p: function (a, b) { return b.p_token - a.p_token; },
      age: function (a, b) { return b.age_years - a.age_years; },
    }[sort] || function (a, b) { return a.rank - b.rank; };
    list.sort(function (a, b) { return by(a, b) || (a.slug < b.slug ? -1 : 1); });
    return list;
  }

  function render() {
    var list = filtered();
    var shown = list.slice(0, 200);
    var html = '';
    shown.forEach(function (r) {
      var num = r.status === 'CANDIDATE' ? (r.blend_rank || r.rank) : r.rank;
      html += '<tr data-slug="' + esc(r.slug) + '"><td class="num">' + num + '</td>' +
        '<td><span class="name">' + esc(r.name) + '</span><br><span class="slug">' + esc(r.slug) + '</span>' +
        '<br><span class="cat">' + esc(r.category || '—') + ' · ' + esc(r.chains.join(', ')) + '</span></td>' +
        '<td class="num">' + money(r.tvl_usd) + '</td>' +
        '<td class="num">' + pct(r.growth_7d) + '</td>' +
        '<td class="num">' + r.age_years.toFixed(1) + 'y</td>' +
        '<td class="num">' + r.p_token.toFixed(2) + '</td>' +
        '<td class="num">' + money(r.implied_fit_usd) + '</td>' +
        '<td class="num">' + money(r.expected_value_usd) + '</td>' +
        '<td class="num">' + perHour(r.dollars_per_hour) + '</td>' +
        '<td><span class="chip ' + esc(r.verdict) + '">' + esc(r.verdict) + '</span></td></tr>';
    });
    rowsEl.innerHTML = html || '<tr><td colspan="10">No rows match this filter.</td></tr>';
    moreEl.textContent = list.length > 200
      ? 'Showing 200 of ' + list.length + ' rows — narrow the filter to see the rest.'
      : list.length + ' row' + (list.length === 1 ? '' : 's') + '. Click a row for its detail and farm plan.';
    var tabName = tab === 'CANDIDATE' ? 'launch candidates, default sort is the 50/50 blend rank' :
      tab === 'LIVE' ? 'protocols that already record a token, sorted by value' :
      'pre-token products that are not launch targets';
    hintEl.textContent = 'Showing ' + tabName + '. # is the blend rank for candidates, the expected-value rank otherwise.';
    rowsEl.querySelectorAll('tr[data-slug]').forEach(function (tr) {
      tr.addEventListener('click', function () { showDetail(tr.getAttribute('data-slug')); });
    });
  }

  function showDetail(slug) {
    var r = null;
    rows.forEach(function (x) { if (x.slug === slug) r = x; });
    if (!r) { detailEl.innerHTML = ''; return; }
    var steps = r.farm_steps.map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('');
    detailEl.innerHTML =
      '<button class="close" id="close-detail">Close</button>' +
      '<h2>' + esc(r.name) + '</h2>' +
      '<p class="slugline">' + esc(r.slug) + ' · ' + esc(r.category || 'no category') + ' · ' +
      esc(r.chains.join(', ')) + ' · ' + esc(r.status) + ' · ' +
      (r.watchlist ? 'on the watchlist' : 'not on the watchlist') + '</p>' +
      '<div class="grid">' +
      '<div><small>Expected value</small><b>' + money(r.expected_value_usd) + '</b></div>' +
      '<div><small>Implied value (fit)</small><b>' + money(r.implied_fit_usd) + '</b></div>' +
      '<div><small>P(token)</small><b>' + r.p_token.toFixed(2) + '</b></div>' +
      '<div><small>TVL</small><b>' + money(r.tvl_usd) + '</b></div>' +
      '<div><small>7-day change</small><b>' + pct(r.growth_7d) + '</b></div>' +
      '<div><small>Age</small><b>' + r.age_years.toFixed(1) + ' years</b></div>' +
      '<div><small>Farm rate</small><b>' + perHour(r.dollars_per_hour) + '</b></div>' +
      '<div><small>Expected share</small><b>' + (r.expected_share_usd == null ? '—' : money(r.expected_share_usd)) + '</b></div>' +
      '<div><small>Gas (10 tx, cheapest chain)</small><b>' + money(r.gas_usd) + '</b></div>' +
      '<div><small>Break-even multiple</small><b>' + mult(r.breakeven_multiple) + '</b></div>' +
      '<div><small>Minimum capital</small><b>' + money(r.min_capital_usd) + '</b></div>' +
      '<div><small>Verdict</small><b>' + esc(r.verdict) + '</b></div>' +
      '</div>' +
      '<h3>Farm plan</h3><ol>' + steps + '</ol>' +
      '<p class="note">Verdict rule: FARM at $6/hour or more, THIN at $2.50/hour or more, else SKIP. ' +
      'The pool is 5% of expected value, one farmer per $2,000,000 of TVL, over a 90-day window. ' +
      'Minimum capital is 5&times; the run&rsquo;s gas, at least $100.</p>';
    document.getElementById('close-detail').addEventListener('click', function () {
      detailEl.innerHTML = '';
      document.body.classList.remove('detail-route');
      if (window.location.hash.indexOf('detail=') === 1) window.history.replaceState(null, '', '#');
      render();
    });
    detailEl.scrollIntoView({ behavior: 'auto', block: 'start' });
  }

  document.querySelectorAll('.tabs button').forEach(function (b) {
    b.addEventListener('click', function () {
      tab = b.getAttribute('data-tab');
      document.querySelectorAll('.tabs button').forEach(function (x) { x.classList.toggle('active', x === b); });
      verdictEl.value = '';
      render();
    });
  });
  [qEl, catEl, verdictEl, sortEl].forEach(function (el) {
    el.addEventListener('input', render);
    el.addEventListener('change', render);
  });

  function fromHash() {
    var h = window.location.hash || '';
    var m;
    if ((m = /tab=(live|tracked|candidate)/i.exec(h))) {
      tab = m[1].toUpperCase();
      document.querySelectorAll('.tabs button').forEach(function (x) {
        x.classList.toggle('active', x.getAttribute('data-tab') === tab);
      });
    }
    if ((m = /[?#&]q=([^&]+)/.exec(h))) qEl.value = decodeURIComponent(m[1]);
    render();
    if ((m = /detail=([^&]+)/.exec(h))) {
      document.body.classList.add('detail-route');
      showDetail(decodeURIComponent(m[1]));
    }
  }
  window.addEventListener('hashchange', fromHash);
  fromHash();
})();
