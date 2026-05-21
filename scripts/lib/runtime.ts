import { execSync } from "child_process";
import { detectStarknetChain, assertChainMatches, isMainnetChainId, type DetectedChain } from "./chain";
import { getDefaultEnvName, getRepoRoot, loadDeploymentConfig, type DeploymentConfig } from "./config";
import { loadManifest, saveManifest, type DeploymentManifest } from "./manifest";

export interface CommandOptions {
  env?: string;
  configPath?: string;
  manifestPath?: string;
  execute?: boolean;
  confirmMainnet?: boolean;
  allowDirty?: boolean;
}

export interface CommandContext {
  env: string;
  configPath: string;
  manifestPath: string;
  config: DeploymentConfig;
  manifest: DeploymentManifest;
  chain: DetectedChain;
}

export interface PlannedAction {
  id: string;
  description: string;
  preview: (manifest: DeploymentManifest) => void;
  execute?: (context: CommandContext) => Promise<void>;
}

export interface OperationPlan {
  command: string;
  actions: PlannedAction[];
  notes?: string[];
}

type ChainDetector = (rpcUrl: string) => Promise<DetectedChain>;
type GitStatusReader = () => string;

function cloneManifest(manifest: DeploymentManifest): DeploymentManifest {
  return JSON.parse(JSON.stringify(manifest)) as DeploymentManifest;
}

function flatten(value: unknown, prefix = ""): Record<string, string> {
  if (Array.isArray(value)) {
    return value.reduce<Record<string, string>>((acc, item, index) => {
      Object.assign(acc, flatten(item, `${prefix}[${index}]`));
      return acc;
    }, {});
  }

  if (value && typeof value === "object") {
    return Object.entries(value as Record<string, unknown>).reduce<Record<string, string>>(
      (acc, [key, item]) => {
        const nextPrefix = prefix ? `${prefix}.${key}` : key;
        Object.assign(acc, flatten(item, nextPrefix));
        return acc;
      },
      {},
    );
  }

  return {
    [prefix]: JSON.stringify(value),
  };
}

export function diffManifests(before: DeploymentManifest, after: DeploymentManifest): string[] {
  const beforeFlat = flatten(before);
  const afterFlat = flatten(after);
  const keys = new Set([...Object.keys(beforeFlat), ...Object.keys(afterFlat)]);

  return [...keys]
    .sort()
    .filter((key) => beforeFlat[key] !== afterFlat[key])
    .map((key) => `${key}: ${beforeFlat[key] ?? "<missing>"} -> ${afterFlat[key] ?? "<missing>"}`);
}

export function previewManifest(plan: OperationPlan, manifest: DeploymentManifest): DeploymentManifest {
  const nextManifest = cloneManifest(manifest);
  for (const action of plan.actions) {
    action.preview(nextManifest);
  }
  return nextManifest;
}

export async function loadCommandContext(
  options: CommandOptions,
  detectChain: ChainDetector = detectStarknetChain,
): Promise<CommandContext> {
  const env = options.env || getDefaultEnvName();
  const loadedConfig = loadDeploymentConfig(env, options.configPath);
  const loadedManifest = loadManifest(env, options.manifestPath);
  const chain = await detectChain(loadedConfig.config.starknet.rpcUrl);

  assertChainMatches(loadedConfig.config.starknet.chainId, chain);
  loadedManifest.manifest.chainId = chain.chainId;

  return {
    env,
    configPath: loadedConfig.configPath,
    manifestPath: loadedManifest.manifestPath,
    config: loadedConfig.config,
    manifest: loadedManifest.manifest,
    chain,
  };
}

function readGitStatus(): string {
  return execSync("git status --short", {
    cwd: getRepoRoot(),
    encoding: "utf-8",
  }).trim();
}

export function assertExecutionSafety(
  context: CommandContext,
  options: CommandOptions,
  gitStatusReader: GitStatusReader = readGitStatus,
): void {
  if (!options.execute) {
    throw new Error("Execution requires --execute");
  }

  if (!isMainnetChainId(context.chain.chainId)) {
    return;
  }

  if (!options.confirmMainnet) {
    throw new Error("Mainnet execution requires --confirm-mainnet");
  }

  if (!options.allowDirty) {
    const status = gitStatusReader();
    if (status !== "") {
      throw new Error("Mainnet execution requires a clean git worktree or --allow-dirty");
    }
  }
}

export function printPlan(plan: OperationPlan, currentManifest: DeploymentManifest): void {
  const preview = previewManifest(plan, currentManifest);
  const diff = diffManifests(currentManifest, preview);

  console.log(`\nPlan: ${plan.command}`);
  console.log(`Actions (${plan.actions.length}):`);
  for (const action of plan.actions) {
    console.log(`- [${action.id}] ${action.description}`);
  }

  if (plan.notes?.length) {
    console.log("\nNotes:");
    for (const note of plan.notes) {
      console.log(`- ${note}`);
    }
  }

  console.log("\nManifest diff:");
  if (!diff.length) {
    console.log("- No manifest changes");
  } else {
    for (const line of diff) {
      console.log(`- ${line}`);
    }
  }
}

export async function executePlan(
  context: CommandContext,
  plan: OperationPlan,
  options: CommandOptions,
): Promise<void> {
  assertExecutionSafety(context, options);

  if (!plan.actions.length) {
    console.log(`No actions required for ${plan.command}`);
    return;
  }

  for (const action of plan.actions) {
    console.log(`Executing [${action.id}] ${action.description}`);
    if (!action.execute) {
      throw new Error(`Action ${action.id} is missing an execute handler`);
    }
    await action.execute(context);
    saveManifest(context.manifestPath, context.manifest);
  }

  context.manifest.lastPlan = {
    mode: "apply",
    command: plan.command,
    actions: plan.actions.map((action) => action.description),
    createdAt: new Date().toISOString(),
  };
  saveManifest(context.manifestPath, context.manifest);
}
