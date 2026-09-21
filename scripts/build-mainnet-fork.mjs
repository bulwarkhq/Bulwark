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

// Pinned so results are reproducible. Override with FORK_HEIGHT to look elsewhere.
export const DEFAULT_FORK_HEIGHT = 9_037_787;

const OUT_DIR = ".mainnet-fork";
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

function build(height) {
  rmSync(OUT_DIR, { recursive: true, force: true });
  mkdirSync(`${OUT_DIR}/contracts`, { recursive: true });
  cpSync("settings", `${OUT_DIR}/settings`, { recursive: true });
  for (const name of CONTRACTS) {
    const source = readFileSync(`contracts/${name}.clar`, "utf8");
    writeFileSync(`${OUT_DIR}/contracts/${name}.clar`, forkedSource(source));
  }
  writeFileSync(`${OUT_DIR}/Clarinet.toml`, manifest(height, CONTRACTS));
  console.log(`built ${OUT_DIR} forking mainnet at height ${height}`);
}

build(Number(process.env.FORK_HEIGHT ?? DEFAULT_FORK_HEIGHT));
