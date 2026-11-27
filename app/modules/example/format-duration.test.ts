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
});
