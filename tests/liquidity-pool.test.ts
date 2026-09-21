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
});
