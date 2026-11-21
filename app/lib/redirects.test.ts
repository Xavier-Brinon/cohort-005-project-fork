import { describe, expect, it } from "vitest";

import { safeRedirectPath } from "./redirects";

describe("safeRedirectPath", () => {
  it("keeps a path on this site with its query and hash", () => {
    expect(safeRedirectPath("/courses/intro/purchase?mode=team#top", "/")).toBe(
      "/courses/intro/purchase?mode=team#top"
    );
  });

  it("falls back when there is no target or it is not a path", () => {
    for (const target of [null, "", "courses", "https://evil.example"]) {
      expect(safeRedirectPath(target, "/fallback")).toBe("/fallback");
    }
  });

  it("falls back for paths a browser reads as another site", () => {
    for (const target of [
      "//evil.example",
      "/\\evil.example",
      "/\t/evil.example",
      "//evil.example/courses",
    ]) {
      expect(safeRedirectPath(target, "/fallback")).toBe("/fallback");
    }
  });

  it("falls back for a target that does not parse", () => {
    expect(safeRedirectPath("//[", "/fallback")).toBe("/fallback");
  });
});
