import { describe, it, expect } from "vitest";
import { Cl, ClarityType } from "@stacks/transactions";
import {
  advance, deployer, feedConfigArgs, mintSbtc, num, principalOf, sbtcBalance, setPrice, storagePrincipal, wallet,
} from "./helpers";

/**
 * Replay of the Velar PerpDEX pattern (Feb 2026): the price a pull oracle has
 * stored can be stale, an attacker can see the real market on Pythnet, and can
 * choose when to push the fresh price. Open in the direction of the known move
 * against the stale stored price, push the fresh price, close: repeat.
 *
 * The SAME perps-market and liquidity-pool run twice. The only difference is
 * the price source they are pinned to.
 */

const ONE_SBTC = 100_000_000;
const lp = wallet(1);
const attacker = wallet(2);

const COLLATERAL = 10_000_000; // 0.1 sBTC
const SIZE = 50_000_000;       // 5x
const START_PRICE = 100_000;
const MOVE = 0.01;             // the real market moves 1% each cycle
const CYCLES = 10;
const STALE_AGE = 35;          // seconds; inside stock Pyth's 60s window, outside a 30s guard window

const pool = (fn: string, args: any[] = [], sender = deployer()) => simnet.callPublicFn("liquidity-pool", fn, args, sender);
const market = (fn: string, args: any[], sender: string) => simnet.callPublicFn("perps-market", fn, args, sender);
const poolLiquidity = () => num(simnet.callReadOnlyFn("liquidity-pool", "get-pool", [], deployer()).result, "liquidity");

function replayStaleOpenAttack(sourceName: string) {
  const source = principalOf(sourceName);
  mintSbtc(lp, 10 * ONE_SBTC);
  mintSbtc(attacker, ONE_SBTC);
  simnet.callPublicFn("oracle-guard", "set-approved-storage", [storagePrincipal()], deployer());
  simnet.callPublicFn("oracle-guard", "set-feed-config", feedConfigArgs(), deployer());
  pool("set-market", [principalOf("perps-market")]);
  market("set-price-source", [source], deployer());
  pool("add-liquidity", [Cl.uint(ONE_SBTC)], lp);

  const attackerBefore = sbtcBalance(attacker);
  const poolBefore = poolLiquidity();
  let stored = START_PRICE;
  let rejected = 0;

  for (let i = 0; i < CYCLES; i++) {
    const up = i % 2 === 0;
    const truth = up ? stored * (1 + MOVE) : stored * (1 - MOVE);

    setPrice(stored, { ageSecs: STALE_AGE });         // what is stored on chain is stale
    const opened = market("open-position",
      [Cl.bool(up), Cl.uint(COLLATERAL), Cl.uint(SIZE), source, storagePrincipal()], attacker);
    if (opened.result.type !== ClarityType.ResponseOk) { rejected++; continue; }

    setPrice(truth, { emaUsd: truth });               // attacker pushes the fresh price
    const id = Number((opened.result as any).value.value);
    market("close-position", [Cl.uint(id), source, storagePrincipal()], attacker);
    stored = truth;
    advance(10);
  }

  return {
    attackerProfit: sbtcBalance(attacker) - attackerBefore,
    poolChange: poolLiquidity() - poolBefore,
    rejected,
  };
}

describe("Velar-style stale-price attack", () => {
  it("drains the pool when the market reads Pyth carelessly (stock staleness window)", () => {
    simnet.callPublicFn("naive-price-source", "set-mode", [Cl.uint(1)], deployer());
    const r = replayStaleOpenAttack("naive-price-source");
    expect(r.rejected).toBe(0);
    expect(r.attackerProfit).toBeGreaterThan(0);
    expect(r.poolChange).toBeLessThan(0);
  });

  it("drains the pool when the market reads Pyth with no staleness check at all", () => {
    simnet.callPublicFn("naive-price-source", "set-mode", [Cl.uint(0)], deployer());
    const r = replayStaleOpenAttack("naive-price-source");
    expect(r.rejected).toBe(0);
    expect(r.attackerProfit).toBeGreaterThan(0);
  });

  it("does nothing to the pool when the market reads through the oracle guard", () => {
    const r = replayStaleOpenAttack("oracle-guard");
    expect(r.rejected).toBe(CYCLES);
    expect(r.attackerProfit).toBe(0);
    expect(r.poolChange).toBe(0);
  });
});
