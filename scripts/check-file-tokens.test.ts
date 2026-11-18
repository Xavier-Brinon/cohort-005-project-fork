import { describe, expect, it } from "vitest";

import {
  estimateTokens,
  findOversized,
  MAX_TOKENS,
  splitGuidance,
} from "./check-file-tokens";

const textOfTokens = (tokens: number) => Buffer.from("a".repeat(tokens * 4));

describe("findOversized", () => {
  it("flags a text file over the limit and passes one at the limit", () => {
    const files: Record<string, Buffer> = {
      "app/big.ts": textOfTokens(MAX_TOKENS + 1),
      "app/ok.ts": textOfTokens(MAX_TOKENS),
    };
    expect(findOversized(Object.keys(files), (file) => files[file])).toEqual([
      { file: "app/big.ts", tokens: MAX_TOKENS + 1 },
    ]);
  });

  it("skips generated files without reading them", () => {
    const read = () => {
      throw new Error("should not read");
    };
    expect(
      findOversized(["package-lock.json", "drizzle/meta/0001.json"], read)
    ).toEqual([]);
  });

  it("skips binary files", () => {
    const binary = Buffer.concat([Buffer.from([0]), textOfTokens(MAX_TOKENS)]);
    expect(findOversized(["public/logo.png"], () => binary)).toEqual([]);
  });
});

describe("estimateTokens", () => {
  it("rounds bytes / 4 up", () => {
    expect(estimateTokens(Buffer.from("abcde"))).toBe(2);
  });
});

describe("splitGuidance", () => {
  it("tailors advice to tests and routes", () => {
    expect(splitGuidance("app/lib/refunds.server.test.ts")[0]).toMatch(
      /describe/
    );
    expect(splitGuidance("app/routes/courses.$slug.tsx")[0]).toMatch(/loader/);
  });
});
