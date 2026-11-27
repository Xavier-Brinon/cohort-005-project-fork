import { describe, expect, it } from "vitest";

import { clampPercentage } from "./clamp-percentage";

describe("clampPercentage", () => {
  it("returns a value inside the range unchanged", () => {
    expect(clampPercentage(42.5)).toBe(42.5);
  });

  it("keeps the bounds themselves", () => {
    expect(clampPercentage(0)).toBe(0);
    expect(clampPercentage(100)).toBe(100);
  });

  it("raises a negative value to 0", () => {
    expect(clampPercentage(-0.1)).toBe(0);
  });

  it("lowers a value above 100 to 100", () => {
    expect(clampPercentage(100.1)).toBe(100);
  });
});
