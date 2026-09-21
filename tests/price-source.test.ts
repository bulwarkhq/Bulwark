import { describe, it, expect } from "vitest";
import { Cl } from "@stacks/transactions";
import { FEED, deployer, feedConfigArgs, setPrice, storagePrincipal } from "./helpers";

describe("price-source trait", () => {
  it("lets a consumer read a guarded price through the trait", () => {
    simnet.callPublicFn("oracle-guard", "set-approved-storage", [storagePrincipal()], deployer());
    simnet.callPublicFn("oracle-guard", "set-feed-config", feedConfigArgs(), deployer());
    const { publishTime } = setPrice(100_000);

    const result = simnet.callPublicFn(
      "trait-caller",
      "fetch",
      [Cl.contractPrincipal(deployer(), "oracle-guard"), FEED, storagePrincipal()],
      deployer(),
    ).result;

    expect(result).toBeOk(Cl.tuple({ price: Cl.uint(100_000e8), "publish-time": Cl.uint(publishTime) }));
  });
});
