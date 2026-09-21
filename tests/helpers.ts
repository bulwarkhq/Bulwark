import { Cl } from "@stacks/transactions";

export const FEED_HEX = "e62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43";
export const FEED = Cl.bufferFromHex(FEED_HEX);

export const GUARD_CFG = {
  maxAge: 30,
  maxConfBps: 100,
  maxEmaDevBps: 300,
  maxStepBps: 500,
  stepWindow: 60,
  cooldown: 300,
};

export const err = (code: number) => Cl.uint(code);
export const accounts = () => simnet.getAccounts();
export const deployer = () => simnet.deployer;
export const stranger = () => accounts().get("wallet_1")!;

export const storagePrincipal = (name = "mock-pyth-storage") =>
  Cl.contractPrincipal(simnet.deployer, name);

export const feedConfigArgs = (cfg = GUARD_CFG) => [
  FEED,
  Cl.uint(cfg.maxAge),
  Cl.uint(cfg.maxConfBps),
  Cl.uint(cfg.maxEmaDevBps),
  Cl.uint(cfg.maxStepBps),
  Cl.uint(cfg.stepWindow),
  Cl.uint(cfg.cooldown),
];

/** Chain time as the contracts see it (block time of the previous block). */
export function chainNow(): number {
  const r = simnet.callReadOnlyFn("mock-pyth-storage", "now", [], simnet.deployer).result as any;
  return Number(r.value);
}

/** Publish a Pyth-style price (8 decimals) into a mock storage contract. */
export function setPrice(
  usd: number,
  o: { ageSecs?: number; at?: number; confBps?: number; emaUsd?: number; storage?: string } = {},
) {
  const price = Math.round(usd * 1e8);
  const ema = Math.round((o.emaUsd ?? usd) * 1e8);
  const conf = Math.round((price * (o.confBps ?? 1)) / 10000);
  const publishTime = o.at ?? chainNow() - (o.ageSecs ?? 0);
  simnet.callPublicFn(
    o.storage ?? "mock-pyth-storage",
    "set-price",
    [FEED, Cl.int(price), Cl.uint(conf), Cl.int(ema), Cl.uint(publishTime)],
    simnet.deployer,
  );
  return { publishTime, price };
}

export function advance(secs: number) {
  simnet.mineEmptyStacksBlocks(Math.ceil(secs / 10));
}

export const wallet = (n: number) => accounts().get(`wallet_${n}`)!;

export function mintSbtc(to: string, amount: number) {
  return simnet.callPublicFn("mock-sbtc", "mint", [Cl.uint(amount), Cl.principal(to)], simnet.deployer);
}

export function sbtcBalance(who: string): number {
  const r = simnet.callReadOnlyFn("mock-sbtc", "get-balance", [Cl.principal(who)], simnet.deployer).result as any;
  return Number(r.value.value);
}

export const contractBalance = (name: string) => sbtcBalance(`${simnet.deployer}.${name}`);

export const num = (cv: any, key: string): number => Number(cv.value[key].value);
