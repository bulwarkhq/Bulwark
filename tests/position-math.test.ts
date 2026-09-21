import { describe, it, expect } from "vitest";
import { Cl } from "@stacks/transactions";

const math = (fn: string, args: any[]) => simnet.callReadOnlyFn("position-math", fn, args, simnet.deployer).result;
const u = (n: number) => Cl.uint(n);

const ENTRY = 100_000e8;
const COLLATERAL = 1_000_000; // sats
const SIZE = 5_000_000;       // 5x leverage

describe("position-math", () => {
  describe("fee-of", () => {
    it("charges 0.10% of the position size", () => {
      expect(math("fee-of", [u(5_000_000)])).toStrictEqual(u(5_000));
    });

    it("rounds down", () => {
      expect(math("fee-of", [u(999)])).toStrictEqual(u(0));
    });
  });

  describe("pnl", () => {
    const pnl = (long: boolean, price: number, collateral = COLLATERAL) =>
      math("pnl", [Cl.bool(long), u(collateral), u(SIZE), u(ENTRY), u(price)]);
    const outcome = (favorable: boolean, amount: number) => Cl.tuple({ favorable: Cl.bool(favorable), amount: u(amount) });

    it("pays a long when the price rises, in proportion to size", () => {
      expect(pnl(true, 101_000e8)).toStrictEqual(outcome(true, 50_000));
    });

    it("costs a long when the price falls", () => {
      expect(pnl(true, 99_000e8)).toStrictEqual(outcome(false, 50_000));
    });

    it("pays a short when the price falls and costs it when the price rises", () => {
      expect(pnl(false, 99_000e8)).toStrictEqual(outcome(true, 50_000));
      expect(pnl(false, 101_000e8)).toStrictEqual(outcome(false, 50_000));
    });

    it("is flat when the price has not moved", () => {
      expect(pnl(true, ENTRY)).toStrictEqual(outcome(false, 0));
    });

    it("caps profit at three times the collateral", () => {
      expect(pnl(true, 200_000e8)).toStrictEqual(outcome(true, 3 * COLLATERAL));
    });

    it("caps loss at the collateral", () => {
      expect(pnl(true, 50_000e8)).toStrictEqual(outcome(false, COLLATERAL));
    });
  });
});
