import * as fs from "fs";
import * as path from "path";
import { hash, json } from "starknet";
import { getRepoRoot } from "./config";

export type FactoryArtifactName = "Primer" | "StarknetEth712Account" | "AccountFactory";

export interface ArtifactDescriptor {
  artifactName: FactoryArtifactName;
  packageName: string;
  contractName: string;
  sierraFile: string;
  casmFile: string;
}

export interface StarknetArtifact extends ArtifactDescriptor {
  artifactId: string;
  sierraPath: string;
  casmPath: string;
  sierraContract: any;
  casmContract: any;
  abi: any;
  classHash: string;
  compiledClassHash: string;
}

export type FactoryArtifactSet = Record<FactoryArtifactName, StarknetArtifact>;

const REPO_ROOT = getRepoRoot();
const TARGET_DIR = path.resolve(REPO_ROOT, "target", "release");

export const FACTORY_DECLARE_ORDER: FactoryArtifactName[] = [
  "Primer",
  "StarknetEth712Account",
  "AccountFactory",
];

export const ARTIFACT_DESCRIPTORS: Record<FactoryArtifactName, ArtifactDescriptor> = {
  Primer: {
    artifactName: "Primer",
    packageName: "contracts",
    contractName: "Primer",
    sierraFile: "contracts_Primer.contract_class.json",
    casmFile: "contracts_Primer.compiled_contract_class.json",
  },
  StarknetEth712Account: {
    artifactName: "StarknetEth712Account",
    packageName: "eth_712_account",
    contractName: "StarknetEth712Account",
    sierraFile: "eth_712_account_StarknetEth712Account.contract_class.json",
    casmFile: "eth_712_account_StarknetEth712Account.compiled_contract_class.json",
  },
  AccountFactory: {
    artifactName: "AccountFactory",
    packageName: "account_factory",
    contractName: "AccountFactory",
    sierraFile: "account_factory_AccountFactory.contract_class.json",
    casmFile: "account_factory_AccountFactory.compiled_contract_class.json",
  },
};

const artifactCache = new Map<FactoryArtifactName, StarknetArtifact>();

export function getArtifactId(artifactName: FactoryArtifactName): string {
  const descriptor = ARTIFACT_DESCRIPTORS[artifactName];
  return `${descriptor.packageName}:${descriptor.contractName}:release`;
}

export function loadStarknetArtifact(artifactName: FactoryArtifactName): StarknetArtifact {
  const cached = artifactCache.get(artifactName);
  if (cached) {
    return cached;
  }

  const descriptor = ARTIFACT_DESCRIPTORS[artifactName];
  const sierraPath = path.join(TARGET_DIR, descriptor.sierraFile);
  const casmPath = path.join(TARGET_DIR, descriptor.casmFile);

  if (!fs.existsSync(sierraPath) || !fs.existsSync(casmPath)) {
    throw new Error(
      `Release artifacts for ${artifactName} not found in ${TARGET_DIR}. Run \`SCARB_PROFILE=release scarb build\` first.`,
    );
  }

  const sierraContract = json.parse(fs.readFileSync(sierraPath, "utf-8"));
  const casmContract = json.parse(fs.readFileSync(casmPath, "utf-8"));
  const artifact: StarknetArtifact = {
    ...descriptor,
    artifactId: getArtifactId(artifactName),
    sierraPath,
    casmPath,
    sierraContract,
    casmContract,
    abi: sierraContract.abi,
    classHash: hash.computeContractClassHash(sierraContract),
    compiledClassHash: hash.computeCompiledClassHash(casmContract),
  };

  artifactCache.set(artifactName, artifact);
  return artifact;
}

export function loadFactoryArtifacts(): FactoryArtifactSet {
  return {
    Primer: loadStarknetArtifact("Primer"),
    StarknetEth712Account: loadStarknetArtifact("StarknetEth712Account"),
    AccountFactory: loadStarknetArtifact("AccountFactory"),
  };
}

export function relativeArtifactPath(absolutePath: string): string {
  return path.relative(REPO_ROOT, absolutePath);
}
