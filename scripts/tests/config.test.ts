import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { assertChainMatches, describeStarknetChain, normalizeStarknetChainId } from "../lib/chain";
import { loadDeploymentConfig } from "../lib/config";

const fixturesDir = path.resolve(import.meta.dir, "fixtures");
const envBackup = new Map<string, string | undefined>();
const fixtureEnv = {
  TEST_CHAIN_ID: "SN_SEPOLIA",
  TEST_RPC_URL: "https://rpc.invalid",
  TEST_DEPLOYER_ADDRESS: "0x111",
  TEST_DEPLOYER_PRIVATE_KEY: "0x222",
  TEST_MULTISIG_ADDRESS: "0x333",
  TEST_UPGRADE_DELAY: "7200",
  RPC_URL: "https://fallback.invalid",
  DEPLOYER_ADDRESS: "0x444",
  DEPLOYER_PRIVATE_KEY: "0x555",
};

describe("deployment config", () => {
  beforeEach(() => {
    for (const [key, value] of Object.entries(fixtureEnv)) {
      envBackup.set(key, process.env[key]);
      process.env[key] = value;
    }
  });

  afterEach(() => {
    for (const [key, value] of envBackup.entries()) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
    envBackup.clear();
  });

  test("resolves explicit env bindings", () => {
    const loaded = loadDeploymentConfig("fixture", path.join(fixturesDir, "env.config.json"));

    expect(loaded.config.starknet.rpcUrl).toBe(fixtureEnv.TEST_RPC_URL);
    expect(loaded.config.starknet.accountAddress).toBe(fixtureEnv.TEST_DEPLOYER_ADDRESS);
    expect(loaded.config.starknet.privateKey).toBe(fixtureEnv.TEST_DEPLOYER_PRIVATE_KEY);
    expect(loaded.config.factory.multisigAddress).toBe(fixtureEnv.TEST_MULTISIG_ADDRESS);
    expect(loaded.config.factory.upgradeDelaySeconds).toBe(fixtureEnv.TEST_UPGRADE_DELAY);
  });

  test("fills runtime Starknet values from env when config only contains public values", () => {
    const loaded = loadDeploymentConfig("fixture", path.join(fixturesDir, "public.config.json"));

    expect(loaded.config.starknet.rpcUrl).toBe(fixtureEnv.RPC_URL);
    expect(loaded.config.starknet.accountAddress).toBe(fixtureEnv.DEPLOYER_ADDRESS);
    expect(loaded.config.starknet.privateKey).toBe(fixtureEnv.DEPLOYER_PRIVATE_KEY);
    expect(loaded.config.factory.multisigAddress).toBe("0x1234");
    expect(loaded.config.factory.upgradeDelaySeconds).toBe("3600");
  });

  test("rejects private keys stored directly in public config JSON", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "earn-config-"));
    const configPath = path.join(tempDir, "bad.json");
    fs.writeFileSync(
      configPath,
      JSON.stringify({
        starknet: {
          chainId: "SN_SEPOLIA",
          privateKey: "0x999",
        },
        factory: {
          multisigAddress: "0x1234",
          upgradeDelaySeconds: "1",
        },
      }),
    );

    expect(() => loadDeploymentConfig("fixture", configPath)).toThrow(
      "starknet.privateKey must not be stored directly",
    );
  });

  test("normalizes and validates Starknet chain ids", () => {
    expect(normalizeStarknetChainId("0x534e5f5345504f4c4941")).toBe("SN_SEPOLIA");
    expect(describeStarknetChain("SN_MAIN").networkClass).toBe("mainnet");
    expect(() => assertChainMatches("SN_MAIN", describeStarknetChain("SN_SEPOLIA"))).toThrow(
      "RPC chain mismatch",
    );
  });
});
