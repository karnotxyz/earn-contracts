import { describe, expect, test } from "bun:test";
import { assertExecutionSafety } from "../lib/runtime";
import { makeFixtureContext } from "./helpers";

describe("execution safety", () => {
  test("requires --execute before applying any plan", () => {
    const context = makeFixtureContext();

    expect(() => assertExecutionSafety(context, {})).toThrow("Execution requires --execute");
  });

  test("allows testnet execution without mainnet confirmation", () => {
    const context = makeFixtureContext("SN_SEPOLIA");

    expect(() => assertExecutionSafety(context, { execute: true })).not.toThrow();
  });

  test("requires explicit mainnet confirmation", () => {
    const context = makeFixtureContext("SN_MAIN");

    expect(() => assertExecutionSafety(context, { execute: true }, () => "")).toThrow(
      "Mainnet execution requires --confirm-mainnet",
    );
  });

  test("requires clean git state on mainnet unless allow-dirty is passed", () => {
    const context = makeFixtureContext("SN_MAIN");

    expect(() =>
      assertExecutionSafety(context, { execute: true, confirmMainnet: true }, () => " M README.md"),
    ).toThrow("Mainnet execution requires a clean git worktree");

    expect(() =>
      assertExecutionSafety(
        context,
        { execute: true, confirmMainnet: true, allowDirty: true },
        () => " M README.md",
      ),
    ).not.toThrow();
  });
});
