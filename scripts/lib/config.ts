import * as fs from "fs";
import * as path from "path";

export interface EnvBinding {
  $env: string;
  default?: string | number | boolean;
  required?: boolean;
}

type ScalarValue = string | number | boolean | null;
type ConfigNode = ScalarValue | EnvBinding | ConfigNode[] | { [key: string]: ConfigNode };

export interface DeploymentConfig {
  description?: string;
  starknet: {
    chainId: string;
    rpcUrl: string;
    accountAddress: string;
    privateKey: string;
  };
  factory: {
    multisigAddress: string;
    upgradeDelaySeconds: string;
  };
}

export interface LoadedDeploymentConfig {
  env: string;
  configPath: string;
  rawConfig: unknown;
  config: DeploymentConfig;
}

const REPO_ROOT = path.resolve(import.meta.dir, "../..");
const STARK_FIELD =
  (1n << 251n) + 17n * (1n << 192n) + 1n;
const U64_MAX = (1n << 64n) - 1n;

function isEnvBinding(value: unknown): value is EnvBinding {
  return Boolean(
    value &&
      typeof value === "object" &&
      "$env" in value &&
      typeof (value as { $env?: unknown }).$env === "string",
  );
}

function resolveConfigNode(node: ConfigNode, currentPath: string): unknown {
  if (Array.isArray(node)) {
    return node.map((item, index) => resolveConfigNode(item, `${currentPath}[${index}]`));
  }

  if (isEnvBinding(node)) {
    const envValue = process.env[node.$env];
    if (envValue === undefined || envValue === "") {
      if (node.default !== undefined) {
        return node.default;
      }
      if (node.required === false) {
        return undefined;
      }
      throw new Error(`Missing environment variable ${node.$env} required by config path ${currentPath}`);
    }
    return envValue;
  }

  if (node && typeof node === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(node)) {
      const resolved = resolveConfigNode(value, currentPath ? `${currentPath}.${key}` : key);
      if (resolved !== undefined) {
        result[key] = resolved;
      }
    }
    return result;
  }

  return node;
}

function expectObject(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function expectString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${label} must be a non-empty string`);
  }
  return value.trim();
}

function expectStringOrNumber(value: unknown, label: string): string {
  if (typeof value === "number" && Number.isSafeInteger(value)) {
    return String(value);
  }
  return expectString(value, label);
}

function getRequiredEnv(key: string): string {
  const value = process.env[key];
  if (!value || value.trim() === "") {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value.trim();
}

function parseInteger(value: string, label: string): bigint {
  try {
    return BigInt(value);
  } catch {
    throw new Error(`${label} must be an integer string`);
  }
}

function expectFelt(value: unknown, label: string, options: { nonZero?: boolean } = {}): string {
  const text = expectString(value, label);
  const parsed = parseInteger(text, label);
  if (parsed < 0n || parsed >= STARK_FIELD) {
    throw new Error(`${label} must be a Starknet felt value`);
  }
  if (options.nonZero !== false && parsed === 0n) {
    throw new Error(`${label} must be non-zero`);
  }
  return text;
}

function expectU64(value: unknown, label: string): string {
  const text = expectStringOrNumber(value, label);
  const parsed = parseInteger(text, label);
  if (parsed < 0n || parsed > U64_MAX) {
    throw new Error(`${label} must fit in u64`);
  }
  return text;
}

function assertNoPlainPrivateKey(rawConfig: unknown): void {
  const root = expectObject(rawConfig, "config");
  const starknet = expectObject(root.starknet ?? {}, "starknet");
  const privateKey = starknet.privateKey;

  if (typeof privateKey === "string" || typeof privateKey === "number") {
    throw new Error("starknet.privateKey must not be stored directly in public config JSON");
  }

  if (isEnvBinding(privateKey) && privateKey.default !== undefined) {
    throw new Error("starknet.privateKey env binding must not include a default value");
  }
}

function mergeRuntimeEnv(value: unknown): unknown {
  const root = expectObject(value, "config");
  const starknet = expectObject(root.starknet ?? {}, "starknet");

  return {
    ...root,
    starknet: {
      ...starknet,
      rpcUrl: starknet.rpcUrl ?? getRequiredEnv("RPC_URL"),
      accountAddress: starknet.accountAddress ?? getRequiredEnv("DEPLOYER_ADDRESS"),
      privateKey: starknet.privateKey ?? getRequiredEnv("DEPLOYER_PRIVATE_KEY"),
    },
  };
}

function validateConfig(value: unknown): DeploymentConfig {
  const root = expectObject(value, "config");
  const starknet = expectObject(root.starknet, "starknet");
  const factory = expectObject(root.factory, "factory");

  return {
    description: typeof root.description === "string" ? root.description : undefined,
    starknet: {
      chainId: expectString(starknet.chainId, "starknet.chainId"),
      rpcUrl: expectString(starknet.rpcUrl, "starknet.rpcUrl"),
      accountAddress: expectFelt(starknet.accountAddress, "starknet.accountAddress"),
      privateKey: expectFelt(starknet.privateKey, "starknet.privateKey"),
    },
    factory: {
      multisigAddress: expectFelt(factory.multisigAddress, "factory.multisigAddress"),
      upgradeDelaySeconds: expectU64(factory.upgradeDelaySeconds, "factory.upgradeDelaySeconds"),
    },
  };
}

export function getRepoRoot(): string {
  return REPO_ROOT;
}

export function getDefaultEnvName(): string {
  return process.env.NETWORK || "sepolia";
}

export function getDefaultConfigPath(env: string): string {
  return path.resolve(REPO_ROOT, "scripts", "config", `${env}.json`);
}

export function loadDeploymentConfig(env: string, configPath?: string): LoadedDeploymentConfig {
  const resolvedPath = configPath ? path.resolve(configPath) : getDefaultConfigPath(env);
  if (!fs.existsSync(resolvedPath)) {
    throw new Error(`Deployment config not found: ${resolvedPath}`);
  }

  const rawConfig = JSON.parse(fs.readFileSync(resolvedPath, "utf-8")) as ConfigNode;
  assertNoPlainPrivateKey(rawConfig);
  const resolvedConfig = resolveConfigNode(rawConfig, "") as unknown;
  const mergedConfig = mergeRuntimeEnv(resolvedConfig);

  return {
    env,
    configPath: resolvedPath,
    rawConfig,
    config: validateConfig(mergedConfig),
  };
}
