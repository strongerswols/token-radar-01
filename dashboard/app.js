// SONAR's dashboard. It reads window.RADAR (written beside dashboard/ by main.ts)
// and renders the ranked board, a per-protocol detail view, a live-token tab and
// the method tab. No network: every byte it shows is in data.js.
//
// State lives in the URL hash, so every view has its own link:
//   #detail=<slug>            one protocol's model breakdown and farm plan
//   #cat=<category>           the board filtered to a category
//   #chain=<chain>            the board filtered to a chain
//   #watchlist=1              watchlist rows only
//   #tab=live | #tab=method   the other tabs
(function () {
  'use strict';

  var DATA = window.RADAR;
  if (!DATA) return;
  var M = DATA.model;
  var rows = DATA.rows;

  var state = { q: '', cat: 'all', chain: 'all', sort: 'implied', watch: false, tab: 'board', detail: null };

  var $ = function (id) { return document.getElementById(id); };
  var fmtUsd = (function () {
    var f = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
    return function (n) {
      if (n === null || n === undefined || !isFinite(n)) return 'n/a';
      if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
      if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
      if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
      return f.format(n);
    };
  })();
  function fmtPct(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(2) + '%';
  }
  function fmtAge(days) {
    if (days === null || days === undefined) return 'unknown';
    if (days >= 365) return (days / 365).toFixed(1) + 'y';
    return Math.max(0, Math.round(days)) + 'd';
  }
  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // The model, recomputed here from the row's own figures: the page's code and
  // board.json's numbers are visibly the same arithmetic.
  function impliedOf(r) {
    var g = Math.min(M.growth_cap, Math.max(M.growth_floor, r.change_7d === null ? 0 : r.change_7d));
    var growthMult = 1 + (g / 100) * M.growth_weight;
    var age = r.age_days === null ? M.unknown_age_days : r.age_days;
    var maturity = M.maturity_floor + (Math.min(Math.max(age, 0), M.maturity_days) / M.maturity_days) * M.maturity_range;
    var chainMult = 1 + M.chain_step * Math.min(Math.max(r.chains.length - 1, 0), M.chain_max_steps);
    return {
      implied: Math.max(1, Math.round(r.tvl_usd * M.base_multiple * growthMult * maturity * chainMult)),
      growthPct: g, growthMult: growthMult, maturity: maturity, chainMult: chainMult, age: age,
    };
  }

  function bySlug(slug) {
    for (var i = 0; i < rows.length; i++) if (rows[i].slug === slug) return rows[i];
    return null;
  }

  function filtered() {
    var q = state.q.trim().toLowerCase();
    var list = rows.filter(function (r) {
      if (state.watch && !r.on_watchlist) return false;
      if (state.cat !== 'all' && r.category !== state.cat) return false;
      if (state.chain !== 'all' && r.chains.indexOf(state.chain) < 0) return false;
      if (q && r.name.toLowerCase().indexOf(q) < 0 && r.slug.toLowerCase().indexOf(q) < 0) return false;
      return true;
    });
    var dir = -1;
    list.sort(function (a, b) {
      if (state.sort === 'tvl') return dir * (a.tvl_usd - b.tvl_usd);
      if (state.sort === 'growth') return dir * ((a.change_7d || 0) - (b.change_7d || 0));
      if (state.sort === 'age') return dir * ((a.age_days === null ? -1 : a.age_days) - (b.age_days === null ? -1 : b.age_days));
      return a.rank - b.rank;
    });
    return list;
  }

  function chainChips(r) {
    return r.chains.slice(0, 3).map(function (c) { return '<span class="chip">' + esc(c) + '</span>'; }).join('') +
      (r.chains.length > 3 ? '<span class="sub"> +' + (r.chains.length - 3) + '</span>' : '');
  }

  function renderBoard() {
    var list = filtered();
    var max = rows.length ? rows[0].implied_value_usd : 1;
    $('rows').innerHTML = list.map(function (r) {
      var pct = r.change_7d;
      var cls = r.rank === 1 ? 'rank1' : r.rank === 2 ? 'rank2' : r.rank === 3 ? 'rank3' : '';
      return '<tr data-slug="' + esc(r.slug) + '"' + (state.detail === r.slug ? ' class="sel"' : '') + '>' +
        '<td class="num ' + cls + '">' + r.rank + '</td>' +
        '<td><div class="name"><b>' + esc(r.name) + (r.on_watchlist ? '<span class="badge">WATCHLIST</span>' : '') + '</b>' +
        '<span class="sub">' + esc(r.slug) + '</span></div></td>' +
        '<td>' + esc(r.category || '—') + '</td>' +
        '<td>' + chainChips(r) + '</td>' +
        '<td class="num">' + fmtUsd(r.tvl_usd) + '</td>' +
        '<td class="num ' + (pct === null ? '' : pct >= 0 ? 'pos' : 'neg') + '">' + fmtPct(pct) + '</td>' +
        '<td class="num">' + fmtAge(r.age_days) + '</td>' +
        '<td><span class="implied">' + fmtUsd(r.implied_value_usd) + '</span>' +
        '<span class="bar"><i style="width:' + Math.max(2, Math.round((r.implied_value_usd / max) * 100)) + '%"></i></span></td>' +
        '</tr>';
    }).join('') || '<tr><td colspan="8"><div class="empty">No protocol matches this filter.</div></td></tr>';
    $('count').textContent = list.length + ' of ' + rows.length + ' rows';
  }

  function parseStep(s) {
    var ci = s.lastIndexOf(' Cost: ');
    var ti = s.lastIndexOf(' Time: ');
    if (ci < 0 || ti < 0 || ti < ci) return { text: s, cost: '', time: '' };
    return { text: s.slice(0, ci), cost: s.slice(ci + 7, ti).replace(/\.$/, ''), time: s.slice(ti + 7).replace(/\.$/, '') };
  }

  function renderDetail() {
    var box = $('detail');
    var r = state.detail ? bySlug(state.detail) : null;
    if (!r) { box.hidden = true; box.innerHTML = ''; return; }
    var v = impliedOf(r);
    var base = r.tvl_usd * M.base_multiple;
    var steps = (r.farm_steps || []).map(function (s, i) {
      var p = parseStep(s);
      return '<li><b>Step ' + (i + 1) + ' — ' + esc(p.text) + '</b>' +
        (p.cost || p.time ? '<span class="cost">Cost: ' + esc(p.cost) + ' · Time: ' + esc(p.time) + '</span>' : '') + '</li>';
    }).join('');
    box.innerHTML =
      '<div class="detail-head"><div>' +
      '<p class="sub">RANK #' + r.rank + ' · ' + esc(r.category || 'Uncategorised') + (r.on_watchlist ? ' · WATCHLIST' : '') + '</p>' +
      '<h2>' + esc(r.name) + '</h2>' +
      '<p class="sub">' + esc(r.slug) + ' · ' + r.chains.map(esc).join(', ') + ' · tracked since ' + esc(r.listed_at || 'unknown') + '</p>' +
      '</div><button type="button" class="close" id="close-detail" aria-label="Close detail">×</button></div>' +
      '<h3>Implied value — ' + fmtUsd(v.implied) + '</h3>' +
      '<div class="equation">' +
      '<div><span>Base — TVL × ' + M.base_multiple + '</span><b>' + fmtUsd(base) + '</b></div>' +
      '<div><span>Growth — 7d ' + fmtPct(r.change_7d) + ' clamped to ' + v.growthPct + '%</span><b>× ' + v.growthMult.toFixed(2) + '</b></div>' +
      '<div><span>Maturity — ' + fmtAge(r.age_days) + ' with no token</span><b>× ' + v.maturity.toFixed(2) + '</b></div>' +
      '<div><span>Chains — ' + r.chains.length + ' chain' + (r.chains.length === 1 ? '' : 's') + '</span><b>× ' + v.chainMult.toFixed(2) + '</b></div>' +
      '<div class="total"><span>Implied value (recomputed here)</span><b>' + fmtUsd(v.implied) + '</b></div>' +
      '</div>' +
      '<h3>Farm plan</h3><ol class="steps">' + steps + '</ol>' +
      '<p class="note">This protocol records no token in the sealed snapshot — that is not proof it has none. The implied value is this entry\u2019s model, not a prediction that a token is issued.</p>';
    box.hidden = false;
    $('close-detail').addEventListener('click', function () { setHash({ detail: null }); });
    box.scrollIntoView({ block: 'start' });
  }

  function renderLive() {
    $('live-rows').innerHTML = DATA.live.map(function (r) {
      return '<tr><td><div class="name"><b>' + esc(r.name) + '</b><span class="sub">' + esc(r.slug) + '</span></div></td>' +
        '<td>' + esc(r.category || '—') + '</td><td>' + chainChips(r) + '</td>' +
        '<td class="num">' + fmtUsd(r.tvl_usd) + '</td>' +
        '<td class="num">' + fmtUsd(r.mcap_usd) + '</td>' +
        '<td class="num ' + (r.change_7d === null ? '' : r.change_7d >= 0 ? 'pos' : 'neg') + '">' + fmtPct(r.change_7d) + '</td></tr>';
    }).join('');
  }

  function renderMeta() {
    $('meta').innerHTML =
      '<span>Snapshot <b>' + esc(DATA.as_of) + '</b></span>' +
      '<span><b>' + DATA.board_size + '</b> rows</span>' +
      '<span>Floor <b>' + fmtUsd(DATA.floor_usd) + '</b></span>' +
      '<span>Model <b>' + esc(DATA.model_version) + '</b></span>';
    var top = rows.length ? rows[0] : null;
    $('stats').innerHTML =
      '<div class="stat"><b>' + DATA.watchlist_size + '</b><span>watchlist protocols — the floor</span></div>' +
      '<div class="stat"><b>' + DATA.early_size + '</b><span>early finds below the floor</span></div>' +
      '<div class="stat"><b>' + fmtUsd(top ? top.implied_value_usd : 0) + '</b><span>top implied value' + (top ? ' — ' + esc(top.name) : '') + '</span></div>' +
      '<div class="stat"><b>' + DATA.live_size + '</b><span>live-token protocols set aside</span></div>';
    $('formula').textContent =
      'implied = max(1, round(TVL × ' + M.base_multiple + ' × growth × maturity × chains))\n' +
      'growth   = 1 + clamp(7d change, ' + M.growth_floor + '%, ' + M.growth_cap + '%) / 100 × ' + M.growth_weight + '\n' +
      'maturity = ' + M.maturity_floor + ' + 0.5 × min(age, ' + M.maturity_days + 'd) / ' + M.maturity_days + 'd   (unknown age: ' + M.unknown_age_days + 'd)\n' +
      'chains   = 1 + ' + M.chain_step + ' × min(chains − 1, ' + M.chain_max_steps + ')';
  }

  function fillSelects() {
    var cats = {}, chains = {};
    rows.forEach(function (r) {
      if (r.category) cats[r.category] = 1;
      r.chains.forEach(function (c) { chains[c] = 1; });
    });
    $('cat').innerHTML = '<option value="all">All categories</option>' +
      Object.keys(cats).sort().map(function (c) { return '<option value="' + esc(c) + '">' + esc(c) + '</option>'; }).join('');
    $('chain').innerHTML = '<option value="all">All chains</option>' +
      Object.keys(chains).sort().map(function (c) { return '<option value="' + esc(c) + '">' + esc(c) + '</option>'; }).join('');
  }

  function setHash(patch) {
    var p = new URLSearchParams(window.location.hash.slice(1));
    Object.keys(patch).forEach(function (k) {
      if (patch[k] === null || patch[k] === '' || patch[k] === 'all' || patch[k] === false) p.delete(k);
      else p.set(k, patch[k]);
    });
    var h = p.toString();
    if (('' + window.location.hash.slice(1)) !== h) window.location.hash = h;
    else readHash();
  }

  function readHash() {
    var p = new URLSearchParams(window.location.hash.slice(1));
    state.q = p.get('q') || '';
    state.cat = p.get('cat') || 'all';
    state.chain = p.get('chain') || 'all';
    state.sort = p.get('sort') || 'implied';
    state.watch = p.get('watchlist') === '1';
    state.tab = p.get('tab') || 'board';
    state.detail = p.get('detail') || null;
    $('q').value = state.q;
    $('cat').value = state.cat;
    $('chain').value = state.chain;
    $('sort').value = state.sort;
    $('watch').checked = state.watch;
    document.querySelectorAll('.tabs button').forEach(function (b) {
      b.setAttribute('aria-pressed', String(b.getAttribute('data-tab') === state.tab));
    });
    $('view-board').hidden = state.tab !== 'board';
    $('view-live').hidden = state.tab !== 'live';
    $('view-method').hidden = state.tab !== 'method';
    renderBoard();
    renderDetail();
  }

  fillSelects();
  renderMeta();
  renderLive();
  $('q').addEventListener('input', function (e) { setHash({ q: e.target.value }); });
  $('cat').addEventListener('change', function (e) { setHash({ cat: e.target.value }); });
  $('chain').addEventListener('change', function (e) { setHash({ chain: e.target.value }); });
  $('sort').addEventListener('change', function (e) { setHash({ sort: e.target.value }); });
  $('watch').addEventListener('change', function (e) { setHash({ watchlist: e.target.checked ? '1' : null }); });
  document.querySelectorAll('.tabs button').forEach(function (b) {
    b.addEventListener('click', function () { setHash({ tab: b.getAttribute('data-tab'), detail: null }); });
  });
  $('rows').addEventListener('click', function (e) {
    var tr = e.target.closest('tr[data-slug]');
    if (!tr) return;
    var slug = tr.getAttribute('data-slug');
    setHash({ detail: state.detail === slug ? null : slug });
  });
  window.addEventListener('hashchange', readHash);
  readHash();
})();
