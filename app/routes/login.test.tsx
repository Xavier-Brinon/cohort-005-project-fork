import { renderToString } from "react-dom/server";
import { createRoutesStub } from "react-router";
import { describe, expect, it } from "vitest";

import Login from "./login";

function renderAfterFailedSubmit(email: string): string {
  const Stub = createRoutesStub([
    { id: "login", path: "/login", Component: Login },
  ]);
  return renderToString(
    <Stub
      initialEntries={["/login"]}
      hydrationData={{
        actionData: {
          login: {
            errors: { email: "No account found with that email." },
            values: { email },
          },
        },
      }}
    />
  );
}

function submitButton(html: string): string {
  const match = /<button[^>]*type="submit"[^>]*>/.exec(html);
  if (!match) {
    throw new Error("No submit button rendered");
  }
  return match[0];
}

describe("login page Email Typo Hint", () => {
  it("suggests the corrected address for a known domain typo", () => {
    const html = renderAfterFailedSubmit("alice@gmial.com");

    expect(html).toMatch(
      /<p id="email-typo-hint" class="[^"]*text-muted-foreground[^"]*">Did you mean <!-- -->alice@gmail.com<!-- -->\?<\/p>/
    );
    expect(html).toContain('aria-describedby="email-typo-hint"');
    expect(html).toContain('aria-live="polite"');
  });

  it("shows no hint for an address without a typo", () => {
    const html = renderAfterFailedSubmit("alice@gmail.com");

    expect(html).not.toContain("Did you mean");
    expect(html).not.toContain("email-typo-hint");
  });

  it("keeps the submit button enabled while a hint shows", () => {
    const html = renderAfterFailedSubmit("alice@gmial.com");

    expect(html).toContain("Did you mean");
    expect(submitButton(html)).not.toMatch(/\sdisabled(="")?[\s>]/);
  });
});
