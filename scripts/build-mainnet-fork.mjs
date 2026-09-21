#!/usr/bin/env node
// Generate .mainnet-fork/, a Clarinet project that runs Bulwark's contracts
// against a fork of Stacks mainnet, wired to the real Pyth contracts.
//
// The contracts in contracts/ import a local copy of Pyth's storage trait so they
// can run in plain simnet. Traits are nominal in Clarity, so to accept the real
// pyth-storage-v4 the generated copies point at the real trait principal.

import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";

const PYTH_DEPLOYER = "SP1CGXWEAMG6P6FT04W66NVGJ7PQWMDAC19R7PJ0Y";
const LOCAL_TRAIT = ".pyth-traits-v2";
const REAL_TRAIT = `'${PYTH_DEPLOYER}.pyth-traits-v2`;

// Each named fork is pinned to a block so results are reproducible.
//   state:  a recent block, where the real stored BTC price is 30+ days stale
//   replay: the block before a real, successful Pyth update (fixtures/pyth-update.json)
export const FORKS = {
  state: 9_037_787,
  replay: 8_517_360,
};

const OUT_ROOT = ".mainnet-fork";
const CONTRACTS = ["price-policy", "price-source-trait", "oracle-guard"];

export const forkedSource = (source) => source.replaceAll(LOCAL_TRAIT, REAL_TRAIT);

export const manifest = (height, contracts) =>
  [
    "[project]",
    'name = "bulwark-mainnet-fork"',
    "telemetry = false",
    'cache_dir = "./.cache"',
    "",
    "[repl.remote_data]",
    "enabled = true",
    `initial_height = ${height}`,
    "use_mainnet_wallets = true",
    ...contracts.flatMap((name) => [
      "",
      `[contracts.${name}]`,
      `path = "contracts/${name}.clar"`,
      "clarity_version = 3",
      'epoch = "3.0"',
    ]),
    "",
  ].join("\n");

function build(name, height) {
  const outDir = `${OUT_ROOT}/${name}`;
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(`${outDir}/contracts`, { recursive: true });
  cpSync("settings", `${outDir}/settings`, { recursive: true });
  for (const contract of CONTRACTS) {
    const source = readFileSync(`contracts/${contract}.clar`, "utf8");
    writeFileSync(`${outDir}/contracts/${contract}.clar`, forkedSource(source));
  }
  writeFileSync(`${outDir}/Clarinet.toml`, manifest(height, CONTRACTS));
  console.log(`built ${outDir}: forking mainnet at height ${height}`);
}

for (const [name, height] of Object.entries(FORKS)) build(name, height);
