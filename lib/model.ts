// Launch Radar's value model.
//
// Every row is scored by the same functions, from the snapshot's own figures.
// No protocol is ever special-cased by name: the category multiples are
// learned from the snapshot itself, from the protocols whose tokens already
// trade, and every other factor comes from the row's own TVL, growth, age
// and chain count. A reader can re-derive any row's value from the snapshot
// with the functions in this file.

export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** One row of board.json: the gate's shape, nothing more. */
export interface BoardRow {
  slug: string;
  name: string;
  rank: number;
  implied_value_usd: number;
  farm_steps: string[];
}

/** One row of the dashboard's data: the board row plus everything the page shows. */
export interface RadarRow extends BoardRow {
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  age_days: number | null;
  has_token: boolean;
  symbol: string | null;
  mcap_usd: number | null;
  valued_by: 'market' | 'model';
  multiple: number;
  growth_mult: number;
  maturity_mult: number;
  breadth_mult: number;
  on_watchlist: boolean;
  shape_excluded: boolean;
  shape_note: string | null;
}

export interface RadarData {
  as_of: string;
  floor_usd: number;
  watchlist_size: number;
  model: string;
  calibration: { by_category: Record<string, number>; global: number; counts: Record<string, number> };
  rows: RadarRow[];
  live: LiveRow[];
}

/** A protocol whose token already trades, set aside from the ranked board:
 *  the comparison set the multiples are learned from. It is never ranked
 *  against the pre-token protocols. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  age_days: number | null;
  symbol: string | null;
  mcap_usd: number | null;
  valued_by: 'market' | 'model';
  implied_value_usd: number;
  multiple: number;
}

export const MODEL_VERSION = 'launch-radar-1';

/** The multiple a category's TVL is worth is learned, then shrunk toward the
 *  global median so a category with one or two trading protocols cannot set
 *  an absurd price, and clamped so no category prices above 2.5x TVL. */
const MULT_MIN = 0.05;
const MULT_MAX = 2.5;
const SHRINK_K = 8;
const RATIO_CAP = 50;

function clamp(value: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, value));
}

function median(values: number[]): number {
  const sorted = values.slice().sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** A protocol records no token when DefiLlama records neither a CoinGecko id
 *  nor a ticker for it. That is a statement about the record, never proof
 *  that the protocol has no token. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.gecko_id === null && p.symbol === null;
}

/** Whole days from the day DefiLlama began tracking the protocol to the
 *  snapshot's date, or null when the record carries no date. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const ms = Date.parse(`${asOf}T00:00:00Z`) - Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(ms)) return null;
  return Math.max(0, Math.floor(ms / 86_400_000));
}

export interface Calibration {
  byCategory: Record<string, number>;
  global: number;
  counts: Record<string, number>;
}

/** Learn each category's trading multiple from the snapshot: the median
 *  market-cap-to-TVL ratio of the category's protocols that record a market
 *  cap, shrunk toward the global median by how few of them there are. */
export function calibrate(snapshot: Snapshot): Calibration {
  const all: number[] = [];
  const perCategory = new Map<string, number[]>();
  for (const p of snapshot.protocols) {
    if (p.mcap_usd === null || p.mcap_usd <= 0 || p.tvl_usd <= 0) continue;
    const ratio = p.mcap_usd / p.tvl_usd;
    if (!(ratio > 0 && ratio <= RATIO_CAP)) continue;
    all.push(ratio);
    const key = p.category ?? 'Other';
    const list = perCategory.get(key) ?? [];
    list.push(ratio);
    perCategory.set(key, list);
  }
  const global = clamp(all.length > 0 ? median(all) : 0.2, MULT_MIN, MULT_MAX);
  const byCategory: Record<string, number> = {};
  const counts: Record<string, number> = {};
  for (const [key, list] of perCategory) {
    counts[key] = list.length;
    byCategory[key] = clamp((list.length * median(list) + SHRINK_K * global) / (list.length + SHRINK_K), MULT_MIN, MULT_MAX);
  }
  return { byCategory, global, counts };
}

export interface Valuation {
  implied: number;
  multiple: number;
  growthMult: number;
  maturityMult: number;
  breadthMult: number;
  age: number | null;
  valuedBy: 'market' | 'model';
}

/** What a protocol's token would be worth if its record stayed as it is.
 *  A protocol whose token already trades and records a market cap is valued
 *  at that cap: the market's answer, not the model's. Anything else is
 *  valued at TVL times its category's learned multiple, adjusted for
 *  seven-day growth (clamped: the snapshot's extremes are data spikes, not
 *  sustainable growth), for maturity (a record held longer is worth more,
 *  up to eighteen months) and for chain breadth (up to five extra chains). */
