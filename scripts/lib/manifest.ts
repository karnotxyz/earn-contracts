import * as fs from "fs";
import * as path from "path";
import { getRepoRoot } from "./config";

export interface DeclaredClassRecord {
  artifact: string;
  packageName: string;
  contractName: string;
  classHash: string;
  compiledClassHash: string;
  sierraPath: string;
  casmPath: string;
  declaredAt: string;
  transactionHash?: string;
  alreadyDeclaredOnChain?: boolean;
}

export interface FactoryDeploymentRecord {
  address: string;
  contractType: "AccountFactory";
  chainId: string;
  classHash: string;
  accountClassHash: string;
  constructorCalldata: {
    governanceAdmin: string;
    upgradeDelay: string;
    accountClassHash: string;
  };
  deployedAt: string;
  transactionHash?: string;
}

export interface PlanRecord {
  mode: "plan" | "apply";
  command: string;
  actions: string[];
  createdAt: string;
}

export interface DeploymentManifest {
  version: 1;
  env: string;
  createdAt: string;
  updatedAt: string;
  chainId?: string;
  declaredClasses: Record<string, DeclaredClassRecord>;
  contracts: {
    factory?: FactoryDeploymentRecord;
  };
  lastPlan?: PlanRecord;
}

export interface LoadedManifest {
  manifestPath: string;
  manifest: DeploymentManifest;
}

const REPO_ROOT = getRepoRoot();

function nowIso(): string {
  return new Date().toISOString();
}

export function createEmptyManifest(env: string): DeploymentManifest {
  const now = nowIso();
  return {
    version: 1,
    env,
    createdAt: now,
    updatedAt: now,
    declaredClasses: {},
    contracts: {},
  };
}

export function getDefaultManifestPath(env: string): string {
  return path.resolve(REPO_ROOT, "scripts", "manifests", `${env}.json`);
}

export function loadManifest(env: string, manifestPath?: string): LoadedManifest {
  const resolvedPath = manifestPath ? path.resolve(manifestPath) : getDefaultManifestPath(env);
  if (!fs.existsSync(resolvedPath)) {
    return {
      manifestPath: resolvedPath,
      manifest: createEmptyManifest(env),
    };
  }

  const manifest = JSON.parse(fs.readFileSync(resolvedPath, "utf-8")) as DeploymentManifest;
  if (manifest.version !== 1) {
    throw new Error(`Unsupported manifest version in ${resolvedPath}`);
  }

  return {
    manifestPath: resolvedPath,
    manifest,
  };
}

export function saveManifest(manifestPath: string, manifest: DeploymentManifest): void {
  const resolvedPath = path.resolve(manifestPath);
  fs.mkdirSync(path.dirname(resolvedPath), { recursive: true });
  manifest.updatedAt = nowIso();

  const tempPath = `${resolvedPath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tempPath, JSON.stringify(manifest, null, 2) + "\n", { mode: 0o644 });
  fs.renameSync(tempPath, resolvedPath);
}
