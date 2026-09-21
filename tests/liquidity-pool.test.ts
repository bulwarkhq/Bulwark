import { describe, it, expect, beforeEach } from "vitest";
import { Cl } from "@stacks/transactions";
import { contractBalance, deployer, err, mintSbtc, num, sbtcBalance, wallet } from "./helpers";

const ONE_SBTC = 100_000_000;
const MIN_INITIAL = 1_000_000;

const pool = (fn: string, args: any[] = [], sender = deployer()) =>
  simnet.callPublicFn("liquidity-pool", fn, args, sender);
const read = (fn: string, args: any[] = []) =>
  simnet.callReadOnlyFn("liquidity-pool", fn, args, deployer()).result;
const state = () => {
  const s = read("get-pool");
  return { liquidity: num(s, "liquidity"), shares: num(s, "total-shares"), locked: num(s, "locked"), reserved: num(s, "reserved") };
};

describe("liquidity-pool", () => {
  const lp1 = wallet(1);
  const lp2 = wallet(2);

  beforeEach(() => {
    mintSbtc(lp1, 10 * ONE_SBTC);
    mintSbtc(lp2, 10 * ONE_SBTC);
  });

  describe("first deposit", () => {
    it("mints shares one-to-one and takes custody of the sBTC", () => {
      expect(pool("add-liquidity", [Cl.uint(ONE_SBTC)], lp1).result).toBeOk(Cl.uint(ONE_SBTC));
      expect(state()).toMatchObject({ liquidity: ONE_SBTC, shares: ONE_SBTC });
      expect(read("get-shares", [Cl.principal(lp1)])).toStrictEqual(Cl.uint(ONE_SBTC));
      expect(contractBalance("liquidity-pool")).toBe(ONE_SBTC);
      expect(sbtcBalance(lp1)).toBe(9 * ONE_SBTC);
    });

    it("rejects a zero deposit", () => {
      expect(pool("add-liquidity", [Cl.uint(0)], lp1).result).toBeErr(err(9002));
    });

    it("rejects a first deposit below the floor that guards against share inflation", () => {
      expect(pool("add-liquidity", [Cl.uint(MIN_INITIAL - 1)], lp1).result).toBeErr(err(9003));
    });
  });

  describe("later deposits", () => {
    beforeEach(() => pool("add-liquidity", [Cl.uint(ONE_SBTC)], lp1));

    it("mint shares in proportion to the pool", () => {
      expect(pool("add-liquidity", [Cl.uint(ONE_SBTC / 2)], lp2).result).toBeOk(Cl.uint(ONE_SBTC / 2));
      expect(state()).toMatchObject({ liquidity: 1.5 * ONE_SBTC, shares: 1.5 * ONE_SBTC });
    });

    it("are not subject to the first-deposit floor", () => {
      expect(pool("add-liquidity", [Cl.uint(1_000)], lp2).result).toBeOk(Cl.uint(1_000));
    });
  });

  describe("withdrawals", () => {
    beforeEach(() => {
      pool("add-liquidity", [Cl.uint(ONE_SBTC)], lp1);
      pool("add-liquidity", [Cl.uint(ONE_SBTC)], lp2);
    });

    it("return the pro-rata sBTC and burn the shares", () => {
      expect(pool("remove-liquidity", [Cl.uint(ONE_SBTC / 2)], lp1).result).toBeOk(Cl.uint(ONE_SBTC / 2));
      expect(read("get-shares", [Cl.principal(lp1)])).toStrictEqual(Cl.uint(ONE_SBTC / 2));
      expect(state()).toMatchObject({ liquidity: 1.5 * ONE_SBTC, shares: 1.5 * ONE_SBTC });
      expect(contractBalance("liquidity-pool")).toBe(1.5 * ONE_SBTC);
      expect(sbtcBalance(lp1)).toBe(9.5 * ONE_SBTC);
    });

    it("cannot burn more shares than the caller owns", () => {
      expect(pool("remove-liquidity", [Cl.uint(ONE_SBTC + 1)], lp1).result).toBeErr(err(9004));
    });

    it("cannot burn zero shares", () => {
      expect(pool("remove-liquidity", [Cl.uint(0)], lp1).result).toBeErr(err(9004));
    });

    it("let the last LP leave with everything", () => {
      pool("remove-liquidity", [Cl.uint(ONE_SBTC)], lp1);
      pool("remove-liquidity", [Cl.uint(ONE_SBTC)], lp2);
      expect(state()).toMatchObject({ liquidity: 0, shares: 0 });
      expect(contractBalance("liquidity-pool")).toBe(0);
    });
  });

  describe("market authorization", () => {
    const market = wallet(3);

    it("has no market until the admin sets one", () => {
      expect(read("get-market")).toBeNone();
    });

    it("lets only the admin set the market", () => {
      expect(pool("set-market", [Cl.principal(market)], lp1).result).toBeErr(err(9000));
      expect(pool("set-market", [Cl.principal(market)]).result).toBeOk(Cl.bool(true));
      expect(read("get-market")).toBeSome(Cl.principal(market));
    });
  });

  describe("take-collateral", () => {
    const market = wallet(3);
    const take = (amount: number, fee: number, reserve: number, sender = market) =>
      pool("take-collateral", [Cl.principal(market), Cl.uint(amount), Cl.uint(fee), Cl.uint(reserve)], sender);

    beforeEach(() => {
      mintSbtc(market, ONE_SBTC);
      pool("set-market", [Cl.principal(market)]);
      pool("add-liquidity", [Cl.uint(ONE_SBTC)], lp1);
    });

    it("refuses anyone but the market", () => {
      expect(take(1_000_000, 1_000, 3_000_000, lp1).result).toBeErr(err(9001));
    });

    it("locks the collateral, keeps the fee for LPs and reserves the max profit", () => {
      expect(take(1_000_000, 1_000, 2_997_000).result).toBeOk(Cl.bool(true));
      expect(state()).toMatchObject({ liquidity: ONE_SBTC + 1_000, locked: 999_000, reserved: 2_997_000 });
      expect(contractBalance("liquidity-pool")).toBe(ONE_SBTC + 1_000 + 999_000);
    });

    it("refuses when the pool cannot cover the reserve", () => {
      expect(take(1_000_000, 1_000, ONE_SBTC + 1).result).toBeErr(err(9006));
    });

    it("counts existing reservations against new ones", () => {
      take(1_000_000, 1_000, 60_000_000);
      expect(take(1_000_000, 1_000, 40_001_001).result).toBeErr(err(9006));
    });
  });

  describe("withdrawals and the reserve", () => {
    const market = wallet(3);

    beforeEach(() => {
      mintSbtc(market, ONE_SBTC);
      pool("set-market", [Cl.principal(market)]);
      pool("add-liquidity", [Cl.uint(ONE_SBTC)], lp1);
      pool("take-collateral", [Cl.principal(market), Cl.uint(1_000_000), Cl.uint(1_000), Cl.uint(60_000_000)], market);
    });

    it("cannot dip below the reserved liability", () => {
      // liquidity is ONE_SBTC + fee; 60M is reserved, so at most ~40M can leave
      expect(pool("remove-liquidity", [Cl.uint(50_000_000)], lp1).result).toBeErr(err(9005));
    });

    it("can take everything above the reserve", () => {
      expect(pool("remove-liquidity", [Cl.uint(39_000_000)], lp1).result).toBeOk(expect.anything());
    });
  });

  describe("settle", () => {
    const market = wallet(3);
    const trader = market; // the market wallet stands in as the trader in these tests
    const settle = (collateral: number, reserve: number, payout: number, sender = market) =>
      pool("settle", [Cl.principal(trader), Cl.uint(collateral), Cl.uint(reserve), Cl.uint(payout)], sender);
    const invariantHolds = () => contractBalance("liquidity-pool") === state().liquidity + state().locked;

    beforeEach(() => {
      mintSbtc(market, ONE_SBTC);
      pool("set-market", [Cl.principal(market)]);
      pool("add-liquidity", [Cl.uint(ONE_SBTC)], lp1);
      pool("take-collateral", [Cl.principal(trader), Cl.uint(1_000_000), Cl.uint(1_000), Cl.uint(2_997_000)], market);
      // locked is now 999_000, reserved 2_997_000, liquidity ONE_SBTC + 1_000
    });

    it("refuses anyone but the market", () => {
      expect(settle(999_000, 2_997_000, 0, lp1).result).toBeErr(err(9001));
    });

    it("on a loss, pays the trader what is left and keeps the rest for LPs", () => {
      const before = sbtcBalance(trader);
      expect(settle(999_000, 2_997_000, 400_000).result).toBeOk(Cl.bool(true));
      expect(sbtcBalance(trader) - before).toBe(400_000);
      expect(state()).toMatchObject({ liquidity: ONE_SBTC + 1_000 + 599_000, locked: 0, reserved: 0 });
      expect(invariantHolds()).toBe(true);
    });

    it("on a win, pays out more than the collateral from LP liquidity", () => {
      const before = sbtcBalance(trader);
      expect(settle(999_000, 2_997_000, 1_999_000).result).toBeOk(Cl.bool(true));
      expect(sbtcBalance(trader) - before).toBe(1_999_000);
      expect(state()).toMatchObject({ liquidity: ONE_SBTC + 1_000 - 1_000_000, locked: 0, reserved: 0 });
      expect(invariantHolds()).toBe(true);
    });

    it("handles a total loss with nothing to pay out", () => {
      expect(settle(999_000, 2_997_000, 0).result).toBeOk(Cl.bool(true));
      expect(state().liquidity).toBe(ONE_SBTC + 1_000 + 999_000);
      expect(invariantHolds()).toBe(true);
    });

    it("cannot pay out more than liquidity plus the released collateral", () => {
      expect(settle(999_000, 2_997_000, ONE_SBTC + 1_000 + 999_001).result).toBeErr(err(9007));
    });

    it("cannot release more than is locked or reserved", () => {
      expect(settle(999_001, 2_997_000, 0).result).toBeErr(err(9008));
      expect(settle(999_000, 2_997_001, 0).result).toBeErr(err(9008));
    });
  });

  describe("LP share value", () => {
    it("rises when the pool earns, so later depositors get fewer shares", () => {
      const market = wallet(3);
      mintSbtc(market, ONE_SBTC);
      pool("set-market", [Cl.principal(market)]);
      pool("add-liquidity", [Cl.uint(ONE_SBTC)], lp1);
      pool("take-collateral", [Cl.principal(market), Cl.uint(1_000_000), Cl.uint(1_000), Cl.uint(0)], market);
      pool("settle", [Cl.principal(market), Cl.uint(999_000), Cl.uint(0), Cl.uint(0)], market); // total loss
      // liquidity is now ONE_SBTC + 1_000_000 for ONE_SBTC shares
      const minted = pool("add-liquidity", [Cl.uint(ONE_SBTC)], lp2).result as any;
      expect(Number(minted.value.value)).toBeLessThan(ONE_SBTC);
    });
  });
});
