import { describe, expect, it } from "vitest";

import { numberedSlug } from "../index";

describe("numberedSlug", () => {
  it("prefixes a URL-safe slug with the position", () => {
    expect(numberedSlug(3, "  Hello, World! ")).toBe("3-hello-world");
  });
});
