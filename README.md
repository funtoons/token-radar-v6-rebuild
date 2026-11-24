[![make.fun](https://make.fun/badge/token-radar-01.svg)](https://make.fun/c/token-radar-01)
[![make.fun rank](https://make.fun/badge/token-radar-01/funtoons/token-radar-v6-rebuild/rank.svg)](https://make.fun/c/token-radar-01)
[![make.fun reward](https://make.fun/badge/token-radar-01/funtoons/token-radar-v6-rebuild/reward.svg)](https://make.fun/c/token-radar-01)

# Token Radar v6 — expected-value radar for pre-token protocols

A token launch radar for the make.fun `token-radar-01` bounty. It reads the
sealed snapshot of 758 DefiLlama protocols, fits two small models on it, and
ranks every protocol by the **expected value** of its (possible) token:

> expected value = implied value x sqrt(P(token))

where P(token) is the fitted share of peer protocols that already record a
token. The square root bounds the multiplier: a young protocol with P = 25%
keeps 50% of its implied value, not 25%.

## Coverage

All 758 protocols are accounted for: **198 launch candidates** ranked as
targets, **416 protocols that already record a token** shown separately as
LIVE, and **144 pre-token products that are not launch candidates** tracked
but not ranked as targets. The 40-protocol watchlist is fully covered.

## The two models

**Implied value.** Log market cap fitted by least squares on the
launch-eligible peers that already record a token (92 of them, with a usable
recorded market cap), from log TVL and 7-day log growth. A protocol's
recorded market cap of -1 is treated as missing, never as a value.

**Token odds.** Logistic regression on all 758 protocols. Age enters as a
hinge, min(age, 4 years); the fitted slope is about +0.64 logit/year below
the knot and flat after. The 7-day growth term is fixed at an elasticity of
-0.5 (tested, not fitted). P(token) is the share of peers that *already* have
a token, NOT a forecast that a protocol will launch one.

**Default sort.** The dashboard's default sort is a 50/50 rank blend of the
implied-value rank and the token-odds rank. The board file itself stays
ranked by expected value, so its dollar column falls with rank.

## Farm verdicts

Each candidate row carries FARM / THIN / SKIP with $/hour, expected share,
break-even and minimum capital, from stated assumptions: a 5% pool (5% of
expected value), one farmer per $2,000,000 of TVL, a 90-day farming window
(2,160 hours), 10 interactions on the protocol's cheapest chain, FARM at
$6/hour or more, THIN at $2.50/hour or more. Minimum capital is 5x the total
gas of the run, with a $100 floor. LIVE rows already trade; tracked rows are wrapped, staked,
bridged or otherwise ineligible products.

## Measured on this snapshot (as of 2026-11-14)

- Implied value: LOO median error 3.29x; walk-forward (fit on peers listed
  before 2025-01-06, tested on those listed after) 2.04x.
- Token odds: 5-fold CV AUC 0.690; temporal AUC (fit before 2025-01-06,
  tested after) 0.570.
- Board: 758 rows (198 candidates + 416 LIVE + 144 tracked), watchlist 40/40.
- Verdicts over candidates: FARM 123 / THIN 50 / SKIP 25.

## Run it

Node 22, standard library only, deterministic and offline:

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input /path/to/snapshot.json
```

That writes `board.json`, `data.js`, `dashboard/`, `screenshots/` and
`dossier.json` into the output directory. Two runs write the same bytes.

## License

MIT — see [LICENSE](LICENSE).
