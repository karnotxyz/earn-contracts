import {
  FACTORY_DECLARE_ORDER,
  loadFactoryArtifacts,
  relativeArtifactPath,
  type FactoryArtifactSet,
  type StarknetArtifact,
} from "../lib/artifacts";
import { declareClassIfNeeded, deployFactoryIfNeeded, readFactoryState } from "../lib/starknet";
import type { DeploymentManifest } from "../lib/manifest";
import type { CommandContext, OperationPlan, PlannedAction } from "../lib/runtime";

const PLANNED = "<planned>";
const PLACEHOLDER = "<deployed-at-apply>";

function nowPlannedRecord(artifact: StarknetArtifact) {
  return {
    artifact: artifact.artifactId,
    packageName: artifact.packageName,
    contractName: artifact.contractName,
    classHash: artifact.classHash,
    compiledClassHash: artifact.compiledClassHash,
    sierraPath: relativeArtifactPath(artifact.sierraPath),
    casmPath: relativeArtifactPath(artifact.casmPath),
    declaredAt: PLANNED,
  };
}

function assertRecordedClassHashMatches(manifest: DeploymentManifest, artifact: StarknetArtifact): void {
  const existing = manifest.declaredClasses[artifact.artifactId];
  if (existing && existing.classHash !== artifact.classHash) {
    throw new Error(
      `Manifest class hash mismatch for ${artifact.artifactId}: recorded ${existing.classHash}, local release artifact ${artifact.classHash}`,
    );
  }
}

function buildDeclareAction(artifact: StarknetArtifact): PlannedAction {
  return {
    id: `declare:${artifact.artifactName}`,
    description: `Declare ${artifact.artifactName}`,
    preview: (manifest) => {
      manifest.declaredClasses[artifact.artifactId] = nowPlannedRecord(artifact);
    },
    execute: async (context) => {
      await declareClassIfNeeded({
        manifest: context.manifest,
        config: context.config,
        artifact,
      });
    },
  };
}

function buildDeployFactoryAction(artifacts: FactoryArtifactSet): PlannedAction {
  const accountArtifact = artifacts.StarknetEth712Account;
  const factoryArtifact = artifacts.AccountFactory;

  return {
    id: "deploy:AccountFactory",
    description: "Deploy AccountFactory with multisig governance and StarknetEth712Account class hash",
    preview: (manifest) => {
      manifest.contracts.factory = {
        address: PLACEHOLDER,
        contractType: "AccountFactory",
        chainId: manifest.chainId ?? PLANNED,
        classHash: factoryArtifact.classHash,
        accountClassHash: accountArtifact.classHash,
        constructorCalldata: {
          governanceAdmin: PLACEHOLDER,
          upgradeDelay: PLACEHOLDER,
          accountClassHash: accountArtifact.classHash,
        },
        deployedAt: PLANNED,
      };
    },
    execute: async (context) => {
      await deployFactoryIfNeeded({
        manifest: context.manifest,
        config: context.config,
        chainId: context.chain.chainId,
        factoryArtifact,
        accountArtifact,
      });
    },
  };
}

export function buildFactoryPlan(
  context: CommandContext,
  artifacts: FactoryArtifactSet = loadFactoryArtifacts(),
): OperationPlan {
  const actions: PlannedAction[] = [];

  for (const artifactName of FACTORY_DECLARE_ORDER) {
    const artifact = artifacts[artifactName];
    assertRecordedClassHashMatches(context.manifest, artifact);

    const existing = context.manifest.declaredClasses[artifact.artifactId];
    if (existing?.classHash === artifact.classHash) {
      continue;
    }

    actions.push(buildDeclareAction(artifact));
  }

  if (!context.manifest.contracts.factory?.address) {
    actions.push(buildDeployFactoryAction(artifacts));
  }

  return {
    command: "factory",
    actions,
    notes: [
      "Only Primer, StarknetEth712Account, and AccountFactory are declared or deployed.",
      "If a manifest record already has the current class hash or factory address, that step is skipped.",
    ],
  };
}

export async function verifyRecordedFactoryReadable(
  context: CommandContext,
  artifacts: FactoryArtifactSet = loadFactoryArtifacts(),
): Promise<void> {
  const factory = context.manifest.contracts.factory;
  if (!factory?.address) {
    return;
  }

  await readFactoryState({
    config: context.config,
    address: factory.address,
    abi: artifacts.AccountFactory.abi,
  });
}
