import { describe, it, expect } from "vitest";
import { Cl } from "@stacks/transactions";

/**
 * Runs against a fork of Stacks mainnet pinned at FORK_HEIGHT (see
 * scripts/build-mainnet-fork.mjs), so the real Pyth contracts and their real
 * stored prices are what the code under test sees.
 */
const PYTH = "SP1CGXWEAMG6P6FT04W66NVGJ7PQWMDAC19R7PJ0Y";
const REAL_STORAGE = `${PYTH}.pyth-storage-v4`;
const BTC_FEED = Cl.bufferFromHex("e62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43");
const caller = () => simnet.deployer;

describe("real Pyth storage on mainnet", () => {
  it("holds a BTC/USD entry that a plain read returns", () => {
    const result = simnet.callPublicFn(REAL_STORAGE, "read", [BTC_FEED], caller()).result;
    expect(result).toBeOk(expect.anything());
  });
});
