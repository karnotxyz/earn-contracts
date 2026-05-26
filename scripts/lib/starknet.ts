import { execSync } from "child_process";
import * as path from "path";
import {
  Account,
  CallData,
  Contract,
  RpcProvider,
  type UniversalDetails,
  type waitForTransactionOptions,
} from "starknet";
import type { DeploymentConfig } from "./config";
import { getRepoRoot } from "./config";
import type { DeploymentManifest } from "./manifest";
import type { StarknetArtifact } from "./artifacts";
import { relativeArtifactPath } from "./artifacts";

const REPO_ROOT = getRepoRoot();
const ALLOWED_WAIT_SUCCESS_STATES = new Set([
  "PRE_CONFIRMED",
  "ACCEPTED_ON_L2",
  "ACCEPTED_ON_L1",
]);

function nowIso(): string {
  return new Date().toISOString();
}

export function ensureReleaseBuild(): void {
  execSync("SCARB_PROFILE=release scarb build", {
    cwd: REPO_ROOT,
    stdio: "inherit",
  });
}

export function verifyPrimerClassHash(): void {
  execSync(path.join("scripts", "verify_primer_class_hash.sh"), {
    cwd: REPO_ROOT,
    stdio: "inherit",
  });
}

export function getProvider(config: DeploymentConfig): RpcProvider {
  return new RpcProvider({ nodeUrl: config.starknet.rpcUrl });
}

export function getAccount(config: DeploymentConfig, provider?: RpcProvider): Account {
  return new Account({
    provider: provider ?? getProvider(config),
    address: config.starknet.accountAddress,
    signer: config.starknet.privateKey,
  });
}

function deploymentWaitOptions(): waitForTransactionOptions {
  const options: waitForTransactionOptions = {};

  if (process.env.ARCX_DEPLOY_WAIT_RETRY_INTERVAL_MS) {
    const retryInterval = Number(process.env.ARCX_DEPLOY_WAIT_RETRY_INTERVAL_MS);
    if (!Number.isInteger(retryInterval) || retryInterval <= 0) {
      throw new Error("ARCX_DEPLOY_WAIT_RETRY_INTERVAL_MS must be a positive integer");
    }
    options.retryInterval = retryInterval;
  }

  if (process.env.ARCX_DEPLOY_WAIT_SUCCESS_STATES) {
    const successStates = process.env.ARCX_DEPLOY_WAIT_SUCCESS_STATES.split(",")
      .map((state) => state.trim().toUpperCase())
      .filter(Boolean);

    for (const state of successStates) {
      if (!ALLOWED_WAIT_SUCCESS_STATES.has(state)) {
        throw new Error(`Unsupported Starknet wait success state: ${state}`);
      }
    }

    options.successStates = successStates as waitForTransactionOptions["successStates"];
  }

  return options;
}

async function waitForDeploymentTransaction(provider: RpcProvider, transactionHash: string): Promise<void> {
  await provider.waitForTransaction(transactionHash, deploymentWaitOptions());
}

function deploymentTransactionDetails(): UniversalDetails {
  const tip = process.env.ARCX_DEPLOY_TIP;
  if (!tip) return {};

  try {
    BigInt(tip);
  } catch {
    throw new Error("ARCX_DEPLOY_TIP must be a bigint-compatible decimal or 0x-prefixed value");
  }

  // Devnet E2E passes tip=0 so starknet.js does not scan recent blocks for a
  // recommended tip before every declare/deploy. Production deploys keep the
  // library default by omitting this option.
  return { tip };
}

export function buildFactoryConstructorCalldata(params: {
  governanceAdmin: string;
  upgradeDelay: string;
  accountClassHash: string;
}): string[] {
  return CallData.compile({
    governance_admin: params.governanceAdmin,
    upgrade_delay: params.upgradeDelay,
    account_class_hash: params.accountClassHash,
  });
}

