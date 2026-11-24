// Token Radar v6 — the model. Node 22, standard library only, deterministic.
// Written fresh from the design spec: two small fits on the sealed snapshot,
// then an expected-value board over all 758 protocols.
//
// Idea: a protocol's token, if it ever exists, is worth its fitted implied
// value; the board ranks by expected value = implied value x sqrt(P), where
// P is the fitted share of peer protocols that already record a token. The
// square root bounds the multiplier. P is a share of peers, never a forecast
// that a protocol will launch a token.

export interface Protocol {
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
  protocols: Protocol[];
  watchlist: string[];
}

export interface BoardRow {
  slug: string;
  name: string;
  rank: number;
  implied_value_usd: number;
  farm_steps: string[];
  status: 'CANDIDATE' | 'LIVE' | 'TRACKED';
  verdict: 'FARM' | 'THIN' | 'SKIP' | 'LIVE' | 'TRACKED';
  p_token: number;
  tvl_usd: number;
  category: string | null;
  chains: string[];
  age_years: number;
  growth_7d: number | null;
  implied_fit_usd: number;
  expected_value_usd: number;
  dollars_per_hour: number | null;
  expected_share_usd: number | null;
  gas_usd: number;
  breakeven_multiple: number | null;
  min_capital_usd: number;
  blend_rank: number | null;
  watchlist: boolean;
}

export interface RadarMeta {
  as_of: string;
  protocols: number;
  candidates: number;
  live: number;
  tracked: number;
  watchlist_total: number;
  watchlist_covered: number;
  implied_beta: number[];
  implied_loo_median_error: number;
  implied_walk_forward_median_error: number;
  odds_beta: number[];
  odds_cv_auc: number;
  odds_temporal_auc: number;
  verdict_split: { FARM: number; THIN: number; SKIP: number };
  assumptions: string;
}

export interface Radar {
  meta: RadarMeta;
  rows: BoardRow[];
}

const DAY_MS = 86_400_000;
const YEAR_DAYS = 365.25;

// A protocol records a token when DefiLlama carries either identifier.
export function hasToken(p: Protocol): boolean {
  return p.gecko_id !== null || p.symbol !== null;
}

const EXCLUDED_CATEGORIES = new Set([
  'Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX',
]);
const EXCHANGE_PREFIXES = ['Binance', 'Coinbase', 'Bybit', 'Kraken', 'Bitget', 'OKX', 'Bitfinex', 'Gemini'];
const VERSION_SUFFIX = /\s(v\d+|V\d+|\d+\.\d+)\s*$/;
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;

// The watchlist rule, minus the parent-protocol clause (the snapshot carries
// no parent field): not a wrapped, staked or bridged product of a protocol
// whose token already trades. Applied to pre-token protocols it yields the
// 198 launch candidates; applied to token peers it yields their training set.
export function peerEligible(p: Protocol): boolean {
  if (p.category !== null && EXCLUDED_CATEGORIES.has(p.category)) return false;
  if (VERSION_SUFFIX.test(p.name)) return false;
  if (WRAPPED_WORD.test(p.name)) return false;
  if (EXCHANGE_PREFIXES.some((e) => p.name.startsWith(e))) return false;
  return true;
}

export function isCandidate(p: Protocol): boolean {
  return !hasToken(p) && peerEligible(p);
}

export function parseSnapshot(text: string): Snapshot {
  const data = JSON.parse(text) as Snapshot;
  if (!Array.isArray(data.protocols) || !Array.isArray(data.watchlist)) {
    throw new Error('token radar: snapshot holds no protocols/watchlist arrays');
  }
  return data;
}

function ageYears(p: Protocol, asOfMs: number, medianAge: number): number {
  if (p.listed_at === null) return medianAge;
  const ms = asOfMs - Date.parse(`${p.listed_at}T00:00:00Z`);
  return Math.max(0, ms / DAY_MS / YEAR_DAYS);
}

// 7-day TVL change as a log factor, clipped so one 4,448% week cannot rule
// the fit. Null (unreported) reads as no change.
function growthLog(p: Protocol): number {
  if (p.change_7d === null) return 0;
  return Math.max(-1, Math.min(2, Math.log(1 + p.change_7d / 100)));
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)]!;
}

