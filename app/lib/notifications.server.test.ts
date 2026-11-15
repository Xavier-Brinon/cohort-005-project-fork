import { mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  deliver,
  fakeNotifier,
  outboxNotifier,
  type Notifier,
  type NotifyIntent,
} from "./notifications.server";

const opened: NotifyIntent = {
  type: "refund-request-opened",
  actor: { id: 1, name: "Liam" },
  recipients: [{ id: 3, name: "Pat Admin" }],
  data: {
    refundRequestId: 7,
    buyerName: "Liam",
    courseTitle: "Introduction to TypeScript",
    purchaseKind: "individual_purchase",
    reasonExcerpt: "It was not what I expected.",
    url: "/admin/refunds",
  },
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe("deliver", () => {
  it("passes mark-read intents to the Notifier", async () => {
    const notifier = fakeNotifier();

    await deliver(
      { markRead: [{ type: "refund-request-opened", subjectId: 7 }] },
      notifier
    );

    expect(notifier.marked).toEqual([
      { type: "refund-request-opened", subjectId: 7 },
    ]);
  });

  it("logs and swallows a Notifier that throws", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const failing: Notifier = {
      notify: () => Promise.reject(new Error("Knock is down")),
      markRead: () => {
        throw new Error("Knock is down");
      },
    };

    await expect(
      deliver(
        {
          notify: [opened],
          markRead: [{ type: "refund-request-opened", subjectId: 7 }],
        },
        failing
      )
    ).resolves.toBeUndefined();

    expect(log).toHaveBeenCalledTimes(2);
  });

  it("gives up on a Notifier that never resolves once the timeout passes", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const hanging: Notifier = {
      notify: () => new Promise(() => {}),
      markRead: () => new Promise(() => {}),
    };

    const started = Date.now();
    await deliver({ notify: [opened] }, hanging, 50);

    expect(Date.now() - started).toBeLessThan(1000);
    expect(log).toHaveBeenCalledWith(
      "Notification notify refund-request-opened failed:",
      expect.objectContaining({ message: "timed out after 50ms" })
    );
  });
});

describe("outboxNotifier", () => {
  it("writes notify and markRead calls to the outbox as JSON when there is no Knock key", async () => {
    const directory = mkdtempSync(join(tmpdir(), "notifications-outbox-"));

    await deliver(
      {
        notify: [opened],
        markRead: [{ type: "refund-request-opened", subjectId: 7 }],
      },
      outboxNotifier(directory)
    );

    const written = readdirSync(directory).map((file) =>
      JSON.parse(readFileSync(join(directory, file), "utf8"))
    );
    expect(written).toHaveLength(2);
    expect(written).toEqual(
      expect.arrayContaining([
        {
          operation: "notify",
          type: "refund-request-opened",
          actor: { id: 1, name: "Liam" },
          recipients: [{ id: 3, name: "Pat Admin" }],
          data: opened.data,
        },
        {
          operation: "markRead",
          type: "refund-request-opened",
          subjectId: 7,
        },
      ])
    );
  });
});
