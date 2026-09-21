import { describe, it, expect, beforeEach } from "vitest";
import { Cl } from "@stacks/transactions";
import { contractBalance, deployer, err, mintSbtc, num, principalOf, sbtcBalance, storagePrincipal, wallet } from "./helpers";

const ONE_SBTC = 100_000_000;
const PRICE = 100_000e8;
const T0 = 1_000_000;

const market = (fn: string, args: any[] = [], sender = deployer()) =>
  simnet.callPublicFn("perps-market", fn, args, sender);
const marketRead = (fn: string, args: any[] = []) =>
  simnet.callReadOnlyFn("perps-market", fn, args, deployer()).result;
const pool = (fn: string, args: any[] = [], sender = deployer()) =>
  simnet.callPublicFn("liquidity-pool", fn, args, sender);
const poolState = () => {
  const s = simnet.callReadOnlyFn("liquidity-pool", "get-pool", [], deployer()).result;
  return { liquidity: num(s, "liquidity"), locked: num(s, "locked"), reserved: num(s, "reserved") };
};
const setQuote = (price: number, at: number) =>
  simnet.callPublicFn("stub-price-source", "set-quote", [Cl.uint(price), Cl.uint(at)], deployer());

const SOURCE = () => principalOf("stub-price-source");
const open = (long: boolean, collateral: number, size: number, sender = trader) =>
  market("open-position", [Cl.bool(long), Cl.uint(collateral), Cl.uint(size), SOURCE(), storagePrincipal()], sender);
const close = (id: number, sender = trader) =>
  market("close-position", [Cl.uint(id), SOURCE(), storagePrincipal()], sender);
const liquidate = (id: number, sender = keeper) =>
  market("liquidate", [Cl.uint(id), SOURCE(), storagePrincipal()], sender);

const lp = wallet(1);
const trader = wallet(2);
const keeper = wallet(3);
const COLLATERAL = 1_000_000;
const SIZE = 5_000_000;
const FEE = 5_000;
const NET = COLLATERAL - FEE;