// Gauss-Jordan with partial pivoting; the systems here are tiny (<= 4).
export function solveLinear(a: number[][], b: number[]): number[] {
  const n = b.length;
  const m = a.map((row, i) => [...row, b[i]!]);
  for (let c = 0; c < n; c++) {
    let piv = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(m[r]![c]!) > Math.abs(m[piv]![c]!)) piv = r;
    const tmp = m[c]!; m[c] = m[piv]!; m[piv] = tmp;
    const d = m[c]![c]!;
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = m[r]![c]! / d;
      for (let k = c; k <= n; k++) m[r]![k]! -= f * m[c]![k]!;
    }
  }
  return m.map((row, i) => row[n]! / row[i]!);
}

function ols(x: number[][], y: number[]): { beta: number[]; inv: number[][] } {
  const k = x[0]!.length;
  const xtx: number[][] = Array.from({ length: k }, () => new Array<number>(k).fill(0));
  const xty: number[] = new Array<number>(k).fill(0);
  for (let i = 0; i < x.length; i++) {
    for (let a = 0; a < k; a++) {
      xty[a]! += x[i]![a]! * y[i]!;
      for (let b = 0; b < k; b++) xtx[a]![b]! += x[i]![a]! * x[i]![b]!;
    }
  }
  const beta = solveLinear(xtx, xty);
  const inv: number[][] = [];
  for (let j = 0; j < k; j++) {
    const e = new Array<number>(k).fill(0);
    e[j] = 1;
    inv.push(solveLinear(xtx, e));
  }
  const xtxInv = Array.from({ length: k }, (_, a) => Array.from({ length: k }, (_, b) => inv[b]![a]!));
  return { beta, inv: xtxInv };
}

function sigmoid(z: number): number {
  const c = Math.max(-30, Math.min(30, z));
  return 1 / (1 + Math.exp(-c));
}

// Mann-Whitney AUC: the chance a token protocol scores above a pre-token one.
function auc(rows: Protocol[], score: (p: Protocol) => number): number {
  const pos = rows.filter(hasToken);
  const neg = rows.filter((p) => !hasToken(p));
  let wins = 0;
  let ties = 0;
  for (const a of pos) {
    for (const b of neg) {
      const d = score(a) - score(b);
      if (d > 0) wins++;
      else if (d === 0) ties++;
    }
  }
  return (wins + 0.5 * ties) / (pos.length * neg.length);
}

export function fmtUsd(v: number): string {
  if (v >= 1e9) return `$${(v / 1e9).toFixed(2)}B`;
  if (v >= 1e6) return `$${(v / 1e6).toFixed(1)}M`;
  if (v >= 1e3) return `$${(v / 1e3).toFixed(1)}K`;
  if (v < 10) return `$${v.toFixed(2)}`;
  return `$${v.toFixed(0)}`;
}

const GAS_PER_TX_USD: Record<string, number> = {
  ethereum: 4.0, bsc: 0.15, binance: 0.15, bnbchain: 0.15, arbitrum: 0.1, optimism: 0.08,
  base: 0.05, polygon: 0.02, avalanche: 0.3, solana: 0.002, gnosis: 0.02, fantom: 0.05,
  cronos: 0.05, linea: 0.05, zksync: 0.1, scroll: 0.1, blast: 0.05, mode: 0.02,
  fraxtal: 0.02, sei: 0.01, sui: 0.01, aptos: 0.01, near: 0.01, tron: 0.3, kava: 0.02,
  celo: 0.01, moonbeam: 0.05, moonriver: 0.05, harmony: 0.01,
};

export function cheapestChain(p: Protocol): { chain: string; txUsd: number } {
  let best: { chain: string; txUsd: number } = { chain: p.chains[0] ?? 'Ethereum', txUsd: 0.5 };
  for (const chain of p.chains) {
    const key = chain.toLowerCase().replace(/[\s_-]+/g, '');
    const tx = GAS_PER_TX_USD[key] ?? 0.5;
    if (tx < best.txUsd) best = { chain, txUsd: tx };
  }
  return best;
}

const CATEGORY_ACTION: Record<string, string> = {
  Dexs: 'swap and add liquidity',
  Lending: 'supply collateral and borrow against it',
  Yield: 'deposit into the vaults',
  Derivatives: 'open and close a small hedged position',
  CDP: 'mint against collateral and repay in part',
  Farm: 'deposit into the farm pools',
  'Liquid Staking': 'stake and hold the receipt token',
  Bridge: 'bridge a small amount both ways',
  Options: 'write a small covered option',
  'Yield Aggregator': 'deposit into the aggregated vaults',
  Indexes: 'buy the index and hold it',
  Insurance: 'buy cover for a position you hold',
  'Algo-Stables': 'mint and redeem a small amount',
  'Privacy': 'use the shielded pool once a week',
};