export function impliedValue(p: SnapshotProtocol, asOf: string, cal: Calibration): Valuation {
  const age = ageDays(asOf, p.listed_at);
  const multiple = cal.byCategory[p.category ?? 'Other'] ?? cal.global;
  if (!isPreToken(p) && p.mcap_usd !== null && p.mcap_usd > 0) {
    return { implied: Math.round(p.mcap_usd), multiple, growthMult: 1, maturityMult: 1, breadthMult: 1, age, valuedBy: 'market' };
  }
  const growthMult = 1 + 0.6 * (clamp(p.change_7d ?? 0, -40, 80) / 100);
  const maturityMult = age === null ? 0.9 : 0.8 + 0.2 * Math.min(1, age / 540);
  const breadthMult = 1 + 0.04 * Math.min(Math.max(p.chains.length - 1, 0), 5);
  const implied = Math.max(1, Math.round(p.tvl_usd * multiple * growthMult * maturityMult * breadthMult));
  return { implied, multiple, growthMult, maturityMult, breadthMult, age, valuedBy: 'model' };
}

// ---------------------------------------------------------------- farm plans

function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** What one transaction typically costs on a chain, in words a reader can
 *  budget with. Chains not listed here take the default. */
const GAS_HINTS: Record<string, string> = {
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
  'Hyperliquid L1': 'a few cents of gas per transaction',
};

function gasHint(chain: string): string {
  return GAS_HINTS[chain] ?? 'a few dollars of gas per transaction';
}

/** A starter size for the plan's main action: larger on Ethereum, where gas
 *  eats small positions, smaller everywhere else. */
function capitalFor(p: SnapshotProtocol): number {
  return chainOf(p) === 'Ethereum' ? 1000 : 500;
}

