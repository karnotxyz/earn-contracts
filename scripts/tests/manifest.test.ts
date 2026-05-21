import { describe, expect, test } from "bun:test";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { createEmptyManifest, loadManifest, saveManifest } from "../lib/manifest";

describe("deployment manifest", () => {
  test("saves and loads manifest records atomically", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "earn-manifest-"));
    const manifestPath = path.join(tempDir, "fixture.json");
    const manifest = createEmptyManifest("fixture");
    manifest.chainId = "SN_SEPOLIA";
    manifest.declaredClasses["contracts:Primer:release"] = {
      artifact: "contracts:Primer:release",
      packageName: "contracts",
      contractName: "Primer",
      classHash: "0x101",
      compiledClassHash: "0x201",
      sierraPath: "target/release/contracts_Primer.contract_class.json",
      casmPath: "target/release/contracts_Primer.compiled_contract_class.json",
      declaredAt: "now",
    };

    saveManifest(manifestPath, manifest);
    const loaded = loadManifest("fixture", manifestPath);

    expect(loaded.manifest.chainId).toBe("SN_SEPOLIA");
    expect(loaded.manifest.declaredClasses["contracts:Primer:release"].classHash).toBe("0x101");
    expect(fs.readdirSync(tempDir).filter((name) => name.endsWith(".tmp"))).toEqual([]);
  });

  test("returns an empty manifest when no recorded json is provided", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "earn-manifest-"));
    const manifestPath = path.join(tempDir, "missing.json");
    const loaded = loadManifest("fixture", manifestPath);

    expect(loaded.manifest.env).toBe("fixture");
    expect(loaded.manifest.contracts.factory).toBeUndefined();
  });
});
