import { describe, it, expect, beforeEach } from "vitest";
import { Cl } from "@stacks/transactions";
import {
  FEED, advance, deployer, err, feedConfigArgs, mintSbtc, principalOf, sbtcBalance, setPrice, storagePrincipal, wallet,
} from "./helpers";

const ONE_SBTC = 100_000_000;
const lp = wallet(1);
const trader = wallet(2);
const keeper = wallet(3);

const guard = (fn: string, args: any[] = [], sender = deployer()) => simnet.callPublicFn("oracle-guard", fn, args, sender);
const pool = (fn: string, args: any[] = [], sender = deployer()) => simnet.callPublicFn("liquidity-pool", fn, args, sender);
const market = (fn: string, args: any[], sender: string) => simnet.callPublicFn("perps-market", fn, args, sender);

const GUARD = () => principalOf("oracle-guard");
const open = (long: boolean, collateral: number, size: number, sender = trader) =>
  market("open-position", [Cl.bool(long), Cl.uint(collateral), Cl.uint(size), GUARD(), storagePrincipal()], sender);
const close = (id: number, sender = trader) =>
  market("close-position", [Cl.uint(id), GUARD(), storagePrincipal()], sender);
const liquidate = (id: number) =>
  market("liquidate", [Cl.uint(id), GUARD(), storagePrincipal()], keeper);

describe("perps-market on the oracle guard", () => {
  beforeEach(() => {
    mintSbtc(lp, 10 * ONE_SBTC);
    mintSbtc(trader, ONE_SBTC);
    guard("set-approved-storage", [storagePrincipal()]);
    guard("set-feed-config", feedConfigArgs());
    pool("set-market", [principalOf("perps-market")]);
    market("set-price-source", [GUARD()], deployer());
    pool("add-liquidity", [Cl.uint(ONE_SBTC)], lp);
  });

  it("opens and closes on fresh guarded prices", () => {
    setPrice(100_000);
    expect(open(true, 1_000_000, 5_000_000).result).toBeOk(Cl.uint(1));
    advance(40);
    setPrice(101_000, { emaUsd: 101_000 });
    expect(close(1).result).toBeOk(expect.anything());
  });

  it("refuses to open on a stale price", () => {
    setPrice(100_000, { ageSecs: 120 });
    expect(open(true, 1_000_000, 5_000_000).result).toBeErr(err(6003));
  });

  it("refuses to open on a price far from Pyth's ema", () => {
    setPrice(108_000, { emaUsd: 100_000 });
    expect(open(true, 1_000_000, 5_000_000).result).toBeErr(err(6006));
  });

  it("refuses to close or liquidate while the feed is tripped", () => {
    setPrice(100_000);
    open(true, 1_000_000, 5_000_000);
    guard("admin-trip", [FEED]);
    advance(40);
    setPrice(100_000);
    expect(close(1).result).toBeErr(err(6001));
    expect(liquidate(1).result).toBeErr(err(6001));
  });

  it("refuses a price source other than the pinned guard", () => {
    setPrice(100_000);
    const impostor = market("open-position",
      [Cl.bool(true), Cl.uint(1_000_000), Cl.uint(5_000_000), principalOf("trait-caller"), storagePrincipal()], trader);
    expect(impostor.result).toBeErr(expect.anything());
  });

  it("leaves the pool untouched when a guarded open is rejected", () => {
    const before = sbtcBalance(trader);
    setPrice(100_000, { ageSecs: 120 });
    open(true, 1_000_000, 5_000_000);
    expect(sbtcBalance(trader)).toBe(before);
  });
});