/** How long to leave the position open: a newer protocol proves itself
 *  faster, an older one earns a longer hold. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 60;
  if (age < 180) return 30;
  if (age < 540) return 60;
  return 90;
}

interface PlanContext {
  chain: string;
  gas: string;
  capital: number;
  half: number;
  holdDays: number;
}

function familyOf(category: string | null): string {
  const c = (category ?? '').toLowerCase();
  if (c.includes('bridge')) return 'bridge';
  if (c.includes('staking') || c.includes('restaking')) return 'staking';
  if (c.includes('lending') || c.includes('cdp') || c.includes('collateral') || c.includes('leveraged')) return 'lending';
  if (c.includes('yield') || c === 'farm') return 'yield';
  if (c.includes('dex') || c.includes('deriv') || c.includes('option') || c.includes('synthetic') || c.includes('trading') || c.includes('prediction')) return 'trading';
  if (c.includes('stable') || c.includes('reserve currency')) return 'stable';
  if (c.includes('rwa')) return 'rwa';
  if (c === 'cex' || c.includes('exchange')) return 'cex';
  if (c.includes('risk')) return 'risk';
  return 'default';
}

const PLANS: Record<string, (name: string, ctx: PlanContext) => string[]> = {
  trading: (name, ctx) => [
    `Swap about $${ctx.capital} of assets on ${name} on ${ctx.chain}, in two or three trades over a week rather than all at once, so the activity reads as real use. Budget ${ctx.gas}; about 30 minutes in total.`,
    `Add about $${ctx.capital} to one of ${name}'s main liquidity pools on ${ctx.chain} and hold the position for at least ${ctx.holdDays} days, collecting fees while you wait. Expect ${ctx.gas} to enter and to exit.`,
    `Return weekly: one small swap or a rebalance of the pool position, and check the pool's rewards page for any points or incentive program ${name} runs. About 10 minutes a week.`,
    `If ${name} has a governance forum or a points dashboard, connect the same wallet you traded with and register for any program it offers; keep the wallet's history in one place. About 20 minutes, once.`,
    `Keep records: the wallet address, the dates and sizes of each trade and pool deposit, and any points balance, so a future claim is easy to prove. Only use funds you can afford to lose; pools can lose value when prices move.`,
  ],
  lending: (name, ctx) => [
    `Supply about $${ctx.capital} of a major asset (ETH, BTC or a dollar stablecoin) to ${name} on ${ctx.chain} and leave it supplied for at least ${ctx.holdDays} days. Budget ${ctx.gas} for the deposit; about 15 minutes.`,
    `Borrow a small amount against the supply, under half its value, and repay it within a week, so the wallet shows both sides of the market. Interest for a week on $${ctx.half} is usually a few dollars; about 15 minutes.`,
    `Repeat monthly: top the supply up or adjust the borrow, and check whether ${name} runs a points or rewards program for suppliers and borrowers. About 10 minutes a month.`,
    `If ${name} publishes a points dashboard, connect the same wallet and confirm your activity is counted; keep one wallet for all of it. About 20 minutes, once.`,
    `Keep records of the wallet, the supply and borrow amounts and their dates. Only use funds you can afford to lose; a borrow can be liquidated if collateral prices fall sharply.`,
  ],
  staking: (name, ctx) => [
    `Stake about $${ctx.capital} through ${name} on ${ctx.chain} and hold the receipt token in the same wallet for at least ${ctx.holdDays} days. Budget ${ctx.gas}; about 15 minutes.`,
    `Put the receipt token to work once: supply it to one lending market or liquidity pool ${name} lists as a partner, so the wallet shows the full loop. Budget ${ctx.gas}; about 20 minutes.`,
    `Check monthly that the stake is still earning and whether ${name} runs a points program; claim any rewards it offers rather than leaving them. About 10 minutes a month.`,
    `Keep the stake in one wallet and keep records of the stake size and dates, so a future claim is easy to prove. Only use funds you can afford to lose; receipt tokens can trade below their backing.`,
  ],
  bridge: (name, ctx) => [
    `Bridge about $${ctx.capital} through ${name} between ${ctx.chain} and one other chain it serves, in two or three transfers over a month rather than one large one. Budget ${ctx.gas} plus the bridge fee each way; about 20 minutes per transfer including the wait.`,
    `Use the bridged funds on the destination chain within a day, in a swap or a deposit, so the wallet's activity reads as real use rather than a single hop. About 15 minutes.`,
    `Repeat monthly with a different route ${name} serves, and check whether it runs a points or fee-rebate program. About 20 minutes a month.`,
    `Keep records of each transfer's size, route and date. Only use funds you can afford to lose; bridges carry smart-contract and custodian risk.`,
  ],
  yield: (name, ctx) => [
    `Deposit about $${ctx.capital} into one of ${name}'s vaults or strategies on ${ctx.chain} and leave it for at least ${ctx.holdDays} days. Budget ${ctx.gas}; about 15 minutes.`,
    `Harvest or compound the yield once a month, and check the vault's strategy page for any points or bonus program. Budget ${ctx.gas} per harvest; about 10 minutes.`,
    `If ${name} offers more than one vault, split a second deposit of about $${ctx.half} into a different strategy after the first month, so the wallet shows breadth. About 15 minutes.`,
    `Keep records of deposits, harvests and the wallet used. Only use funds you can afford to lose; vault strategies can lose value.`,
  ],
  stable: (name, ctx) => [
    `Mint or buy about $${ctx.capital} of ${name}'s stable asset on ${ctx.chain} and hold it in one wallet for at least ${ctx.holdDays} days. Budget ${ctx.gas}; about 15 minutes.`,
    `Use the stable asset once: supply it to a lending market or a liquidity pool, so the wallet shows the asset in circulation rather than idle. Budget ${ctx.gas}; about 20 minutes.`,
    `Check monthly for any savings rate, points or rewards ${name} offers holders, and claim what is offered. About 10 minutes a month.`,
    `Keep records of the mint or purchase and the wallet. Only use funds you can afford to lose; a stable asset can lose its peg.`,
  ],
  rwa: (name, ctx) => [
    `Buy about $${ctx.capital} of ${name}'s tokenized offering on ${ctx.chain}, after reading its disclosures about what backs it, and hold for at least ${ctx.holdDays} days. Budget ${ctx.gas} plus any issuance fee; about 30 minutes including the reading.`,
    `If ${name} offers a yield or distribution, claim or reinvest it monthly and keep the holding in one wallet. About 10 minutes a month.`,
    `Check quarterly whether ${name} runs a holder program or points, and confirm the holding still matches the disclosed backing. About 20 minutes a quarter.`,
    `Keep records of the purchase, the disclosures and the wallet. Only use funds you can afford to lose; tokenized assets carry issuer and legal risk.`,
  ],
  cex: (name, ctx) => [
    `Open and verify an account with ${name} if you do not have one, and keep it in good standing; verification usually takes a day. No cost beyond the time.`,
    `Trade about $${ctx.capital} across a few orders over a month on ${name}, and use one of its earn or staking products with part of the balance. Trading fees are usually under 0.1% per order.`,
    `Hold a steady balance and return weekly; if ${name} runs a rewards or points program, opt in with the same account. About 10 minutes a week.`,
    `Keep records of trades and balances. Only keep funds on an exchange you can afford to lose access to; exchange balances are custodied, not self-held.`,
  ],
  risk: (name, ctx) => [
    `Deposit about $${ctx.capital} into a vault ${name} curates on ${ctx.chain} and hold for at least ${ctx.holdDays} days. Budget ${ctx.gas}; about 20 minutes including reading the vault's strategy.`,
    `Read the curator's allocation reports monthly and check whether the vault earns points or incentives. About 15 minutes a month.`,
    `If ${name} curates more than one vault, add about $${ctx.half} to a second one after a month. About 15 minutes.`,
    `Keep records of deposits and the wallet. Only use funds you can afford to lose; curated vaults carry the risks of every market they allocate to.`,
  ],
  default: (name, ctx) => [
    `Use ${name} on ${ctx.chain} with about $${ctx.capital}: make the protocol's main action (its swap, deposit, stake or mint) two or three times over the first week. Budget ${ctx.gas}; about 30 minutes in total.`,
    `Leave the position open for at least ${ctx.holdDays} days and return weekly to check for a points, rewards or incentive program ${name} runs. About 10 minutes a week.`,
    `Connect the same wallet to any dashboard ${name} publishes and confirm your activity is counted; keep all of it in one wallet. About 20 minutes, once.`,
    `Keep records of the wallet, the amounts and the dates. Only use funds you can afford to lose; new protocols carry smart-contract risk.`,
  ],
};

/** The farm plan for a protocol: its category's template, filled with the
 *  protocol's own name, main chain, a starter size and a hold length. */
