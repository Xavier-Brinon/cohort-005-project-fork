# Knock delivers in-app Notifications

Cadence sends in-app Notifications through Knock, a hosted vendor, instead of storing them itself. Knock holds the feed and read state, delivers in real time, and accepts a user token Cadence signs on the server, so nobody can open another person's inbox. We picked it over cheaper and open-source vendors because cost of growth was ruled out as a criterion, which left Knock ahead on environments, token signing and read state.

## Considered Options

- **Novu.** MIT open core, EU data residency on the free tier, $30/mo next tier. Lost on environments (only Dev and Prod on Free) and a simpler read state. It is the named fallback if Knock fails the React Router 7 prototype.
- **SuprSend.** Staging and Production on Free, $100/mo next tier, but SSR undocumented and a possibly stale pricing page.
- **MagicBell, Courier, Engagespot, NotificationAPI (Pingram).** Dropped: too small a free tier, a token minted by an API call, or a product that looks abandoned or has moved away from in-app.
- **A home-grown notifications table.** Rejected: Cadence is treated as live in production and needs real-time delivery, signed access, and room for email later.

## Consequences

- No EU data residency until Knock ships it (promised by end of 2026). EU residency was ruled a tie-breaker, not a requirement.
- Closed source, and $250/mo once usage passes the free 10,000 messages a month.
- Knock's inbox renders only in the browser: the user token is signed in a loader and the inbox mounts after hydration.

Research: `research/notification-vendors` and `research/more-notification-vendors` branches.
