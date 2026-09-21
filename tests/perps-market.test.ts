import { describe, it, expect, beforeEach } from "vitest";
import { Cl } from "@stacks/transactions";
import { contractBalance, deployer, err, mintSbtc, num, principalOf, storagePrincipal, wallet } from "./helpers";

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
      open(false, COLLATERAL, 2 * SIZE);
      expect(marketRead("get-open-interest")).toStrictEqual(
        Cl.tuple({ long: Cl.uint(SIZE), short: Cl.uint(2 * SIZE) }),
      );
    });
  });
});