export function farmSteps(p: SnapshotProtocol, age: number | null): string[] {
  const chain = chainOf(p);
  const capital = capitalFor(p);
  const ctx: PlanContext = { chain, gas: gasHint(chain), capital, half: Math.round(capital / 2), holdDays: holdDaysFor(age) };
  const plan = PLANS[familyOf(p.category)] ?? PLANS['default']!;
  return plan(p.name, ctx);
}

// ---------------------------------------------------------------- the board

/** The watchlist rule's shape test, from the snapshot's own fields: the
 *  categories it leaves out, the version markers, the wrapped/staked words
 *  and the exchange names. The snapshot carries no parent-protocol field,
 *  so the rule's parent part cannot be applied and is not claimed: this flag
 *  is the name-and-category part of the rule only. A flagged row stays on
 *  the board; the dashboard lets the reader hide flagged rows, and says why
 *  each one is flagged. */
const EXCLUDED_CATEGORIES = new Set(['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX']);
const VERSION_MARKER = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
const EXCHANGE_NAMES = ['Binance', 'Coinbase', 'Bybit', 'Kraken', 'Bitget', 'OKX', 'Bitfinex', 'Gemini'];

export function shapeExclusion(p: SnapshotProtocol): string | null {
  if (p.category !== null && EXCLUDED_CATEGORIES.has(p.category)) return `category ${p.category} is one the watchlist rule leaves out`;
  if (VERSION_MARKER.test(p.name)) return 'name ends in a version marker';
  if (/\bwrapped\b|\bstaked\b|\bstaking\b/i.test(p.name)) return 'name carries wrapped, staked or staking';
  for (const exchange of EXCHANGE_NAMES) {
    if (p.name.startsWith(exchange)) return `name begins with the exchange name ${exchange}`;
  }
  return null;
}

const LIVE_SIZE = 48;

/** Score the snapshot. The ranked board holds every protocol that records
 *  no token, ranked by modeled implied value (ties break by slug, so the
 *  order is the same on every run). The protocols whose tokens already
 *  trade are set aside as the comparison set, never ranked against the
 *  board: the largest 48 by market cap, or modeled value where no market
 *  cap is recorded. */
