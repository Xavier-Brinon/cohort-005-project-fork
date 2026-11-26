import { describe, expect, it } from "vitest";

import { suggestEmailCorrection } from "../index";

describe("Email Typo Hint: suggestEmailCorrection", () => {
  it.each([
    ["alice@gmial.com", "alice@gmail.com"],
    ["alice@gamil.com", "alice@gmail.com"],
    ["bob.smith@hotmial.com", "bob.smith@hotmail.com"],
    ["carol+news@outlok.com", "carol+news@outlook.com"],
    ["a@gmial.com", "a@gmail.com"],
  ])("suggests a corrected domain for %s", (email, expected) => {
    expect(suggestEmailCorrection(email)).toBe(expected);
  });

  it("ignores case and surrounding whitespace, as the login schema does", () => {
    expect(suggestEmailCorrection("  Alice@GMIAL.com ")).toBe(
      "alice@gmail.com"
    );
  });

  it.each([
    ["a correct gmail.com", "alice@gmail.com"],
    ["a correct hotmail.com", "alice@hotmail.com"],
    ["a correct outlook.com", "alice@outlook.com"],
    ["another domain", "alice@example.com"],
    ["a typo followed by more labels", "alice@gmial.com.au"],
    ["a typo preceded by more characters", "alice@notgmial.com"],
    ["an empty string", ""],
    ["a string with no @", "gmial.com"],
    ["an empty local part", "@gmial.com"],
    ["an empty local part after trimming", "  @gmial.com"],
  ])("returns null for %s", (_label, email) => {
    expect(suggestEmailCorrection(email)).toBeNull();
  });
});
