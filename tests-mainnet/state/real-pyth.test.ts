import { describe, it, expect, beforeAll } from "vitest";
import { Cl } from "@stacks/transactions";

/**
 * Runs against a fork of Stacks mainnet pinned at FORK_HEIGHT (see
 * scripts/build-mainnet-fork.mjs), so the real Pyth contracts and their real
 * stored prices are what the code under test sees. Facts asserted here are
 * true of that block and are reproducible.
 */
const PYTH = "SP1CGXWEAMG6P6FT04W66NVGJ7PQWMDAC19R7PJ0Y";
const REAL_STORAGE = `${PYTH}.pyth-storage-v4`;
const REAL_GOVERNANCE = `${PYTH}.pyth-governance-v3`;
const BTC_FEED = Cl.bufferFromHex("e62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43");
const DAY = 86_400;

const caller = () => simnet.deployer;
const storage = () => Cl.contractPrincipal(PYTH, "pyth-storage-v4");
const guard = (fn: string, args: any[] = []) => simnet.callPublicFn("oracle-guard", fn, args, caller());
const policy = (fn: string, args: any[]) => simnet.callReadOnlyFn("price-policy", fn, args, caller()).result;

/** Chain time as the contracts see it: the previous block's timestamp. */
function chainNow(): number {
  const r = simnet.execute("(get-stacks-block-info? time (- stacks-block-height u1))").result as any;
  return Number(r.value.value);
}

type Entry = { price: number; conf: number; expo: number; emaPrice: number; publishTime: number };
function readRealEntry(): Entry {
  const ok = simnet.callPublicFn(REAL_STORAGE, "read", [BTC_FEED], caller()).result as any;
  const v = ok.value.value;
  return {
    price: Number(v.price.value),
    conf: Number(v.conf.value),
    expo: Number(v.expo.value),
    emaPrice: Number(v["ema-price"].value),
    publishTime: Number(v["publish-time"].value),
  };
}

describe("real Pyth storage on mainnet", () => {
  let entry: Entry;
  beforeAll(() => {
    entry = readRealEntry();
  });

  it("holds a BTC/USD entry that a plain read returns", () => {
    expect(entry.price).toBeGreaterThan(0);
    expect(entry.expo).toBe(-8);
  });

  it("returns that entry however old it is: the stored price is over 30 days old", () => {
    expect(chainNow() - entry.publishTime).toBeGreaterThan(30 * DAY);
  });

  it("is governed by a stock staleness threshold of two hours", () => {
    const threshold = simnet.callReadOnlyFn(REAL_GOVERNANCE, "get-stale-price-threshold", [], caller()).result;
    expect(threshold).toStrictEqual(Cl.uint(2 * 3600));
  });

  it("is refused by the stock staleness check only because it is beyond that two-hour window", () => {
    const stock = simnet.callReadOnlyFn(REAL_STORAGE, "read-price-with-staleness-check", [BTC_FEED], caller()).result;
    expect(stock).toBeErr(Cl.uint(5002));
  });
});

describe("oracle-guard against the real Pyth storage", () => {
  beforeAll(() => {
    guard("set-approved-storage", [Cl.principal(REAL_STORAGE)]);
    guard("set-feed-config", [BTC_FEED, Cl.uint(30), Cl.uint(100), Cl.uint(300), Cl.uint(500), Cl.uint(60), Cl.uint(300)]);
  });

  it("accepts the real storage contract through the trait and refuses its stale price", () => {
    expect(guard("get-safe-price", [BTC_FEED, storage()]).result).toBeErr(Cl.uint(6003));
  });

  it("serves no price and records nothing when it refuses", () => {
    guard("get-safe-price", [BTC_FEED, storage()]);
    expect(simnet.callReadOnlyFn("oracle-guard", "get-last-accepted", [BTC_FEED], caller()).result).toBeNone();
  });

  it("would accept every other rule on the real entry: no false positives on real Pyth data", () => {
    const e = readRealEntry();
    expect(policy("check-confidence", [Cl.uint(e.conf), Cl.uint(e.price), Cl.uint(100)])).toBeOk(Cl.bool(true));
    expect(policy("check-ema-deviation", [Cl.uint(e.price), Cl.uint(e.emaPrice), Cl.uint(300)])).toBeOk(Cl.bool(true));
    expect(policy("normalize", [Cl.int(e.price), Cl.int(e.expo)])).toBeOk(Cl.uint(e.price));
  });
});
