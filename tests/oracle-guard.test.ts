import { describe, it, expect, beforeEach } from "vitest";
import { Cl } from "@stacks/transactions";
import { FEED, GUARD_CFG, advance, deployer, err, feedConfigArgs, setPrice, storagePrincipal, stranger } from "./helpers";

const guard = (fn: string, args: any[] = [], sender = deployer()) =>
  simnet.callPublicFn("oracle-guard", fn, args, sender);
const read = (fn: string, args: any[] = []) =>
  simnet.callReadOnlyFn("oracle-guard", fn, args, deployer()).result;

const configure = (cfg = GUARD_CFG) => {
  guard("set-approved-storage", [storagePrincipal()]);
  guard("set-feed-config", feedConfigArgs(cfg));
};
const safePrice = (storage = storagePrincipal()) => guard("get-safe-price", [FEED, storage]);

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

  describe("admin", () => {
    it("starts as the deployer", () => {
      expect(read("get-admin")).toStrictEqual(Cl.principal(deployer()));
    });

    it("can be handed over by the current admin", () => {
      expect(guard("set-admin", [Cl.principal(stranger())]).result).toBeOk(Cl.bool(true));
      expect(read("get-admin")).toStrictEqual(Cl.principal(stranger()));
    });

    it("gives the new admin control and takes it from the old one", () => {
      guard("set-admin", [Cl.principal(stranger())]);
      expect(guard("set-approved-storage", [storagePrincipal()], stranger()).result).toBeOk(Cl.bool(true));
      expect(guard("set-approved-storage", [storagePrincipal()]).result).toBeErr(err(6000));
    });

    it("refuses a handover from anyone else", () => {
      expect(guard("set-admin", [Cl.principal(stranger())], stranger()).result).toBeErr(err(6000));
      expect(read("get-admin")).toStrictEqual(Cl.principal(deployer()));
    });
  });

  describe("get-safe-price", () => {
    it("returns a healthy price normalized to 8 decimals with its publish time", () => {
      configure();
      const { publishTime } = setPrice(100_000);
      expect(safePrice().result).toBeOk(
        Cl.tuple({ price: Cl.uint(100_000e8), "publish-time": Cl.uint(publishTime) }),
      );
    });
  });

  describe("get-safe-price gatekeeping", () => {
    it("refuses a feed that has no config", () => {
      guard("set-approved-storage", [storagePrincipal()]);
      setPrice(100_000);
      expect(safePrice().result).toBeErr(err(6002));
    });

    it("refuses any storage while none is approved", () => {
      guard("set-feed-config", feedConfigArgs());
      setPrice(100_000);
      expect(safePrice().result).toBeErr(err(6011));
    });

    it("refuses an impostor storage contract that implements the same trait", () => {
      configure();
      setPrice(100_000, { storage: "fake-pyth-storage" });
      expect(safePrice(storagePrincipal("fake-pyth-storage")).result).toBeErr(err(6011));
    });
  });

  describe("get-safe-price freshness", () => {
    beforeEach(() => configure());

    it("rejects a price older than the feed's max-age", () => {
      setPrice(100_000, { ageSecs: 120 });
      expect(safePrice().result).toBeErr(err(6003));
    });

    it("rejects a price stamped in the future", () => {
      setPrice(100_000, { ageSecs: -120 });
      expect(safePrice().result).toBeErr(err(6004));
    });
  });

  describe("get-safe-price confidence", () => {
    beforeEach(() => configure());

    it("rejects a price whose confidence interval is too wide", () => {
      setPrice(100_000, { confBps: 300 }); // limit is 100 bps
      expect(safePrice().result).toBeErr(err(6005));
    });
  });

  describe("get-safe-price ema sanity", () => {
    beforeEach(() => configure());

    it("rejects a price far from Pyth's own ema", () => {
      setPrice(108_000, { emaUsd: 100_000 }); // limit is 300 bps
      expect(safePrice().result).toBeErr(err(6006));
    });

    it("accepts a price within the ema band", () => {
      setPrice(102_000, { emaUsd: 100_000 });
      expect(safePrice().result).toBeOk(expect.anything());
    });
  });

  describe("last accepted price", () => {
    const lastAccepted = () => (read("get-last-accepted", [FEED]) as any).value?.value;
    beforeEach(() => configure());

    it("is empty before any price is served", () => {
      expect(read("get-last-accepted", [FEED])).toBeNone();
    });

    it("remembers the price and publish time of the last accepted read", () => {
      const { publishTime } = setPrice(100_000);
      safePrice();
      expect(lastAccepted().price).toStrictEqual(Cl.uint(100_000e8));
      expect(lastAccepted()["publish-time"]).toStrictEqual(Cl.uint(publishTime));
    });

    it("keeps the previous price when a read is rejected", () => {
      setPrice(100_000);
      safePrice();
      setPrice(108_000, { emaUsd: 100_000 });
      expect(safePrice().result).toBeErr(err(6006));
      expect(lastAccepted().price).toStrictEqual(Cl.uint(100_000e8));
    });
  });

  describe("continuity across reads", () => {
    // Freshness is not under test here; several blocks pass between reads.
    beforeEach(() => configure({ ...GUARD_CFG, maxAge: 300 }));

    it("refuses a price older than one already served", () => {
      const first = setPrice(100_000);
      safePrice();
      setPrice(100_000, { at: first.publishTime - 1 });
      expect(safePrice().result).toBeErr(err(6009));
    });
  });

  describe("sudden moves", () => {
    beforeEach(() => configure());

    it("rejects a jump beyond the step limit shortly after the last price", () => {
      setPrice(100_000);
      safePrice();
      setPrice(108_000, { emaUsd: 108_000 }); // ema followed, so only the step rule can object
      expect(safePrice().result).toBeErr(err(6007));
    });

    it("accepts a small move shortly after the last price", () => {
      setPrice(100_000);
      safePrice();
      setPrice(102_000, { emaUsd: 102_000 });
      expect(safePrice().result).toBeOk(expect.anything());
    });

    it("accepts the same jump once the step window has passed", () => {
      setPrice(100_000);
      safePrice();
      advance(GUARD_CFG.stepWindow + 30);
      setPrice(108_000, { emaUsd: 108_000 });
      expect(safePrice().result).toBeOk(expect.anything());
    });
  });

  describe("circuit breaker: admin override", () => {
    beforeEach(() => configure());

    it("is not tripped by default", () => {
      expect(read("is-tripped", [FEED])).toStrictEqual(Cl.bool(false));
    });

    it("lets the admin pause a feed, after which prices are refused", () => {
      expect(guard("admin-trip", [FEED]).result).toBeOk(Cl.bool(true));
      expect(read("is-tripped", [FEED])).toStrictEqual(Cl.bool(true));
      setPrice(100_000);
      expect(safePrice().result).toBeErr(err(6001));
    });

    it("lets the admin resume a paused feed", () => {
      guard("admin-trip", [FEED]);
      expect(guard("admin-reset", [FEED]).result).toBeOk(Cl.bool(true));
      setPrice(100_000);
      expect(safePrice().result).toBeOk(expect.anything());
    });

    it("refuses anyone else", () => {
      expect(guard("admin-trip", [FEED], stranger()).result).toBeErr(err(6000));
      expect(guard("admin-reset", [FEED], stranger()).result).toBeErr(err(6000));
    });
  });

  describe("circuit breaker: poke", () => {
    const poke = (storage = storagePrincipal()) => guard("poke", [FEED, storage], stranger());
    const trip = () => (read("get-trip", [FEED]) as any).value?.value;
    beforeEach(() => configure());

    it("trips on a price far from Pyth's ema and records why", () => {
      setPrice(108_000, { emaUsd: 100_000 });
      expect(poke().result).toBeOk(Cl.bool(true));
      expect(read("is-tripped", [FEED])).toStrictEqual(Cl.bool(true));
      expect(trip().reason).toStrictEqual(Cl.uint(6006));
    });

    it("keeps refusing prices afterwards, even healthy ones", () => {
      setPrice(108_000, { emaUsd: 100_000 });
      poke();
      setPrice(100_000);
      expect(safePrice().result).toBeErr(err(6001));
    });

    it("does nothing on a healthy price", () => {
      setPrice(100_000);
      expect(poke().result).toBeOk(Cl.bool(false));
      expect(read("is-tripped", [FEED])).toStrictEqual(Cl.bool(false));
    });

    it("does not trip on a price that is merely stale", () => {
      setPrice(100_000, { ageSecs: 300 });
      expect(poke().result).toBeOk(Cl.bool(false));
    });

    it("does nothing when the feed is already tripped", () => {
      guard("admin-trip", [FEED]);
      setPrice(108_000, { emaUsd: 100_000 });
      expect(poke().result).toBeOk(Cl.bool(false));
    });

    it("refuses an impostor storage contract", () => {
      expect(poke(storagePrincipal("fake-pyth-storage")).result).toBeErr(err(6011));
    });

    it("refuses an unconfigured feed", () => {
      expect(guard("poke", [Cl.bufferFromHex("00".repeat(32)), storagePrincipal()], stranger()).result).toBeErr(err(6002));
    });
  });

  describe("circuit breaker: poke on sudden moves", () => {
    const poke = () => guard("poke", [FEED, storagePrincipal()], stranger());
    beforeEach(() => configure());

    it("trips on a jump beyond the step limit even when the ema followed", () => {
      setPrice(100_000);
      safePrice();
      setPrice(108_000, { emaUsd: 108_000 });
      expect(poke().result).toBeOk(Cl.bool(true));
      expect((read("get-trip", [FEED]) as any).value.value.reason).toStrictEqual(Cl.uint(6007));
    });

    it("stays quiet on a small move", () => {
      setPrice(100_000);
      safePrice();
      setPrice(102_000, { emaUsd: 102_000 });
      expect(poke().result).toBeOk(Cl.bool(false));
    });

    it("stays quiet on a big move once the step window has passed", () => {
      setPrice(100_000);
      safePrice();
      advance(GUARD_CFG.stepWindow + 30);
      setPrice(108_000, { emaUsd: 108_000 });
      expect(poke().result).toBeOk(Cl.bool(false));
    });
  });

  describe("circuit breaker: resume", () => {
    const resume = (storage = storagePrincipal()) => guard("resume", [FEED, storage], stranger());
    const tripOnBadTick = () => {
      setPrice(108_000, { emaUsd: 100_000 });
      guard("poke", [FEED, storagePrincipal()], stranger());
    };
    beforeEach(() => configure());

    it("errors when nothing is tripped", () => {
      expect(resume().result).toBeErr(err(6012));
    });

    it("refuses to resume before the cooldown has passed", () => {
      tripOnBadTick();
      setPrice(100_000);
      expect(resume().result).toBeErr(err(6013));
    });

    it("refuses to resume while the price is still unhealthy", () => {
      tripOnBadTick();
      advance(GUARD_CFG.cooldown + 10);
      setPrice(108_000, { emaUsd: 100_000 });
      expect(resume().result).toBeErr(err(6006));
    });

    it("lets anyone resume after the cooldown once the price is healthy", () => {
      tripOnBadTick();
      advance(GUARD_CFG.cooldown + 10);
      setPrice(100_000);
      expect(resume().result).toBeOk(Cl.uint(100_000e8));
      expect(read("is-tripped", [FEED])).toStrictEqual(Cl.bool(false));
    });

    it("serves prices again after resuming", () => {
      tripOnBadTick();
      advance(GUARD_CFG.cooldown + 10);
      setPrice(100_000);
      resume();
      setPrice(100_500);
      expect(safePrice().result).toBeOk(expect.anything());
    });

    it("restarts the step baseline from the resume price", () => {
      tripOnBadTick();
      advance(GUARD_CFG.cooldown + 10);
      setPrice(100_000);
      resume();
      expect((read("get-last-accepted", [FEED]) as any).value.value.price).toStrictEqual(Cl.uint(100_000e8));
    });

    it("refuses an impostor storage contract", () => {
      tripOnBadTick();
      expect(resume(storagePrincipal("fake-pyth-storage")).result).toBeErr(err(6011));
    });
  });
});
