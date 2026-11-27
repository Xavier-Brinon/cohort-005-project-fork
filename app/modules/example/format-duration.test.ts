import { describe, expect, it } from "vitest";

import { formatDurationMinutes } from "./format-duration";

describe("formatDurationMinutes", () => {
  it.each([
    [0, "0m"],
    [45, "45m"],
    [60, "1h"],
    [135, "2h 15m"],
  ])("formats %i minutes as %s", (minutes, expected) => {
    expect(formatDurationMinutes(minutes)).toBe(expected);
  });

  it.each([-30, 90.5, Number.NaN, Number.POSITIVE_INFINITY])(
    "rejects %s, which is not a non-negative whole number of minutes",
    (minutes) => {
      expect(() => formatDurationMinutes(minutes)).toThrow(
        new RangeError(
          `Expected a non-negative whole number of minutes, got ${minutes}`
        )
      );
    }
  );
});