describe("perps-market", () => {
  describe("price source", () => {
    it("has none until the admin pins one", () => {
      expect(marketRead("get-price-source")).toBeNone();
    });

    it("lets only the admin pin it", () => {
      expect(market("set-price-source", [SOURCE()], trader).result).toBeErr(err(7000));
      expect(market("set-price-source", [SOURCE()]).result).toBeOk(Cl.bool(true));
      expect(marketRead("get-price-source")).toBeSome(SOURCE());
    });

    it("passes through the source's failure when it has no quote", () => {
      mintSbtc(lp, ONE_SBTC);
      mintSbtc(trader, ONE_SBTC);
      pool("set-market", [principalOf("perps-market")]);
      pool("add-liquidity", [Cl.uint(ONE_SBTC)], lp);
      market("set-price-source", [SOURCE()]);
      expect(open(true, COLLATERAL, SIZE).result).toBeErr(Cl.uint(1));
    });

    it("refuses to trade against a source that is not pinned", () => {
      mintSbtc(trader, ONE_SBTC);
      expect(open(true, COLLATERAL, SIZE).result).toBeErr(err(7001));
    });
  });

  describe("open-position", () => {
    beforeEach(() => {
      mintSbtc(lp, 10 * ONE_SBTC);
      mintSbtc(trader, ONE_SBTC);
      pool("set-market", [principalOf("perps-market")]);
      market("set-price-source", [SOURCE()]);
      pool("add-liquidity", [Cl.uint(ONE_SBTC)], lp);
      setQuote(PRICE, T0);
    });

    it("records the position at the quoted price and returns its id", () => {
      expect(open(true, COLLATERAL, SIZE).result).toBeOk(Cl.uint(1));
      expect(marketRead("get-position", [Cl.uint(1)])).toBeSome(
        Cl.tuple({
          owner: Cl.principal(trader),
          long: Cl.bool(true),
          collateral: Cl.uint(NET),
          size: Cl.uint(SIZE),
          "entry-price": Cl.uint(PRICE),
          "entry-time": Cl.uint(T0),
        }),
      );
    });

    it("hands out increasing ids", () => {
      open(true, COLLATERAL, SIZE);
      expect(open(false, COLLATERAL, SIZE).result).toBeOk(Cl.uint(2));
    });

    it("moves the collateral into the pool: fee to LPs, rest locked, max profit reserved", () => {
      open(true, COLLATERAL, SIZE);
      expect(poolState()).toEqual({ liquidity: ONE_SBTC + FEE, locked: NET, reserved: 3 * NET });
      expect(contractBalance("liquidity-pool")).toBe(ONE_SBTC + FEE + NET);
    });

    it("tracks open interest by side", () => {
      open(true, COLLATERAL, SIZE);
      open(false, 2 * COLLATERAL, 2 * SIZE);
      expect(marketRead("get-open-interest")).toStrictEqual(
        Cl.tuple({ long: Cl.uint(SIZE), short: Cl.uint(2 * SIZE) }),
      );
    });
  });

  describe("open-position validation", () => {
    beforeEach(() => {
      mintSbtc(lp, 10 * ONE_SBTC);
      mintSbtc(trader, ONE_SBTC);
      pool("set-market", [principalOf("perps-market")]);
      market("set-price-source", [SOURCE()]);
      pool("add-liquidity", [Cl.uint(ONE_SBTC)], lp);
      setQuote(PRICE, T0);
    });

    it("rejects collateral below the minimum", () => {
      expect(open(true, 9_999, 9_999).result).toBeErr(err(7002));
    });

    it("rejects more than 5x leverage and empty positions", () => {
      expect(open(true, COLLATERAL, 5 * COLLATERAL + 1).result).toBeErr(err(7003));
      expect(open(true, COLLATERAL, 0).result).toBeErr(err(7003));
    });

    it("caps the reserved max profit at half of pool liquidity", () => {
      // pool is 1 sBTC, so at most 0.5 sBTC may be reserved; 0.2 sBTC collateral reserves ~0.6
      expect(open(true, 20_000_000, 20_000_000).result).toBeErr(err(7004));
    });

    it("counts existing reservations against the cap", () => {
      expect(open(true, 10_000_000, 10_000_000).result).toBeOk(Cl.uint(1)); // reserves ~0.3
      expect(open(false, 10_000_000, 10_000_000).result).toBeErr(err(7004)); // would reach ~0.6
    });

    it("fails cleanly when the trader lacks the funds", () => {
      expect(sbtcBalance(keeper)).toBe(0);
      expect(open(true, COLLATERAL, SIZE, keeper).result).toBeErr(expect.anything());
    });
  });

  describe("close-position", () => {
    const HOLD = 30;
    const PAID_FEE = FEE; // closing charges the same 0.10% of size
    const openLong = () => open(true, COLLATERAL, SIZE);
    const invariantHolds = () => {
      const p = poolState();
      return contractBalance("liquidity-pool") === p.liquidity + p.locked;
    };

    beforeEach(() => {
      mintSbtc(lp, 10 * ONE_SBTC);
      mintSbtc(trader, ONE_SBTC);
      pool("set-market", [principalOf("perps-market")]);
      market("set-price-source", [SOURCE()]);
      pool("add-liquidity", [Cl.uint(ONE_SBTC)], lp);
      setQuote(PRICE, T0);
    });

    it("rejects an unknown position", () => {
      expect(close(99).result).toBeErr(err(7005));
    });

    it("rejects anyone but the owner", () => {
      openLong();
      setQuote(PRICE, T0 + 60);
      expect(close(1, keeper).result).toBeErr(err(7006));
    });

    it("rejects a close on a price published less than the minimum hold after entry", () => {
      openLong();
      setQuote(101_000e8, T0 + HOLD - 1);
      expect(close(1).result).toBeErr(err(7007));
    });

    it("allows a close exactly at the minimum hold", () => {
      openLong();
      setQuote(PRICE, T0 + HOLD);
      expect(close(1).result).toBeOk(expect.anything());
    });

    it("pays a winning long its profit minus the close fee", () => {
      openLong();
      const before = sbtcBalance(trader);
      setQuote(101_000e8, T0 + 60);
      expect(close(1).result).toBeOk(Cl.uint(NET + 50_000 - PAID_FEE));
      expect(sbtcBalance(trader) - before).toBe(NET + 50_000 - PAID_FEE);
    });

    it("pays a losing long what is left after the loss and the fee", () => {
      openLong();
      setQuote(99_000e8, T0 + 60);
      expect(close(1).result).toBeOk(Cl.uint(NET - 50_000 - PAID_FEE));
    });

    it("pays a short the mirror image", () => {
      open(false, COLLATERAL, SIZE);
      setQuote(99_000e8, T0 + 60);
      expect(close(1).result).toBeOk(Cl.uint(NET + 50_000 - PAID_FEE));
    });

    it("caps a runaway win at three times the collateral", () => {
      openLong();
      setQuote(300_000e8, T0 + 60);
      expect(close(1).result).toBeOk(Cl.uint(NET + 3 * NET - PAID_FEE));
    });

    it("releases the position, its locked collateral, reserve and open interest", () => {
      openLong();
      setQuote(101_000e8, T0 + 60);
      close(1);
      expect(marketRead("get-position", [Cl.uint(1)])).toBeNone();
      expect(poolState()).toMatchObject({ locked: 0, reserved: 0 });
      expect(marketRead("get-open-interest")).toStrictEqual(Cl.tuple({ long: Cl.uint(0), short: Cl.uint(0) }));
    });

    it("keeps custody equal to liquidity plus locked collateral after wins and losses", () => {
      openLong();
      open(false, COLLATERAL, SIZE);
      setQuote(101_000e8, T0 + 60);
      close(1);
      close(2);
      expect(invariantHolds()).toBe(true);
    });

    it("cannot close the same position twice", () => {
      openLong();
      setQuote(PRICE, T0 + 60);
      close(1);
      expect(close(1).result).toBeErr(err(7005));
    });

    it("refuses an unpinned price source", () => {
      openLong();
      expect(market("close-position", [Cl.uint(1), principalOf("trait-caller"), storagePrincipal()], trader).result)
        .toBeErr(expect.anything());
    });
  });
});