export function buildRadar(snapshot: Snapshot): { board: BoardRow[]; radar: RadarData } {
  const cal = calibrate(snapshot);
  const watchlist = new Set(snapshot.watchlist);
  const rows: RadarRow[] = [];
  const live: LiveRow[] = [];
  for (const p of snapshot.protocols) {
    const v = impliedValue(p, snapshot.as_of, cal);
    if (isPreToken(p)) {
      const exclusion = shapeExclusion(p);
      rows.push({
        slug: p.slug,
        name: p.name,
        rank: 0,
        implied_value_usd: v.implied,
        farm_steps: farmSteps(p, v.age),
        category: p.category,
        chains: p.chains,
        tvl_usd: p.tvl_usd,
        change_7d: p.change_7d,
        age_days: v.age,
        has_token: false,
        symbol: p.symbol,
        mcap_usd: p.mcap_usd,
        valued_by: 'model',
        multiple: v.multiple,
        growth_mult: v.growthMult,
        maturity_mult: v.maturityMult,
        breadth_mult: v.breadthMult,
        on_watchlist: watchlist.has(p.slug),
        shape_excluded: exclusion !== null,
        shape_note: exclusion,
      });
    } else {
      live.push({
        slug: p.slug,
        name: p.name,
        category: p.category,
        chains: p.chains,
        tvl_usd: p.tvl_usd,
        change_7d: p.change_7d,
        age_days: v.age,
        symbol: p.symbol,
        mcap_usd: p.mcap_usd,
        valued_by: v.valuedBy,
        implied_value_usd: v.implied,
        multiple: v.multiple,
      });
    }
  }
  rows.sort((a, b) => b.implied_value_usd - a.implied_value_usd || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
  rows.forEach((row, i) => {
    row.rank = i + 1;
  });
  live.sort((a, b) => b.implied_value_usd - a.implied_value_usd || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
  const board: BoardRow[] = rows.map((r) => ({ slug: r.slug, name: r.name, rank: r.rank, implied_value_usd: r.implied_value_usd, farm_steps: r.farm_steps }));
  return {
    board,
    radar: {
      as_of: snapshot.as_of,
      floor_usd: snapshot.floor_usd,
      watchlist_size: snapshot.watchlist.length,
      model: MODEL_VERSION,
      calibration: { by_category: cal.byCategory, global: cal.global, counts: cal.counts },
      rows,
      live: live.slice(0, LIVE_SIZE),
    },
  };
}

/** The dashboard's data as one script: a single global, written beside the
 *  page, holding the same rows the board holds. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR = ${JSON.stringify(radar)};\n`;
}

/** Read and validate the sealed snapshot. Anything that is not the shape
 *  the snapshot promises is a failure, not a guess. */
export function parseSnapshot(text: string): Snapshot {
  const data = JSON.parse(text) as Snapshot;
  if (typeof data !== 'object' || data === null) throw new Error('snapshot is not an object');
  if (typeof data.as_of !== 'string') throw new Error('snapshot has no as_of date');
  if (!Array.isArray(data.protocols) || data.protocols.length === 0) throw new Error('snapshot has no protocols');
  if (!Array.isArray(data.watchlist)) throw new Error('snapshot has no watchlist');
  for (const p of data.protocols) {
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Array.isArray(p.chains)) {
      throw new Error('snapshot holds a protocol without slug, name, tvl_usd or chains');
    }
  }
  return data;
}

/** The gate's board rules, checked before anything is written: 100 to 4,000
 *  rows, slugs unique and from the snapshot, every watchlist slug covered,
 *  ranks exactly 1 to N, values never rising with rank and never all equal,
 *  and every farm plan 3 to 12 steps of 20 to 600 characters. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  if (board.length < 100 || board.length > 4000) return `board holds ${board.length} rows, outside 100 to 4000`;
  const known = new Set(snapshot.protocols.map((p) => p.slug));
  const seen = new Set<string>();
  let previous = Number.POSITIVE_INFINITY;
  let allEqual = board.length > 1;
  for (let i = 0; i < board.length; i++) {
    const row = board[i]!;
    if (!known.has(row.slug)) return `row ${i + 1} names ${row.slug}, not one of the snapshot's protocols`;
    if (seen.has(row.slug)) return `row ${i + 1} repeats slug ${row.slug}`;
    seen.add(row.slug);
    if (typeof row.name !== 'string' || row.name.length === 0) return `row ${i + 1} has no name`;
    if (row.rank !== i + 1) return `row ${i + 1} carries rank ${row.rank}`;
    if (!Number.isInteger(row.implied_value_usd) || row.implied_value_usd <= 0) return `row ${i + 1} has no positive whole implied value`;
    if (row.implied_value_usd > previous) return `row ${i + 1}'s value rises above row ${i}'s`;
    if (row.implied_value_usd !== board[0]!.implied_value_usd) allEqual = false;
    previous = row.implied_value_usd;
    if (row.farm_steps.length < 3 || row.farm_steps.length > 12) return `row ${i + 1} holds ${row.farm_steps.length} farm steps, outside 3 to 12`;
    for (const step of row.farm_steps) {
      const len = step.trim().length;
      if (len < 20 || len > 600) return `row ${i + 1} holds a farm step of ${len} characters, outside 20 to 600`;
    }
  }
  if (allEqual) return 'every row carries the same implied value: the board ranks nothing';
  for (const slug of snapshot.watchlist) {
    if (!seen.has(slug)) return `watchlist slug ${slug} is missing from the board`;
  }
  return null;
}
