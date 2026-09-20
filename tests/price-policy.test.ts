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
});