function categoryAction(p: Protocol): string {
  return (p.category !== null && CATEGORY_ACTION[p.category]) ?? 'use the protocol’s core feature';
}

function candidateSteps(row: BoardRow, p: Protocol): string[] {
  const cheap = cheapestChain(p);
  const action = categoryAction(p);
  return [
    `Open ${p.name} on ${cheap.chain} with a fresh wallet. The radar values it at ${fmtUsd(row.expected_value_usd)} expected value, with P(token) ${row.p_token.toFixed(2)}.`,
    `Bridge about ${fmtUsd(row.min_capital_usd)} to ${cheap.chain}. Ten interactions cost about ${fmtUsd(row.gas_usd)} in gas there, the cheapest of its ${p.chains.length} chain${p.chains.length === 1 ? '' : 's'}.`,
    `Use ${p.name} every week — ${action} — so the address accrues real usage before any snapshot, not a single burst on the last day.`,
    `Your expected share is ${fmtUsd(row.expected_share_usd ?? 0)} at ${fmtUsd(row.dollars_per_hour ?? 0)} an hour; keep it above the ${fmtUsd(row.gas_usd)} gas of the run or the farm loses money.`,
    `Watch ${p.name} for a token or points announcement and claim promptly. The pool modelled here is 5% of expected value, split across farmers.`,
  ];
}

function liveSteps(row: BoardRow, p: Protocol): string[] {
  const cheap = cheapestChain(p);
  return [
    `${p.name} already records a token, so there is no launch left to farm; its recorded value is ${fmtUsd(row.expected_value_usd)}.`,
    `Use it on ${cheap.chain}, its cheapest chain, and compare the live yield against the same capital parked elsewhere before locking anything.`,
    `If you hold the token, check staking or governance: a live token pays for participation, not for waiting.`,
    `Re-check the position monthly. A live protocol can still dilute you with new emissions, so track supply, not price alone.`,
  ];
}

function trackedSteps(row: BoardRow, p: Protocol): string[] {
  const cheap = cheapestChain(p);
  return [
    `${p.name} is tracked, not ranked as a launch target: it looks like a wrapped, staked or bridged product of a protocol whose token already trades.`,
    `Its fitted value is ${fmtUsd(row.expected_value_usd)} with P(token) ${row.p_token.toFixed(2)}, but a wrapped or staked product does not launch its own token.`,
    `Use it on ${cheap.chain} only for what it is — ${categoryAction(p)} — and do not farm it expecting a separate airdrop.`,
    `Keep it on the watchlist anyway: if its status changes, the radar re-ranks it as a candidate on the next snapshot.`,
  ];
}

