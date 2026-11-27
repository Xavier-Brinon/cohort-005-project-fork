import { describe, expect, it } from "vitest";

import { isPositiveInteger } from "./is-positive-integer";

describe("isPositiveInteger", () => {
  it("accepts positive whole numbers", () => {
    expect(isPositiveInteger(1)).toBe(true);
    expect(isPositiveInteger(42)).toBe(true);
  });

  it("rejects zero and negatives", () => {
    expect(isPositiveInteger(0)).toBe(false);
    expect(isPositiveInteger(-1)).toBe(false);
  });

  it("rejects non-integers", () => {
    expect(isPositiveInteger(1.5)).toBe(false);
    expect(isPositiveInteger(Number.NaN)).toBe(false);
    expect(isPositiveInteger(Number.POSITIVE_INFINITY)).toBe(false);
  });
});