export async function declareClassIfNeeded(params: {
  manifest: DeploymentManifest;
  config: DeploymentConfig;
  artifact: StarknetArtifact;
}): Promise<void> {
  const existing = params.manifest.declaredClasses[params.artifact.artifactId];
  if (existing?.classHash === params.artifact.classHash) {
    return;
  }

  const provider = getProvider(params.config);
  const account = getAccount(params.config, provider);
  const tx = await account.declareIfNot({
    contract: params.artifact.sierraContract,
    casm: params.artifact.casmContract,
  }, deploymentTransactionDetails());

  if (tx.transaction_hash) {
    await waitForDeploymentTransaction(provider, tx.transaction_hash);
  }

  params.manifest.declaredClasses[params.artifact.artifactId] = {
    artifact: params.artifact.artifactId,
    packageName: params.artifact.packageName,
    contractName: params.artifact.contractName,
    classHash: tx.class_hash,
    compiledClassHash: params.artifact.compiledClassHash,
    sierraPath: relativeArtifactPath(params.artifact.sierraPath),
    casmPath: relativeArtifactPath(params.artifact.casmPath),
    declaredAt: nowIso(),
    transactionHash: tx.transaction_hash || undefined,
    alreadyDeclaredOnChain: !tx.transaction_hash,
  };
}

export async function deployFactoryIfNeeded(params: {
  manifest: DeploymentManifest;
  config: DeploymentConfig;
  chainId: string;
  factoryArtifact: StarknetArtifact;
  accountArtifact: StarknetArtifact;
}): Promise<void> {
  if (params.manifest.contracts.factory?.address) {
    return;
  }

  const provider = getProvider(params.config);
  const account = getAccount(params.config, provider);
  const constructorCalldata = buildFactoryConstructorCalldata({
    governanceAdmin: params.config.factory.multisigAddress,
    upgradeDelay: params.config.factory.upgradeDelaySeconds,
    accountClassHash: params.accountArtifact.classHash,
  });

  const response = await account.deployContract({
    classHash: params.factoryArtifact.classHash,
    constructorCalldata,
  }, deploymentTransactionDetails());

  const address = Array.isArray(response.contract_address)
    ? response.contract_address[0]
    : response.contract_address;

  if (!address) {
    throw new Error("Factory deployment transaction did not return a contract address");
  }

  await waitForDeploymentTransaction(provider, response.transaction_hash);

  params.manifest.contracts.factory = {
    address,
    contractType: "AccountFactory",
    chainId: params.chainId,
    classHash: params.factoryArtifact.classHash,
    accountClassHash: params.accountArtifact.classHash,
    constructorCalldata: {
      governanceAdmin: params.config.factory.multisigAddress,
      upgradeDelay: params.config.factory.upgradeDelaySeconds,
      accountClassHash: params.accountArtifact.classHash,
    },
    deployedAt: nowIso(),
    transactionHash: response.transaction_hash,
  };
}

function firstFelt(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "bigint" || typeof value === "number") {
    return `0x${BigInt(value).toString(16)}`;
  }
  if (Array.isArray(value) && value.length > 0) {
    return firstFelt(value[0]);
  }
  if (value && typeof value === "object") {
    const values = Object.values(value as Record<string, unknown>);
    if (values.length > 0) {
      return firstFelt(values[0]);
    }
  }
  throw new Error(`Unable to decode felt from value: ${JSON.stringify(value)}`);
}

export async function readFactoryState(params: {
  config: DeploymentConfig;
  address: string;
  abi: any;
}): Promise<{ deployedClassHash: string; accountClassHash: string }> {
  const provider = getProvider(params.config);
  const deployedClassHash = await provider.getClassHashAt(params.address);
  const contract = new Contract({
    abi: params.abi,
    address: params.address,
    providerOrAccount: provider,
  });
  const accountClassHash = firstFelt(await contract.call("account_class_hash", []));
  return {
    deployedClassHash,
    accountClassHash,
  };
}
