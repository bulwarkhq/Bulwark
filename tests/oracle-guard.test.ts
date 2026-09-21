import { describe, it, expect } from "vitest";
import { Cl } from "@stacks/transactions";
import { deployer, err, storagePrincipal, stranger } from "./helpers";

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
});
