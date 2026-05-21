import { describe, expect, test } from "bun:test";
import { buildFactoryPlan } from "../commands/factory";
import { previewManifest } from "../lib/runtime";
import { makeFixtureArtifacts, makeFixtureContext } from "./helpers";

describe("factory deployment plan", () => {
  test("plans declarations and factory deployment from an empty manifest", () => {
    const artifacts = makeFixtureArtifacts();
    const context = makeFixtureContext();

    const plan = buildFactoryPlan(context, artifacts);
    expect(plan.actions.map((action) => action.id)).toEqual([
      "declare:Primer",
      "declare:StarknetEth712Account",
      "declare:AccountFactory",
      "deploy:AccountFactory",
    ]);

    const preview = previewManifest(plan, context.manifest);
    expect(preview.declaredClasses[artifacts.Primer.artifactId].classHash).toBe("0x101");
    expect(preview.contracts.factory?.accountClassHash).toBe("0x202");
  });

  test("skips work already recorded in the manifest", () => {
    const artifacts = makeFixtureArtifacts();
    const context = makeFixtureContext();
    const firstPlan = buildFactoryPlan(context, artifacts);
    const preview = previewManifest(firstPlan, context.manifest);
    preview.contracts.factory!.address = "0xabc";

    const secondPlan = buildFactoryPlan({ ...context, manifest: preview }, artifacts);

    expect(secondPlan.actions).toEqual([]);
  });

  test("fails when the recorded class hash differs from the local release artifact", () => {
    const artifacts = makeFixtureArtifacts();
    const context = makeFixtureContext();
    context.manifest.declaredClasses[artifacts.AccountFactory.artifactId] = {
      artifact: artifacts.AccountFactory.artifactId,
      packageName: "account_factory",
      contractName: "AccountFactory",
      classHash: "0x999",
      compiledClassHash: "0x1999",
      sierraPath: "target/release/account_factory_AccountFactory.contract_class.json",
      casmPath: "target/release/account_factory_AccountFactory.compiled_contract_class.json",
      declaredAt: "existing",
    };

    expect(() => buildFactoryPlan(context, artifacts)).toThrow("Manifest class hash mismatch");
  });
});
