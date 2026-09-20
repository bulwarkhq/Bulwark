import { describe, it, expect } from "vitest";
import { Cl } from "@stacks/transactions";

const policy = (fn: string, args: any[]) =>
  simnet.callReadOnlyFn("price-policy", fn, args, simnet.deployer).result;
const err = (code: number) => Cl.uint(code);

describe("price-policy", () => {
  describe("normalize", () => {
    const normalize = (price: number, expo: number) => policy("normalize", [Cl.int(price), Cl.int(expo)]);

    it("keeps prices that already have 8 decimals", () => {
      expect(normalize(123, -8)).toBeOk(Cl.uint(123));
    });

    it("scales up prices with fewer decimals", () => {
      expect(normalize(123, -6)).toBeOk(Cl.uint(12_300));
      expect(normalize(5, 0)).toBeOk(Cl.uint(500_000_000));
    });

    it("scales down prices with more decimals", () => {
      expect(normalize(12_300, -10)).toBeOk(Cl.uint(123));
    });

    it("rejects zero and negative prices", () => {
      expect(normalize(0, -8)).toBeErr(err(6008));
      expect(normalize(-5, -8)).toBeErr(err(6008));
    });

    it("rejects exponents outside [-18, 0]", () => {
      expect(normalize(5, 1)).toBeErr(err(6014));
      expect(normalize(5, -19)).toBeErr(err(6014));
    });
  });

  describe("check-fresh", () => {
    const NOW = 1_000_000;
    const MAX_AGE = 30;
    const fresh = (publishTime: number) =>
      policy("check-fresh", [Cl.uint(publishTime), Cl.uint(NOW), Cl.uint(MAX_AGE)]);

    it("accepts a price published just now", () => {
      expect(fresh(NOW)).toBeOk(Cl.bool(true));
    });

    it("accepts a price exactly max-age old", () => {
      expect(fresh(NOW - MAX_AGE)).toBeOk(Cl.bool(true));
    });

    it("rejects a price older than max-age", () => {
      expect(fresh(NOW - MAX_AGE - 1)).toBeErr(err(6003));
    });

    it("tolerates a small clock skew into the future", () => {
      expect(fresh(NOW + 10)).toBeOk(Cl.bool(true));
    });

    it("rejects a price stamped too far in the future", () => {
      expect(fresh(NOW + 11)).toBeErr(err(6004));
    });
  });

  describe("check-confidence", () => {
    // price 100_000.00000000, max 100 bps (1%) => conf must be <= 1_000.00000000
    const PRICE = 100_000e8;
    const conf = (c: number) => policy("check-confidence", [Cl.uint(c), Cl.uint(PRICE), Cl.uint(100)]);

    it("accepts a tight confidence interval", () => {
      expect(conf(10e8)).toBeOk(Cl.bool(true));
    });

    it("accepts a confidence exactly at the limit", () => {
      expect(conf(1_000e8)).toBeOk(Cl.bool(true));
    });

    it("rejects a confidence interval wider than the limit", () => {
      expect(conf(1_000e8 + 1)).toBeErr(err(6005));
    });
  });

  describe("check-ema-deviation", () => {
    // Pyth publishes its own EMA: a free reference for "is this tick off-market?"
    const EMA = 100_000e8;
    const dev = (price: number, ema = EMA) =>
      policy("check-ema-deviation", [Cl.uint(price), Cl.uint(ema), Cl.uint(300)]); // 3%

    it("accepts a price close to the ema", () => {
      expect(dev(101_000e8)).toBeOk(Cl.bool(true));
    });

    it("accepts a deviation exactly at the limit, above or below", () => {
      expect(dev(103_000e8)).toBeOk(Cl.bool(true));
      expect(dev(97_000e8)).toBeOk(Cl.bool(true));
    });

    it("rejects a price too far above the ema", () => {
      expect(dev(103_000e8 + 1)).toBeErr(err(6006));
    });

    it("rejects a price too far below the ema", () => {
      expect(dev(97_000e8 - 1)).toBeErr(err(6006));
    });

    it("skips the check when the feed has no ema yet", () => {
      expect(dev(150_000e8, 0)).toBeOk(Cl.bool(true));
    });
  });

  describe("check-time-order", () => {
    const order = (lastPublish: number, publish: number) =>
      policy("check-time-order", [Cl.uint(lastPublish), Cl.uint(publish)]);

    it("accepts a newer publish time", () => {
      expect(order(1_000, 1_005)).toBeOk(Cl.bool(true));
    });

    it("accepts the same publish time", () => {
      expect(order(1_000, 1_000)).toBeOk(Cl.bool(true));
    });

    it("rejects a publish time older than one already accepted", () => {
      expect(order(1_000, 999)).toBeErr(err(6009));
    });
  });

  describe("check-step", () => {
    // last accepted 100_000 at t=1_000; max 500 bps (5%); a move only counts
    // as "sudden" if the last price is at most 60s old.
    const LAST = 100_000e8;
    const step = (price: number, blockTime: number) =>
      policy("check-step", [Cl.uint(LAST), Cl.uint(1_000), Cl.uint(price), Cl.uint(blockTime), Cl.uint(500), Cl.uint(60)]);

    it("accepts a small move shortly after the last price", () => {
      expect(step(102_000e8, 1_010)).toBeOk(Cl.bool(true));
    });

    it("accepts a move exactly at the limit, up or down", () => {
      expect(step(105_000e8, 1_010)).toBeOk(Cl.bool(true));
      expect(step(95_000e8, 1_010)).toBeOk(Cl.bool(true));
    });

    it("rejects a sudden jump in either direction", () => {
      expect(step(105_000e8 + 1, 1_010)).toBeErr(err(6007));
      expect(step(95_000e8 - 1, 1_010)).toBeErr(err(6007));
    });

    it("allows a large move once the last price is older than the window", () => {
      expect(step(120_000e8, 1_061)).toBeOk(Cl.bool(true));
    });

    it("still applies the limit exactly at the window edge", () => {
      expect(step(120_000e8, 1_060)).toBeErr(err(6007));
    });
  });
});