export function buildRadar(snapshot: Snapshot): { board: BoardRow[]; radar: Radar } {
  const asOfMs = Date.parse(`${snapshot.as_of}T00:00:00Z`);
  const dated = snapshot.protocols.filter((p) => p.listed_at !== null);
  const medianAge = median(
    dated.map((p) => (asOfMs - Date.parse(`${p.listed_at!}T00:00:00Z`)) / DAY_MS / YEAR_DAYS),
  );
  const ageOf = (p: Protocol): number => ageYears(p, asOfMs, medianAge);

  // --- Implied value: OLS on log market cap over launch-eligible peers that
  // already record a token and carry a usable recorded cap (mcap -1 is
  // missing, never a value). Features: log TVL and 7-day log growth.
  const peers = snapshot.protocols.filter((p) => hasToken(p) && p.mcap_usd !== null && (p.mcap_usd as number) > 0 && peerEligible(p));
  const xPeers = peers.map((p) => [1, Math.log(p.tvl_usd), growthLog(p)]);
  const yPeers = peers.map((p) => Math.log(p.mcap_usd as number));
  const { beta: betaIv, inv: invIv } = ols(xPeers, yPeers);
  const impliedFit = (p: Protocol): number =>
    Math.exp(betaIv[0]! + betaIv[1]! * Math.log(p.tvl_usd) + betaIv[2]! * growthLog(p));

  // Leave-one-out median error factor, via the hat matrix.
  const looErrors: number[] = [];
  for (let i = 0; i < peers.length; i++) {
    const xi = xPeers[i]!;
    const pred = xi.reduce((s, v, j) => s + v * betaIv[j]!, 0);
    const resid = yPeers[i]! - pred;
    let h = 0;
    for (let a = 0; a < xi.length; a++) for (let b = 0; b < xi.length; b++) h += xi[a]! * invIv[a]![b]! * xi[b]!;
    looErrors.push(Math.exp(Math.abs(resid / Math.max(1e-9, 1 - h))));
  }
  const loo = median(looErrors);

  // Walk-forward: fit on peers listed before 2025-01-06, test on those after.
  const wfTrain = peers.filter((p) => p.listed_at !== null && p.listed_at < '2025-01-06');
  const wfTest = peers.filter((p) => p.listed_at !== null && p.listed_at >= '2025-01-06');
  const wfBeta = ols(
    wfTrain.map((p) => [1, Math.log(p.tvl_usd), growthLog(p)]),
    wfTrain.map((p) => Math.log(p.mcap_usd as number)),
  ).beta;
  const wf = median(
    wfTest.map((p) => {
      const pred = wfBeta[0]! + wfBeta[1]! * Math.log(p.tvl_usd) + wfBeta[2]! * growthLog(p);
      return Math.exp(Math.abs(Math.log(p.mcap_usd as number) - pred));
    }),
  );

  // --- Token odds: logistic regression on all 758 protocols. Age enters as
  // a hinge, min(age, 4); the growth term is an offset with elasticity -0.5,
  // fixed after testing, not fitted. IRLS, deterministic.
  const ageHinge = (p: Protocol): number => Math.min(ageOf(p), 4);
  const oddsOffset = (p: Protocol): number => -0.5 * growthLog(p);
  function fitOdds(rows: Protocol[]): number[] {
    let beta = [0, 0];
    for (let it = 0; it < 80; it++) {
      const xtwx = [[0, 0], [0, 0]];
      const xtwz = [0, 0];
      for (const p of rows) {
        const x = [1, ageHinge(p)];
        const eta = x[0]! * beta[0]! + x[1]! * beta[1]! + oddsOffset(p);
        const mu = sigmoid(eta);
        const w = Math.max(1e-6, mu * (1 - mu));
        const y = hasToken(p) ? 1 : 0;
        const z = eta + (y - mu) / w;
        for (let a = 0; a < 2; a++) {
          xtwz[a]! += w * x[a]! * z;
          for (let b = 0; b < 2; b++) xtwx[a]![b]! += w * x[a]! * x[b]!;
        }
      }
      beta = solveLinear(xtwx, xtwz);
    }
    return beta;
  }
  const betaOdds = fitOdds(snapshot.protocols);
  const pToken = (p: Protocol): number =>
    sigmoid(betaOdds[0]! + betaOdds[1]! * ageHinge(p) + oddsOffset(p));
  const oddsScore = (beta: number[]) => (p: Protocol): number =>
    beta[0]! + beta[1]! * ageHinge(p) + oddsOffset(p);

  // 5-fold CV AUC, deterministic folds by snapshot order (slug-sorted).
  let cvSum = 0;
  for (let f = 0; f < 5; f++) {
    const train = snapshot.protocols.filter((_, i) => i % 5 !== f);
    const test = snapshot.protocols.filter((_, i) => i % 5 === f);
    cvSum += auc(test, oddsScore(fitOdds(train)));
  }
  const cvAuc = cvSum / 5;
  // Temporal check: fit before 2025-01-06, test after.
  const tempTrain = snapshot.protocols.filter((p) => p.listed_at !== null && p.listed_at < '2025-01-06');
  const tempTest = snapshot.protocols.filter((p) => p.listed_at !== null && p.listed_at >= '2025-01-06');
  const temporalAuc = auc(tempTest, oddsScore(fitOdds(tempTrain)));

  // --- Board: every protocol, ranked by expected value. ---
  const POOL_SHARE = 0.05;
  const FARMERS_PER_TVL = 2_000_000;
  const FARM_HOURS = 2160; // 90 days
  const FARM_AT = 6; // $/hour
  const THIN_AT = 2.5; // $/hour
  const GAS_TXS = 10;

  interface Scored extends Protocol {
    status: 'CANDIDATE' | 'LIVE' | 'TRACKED';
    implied: number;
    p: number;
    ev: number;
    age: number;
  }
  const scored: Scored[] = snapshot.protocols.map((proto) => {
    const status = isCandidate(proto) ? 'CANDIDATE' : hasToken(proto) ? 'LIVE' : 'TRACKED';
    const implied = impliedFit(proto);
    let ev: number;
    let prob: number;
    if (status === 'LIVE') {
      prob = 1;
      ev = proto.mcap_usd !== null && (proto.mcap_usd as number) > 0 ? (proto.mcap_usd as number) : implied;
    } else {
      prob = pToken(proto);
      ev = implied * Math.sqrt(prob);
    }
    return { ...proto, status, implied, p: prob, ev, age: ageOf(proto) };
  });

  // Implied-value rank and token-odds rank, for the 50/50 blend sort.
  const byImplied = [...scored].sort((a, b) => b.implied - a.implied || (a.slug < b.slug ? -1 : 1));
  const impliedRank = new Map<string, number>();
  byImplied.forEach((s, i) => impliedRank.set(s.slug, i + 1));
  const byOdds = [...scored].sort((a, b) => b.p - a.p || (a.slug < b.slug ? -1 : 1));
  const oddsRank = new Map<string, number>();
  byOdds.forEach((s, i) => oddsRank.set(s.slug, i + 1));

  // Blend rank is computed over launch candidates only: the board's default
  // sort. LIVE and tracked rows live in their own sections.
  const candidates = scored.filter((s) => s.status === 'CANDIDATE');
  const blendOrder = [...candidates].sort(
    (a, b) =>
      (impliedRank.get(a.slug)! + oddsRank.get(a.slug)!) - (impliedRank.get(b.slug)! + oddsRank.get(b.slug)!) ||
      (a.slug < b.slug ? -1 : 1),
  );
  const blendRank = new Map<string, number>();
  blendOrder.forEach((s, i) => blendRank.set(s.slug, i + 1));

  // Board order: expected value descending, slug tiebreak. Rounding to whole
  // dollars is monotone, so the dollar column never rises with rank.
  const byEv = [...scored].sort((a, b) => b.ev - a.ev || (a.slug < b.slug ? -1 : 1));
  const watchSet = new Set(snapshot.watchlist);
  let farm = 0;
  let thin = 0;
  let skip = 0;
  const board: BoardRow[] = byEv.map((s, i) => {
    const cheap = cheapestChain(s);
    const gas = GAS_TXS * cheap.txUsd;
    let dollarsPerHour: number | null = null;
    let share: number | null = null;
    let breakeven: number | null = null;
    let verdict: BoardRow['verdict'];
    if (s.status === 'CANDIDATE') {
      const farmers = Math.max(1, Math.round(s.tvl_usd / FARMERS_PER_TVL));
      share = (POOL_SHARE * s.ev) / farmers;
      dollarsPerHour = share / FARM_HOURS;
      breakeven = share / gas;
      verdict = dollarsPerHour >= FARM_AT ? 'FARM' : dollarsPerHour >= THIN_AT ? 'THIN' : 'SKIP';
      if (verdict === 'FARM') farm++;
      else if (verdict === 'THIN') thin++;
      else skip++;
    } else if (s.status === 'LIVE') {
      verdict = 'LIVE';
    } else {
      const farmers = Math.max(1, Math.round(s.tvl_usd / FARMERS_PER_TVL));
      share = (POOL_SHARE * s.ev) / farmers;
      dollarsPerHour = share / FARM_HOURS;
      breakeven = share / gas;
      verdict = 'TRACKED';
    }
    const row: BoardRow = {
      slug: s.slug,
      name: s.name,
      rank: i + 1,
      implied_value_usd: Math.max(1, Math.round(s.ev)),
      farm_steps: [],
      status: s.status,
      verdict,
      p_token: s.p,
      tvl_usd: s.tvl_usd,
      category: s.category,
      chains: s.chains,
      age_years: s.age,
      growth_7d: s.change_7d,
      implied_fit_usd: Math.max(1, Math.round(s.implied)),
      expected_value_usd: Math.max(1, Math.round(s.ev)),
      dollars_per_hour: dollarsPerHour === null ? null : Math.round(dollarsPerHour * 100) / 100,
      expected_share_usd: share === null ? null : Math.round(share * 100) / 100,
      gas_usd: Math.round(gas * 1000) / 1000,
      breakeven_multiple: breakeven === null ? null : Math.round(breakeven * 10) / 10,
      // 5x the run's gas, with a $100 floor: on a near-free chain the gas
      // alone would suggest a meaningless sub-dollar deposit.
      min_capital_usd: Math.max(100, Math.round(gas * 5 * 100) / 100),
      blend_rank: blendRank.get(s.slug) ?? null,
      watchlist: watchSet.has(s.slug),
    };
    row.farm_steps =
      s.status === 'CANDIDATE' ? candidateSteps(row, s) : s.status === 'LIVE' ? liveSteps(row, s) : trackedSteps(row, s);
    return row;
  });

  const covered = snapshot.watchlist.filter((slug) => board.some((r) => r.slug === slug)).length;
  const radar: Radar = {
    meta: {
      as_of: snapshot.as_of,
      protocols: snapshot.protocols.length,
      candidates: candidates.length,
      live: scored.filter((s) => s.status === 'LIVE').length,
      tracked: scored.filter((s) => s.status === 'TRACKED').length,
      watchlist_total: snapshot.watchlist.length,
      watchlist_covered: covered,
      implied_beta: betaIv.map((b) => Math.round(b * 1000) / 1000),
      implied_loo_median_error: Math.round(loo * 100) / 100,
      implied_walk_forward_median_error: Math.round(wf * 100) / 100,
      odds_beta: betaOdds.map((b) => Math.round(b * 1000) / 1000),
      odds_cv_auc: Math.round(cvAuc * 1000) / 1000,
      odds_temporal_auc: Math.round(temporalAuc * 1000) / 1000,
      verdict_split: { FARM: farm, THIN: thin, SKIP: skip },
      assumptions:
        'Implied value: OLS on log market cap over launch-eligible token peers (log TVL, 7-day log growth). ' +
        'P(token): logistic, age hinge min(age,4), growth elasticity -0.5 fixed. ' +
        'EV = implied x sqrt(P). Farm: 5% pool, 1 farmer per $2M TVL, 90-day window, 10 tx on the cheapest chain, ' +
        'FARM at $6/h, THIN at $2.50/h, minimum capital 5x the run gas with a $100 floor. ' +
        'P(token) is the share of peers that already record a token, not a launch forecast.',
    },
    rows: board,
  };
  return { board, radar };
}

