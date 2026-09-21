import { describe, it, expect, beforeAll } from "vitest";
import { Cl } from "@stacks/transactions";
import fixture from "../fixtures/pyth-update.json";

/**
 * Forks mainnet at the block just before a real Pyth update (see
 * fixtures/pyth-update.json) and replays that exact, genuinely signed update
 * through the real Wormhole and Pyth contracts. Then asks the guard about the
 * fresh price that results: real data, real contracts, nothing mocked.
 */
const PYTH = "SP1CGXWEAMG6P6FT04W66NVGJ7PQWMDAC19R7PJ0Y";
const REAL_STORAGE = `${PYTH}.pyth-storage-v4`;
const BTC_FEED = Cl.bufferFromHex("e62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43");
// The real update was published ~165 s before the chain time it is read at, so a
// realistic per-feed window is a few minutes, not the 30 s used in unit tests.
const REAL_WORLD_MAX_AGE = 300;
const BTC_HEX = "e62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43";
const caller = () => simnet.deployer;
const storage = () => Cl.contractPrincipal(PYTH, "pyth-storage-v4");
const guard = (fn: string, args: any[] = []) => simnet.callPublicFn("oracle-guard", fn, args, caller());

let storedPrice: number;

describe("a genuine Pyth update replayed on a mainnet fork", () => {
  beforeAll(() => {
    const plan = Cl.tuple({
      "pyth-decoder-contract": Cl.contractPrincipal(PYTH, "pyth-pnau-decoder-v3"),
      "pyth-storage-contract": Cl.contractPrincipal(PYTH, "pyth-storage-v4"),
      "wormhole-core-contract": Cl.contractPrincipal(PYTH, "wormhole-core-v4"),
    });
    const pushed = simnet.callPublicFn(
      `${PYTH}.pyth-oracle-v4`,
      "verify-and-update-price-feeds",
      [Cl.bufferFromHex(fixture.priceFeedBytes.slice(2)), plan],
      caller(),
    ).result as any;
    expect(pushed.type).toBe("ok");
    // the real update carries two feeds (STX and BTC); pick BTC by id
    const btc = pushed.value.value.map((f: any) => f.value).find((v: any) => v["price-identifier"].value === BTC_HEX);
    storedPrice = Number(btc.price.value);

    guard("set-approved-storage", [Cl.principal(REAL_STORAGE)]);
    guard("set-feed-config", [BTC_FEED, Cl.uint(REAL_WORLD_MAX_AGE), Cl.uint(100), Cl.uint(300), Cl.uint(500), Cl.uint(60), Cl.uint(300)]);
  });

  it("lands a real BTC/USD price in the real storage", () => {
    expect(storedPrice).toBeGreaterThan(0);
    const held = simnet.callPublicFn(REAL_STORAGE, "read", [BTC_FEED], caller()).result as any;
    expect(Number(held.value.value.price.value)).toBe(storedPrice);
  });

  it("is served by the guard, normalized to 8 decimals, straight from the real storage", () => {
    const served = guard("get-safe-price", [BTC_FEED, storage()]).result as any;
    expect(served.type).toBe("ok");
    expect(Number(served.value.value.price.value)).toBe(storedPrice);
  });

  it("is remembered as the last accepted price", () => {
    guard("get-safe-price", [BTC_FEED, storage()]);
    const last = simnet.callReadOnlyFn("oracle-guard", "get-last-accepted", [BTC_FEED], caller()).result;
    expect(last).toBeSome(expect.anything());
  });

  it("is refused once the price has aged past the feed's own window", () => {
    guard("set-feed-config", [BTC_FEED, Cl.uint(1), Cl.uint(100), Cl.uint(300), Cl.uint(500), Cl.uint(60), Cl.uint(300)]);
    simnet.mineEmptyStacksBlocks(20);
    expect(guard("get-safe-price", [BTC_FEED, storage()]).result).toBeErr(Cl.uint(6003));
  });
});
