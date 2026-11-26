import { renderToString } from "react-dom/server";
import { createRoutesStub } from "react-router";
import { describe, expect, it } from "vitest";

import Login from "./login";

const HELPER_COPY = "No password needed — enter the email you signed up with.";

function renderLogin() {
  const Stub = createRoutesStub([{ path: "/login", Component: Login }]);
  return renderToString(<Stub initialEntries={["/login"]} />);
}

describe("Login page", () => {
  it("tells the learner no password is needed", () => {
    expect(renderLogin()).toContain(HELPER_COPY);
  });

  it("places the helper line beneath the Log In button", () => {
    const html = renderLogin();
    const button = html.indexOf("Log In</button>");
    const helper = html.indexOf(HELPER_COPY);

    expect(button).toBeGreaterThan(-1);
    expect(helper).toBeGreaterThan(button);
  });
});
