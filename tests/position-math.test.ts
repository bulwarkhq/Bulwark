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

  describe("payout", () => {
    const payout = (favorable: boolean, amount: number, collateral = COLLATERAL, fee = 5_000) =>
      math("payout", [Cl.bool(favorable), u(amount), u(collateral), u(fee)]);

    it("on a win, returns collateral plus profit minus the fee", () => {
      expect(payout(true, 50_000)).toStrictEqual(u(1_045_000));
    });

    it("on a loss, returns the remaining collateral minus the fee", () => {
      expect(payout(false, 50_000)).toStrictEqual(u(945_000));
    });

    it("pays nothing after a total loss", () => {
      expect(payout(false, COLLATERAL)).toStrictEqual(u(0));
    });

    it("never charges more fee than the remaining collateral", () => {
      expect(payout(false, COLLATERAL - 2_000)).toStrictEqual(u(0));
    });
  });

  describe("is-liquidatable", () => {
    const liquidatable = (favorable: boolean, amount: number) =>
      math("is-liquidatable", [Cl.bool(favorable), u(amount), u(COLLATERAL)]);

    it("is true once 90% of the collateral is lost", () => {
      expect(liquidatable(false, 900_000)).toStrictEqual(Cl.bool(true));
      expect(liquidatable(false, COLLATERAL)).toStrictEqual(Cl.bool(true));
    });

    it("is false below that", () => {
      expect(liquidatable(false, 899_999)).toStrictEqual(Cl.bool(false));
    });

    it("is never true for a winning position", () => {
      expect(liquidatable(true, 3 * COLLATERAL)).toStrictEqual(Cl.bool(false));
    });
  });

  describe("liquidation-reward", () => {
    it("is 5% of the collateral", () => {
      expect(math("liquidation-reward", [u(COLLATERAL)])).toStrictEqual(u(50_000));
    });
  });

  describe("max-profit-reserve", () => {
    it("is three times the collateral", () => {
      expect(math("max-profit-reserve", [u(COLLATERAL)])).toStrictEqual(u(3_000_000));
    });
  });

  describe("is-leverage-allowed", () => {
    const allowed = (size: number) => math("is-leverage-allowed", [u(COLLATERAL), u(size)]);

    it("allows up to 5x", () => {
      expect(allowed(5 * COLLATERAL)).toStrictEqual(Cl.bool(true));
      expect(allowed(1)).toStrictEqual(Cl.bool(true));
    });

    it("rejects more than 5x and empty positions", () => {
      expect(allowed(5 * COLLATERAL + 1)).toStrictEqual(Cl.bool(false));
      expect(allowed(0)).toStrictEqual(Cl.bool(false));
    });
  });
});
