import type { FactoryArtifactSet, FactoryArtifactName, StarknetArtifact } from "../lib/artifacts";
import type { DeploymentConfig } from "../lib/config";
import { describeStarknetChain } from "../lib/chain";
import { createEmptyManifest } from "../lib/manifest";
import type { CommandContext } from "../lib/runtime";

export function makeFixtureConfig(chainId = "SN_SEPOLIA"): DeploymentConfig {
  return {
    description: "Fixture config",
    starknet: {
      chainId,
      rpcUrl: "https://starknet.invalid",
      accountAddress: "0x111",
      privateKey: "0x222",
    },
    factory: {
      multisigAddress: "0x333",
      upgradeDelaySeconds: "3600",
    },
  };
}

function makeArtifact(
  artifactName: FactoryArtifactName,
  packageName: string,
  contractName: string,
  classHash: string,
): StarknetArtifact {
  return {
    artifactName,
    packageName,
    contractName,
    artifactId: `${packageName}:${contractName}:release`,
    sierraFile: `${packageName}_${contractName}.contract_class.json`,
    casmFile: `${packageName}_${contractName}.compiled_contract_class.json`,
    sierraPath: `/tmp/${packageName}_${contractName}.contract_class.json`,
    casmPath: `/tmp/${packageName}_${contractName}.compiled_contract_class.json`,
    sierraContract: { abi: [] },
    casmContract: {},
    abi: [],
    classHash,
    compiledClassHash: `0x${(BigInt(classHash) + 1000n).toString(16)}`,
  };
}

export function makeFixtureArtifacts(): FactoryArtifactSet {
  return {
    Primer: makeArtifact("Primer", "contracts", "Primer", "0x101"),
    StarknetEth712Account: makeArtifact(
      "StarknetEth712Account",
      "eth_712_account",
      "StarknetEth712Account",
      "0x202",
    ),
    AccountFactory: makeArtifact("AccountFactory", "account_factory", "AccountFactory", "0x303"),
  };
}

export function makeFixtureContext(chainId = "SN_SEPOLIA"): CommandContext {
  const config = makeFixtureConfig(chainId);
  return {
    env: "fixture",
    configPath: "/tmp/fixture.config.json",
    manifestPath: "/tmp/fixture.manifest.json",
    config,
    manifest: createEmptyManifest("fixture"),
    chain: describeStarknetChain(chainId),
  };
}
