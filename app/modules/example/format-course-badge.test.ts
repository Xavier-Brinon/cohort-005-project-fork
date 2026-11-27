import { describe, expect, it } from "vitest";

import { formatCourseBadge } from "./format-course-badge";

describe("formatCourseBadge", () => {
  it("labels a beginner course", () => {
    expect(formatCourseBadge("beginner")).toBe("Beginner");
  });

  it("labels an intermediate course", () => {
    expect(formatCourseBadge("intermediate")).toBe("Intermediate");
  });

  it("labels an advanced course", () => {
    expect(formatCourseBadge("advanced")).toBe("Advanced");
  });
});
