#!/usr/bin/env bun
import { Command } from "commander";
import { runAudit } from "./commands/audit";
import { buildFactoryPlan, verifyRecordedFactoryReadable } from "./commands/factory";
import { ensureReleaseBuild, verifyPrimerClassHash } from "./lib/starknet";
import {
  executePlan,
  loadCommandContext,
  printPlan,
  type CommandContext,
  type CommandOptions,
} from "./lib/runtime";

function applySharedOptions<T extends { option: (...args: any[]) => T }>(
  command: T,
  includeExecute = false,
): T {
  command
    .option("--env <env>", "Deployment environment name")
    .option("--config-path <path>", "Override deployment config path")
    .option("--manifest-path <path>", "Override deployment manifest path")
    .option("--wait-retry-interval-ms <ms>", "Override Starknet transaction wait poll interval in milliseconds")
    .option(
      "--wait-success-states <states>",
      "Comma-separated Starknet wait success states, e.g. PRE_CONFIRMED,ACCEPTED_ON_L2",
    )
    .option("--tip <tip>", "Override Starknet transaction tip; local devnet E2E can use 0");

  if (includeExecute) {
    command
      .option("--execute", "Actually broadcast transactions")
      .option("--confirm-mainnet", "Required for Starknet mainnet execution")
      .option("--allow-dirty", "Allow mainnet execution with a dirty git worktree");
  }

  return command;
}

async function withContext<T>(
  options: CommandOptions,
  handler: (context: CommandContext) => Promise<T>,
): Promise<T> {
  const context = await loadCommandContext(options);
  return handler(context);
}

function printStatus(context: CommandContext): void {
  console.log(`Environment: ${context.env}`);
  console.log(`Config: ${context.configPath}`);
  console.log(`Manifest: ${context.manifestPath}`);
  console.log(`Starknet: ${context.chain.label} (${context.chain.chainId})`);
  console.log(`Deployer: ${context.config.starknet.accountAddress}`);
  console.log(`Factory multisig: ${context.config.factory.multisigAddress}`);
  console.log(`Factory upgrade delay: ${context.config.factory.upgradeDelaySeconds}s`);
  console.log(`Declared classes: ${Object.keys(context.manifest.declaredClasses).length}`);
  console.log(`Factory: ${context.manifest.contracts.factory?.address ?? "<not deployed>"}`);
}

export async function runCli(argv = process.argv): Promise<void> {
  const program = new Command();

  program.name("deploy").description("Karnot Earn factory deployment CLI").version("1.0.0");

  applySharedOptions(program.command("validate").description("Validate config and RPC chain id"))
    .action(async (options: CommandOptions) => {
      await withContext(options, async (context) => {
        printStatus(context);
      });
    });

  applySharedOptions(program.command("status").description("Show deployment manifest status"))
    .action(async (options: CommandOptions) => {
      await withContext(options, async (context) => {
        printStatus(context);
        console.log("\nDeclared classes:");
        for (const [key, record] of Object.entries(context.manifest.declaredClasses)) {
          console.log(`- ${key}: ${record.classHash}`);
        }
      });
    });

  applySharedOptions(program.command("factory").description("Preview or apply factory declarations and deployment"), true)
    .action(async (options: CommandOptions) => {
      await withContext(options, async (context) => {
        verifyPrimerClassHash();
        await verifyRecordedFactoryReadable(context);
        const plan = buildFactoryPlan(context);
        printPlan(plan, context.manifest);
        if (options.execute) {
          await executePlan(context, plan, options);
        }
      });
    });

  applySharedOptions(program.command("audit").description("Audit local release hashes against manifest and factory state"))
    .action(async (options: CommandOptions) => {
      await withContext(options, async (context) => {
        ensureReleaseBuild();
        await runAudit(context);
      });
    });

  await program.parseAsync(argv);
}

if (import.meta.main) {
  runCli().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
