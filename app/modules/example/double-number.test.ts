import { describe, expect, it } from "vitest";

import { doubleNumber } from "./double-number";

describe("doubleNumber", () => {
  it("doubles a positive number", () => {
    expect(doubleNumber(3)).toBe(6);
  });

  it("doubles zero", () => {
    expect(doubleNumber(0)).toBe(0);
  });

  it("doubles a negative number", () => {
    expect(doubleNumber(-4)).toBe(-8);
  });
});
