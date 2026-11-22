import { describe, expect, it } from "vitest";

import { checksFor } from "./check";

const names = (flags: string[], staged: string[] = []) =>
  checksFor(flags, staged).map((check) => check.name);

describe("checksFor", () => {
  it("runs every whole-tree check but the client bundle by default", () => {
    expect(names([])).toEqual([
      "typegen",
      "tsc",
      "lint:boolean-names",
      "lint:boundaries",
      "test",
      "lint",
      "format:check",
    ]);
  });

  it("runs tsc and the boolean-name check after typegen, in every mode", () => {
    for (const flags of [[], ["--staged"], ["--full"]]) {
      const waiting = checksFor(flags, ["app/a.ts"])
        .filter((check) => check.needs === "typegen")
        .map((check) => check.name);
      expect(waiting).toEqual(["tsc", "lint:boolean-names"]);
    }
  });

  it("adds the client bundle with --full", () => {
    expect(names(["--full"])).toContain("check:client-bundle");
  });

  it("lints only staged code files and formats every staged file", () => {
    const checks = checksFor(["--staged"], ["app/a.ts", "README.md"]);
    const lint = checks.find((check) => check.name === "lint (staged)");
    const format = checks.find(
      (check) => check.name === "format:check (staged)"
    );
    expect(lint?.args).toEqual(["--no-error-on-unmatched-pattern", "app/a.ts"]);
    expect(format?.args).toEqual([
      "--check",
      "--no-error-on-unmatched-pattern",
      "app/a.ts",
      "README.md",
    ]);
    expect(names(["--staged"], ["app/a.ts"])).toContain("file tokens (staged)");
  });

  it("skips staged lint when no code file is staged, rather than lint everything", () => {
    expect(names(["--staged"], ["README.md"])).not.toContain("lint (staged)");
    expect(names(["--staged"], [])).not.toContain("format:check (staged)");
  });
});
