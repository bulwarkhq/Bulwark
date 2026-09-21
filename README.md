# Bulwark

Oracle safety for Bitcoin DeFi on Stacks.

Bulwark is a price guard written in Clarity that sits between a protocol and Pyth on Stacks, plus a small perpetuals prototype that proves the guard works. It exists because the stock Pyth integration hands consumers a price without asking whether that price is fresh, tight, sane or in order, and that gap has already cost a Stacks protocol its LPs' money.

> Status: working prototype, not audited, not deployed to mainnet. See [Limits](#limits).

## The problem

In February 2026 Velar disclosed an exploit of its PerpDEX pools on Stacks, and a near-identical drain of its pool on Mezo was found shortly after. The public write-ups agree on the mechanism: Pyth on Stacks is a *pull* oracle (prices only land on chain when someone pushes them), the perp contracts did not check oracle timestamps, and the attacker controlled when prices were pushed because normal activity was low.

The Mezo post-mortem puts numbers on it: about $72M of volume churned through the contracts over roughly ten days to take about $401K from LPs, with no pause mechanism and no monitoring, so the drain was noticed two weeks late. (Those figures are for the Mezo pool; the Stacks-side loss is not quantified in the sources used here.)

Reading the Pyth storage contract shows why it is easy to get wrong:

| Call | What it checks |
|---|---|
| `read` | nothing. Returns whatever was last stored, however old |
| `read-price-with-staleness-check` | age against one governance-wide threshold shared by every consumer |

Neither looks at the confidence interval, deviation from the market, time ordering, or sudden jumps. Every integrating protocol has to write those checks itself, and a careless one loses money.

## What Bulwark does

`oracle-guard` returns a price only if all of these hold:

1. the storage contract is the one the guard was configured with (no impostor storage)
2. the feed is configured and its circuit breaker is not tripped
3. the price is positive and its publish time is not in the future
4. it is no older than the feed's own `max-age`
5. its confidence interval is within `max-conf-bps` of the price
6. it is within `max-ema-dev-bps` of Pyth's own EMA
7. its publish time is not older than the last price served
8. it has not jumped more than `max-step-bps` from the last price while that price is recent

A failed read reverts all state in Clarity, so it cannot persist a pause. `poke` is a permissionless call that trips the breaker when the raw price is off-market (EMA deviation or a sudden jump); `resume` clears it after a per-feed cooldown once the price is healthy again.

## Evidence: the attack, replayed

`tests/attack-replay.test.ts` runs the **same** perps market and liquidity pool three times. Only the price source it is pinned to changes. Each run is 10 cycles of the stale-price pattern: open in the direction of a known 1% market move against the stale stored price, push the fresh price, close. Pool: 1 sBTC. Attacker: 0.1 sBTC collateral at 5x.

| Price source | Attacker profit | Pool change | Opens rejected |
|---|---|---|---|
| Careless read, stock 60 s window | +4,000,000 sats | −4,000,000 sats | 0 / 10 |
| Careless read, no staleness check | +4,000,000 sats | −4,000,000 sats | 0 / 10 |
| **Oracle guard** | **0** | **0** | **10 / 10** |

The numbers come from the test run, not from an estimate. `naive-price-source` is a deliberately vulnerable fixture and must never be deployed.

## Evidence: real mainnet data

Beyond simulated attacks, the guard is tested against a fork of Stacks mainnet (Clarinet's mainnet execution simulation), wired to the real Pyth and Wormhole contracts. Nothing in these tests is mocked. Both forks are pinned to a block, so results are reproducible.

**1. What the real oracle holds today** (fork at block 9,037,787, 2026-09-21)

- The BTC/USD price stored in the real `pyth-storage-v4` is **over 30 days old**, and a plain `read` returns it anyway.
- The stock staleness threshold, read from the real `pyth-governance-v3`, is **7,200 seconds (2 hours)**. The stock check refuses this entry only because it is 30 days past that window; anything under two hours old passes.
- The guard refuses the price (`err u6003`) and records nothing. On the entry's other properties (confidence about 3 bps against a 100 bps limit, about 0.6% from Pyth's EMA against a 3% limit) it raises no objection, so the rules produce no false positives on real data.

**2. A real signed update, replayed** (fork at block 8,517,360)

A genuine `verify-and-update-price-feeds` transaction from mainnet (`0x00c6322799810a8e89da621dfb2bf31d042bb01b34c111e23c6e872db9ce55cc`, block 8,517,361) is replayed through the real Wormhole and Pyth contracts. Its 1,660 bytes are signature-checked by the real guardian set, and it stores a real BTC/USD price of $63,332.72. The guard then serves that price, remembers it, and refuses it once it has aged past the feed's window. The update was published about 165 seconds before the chain time it is read at, which is why the real-data tests use a 300 s window where the unit tests use 30 s.

Run them (needs network access to the Hiro API; the forks fetch mainnet state on demand):

```bash
npm run test:mainnet
```

## Architecture

```
            +------------------+        +-------------------+
 consumer   |   perps-market   | -----> |  liquidity-pool   |   custody, LP shares,
 protocol   | positions, rules |        | reserve accounting|   locked collateral
            +---------+--------+        +-------------------+
                      |  <price-source-trait>
                      v
            +------------------+      +----------------+
            |   oracle-guard   | ---> |  price-policy  |   pure rules, no state
            | state + breaker  |      +----------------+
            +---------+--------+
                      | reads (pinned storage only)
                      v
              Pyth storage (pyth-storage-v4)

            position-math: pure fees, PnL, payout, liquidation rules used by perps-market
```

| Contract | Single responsibility |
|---|---|
| `price-policy` | Judge one price: normalize, freshness, confidence, EMA, ordering, step. Stateless |
| `oracle-guard` | Own config, last accepted price and the circuit breaker; compose the rules; implement `price-source-trait` |
| `price-source-trait` | The only thing a consumer needs from a price provider |
| `position-math` | Fees, capped PnL, payouts, liquidation and leverage rules. Stateless |
| `liquidity-pool` | Hold sBTC, mint and burn LP shares, keep `custody == liquidity + locked` |
| `perps-market` | Open, close, liquidate; orchestrates the three above |

The market depends on `price-source-trait`, not on the guard, and pins the approved source. That is what lets the attack replay swap the source and nothing else, and lets market logic be tested against a stub.

### Perps prototype rules

- sBTC margin and settlement, single BTC/USD market, up to 5x leverage
- 0.10% fee of size on open and on close
- profit capped at 3x collateral; the pool reserves that amount when the position opens, so it can never owe more than it holds
- a close must use a price published at least 30 s after the entry price
- reserved max profit is capped at 50% of LP liquidity
- liquidation at 90% collateral loss; the liquidator earns 5% of collateral

## Run the tests

```bash
npm install
npm test
```

163 unit tests across 8 files, all through the Clarinet SDK simnet, plus 11 mainnet-fork tests (`npm run test:mainnet`). The suite was built test-first: each behaviour has its own commit.

## Limits

Stated plainly, because this is a prototype:

- **Not audited.** Do not put real funds behind it.
- **Residual latency window.** A price up to `max-age` seconds old is still accepted, so an attacker can still exploit market movement inside that window. It is bounded by `max-age`, the fee and the minimum hold. The planned fix is request/execute settlement, where the execution price must be published after the request.
- **The breaker can pause a legitimately volatile market.** `max-step-bps` and the cooldown are per-feed knobs; the defaults in the tests are illustrative.
- **Perps simplifications:** pool value ignores unrealised PnL, no funding rate, single collateral, linear-in-sats settlement.
- **The guard is tested against real Pyth; the perps market is not.** Unit tests use a mock Pyth storage. The mainnet forks exercise `oracle-guard` against the real `pyth-storage-v4`, but `liquidity-pool` and `perps-market` still run on a mock sBTC token; they have not been run against the real sBTC contract.
- **Deployment wiring not done yet.** For the fork tests, `scripts/build-mainnet-fork.mjs` rewrites the local Pyth trait import to the real `SP1CGXWEAMG6P6FT04W66NVGJ7PQWMDAC19R7PJ0Y.pyth-traits-v2`. A production deployment needs the same change, and the market needs the real sBTC principal in place of the mock.

## Roadmap

1. Run the market and pool against the real sBTC in the fork, then a testnet deployment.
2. Request/execute settlement to close the latency window.
3. Independent review and audit preparation; open-source the guard as a drop-in for other Stacks protocols.

## License

MIT. See [LICENSE](LICENSE).
