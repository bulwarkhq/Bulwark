import { describe, it, expect } from "vitest";
import { Cl } from "@stacks/transactions";
import { FEED, GUARD_CFG, deployer, err, feedConfigArgs, storagePrincipal, stranger } from "./helpers";

const guard = (fn: string, args: any[] = [], sender = deployer()) =>
  simnet.callPublicFn("oracle-guard", fn, args, sender);
const read = (fn: string, args: any[] = []) =>
  simnet.callReadOnlyFn("oracle-guard", fn, args, deployer()).result;

describe("oracle-guard", () => {
  describe("approved storage", () => {
    it("starts with no approved storage", () => {
      expect(read("get-approved-storage")).toBeNone();
    });

    it("lets the admin approve a storage contract", () => {
      expect(guard("set-approved-storage", [storagePrincipal()]).result).toBeOk(Cl.bool(true));
      expect(read("get-approved-storage")).toBeSome(storagePrincipal());
    });

    it("refuses anyone else", () => {
      expect(guard("set-approved-storage", [storagePrincipal()], stranger()).result).toBeErr(err(6000));
      expect(read("get-approved-storage")).toBeNone();
    });
  });

  describe("feed configuration", () => {
    const setConfig = (args = feedConfigArgs(), sender = deployer()) => guard("set-feed-config", args, sender);
    const withField = (index: number, value: number) => {
      const args = feedConfigArgs();
      args[index] = Cl.uint(value);
      return args;
    };
    const [MAX_AGE, MAX_CONF, MAX_EMA, MAX_STEP] = [1, 2, 3, 4];

    it("has no config until the admin sets one", () => {
      expect(read("get-config", [FEED])).toBeNone();
    });

    it("stores the config the admin sets", () => {
      expect(setConfig().result).toBeOk(Cl.bool(true));
      expect(read("get-config", [FEED])).toBeSome(
        Cl.tuple({
          "max-age": Cl.uint(GUARD_CFG.maxAge),
          "max-conf-bps": Cl.uint(GUARD_CFG.maxConfBps),
          "max-ema-dev-bps": Cl.uint(GUARD_CFG.maxEmaDevBps),
          "max-step-bps": Cl.uint(GUARD_CFG.maxStepBps),
          "step-window": Cl.uint(GUARD_CFG.stepWindow),
          cooldown: Cl.uint(GUARD_CFG.cooldown),
        }),
      );
    });

    it("refuses anyone else", () => {
      expect(setConfig(feedConfigArgs(), stranger()).result).toBeErr(err(6000));
      expect(read("get-config", [FEED])).toBeNone();
    });

    it("rejects a zero max-age", () => {
      expect(setConfig(withField(MAX_AGE, 0)).result).toBeErr(err(6010));
    });

    it("rejects basis-point limits above 100%", () => {
      expect(setConfig(withField(MAX_CONF, 10_001)).result).toBeErr(err(6010));
      expect(setConfig(withField(MAX_EMA, 10_001)).result).toBeErr(err(6010));
      expect(setConfig(withField(MAX_STEP, 10_001)).result).toBeErr(err(6010));
    });

    it("rejects a zero step limit", () => {
      expect(setConfig(withField(MAX_STEP, 0)).result).toBeErr(err(6010));
    });
  });
});