export function dataScript(radar: Radar): string {
  return `window.RADAR = ${JSON.stringify(radar)};\n`;
}

// The gate's shape, checked before anything is written: a refusal here is a
// bug in the model, not in the snapshot.
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  if (board.length < 100 || board.length > 4000) return `board holds ${board.length} rows, not 100 to 4000`;
  const slugs = new Set(snapshot.protocols.map((p) => p.slug));
  const seen = new Set<string>();
  let prev = Number.POSITIVE_INFINITY;
  let allSame = true;
  let first: number | null = null;
  for (const row of board) {
    if (!slugs.has(row.slug)) return `board names ${row.slug}, not in the snapshot`;
    if (seen.has(row.slug)) return `board repeats ${row.slug}`;
    seen.add(row.slug);
    if (!Number.isInteger(row.rank) || row.rank < 1) return `row ${row.slug} has a bad rank`;
    if (!Number.isInteger(row.implied_value_usd) || row.implied_value_usd < 1) return `row ${row.slug} has a bad implied value`;
    if (first === null) first = row.implied_value_usd;
    else if (row.implied_value_usd !== first) allSame = false;
    if (row.implied_value_usd > prev) return `board value rises at rank ${row.rank}`;
    prev = row.implied_value_usd;
    if (row.farm_steps.length < 3 || row.farm_steps.length > 12) return `row ${row.slug} holds ${row.farm_steps.length} farm steps`;
    for (const step of row.farm_steps) {
      const t = step.trim();
      if (t.length < 20 || t.length > 600) return `row ${row.slug} has a farm step of ${t.length} characters`;
    }
  }
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return 'board ranks are not exactly 1 to N';
  if (allSame && board.length >= 2) return 'board values are all the same: not a ranking';
  for (const slug of snapshot.watchlist) if (!seen.has(slug)) return `board misses watchlist ${slug}`;
  return null;
}
