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
});
