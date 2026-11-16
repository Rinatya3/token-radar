(function () {
  'use strict';

  var DATA = window.RADAR;
  var main = document.getElementById('main');
  if (!DATA) {
    main.textContent = 'No radar data loaded.';
    main.setAttribute('aria-busy', 'false');
    return;
  }

  // ------------------------------------------------------------ the model
  //
  // The same value model lib/model.ts runs when the board is built, here in
  // the page so the dashboard shows its working: every value on screen is
  // recomputed from the row's own figures and the calibration the snapshot
  // produced, and the detail view shows each factor. Nothing here names a
  // protocol: the multiples are learned from the protocols whose tokens
  // already trade, shrunk toward the global median, and clamped.

  function clamp(value, lo, hi) { return Math.min(hi, Math.max(lo, value)); }

  function multipleOf(row) {
    var key = row.category === null || row.category === undefined ? 'Other' : row.category;
    var m = DATA.calibration.by_category[key];
    return m === undefined ? DATA.calibration.global : m;
  }

  function growthMultOf(row) {
    var change = row.change_7d === null || row.change_7d === undefined ? 0 : row.change_7d;
    return 1 + 0.6 * (clamp(change, -40, 80) / 100);
  }

  function maturityMultOf(row) {
    var age = row.age_days;
    if (age === null || age === undefined) return 0.9;
    return 0.8 + 0.2 * Math.min(1, age / 540);
  }

  function breadthMultOf(row) {
    var n = row.chains ? row.chains.length : 0;
    return 1 + 0.04 * Math.min(Math.max(n - 1, 0), 5);
  }

  function valueOf(row) {
    return Math.max(1, Math.round(row.tvl_usd * multipleOf(row) * growthMultOf(row) * maturityMultOf(row) * breadthMultOf(row)));
  }

  // The watchlist rule's shape test, from the snapshot's own fields. The
  // snapshot carries no parent-protocol field, so the rule's parent part
  // cannot be applied and is not claimed.
  var EXCLUDED_CATEGORIES = { Bridge: 1, 'Canonical Bridge': 1, 'Liquid Staking': 1, 'Liquid Restaking': 1, 'Restaked BTC': 1, CEX: 1 };
  var VERSION_MARKER = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
  var EXCHANGE_NAMES = ['Binance', 'Coinbase', 'Bybit', 'Kraken', 'Bitget', 'OKX', 'Bitfinex', 'Gemini'];

  function shapeExclusion(row) {
    if (row.category !== null && row.category !== undefined && EXCLUDED_CATEGORIES[row.category]) {
      return 'category ' + row.category + ' is one the watchlist rule leaves out';
    }
    if (VERSION_MARKER.test(row.name)) return 'name ends in a version marker';
    if (/\bwrapped\b|\bstaked\b|\bstaking\b/i.test(row.name)) return 'name carries wrapped, staked or staking';
    for (var i = 0; i < EXCHANGE_NAMES.length; i++) {
      if (row.name.indexOf(EXCHANGE_NAMES[i]) === 0) return 'name begins with the exchange name ' + EXCHANGE_NAMES[i];
    }
    return null;
  }

  // ---------------------------------------------------------- farm plans
  //
  // The same category templates lib/model.ts uses: each plan is filled with
  // the protocol's own name, main chain, a starter size and a hold length,
  // and every step says what it costs and how long it takes.

  var GAS_HINTS = {
    Ethereum: '$5–$30 of gas per transaction at busy times',
    Solana: 'a few cents of gas per transaction',
    Base: 'under $1 of gas per transaction',
    Arbitrum: 'under $1 of gas per transaction',
    Optimism: 'under $1 of gas per transaction',
    Unichain: 'under $1 of gas per transaction',
    Linea: 'under $1 of gas per transaction',
    Scroll: 'under $1 of gas per transaction',
    Blast: 'under $1 of gas per transaction',
    zkSync: 'under $1 of gas per transaction',
    'zkSync Era': 'under $1 of gas per transaction',
    Binance: 'about $0.30 of gas per transaction',
    Polygon: 'a few cents of gas per transaction',
    Avalanche: 'under $1 of gas per transaction',
    Sui: 'a few cents of gas per transaction',
    Aptos: 'a few cents of gas per transaction',
    TON: 'a few cents of gas per transaction',
    Tron: 'a few cents of gas per transaction',
    Berachain: 'under $1 of gas per transaction',
    'World Chain': 'under $1 of gas per transaction',
    Gnosis: 'a few cents of gas per transaction',
    xDai: 'a few cents of gas per transaction',
    Sonic: 'a few cents of gas per transaction',
    Fantom: 'a few cents of gas per transaction',
    Celo: 'a few cents of gas per transaction',
    Sei: 'a few cents of gas per transaction',
    Injective: 'a few cents of gas per transaction',
    Near: 'a few cents of gas per transaction',
    'Hyperliquid L1': 'a few cents of gas per transaction'
  };

  function chainOf(row) { return row.chains && row.chains.length > 0 ? row.chains[0] : 'its main chain'; }
  function gasHint(chain) { return GAS_HINTS[chain] || 'a few dollars of gas per transaction'; }
  function capitalFor(chain) { return chain === 'Ethereum' ? 1000 : 500; }
  function holdDaysFor(age) {
    if (age === null || age === undefined) return 60;
    if (age < 180) return 30;
    if (age < 540) return 60;
    return 90;
  }

  function familyOf(category) {
    var c = (category || '').toLowerCase();
    if (c.indexOf('bridge') !== -1) return 'bridge';
    if (c.indexOf('staking') !== -1 || c.indexOf('restaking') !== -1) return 'staking';
    if (c.indexOf('lending') !== -1 || c.indexOf('cdp') !== -1 || c.indexOf('collateral') !== -1 || c.indexOf('leveraged') !== -1) return 'lending';
    if (c.indexOf('yield') !== -1 || c === 'farm') return 'yield';
    if (c.indexOf('dex') !== -1 || c.indexOf('deriv') !== -1 || c.indexOf('option') !== -1 || c.indexOf('synthetic') !== -1 || c.indexOf('trading') !== -1 || c.indexOf('prediction') !== -1) return 'trading';
    if (c.indexOf('stable') !== -1 || c.indexOf('reserve currency') !== -1) return 'stable';
    if (c.indexOf('rwa') !== -1) return 'rwa';
    if (c === 'cex' || c.indexOf('exchange') !== -1) return 'cex';
    if (c.indexOf('risk') !== -1) return 'risk';
    return 'default';
  }

  var PLANS = {
    trading: function (name, ctx) { return [
      'Swap about $' + ctx.capital + ' of assets on ' + name + ' on ' + ctx.chain + ', in two or three trades over a week rather than all at once, so the activity reads as real use. Budget ' + ctx.gas + '; about 30 minutes in total.',
      'Add about $' + ctx.capital + " to one of " + name + "'s main liquidity pools on " + ctx.chain + ' and hold the position for at least ' + ctx.holdDays + ' days, collecting fees while you wait. Expect ' + ctx.gas + ' to enter and to exit.',
      'Return weekly: one small swap or a rebalance of the pool position, and check the pool\'s rewards page for any points or incentive program ' + name + ' runs. About 10 minutes a week.',
      'If ' + name + ' has a governance forum or a points dashboard, connect the same wallet you traded with and register for any program it offers; keep the wallet\'s history in one place. About 20 minutes, once.',
      'Keep records: the wallet address, the dates and sizes of each trade and pool deposit, and any points balance, so a future claim is easy to prove. Only use funds you can afford to lose; pools can lose value when prices move.'
    ]; },
    lending: function (name, ctx) { return [
      'Supply about $' + ctx.capital + ' of a major asset (ETH, BTC or a dollar stablecoin) to ' + name + ' on ' + ctx.chain + ' and leave it supplied for at least ' + ctx.holdDays + ' days. Budget ' + ctx.gas + ' for the deposit; about 15 minutes.',
      'Borrow a small amount against the supply, under half its value, and repay it within a week, so the wallet shows both sides of the market. Interest for a week on $' + ctx.half + ' is usually a few dollars; about 15 minutes.',
      'Repeat monthly: top the supply up or adjust the borrow, and check whether ' + name + ' runs a points or rewards program for suppliers and borrowers. About 10 minutes a month.',
      'If ' + name + ' publishes a points dashboard, connect the same wallet and confirm your activity is counted; keep one wallet for all of it. About 20 minutes, once.',
      'Keep records of the wallet, the supply and borrow amounts and their dates. Only use funds you can afford to lose; a borrow can be liquidated if collateral prices fall sharply.'
    ]; },
    staking: function (name, ctx) { return [
      'Stake about $' + ctx.capital + ' through ' + name + ' on ' + ctx.chain + ' and hold the receipt token in the same wallet for at least ' + ctx.holdDays + ' days. Budget ' + ctx.gas + '; about 15 minutes.',
      'Put the receipt token to work once: supply it to one lending market or liquidity pool ' + name + ' lists as a partner, so the wallet shows the full loop. Budget ' + ctx.gas + '; about 20 minutes.',
      'Check monthly that the stake is still earning and whether ' + name + ' runs a points program; claim any rewards it offers rather than leaving them. About 10 minutes a month.',
      'Keep the stake in one wallet and keep records of the stake size and dates, so a future claim is easy to prove. Only use funds you can afford to lose; receipt tokens can trade below their backing.'
    ]; },
    bridge: function (name, ctx) { return [
      'Bridge about $' + ctx.capital + ' through ' + name + ' between ' + ctx.chain + ' and one other chain it serves, in two or three transfers over a month rather than one large one. Budget ' + ctx.gas + ' plus the bridge fee each way; about 20 minutes per transfer including the wait.',
      'Use the bridged funds on the destination chain within a day, in a swap or a deposit, so the wallet\'s activity reads as real use rather than a single hop. About 15 minutes.',
      'Repeat monthly with a different route ' + name + ' serves, and check whether it runs a points or fee-rebate program. About 20 minutes a month.',
      'Keep records of each transfer\'s size, route and date. Only use funds you can afford to lose; bridges carry smart-contract and custodian risk.'
    ]; },
    yield: function (name, ctx) { return [
      'Deposit about $' + ctx.capital + " into one of " + name + "'s vaults or strategies on " + ctx.chain + ' and leave it for at least ' + ctx.holdDays + ' days. Budget ' + ctx.gas + '; about 15 minutes.',
      'Harvest or compound the yield once a month, and check the vault\'s strategy page for any points or bonus program. Budget ' + ctx.gas + ' per harvest; about 10 minutes.',
      'If ' + name + ' offers more than one vault, split a second deposit of about $' + ctx.half + ' into a different strategy after the first month, so the wallet shows breadth. About 15 minutes.',
      'Keep records of deposits, harvests and the wallet used. Only use funds you can afford to lose; vault strategies can lose value.'
    ]; },
    stable: function (name, ctx) { return [
      'Mint or buy about $' + ctx.capital + " of " + name + "'s stable asset on " + ctx.chain + ' and hold it in one wallet for at least ' + ctx.holdDays + ' days. Budget ' + ctx.gas + '; about 15 minutes.',
      'Use the stable asset once: supply it to a lending market or a liquidity pool, so the wallet shows the asset in circulation rather than idle. Budget ' + ctx.gas + '; about 20 minutes.',
      'Check monthly for any savings rate, points or rewards ' + name + ' offers holders, and claim what is offered. About 10 minutes a month.',
      'Keep records of the mint or purchase and the wallet. Only use funds you can afford to lose; a stable asset can lose its peg.'
    ]; },
    rwa: function (name, ctx) { return [
      'Buy about $' + ctx.capital + " of " + name + "'s tokenized offering on " + ctx.chain + ', after reading its disclosures about what backs it, and hold for at least ' + ctx.holdDays + ' days. Budget ' + ctx.gas + ' plus any issuance fee; about 30 minutes including the reading.',
      'If ' + name + ' offers a yield or distribution, claim or reinvest it monthly and keep the holding in one wallet. About 10 minutes a month.',
      'Check quarterly whether ' + name + ' runs a holder program or points, and confirm the holding still matches the disclosed backing. About 20 minutes a quarter.',
      'Keep records of the purchase, the disclosures and the wallet. Only use funds you can afford to lose; tokenized assets carry issuer and legal risk.'
    ]; },
    cex: function (name, ctx) { return [
      'Open and verify an account with ' + name + ' if you do not have one, and keep it in good standing; verification usually takes a day. No cost beyond the time.',
      'Trade about $' + ctx.capital + ' across a few orders over a month on ' + name + ', and use one of its earn or staking products with part of the balance. Trading fees are usually under 0.1% per order.',
      'Hold a steady balance and return weekly; if ' + name + ' runs a rewards or points program, opt in with the same account. About 10 minutes a week.',
      'Keep records of trades and balances. Only keep funds on an exchange you can afford to lose access to; exchange balances are custodied, not self-held.'
    ]; },
    risk: function (name, ctx) { return [
      'Deposit about $' + ctx.capital + ' into a vault ' + name + ' curates on ' + ctx.chain + ' and hold for at least ' + ctx.holdDays + ' days. Budget ' + ctx.gas + '; about 20 minutes including reading the vault\'s strategy.',
      'Read the curator\'s allocation reports monthly and check whether the vault earns points or incentives. About 15 minutes a month.',
      'If ' + name + ' curates more than one vault, add about $' + ctx.half + ' to a second one after a month. About 15 minutes.',
      'Keep records of deposits and the wallet. Only use funds you can afford to lose; curated vaults carry the risks of every market they allocate to.'
    ]; },
    default: function (name, ctx) { return [
      'Use ' + name + ' on ' + ctx.chain + ' with about $' + ctx.capital + ': make the protocol\'s main action (its swap, deposit, stake or mint) two or three times over the first week. Budget ' + ctx.gas + '; about 30 minutes in total.',
      'Leave the position open for at least ' + ctx.holdDays + ' days and return weekly to check for a points, rewards or incentive program ' + name + ' runs. About 10 minutes a week.',
      'Connect the same wallet to any dashboard ' + name + ' publishes and confirm your activity is counted; keep all of it in one wallet. About 20 minutes, once.',
      'Keep records of the wallet, the amounts and the dates. Only use funds you can afford to lose; new protocols carry smart-contract risk.'
    ]; }
  };

  function farmSteps(row) {
    var chain = chainOf(row);
    var capital = capitalFor(chain);
    var ctx = { chain: chain, gas: gasHint(chain), capital: capital, half: Math.round(capital / 2), holdDays: holdDaysFor(row.age_days) };
    var plan = PLANS[familyOf(row.category)] || PLANS['default'];
    return plan(row.name, ctx);
  }

  // ---------------------------------------------------------- formatting

  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function fmtUsd(n) {
    if (n === null || n === undefined) return 'n/a';
    var abs = Math.abs(n);
    if (abs >= 1e9) return '$' + (n / 1e9).toFixed(2).replace(/\.?0+$/, '') + 'B';
    if (abs >= 1e6) return '$' + (n / 1e6).toFixed(n / 1e6 >= 100 ? 0 : 1).replace(/\.0$/, '') + 'M';
    if (abs >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return '$' + Math.round(n);
  }

  function fmtUsdFull(n) {
    if (n === null || n === undefined) return 'n/a';
    return '$' + Math.round(n).toLocaleString('en-US');
  }

  function fmtPct(n) {
    if (n === null || n === undefined) return '<span class="dim">n/a</span>';
    var sign = n > 0 ? '+' : '';
    var cls = n > 0 ? 'up' : n < 0 ? 'down' : '';
    return '<span class="' + cls + '">' + sign + n.toFixed(1) + '%</span>';
  }

  function fmtAge(days) {
    if (days === null || days === undefined) return '<span class="dim">unknown</span>';
    if (days < 30) return days + 'd';
    if (days < 365) return Math.floor(days / 30) + 'mo';
    var y = Math.floor(days / 365);
    var m = Math.floor((days % 365) / 30);
    return y + 'y' + (m > 0 ? ' ' + m + 'mo' : '');
  }

  function fmtChains(chains) {
    if (!chains || chains.length === 0) return '<span class="dim">—</span>';
    var first = esc(chains[0]);
    return chains.length > 1 ? first + ' <span class="dim">+' + (chains.length - 1) + '</span>' : first;
  }

  // ------------------------------------------------------------- routing

  var PAGE_SIZE = 50;

  function readHash() {
    var params = new URLSearchParams(window.location.hash.replace(/^#/, ''));
    return {
      view: params.get('view') || 'board',
      slug: params.get('slug') || '',
      q: params.get('q') || '',
      cat: params.get('cat') || '',
      chain: params.get('chain') || '',
      sort: params.get('sort') || 'rank',
      dir: params.get('dir') || 'asc',
      hide: params.get('hide') === null ? '1' : params.get('hide'),
      page: Math.max(1, parseInt(params.get('page') || '1', 10) || 1)
    };
  }

  function hashFor(state) {
    var params = new URLSearchParams();
    if (state.view && state.view !== 'board') params.set('view', state.view);
    if (state.slug) params.set('slug', state.slug);
    if (state.q) params.set('q', state.q);
    if (state.cat) params.set('cat', state.cat);
    if (state.chain) params.set('chain', state.chain);
    if (state.sort && state.sort !== 'rank') params.set('sort', state.sort);
    if (state.dir && state.dir !== 'asc') params.set('dir', state.dir);
    if (state.hide === '0') params.set('hide', '0');
    if (state.page && state.page > 1) params.set('page', String(state.page));
    var s = params.toString();
    return s ? '#' + s : '#view=board';
  }

  function go(state) { window.location.hash = hashFor(state); }

  // ------------------------------------------------------------ filtering

  function visibleRows(state) {
    var q = state.q.trim().toLowerCase();
    return DATA.rows.filter(function (r) {
      if (state.hide === '1' && r.shape_excluded) return false;
      if (state.cat && (r.category || 'Other') !== state.cat) return false;
      if (state.chain && (!r.chains || r.chains.indexOf(state.chain) === -1)) return false;
      if (q) {
        var hay = (r.name + ' ' + r.slug + ' ' + (r.category || '')).toLowerCase();
        if (hay.indexOf(q) === -1) return false;
      }
      return true;
    });
  }

  var SORT_KEYS = {
    rank: function (r) { return r.rank; },
    implied: function (r) { return valueOf(r); },
    tvl: function (r) { return r.tvl_usd; },
    change: function (r) { return r.change_7d === null ? null : r.change_7d; },
    age: function (r) { return r.age_days === null ? null : r.age_days; },
    name: function (r) { return r.name.toLowerCase(); }
  };

  function sortedRows(list, state) {
    var key = SORT_KEYS[state.sort] || SORT_KEYS.rank;
    var dir = state.dir === 'desc' ? -1 : 1;
    return list.slice().sort(function (a, b) {
      var va = key(a), vb = key(b);
      if (va === null && vb === null) return a.slug < b.slug ? -1 : 1;
      if (va === null) return 1;
      if (vb === null) return -1;
      if (va < vb) return -1 * dir;
      if (va > vb) return 1 * dir;
      return a.slug < b.slug ? -1 : 1;
    });
  }

  function unique(values) {
    var seen = {}, out = [];
    values.forEach(function (v) { if (!seen[v]) { seen[v] = 1; out.push(v); } });
    return out.sort();
  }

  // ------------------------------------------------------------- views

  function badgesFor(row) {
    var out = '';
    if (row.on_watchlist) out += '<span class="badge watch">Watchlist</span>';
    if (row.shape_excluded) out += '<span class="badge shape" title="' + esc(row.shape_note || '') + '">Flagged shape</span>';
    return out ? '<span class="badges">' + out + '</span>' : '';
  }

  function boardTable(list, state) {
    if (list.length === 0) return '<div class="empty">No protocols match these filters. <a href="#view=board">Clear the filters</a>.</div>';
    var pages = Math.max(1, Math.ceil(list.length / PAGE_SIZE));
    var page = Math.min(state.page, pages);
    var slice = list.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
    var arrow = function (key) {
      if (state.sort !== key) return '';
      return state.dir === 'desc' ? ' ▼' : ' ▲';
    };
    var th = function (label, key, cls) {
      return '<th class="sortable ' + (cls || '') + '" data-sort="' + key + '">' + label + arrow(key) + '</th>';
    };
    var rows = slice.map(function (r) {
      return '<tr><td class="rankcell">' + r.rank + '</td>' +
        '<td class="namecell"><a href="#view=detail&amp;slug=' + encodeURIComponent(r.slug) + '">' + esc(r.name) + '</a>' + badgesFor(r) + '</td>' +
        '<td>' + esc(r.category || 'Other') + '</td>' +
        '<td>' + fmtChains(r.chains) + '</td>' +
        '<td class="num" title="' + esc(fmtUsdFull(r.tvl_usd)) + '">' + fmtUsd(r.tvl_usd) + '</td>' +
        '<td class="num">' + fmtPct(r.change_7d) + '</td>' +
        '<td class="num">' + fmtAge(r.age_days) + '</td>' +
        '<td class="num" title="' + esc(fmtUsdFull(valueOf(r))) + '"><b>' + fmtUsd(valueOf(r)) + '</b></td></tr>';
    }).join('');
    var first = (page - 1) * PAGE_SIZE + 1, last = Math.min(list.length, page * PAGE_SIZE);
    var pager = '<div class="pager"><button data-page="' + (page - 1) + '"' + (page <= 1 ? ' disabled' : '') + '>← Prev</button>' +
      '<span class="pages">Page ' + page + ' of ' + pages + ' · rows ' + first + '–' + last + ' of ' + list.length + '</span>' +
      '<button data-page="' + (page + 1) + '"' + (page >= pages ? ' disabled' : '') + '>Next →</button></div>';
    return '<table class="board"><thead><tr>' + th('Rank', 'rank', 'rankcell') + th('Protocol', 'name') + '<th>Category</th><th>Chains</th>' +
      th('TVL', 'tvl', 'num') + th('7d', 'change', 'num') + th('Age', 'age', 'num') + th('Implied value', 'implied', 'num') +
      '</tr></thead><tbody>' + rows + '</tbody></table>' + pager;
  }

  function renderBoard(state) {
    var categories = unique(DATA.rows.map(function (r) { return r.category || 'Other'; }));
    var chains = unique(DATA.rows.reduce(function (acc, r) { return acc.concat(r.chains || []); }, []));
    var opts = function (list, current, allLabel) {
      var out = '<option value="">' + allLabel + '</option>';
      list.forEach(function (v) { out += '<option value="' + esc(v) + '"' + (v === current ? ' selected' : '') + '>' + esc(v) + '</option>'; });
      return out;
    };
    var excluded = DATA.rows.filter(function (r) { return r.shape_excluded; }).length;
    var html = '<div class="lede"><h1>Protocols that record no token, ranked by what a token would be worth</h1>' +
      '<p>Each value follows from the snapshot: TVL times the trading multiple its category earns, adjusted for seven-day growth, for how long it has run, and for how many chains it runs on. Open a protocol for the full working and its farm plan.</p>' +
      '<p class="counts"><b>' + DATA.rows.length + '</b> protocols that record no token · <b>' + DATA.watchlist_size + '</b> on the watchlist · ' +
      '<b>' + excluded + '</b> flagged by the watchlist rule\'s shape test · snapshot ' + esc(DATA.as_of) + ' · <b>' + DATA.live.length + '</b> already trading, set aside</p></div>' +
      '<div class="controls">' +
      '<div class="field"><label for="q">Search</label><input id="q" type="search" placeholder="Name, slug or category" value="' + esc(state.q) + '" autocomplete="off"></div>' +
      '<div class="field"><label for="cat">Category</label><select id="cat">' + opts(categories, state.cat, 'All categories') + '</select></div>' +
      '<div class="field"><label for="chain">Chain</label><select id="chain">' + opts(chains, state.chain, 'All chains') + '</select></div>' +
      '<label class="check"><input id="hide" type="checkbox"' + (state.hide === '1' ? ' checked' : '') + '> Hide flagged shapes</label>' +
      '<span class="showing" id="showing"></span></div>' +
      '<div id="board-region"></div>';
    main.innerHTML = html;
    var refresh = function () {
      var list = sortedRows(visibleRows(state), state);
      document.getElementById('board-region').innerHTML = boardTable(list, state);
      var shown = document.getElementById('showing');
      if (shown) shown.textContent = list.length + ' of ' + DATA.rows.length + ' protocols';
    };
    refresh();
    document.getElementById('q').addEventListener('input', function (e) {
      state.q = e.target.value;
      state.page = 1;
      history.replaceState(null, '', hashFor(state));
      refresh();
    });
    document.getElementById('cat').addEventListener('change', function (e) {
      state.cat = e.target.value; state.page = 1; go(state);
    });
    document.getElementById('chain').addEventListener('change', function (e) {
      state.chain = e.target.value; state.page = 1; go(state);
    });
    document.getElementById('hide').addEventListener('change', function (e) {
      state.hide = e.target.checked ? '1' : '0'; state.page = 1; go(state);
    });
  }

  function findRow(slug) {
    for (var i = 0; i < DATA.rows.length; i++) if (DATA.rows[i].slug === slug) return { row: DATA.rows[i], live: false };
    for (var j = 0; j < DATA.live.length; j++) if (DATA.live[j].slug === slug) return { row: DATA.live[j], live: true };
    return null;
  }

  function breakdownHtml(row) {
    var mult = multipleOf(row);
    var comps = DATA.calibration.counts[row.category || 'Other'];
    var multNote = comps ? 'median of ' + comps + ' trading protocol' + (comps === 1 ? '' : 's') + ' in ' + esc(row.category || 'Other') + ', shrunk toward the global median' : 'no trading protocols in this category: the global median multiple';
    var change = row.change_7d === null || row.change_7d === undefined ? null : row.change_7d;
    var clamped = change === null ? 0 : clamp(change, -40, 80);
    var growthNote = change === null ? 'no seven-day change reported: treated as flat' : 'seven-day change ' + (change > 0 ? '+' : '') + change.toFixed(1) + '%' + (clamped !== change ? ', clamped to ' + (clamped > 0 ? '+' : '') + clamped.toFixed(1) + '%' : '') + ', at 0.6 weight';
    var ageNote = row.age_days === null || row.age_days === undefined ? 'no listing date reported: neutral 0.90' : fmtAge(row.age_days).replace(/<[^>]*>/g, '') + ' on record, toward the eighteen-month cap';
    var chainNote = (row.chains ? row.chains.length : 0) + ' chain' + ((row.chains ? row.chains.length : 0) === 1 ? '' : 's') + ', capped at five extra';
    return '<table class="factors">' +
      '<tr><td>TVL on record</td><td>' + esc(fmtUsdFull(row.tvl_usd)) + '</td></tr>' +
      '<tr><td>× Category multiple <span class="why">' + multNote + '</span></td><td>×' + mult.toFixed(3) + '</td></tr>' +
      '<tr><td>× Growth factor <span class="why">' + esc(growthNote) + '</span></td><td>×' + growthMultOf(row).toFixed(3) + '</td></tr>' +
      '<tr><td>× Maturity factor <span class="why">' + esc(ageNote) + '</span></td><td>×' + maturityMultOf(row).toFixed(3) + '</td></tr>' +
      '<tr><td>× Breadth factor <span class="why">' + esc(chainNote) + '</span></td><td>×' + breadthMultOf(row).toFixed(3) + '</td></tr>' +
      '<tr class="total"><td>Implied value</td><td>' + esc(fmtUsdFull(valueOf(row))) + '</td></tr></table>';
  }

  function renderDetail(state) {
    var found = findRow(state.slug);
    if (!found) {
      main.innerHTML = '<div class="detail"><a class="back" href="#view=board">← Back to the board</a><h1>Unknown protocol</h1><p>No protocol with this slug is on the board.</p></div>';
      return;
    }
    var row = found.row;
    var steps = farmSteps(row).map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('');
    var valuePanel;
    if (found.live && row.valued_by === 'market') {
      valuePanel = '<div class="panel"><h2>Value</h2><p>This protocol\'s token already trades, so it is valued at its recorded market cap, the market\'s answer, not the model\'s. It is set aside from the ranked board: the board ranks only protocols that record no token.</p>' +
        '<table class="factors"><tr><td>Recorded market cap</td><td>' + esc(fmtUsdFull(row.mcap_usd)) + '</td></tr>' +
        '<tr><td>TVL on record</td><td>' + esc(fmtUsdFull(row.tvl_usd)) + '</td></tr>' +
        '<tr><td>Category multiple, for reference</td><td>×' + multipleOf(row).toFixed(3) + '</td></tr></table></div>';
    } else if (found.live) {
      valuePanel = '<div class="panel"><h2>Value</h2><p>This protocol records a token but no market cap, so the model values it the same way as the board, for comparison. It is set aside from the ranked board because its token already trades.</p>' + breakdownHtml(row) + '</div>';
    } else {
      valuePanel = '<div class="panel"><h2>How the value is figured</h2><p>TVL times the trading multiple its category earns, adjusted for growth, maturity and breadth. Every input is the snapshot\'s own figure for this protocol.</p>' + breakdownHtml(row) + '</div>';
    }
    var shapeNote = row.shape_excluded
      ? '<div class="note"><b>Flagged shape.</b> ' + esc(row.shape_note || '') + '. The watchlist rule leaves this shape out; the row stays on the board with its value shown, and the board lets you hide flagged rows.</div>' : '';
    var tokenNote = found.live
      ? '<p>DefiLlama\'s record for this protocol carries a token' + (row.symbol ? ' (' + esc(row.symbol) + ')' : '') + ', so it is set aside from the ranked board and shown for comparison.</p>'
      : '<p>DefiLlama\'s record for this protocol carries no token: no CoinGecko id and no ticker. That is a statement about the record, never proof that it has none.</p>';
    main.innerHTML = '<div class="detail"><a class="back" href="#view=board">← Back to the board</a>' +
      '<h1>' + esc(row.name) + '</h1>' +
      '<p class="sub">' + esc(row.category || 'Other') + ' · ' + esc((row.chains || []).join(', ') || 'no chains listed') + (found.live ? '' : ' · rank #' + row.rank) + '</p>' +
      badgesFor(row) +
      '<div class="stats">' +
      '<div class="stat"><div class="k">Implied value</div><div class="v">' + fmtUsd(found.live ? row.implied_value_usd : valueOf(row)) + '</div></div>' +
      '<div class="stat"><div class="k">TVL</div><div class="v">' + fmtUsd(row.tvl_usd) + '</div></div>' +
      '<div class="stat"><div class="k">7-day change</div><div class="v">' + fmtPct(row.change_7d) + '</div></div>' +
      '<div class="stat"><div class="k">Age on record</div><div class="v">' + fmtAge(row.age_days) + '</div></div>' +
      '</div>' + shapeNote + valuePanel +
      '<div class="panel"><h2>Farm plan</h2><p>Concrete steps, with what each costs and how long it takes. The plan is a starting point, not advice; check the protocol\'s own pages before acting.</p><ol class="plan">' + steps + '</ol></div>' +
      '<div class="panel"><h2>About the record</h2>' + tokenNote + '<p><a href="#view=method">How the radar works</a>, including the full list of category multiples.</p></div></div>';
  }

  function renderLive() {
    var rows = DATA.live.map(function (r) {
      var valueCell = r.valued_by === 'market'
        ? '<td class="num" title="' + esc(fmtUsdFull(r.mcap_usd)) + '"><b>' + fmtUsd(r.mcap_usd) + '</b></td>'
        : '<td class="num" title="' + esc(fmtUsdFull(r.implied_value_usd)) + '"><b>' + fmtUsd(r.implied_value_usd) + '</b> <span class="dim">model</span></td>';
      return '<tr><td class="namecell"><a href="#view=detail&amp;slug=' + encodeURIComponent(r.slug) + '">' + esc(r.name) + '</a> <span class="badges"><span class="badge live">Trading</span></span></td>' +
        '<td>' + esc(r.category || 'Other') + '</td><td>' + esc(r.symbol || '—') + '</td>' +
        '<td class="num">' + fmtUsd(r.tvl_usd) + '</td>' + valueCell + '</tr>';
    }).join('');
    main.innerHTML = '<div class="lede"><h1>Already trading, set aside</h1>' +
      '<p>The largest protocols whose tokens already trade. They are never ranked against the board: their market caps are the record the category multiples are learned from, so the board\'s values rest on prices the market already set. Rows marked “model” record a token but no market cap, and carry the modeled value for comparison.</p></div>' +
      '<table class="board"><thead><tr><th>Protocol</th><th>Category</th><th>Token</th><th class="num">TVL</th><th class="num">Market cap / value</th></tr></thead><tbody>' + rows + '</tbody></table>';
  }

  function renderMethod() {
    var cats = Object.keys(DATA.calibration.by_category).sort();
    var calRows = cats.map(function (c) {
      return '<tr><td>' + esc(c) + '</td><td class="num">' + DATA.calibration.counts[c] + '</td><td class="num">×' + DATA.calibration.by_category[c].toFixed(3) + '</td></tr>';
    }).join('');
    main.innerHTML = '<div class="method"><h1>How the radar works</h1>' +
      '<p><b>What it answers.</b> What a protocol\'s token would be worth if the protocol\'s record stayed as it is, and what a reader should do to farm the protocol. It does not predict whether or when a token is issued. Every implied value is this entry\'s own claim, never one make.fun makes.</p>' +
      '<h2>The value model</h2>' +
      '<div class="formula">implied value = TVL × category multiple × growth × maturity × breadth</div>' +
      '<ul><li><b>Category multiple.</b> For each category, the median market-cap-to-TVL ratio of the snapshot\'s protocols that record a market cap, shrunk toward the global median (×' + DATA.calibration.global.toFixed(3) + ') by how few of them there are, and clamped between ×0.05 and ×2.5. A category with no trading protocols takes the global median. The multiples are learned from this snapshot, never typed in, and no protocol is special-cased by name.</li>' +
      '<li><b>Growth.</b> 1 + 0.6 × the seven-day TVL change, with the change clamped between −40% and +80%: the snapshot\'s extremes are data spikes, not sustainable growth. No reported change counts as flat.</li>' +
      '<li><b>Maturity.</b> 0.80 rising to 1.00 over the first eighteen months on record: a record held longer is worth more. No listing date counts as 0.90.</li>' +
      '<li><b>Breadth.</b> 1.00 rising by 0.04 per extra chain, capped at five: a wider footprint is worth more, but the fifth chain adds little the fourth did not.</li></ul>' +
      '<p><b>Protocols whose tokens already trade</b> are set aside from the board. Where one records a market cap it is valued at that cap; where it records a token but no cap, the model values it for comparison. Their prices are what the multiples are learned from.</p>' +
      '<h2>Category multiples learned from this snapshot</h2>' +
      '<table class="cal"><thead><tr><th>Category</th><th class="num">Trading protocols</th><th class="num">Multiple</th></tr></thead><tbody>' + calRows +
      '<tr><td>Global median (categories with no trading protocols)</td><td class="num">—</td><td class="num">×' + DATA.calibration.global.toFixed(3) + '</td></tr></tbody></table>' +
      '<h2>The watchlist, and flagged shapes</h2>' +
      '<p>The snapshot names a watchlist of ' + DATA.watchlist_size + ' protocols at or above $' + Number(DATA.floor_usd).toLocaleString('en-US') + ' of TVL that record no token and are not wrapped, staked or bridged products. The watchlist is a floor, never a ceiling: the board ranks every protocol that records no token, ' + DATA.rows.length + ' in all, and every watchlist protocol is on it. Rows whose shape the watchlist rule leaves out (a bridge, staking or exchange category, a version-marked name, a wrapped or staked name, an exchange name) are flagged, with the reason on their detail view, and the board lets you hide them. The snapshot carries no parent-protocol field, so the rule\'s parent part is not applied.</p>' +
      '<h2>Farm plans</h2>' +
      '<p>Each protocol\'s plan comes from its category\'s template, filled with the protocol\'s own name, main chain, a starter size ($1,000 on Ethereum, $500 elsewhere) and a hold length set by its age. Every step says what it costs and how long it takes. Plans are starting points, not advice.</p>' +
      '<h2>The data</h2>' +
      '<p>One frozen snapshot of DefiLlama\'s public record, fetched ' + esc(DATA.as_of) + '. It does not move and is not updated. The snapshot carries no ranking, no value and no plan: deriving them is this entry\'s work. A protocol is described as recording no token, never as having none, because a protocol on the board may still have a token its DefiLlama record does not carry.</p></div>';
  }

  function render() {
    var state = readHash();
    var nav = document.querySelectorAll('[data-nav]');
    for (var i = 0; i < nav.length; i++) {
      nav[i].classList.toggle('on', nav[i].getAttribute('data-nav') === state.view || (state.view === 'detail' && nav[i].getAttribute('data-nav') === 'board'));
    }
    if (state.view === 'detail') renderDetail(state);
    else if (state.view === 'live') renderLive();
    else if (state.view === 'method') renderMethod();
    else renderBoard(state);
    main.setAttribute('aria-busy', 'false');
  }

  // One delegated listener for sort headers and pager buttons, attached once:
  // the board re-renders into #main, so a per-render listener would pile up.
  main.addEventListener('click', function (e) {
    var state = readHash();
    var thEl = e.target.closest ? e.target.closest('th[data-sort]') : null;
    if (thEl) {
      var key = thEl.getAttribute('data-sort');
      if (state.sort === key) { state.dir = state.dir === 'desc' ? 'asc' : 'desc'; }
      else { state.sort = key; state.dir = (key === 'rank' || key === 'name') ? 'asc' : 'desc'; }
      state.page = 1; go(state); return;
    }
    var btn = e.target.closest ? e.target.closest('button[data-page]') : null;
    if (btn && !btn.disabled) { state.page = parseInt(btn.getAttribute('data-page'), 10); go(state); }
  });

  window.addEventListener('hashchange', render);
  render();

  // Self-check hook for testing: the page's recomputed values, farm plans
  // and shape flags must match the rows the builder wrote, for every row.
  window.__radar = {
    data: DATA,
    state: readHash,
    check: function () {
      var bad = [];
      DATA.rows.forEach(function (r) {
        if (valueOf(r) !== r.implied_value_usd) bad.push(r.slug + ': value ' + valueOf(r) + ' != ' + r.implied_value_usd);
        if (farmSteps(r).join('\n') !== r.farm_steps.join('\n')) bad.push(r.slug + ': farm plan differs');
        if (shapeExclusion(r) !== r.shape_note) bad.push(r.slug + ': shape flag differs');
      });
      DATA.live.forEach(function (r) {
        if (r.valued_by === 'market') { if (r.implied_value_usd !== Math.round(r.mcap_usd)) bad.push(r.slug + ': market value differs'); }
        else if (valueOf(r) !== r.implied_value_usd) bad.push(r.slug + ': live model value differs');
      });
      return { ok: bad.length === 0, mismatches: bad.slice(0, 5), checked: DATA.rows.length + DATA.live.length };
    }
  };
})();
