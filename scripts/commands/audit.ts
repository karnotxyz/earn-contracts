import { loadFactoryArtifacts, type FactoryArtifactSet } from "../lib/artifacts";
import { readFactoryState } from "../lib/starknet";
import type { CommandContext } from "../lib/runtime";

export interface AuditRow {
  check: string;
  expected: string;
  actual: string;
  status: "OK" | "MISSING" | "MISMATCH";
}

function normalizeFelt(value: string): string {
  return `0x${BigInt(value).toString(16)}`;
}

function compareFelts(expected: string, actual: string): boolean {
  return normalizeFelt(expected) === normalizeFelt(actual);
}

export function formatAuditRows(rows: AuditRow[]): string {
  const widths = {
    check: Math.max("check".length, ...rows.map((row) => row.check.length)),
    status: Math.max("status".length, ...rows.map((row) => row.status.length)),
    expected: Math.max("expected".length, ...rows.map((row) => row.expected.length)),
    actual: Math.max("actual".length, ...rows.map((row) => row.actual.length)),
  };

  const header = `${"check".padEnd(widths.check)}  ${"status".padEnd(widths.status)}  ${"expected".padEnd(widths.expected)}  actual`;
  const separator = `${"-".repeat(widths.check)}  ${"-".repeat(widths.status)}  ${"-".repeat(widths.expected)}  ${"-".repeat(widths.actual)}`;
  const body = rows.map(
    (row) =>
      `${row.check.padEnd(widths.check)}  ${row.status.padEnd(widths.status)}  ${row.expected.padEnd(widths.expected)}  ${row.actual}`,
  );

  return [header, separator, ...body].join("\n");
}

export async function buildAuditRows(
  context: CommandContext,
  artifacts: FactoryArtifactSet = loadFactoryArtifacts(),
): Promise<AuditRow[]> {
  const rows: AuditRow[] = [];

  for (const artifact of Object.values(artifacts)) {
    const record = context.manifest.declaredClasses[artifact.artifactId];
    if (!record) {
      rows.push({
        check: `declared:${artifact.artifactName}`,
        expected: artifact.classHash,
        actual: "<missing>",
        status: "MISSING",
      });
      continue;
    }

    rows.push({
      check: `declared:${artifact.artifactName}`,
      expected: artifact.classHash,
      actual: record.classHash,
      status: compareFelts(artifact.classHash, record.classHash) ? "OK" : "MISMATCH",
    });
  }

  const factory = context.manifest.contracts.factory;
  if (!factory?.address) {
    rows.push({
      check: "factory:address",
      expected: "deployed",
      actual: "<missing>",
      status: "MISSING",
    });
    return rows;
  }

  const state = await readFactoryState({
    config: context.config,
    address: factory.address,
    abi: artifacts.AccountFactory.abi,
  });

  rows.push({
    check: "factory:class_hash",
    expected: artifacts.AccountFactory.classHash,
    actual: state.deployedClassHash,
    status: compareFelts(artifacts.AccountFactory.classHash, state.deployedClassHash)
      ? "OK"
      : "MISMATCH",
  });

  rows.push({
    check: "factory:account_class_hash",
    expected: artifacts.StarknetEth712Account.classHash,
    actual: state.accountClassHash,
    status: compareFelts(artifacts.StarknetEth712Account.classHash, state.accountClassHash)
      ? "OK"
      : "MISMATCH",
  });

  return rows;
}

export async function runAudit(context: CommandContext): Promise<void> {
  const rows = await buildAuditRows(context);
  console.log(formatAuditRows(rows));
}
