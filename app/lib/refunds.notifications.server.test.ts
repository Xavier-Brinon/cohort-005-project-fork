import { beforeEach, describe, expect, it, vi } from "vitest";

import * as schema from "~/db/schema";
import { RefundStatus, UserRole } from "~/db/schema";
import { createTestDb, seedBaseData, type TestDb } from "~/test/setup";

import {
  deliver,
  type FakeNotifier,
  fakeNotifier,
} from "./notifications.server";
import {
  approveRefundRequest,
  type DecisionResult,
  declineRefundRequest,
  listRefundRequestsForBuyer,
  raiseRefundRequest,
  type RaiseResult,
} from "./refunds.server";

// Hands `deliver` whatever a write returned, failed or not, so a Failure that
// carried intents would show up in the fake notifier. Routes skip `deliver`
// on a Failure; these tests do not, or they could never fail.
function deliverAnyway(
  result: RaiseResult | DecisionResult,
  notifier: FakeNotifier
) {
  return deliver(
    { notify: undefined, markRead: undefined, ...result },
    notifier
  );
}

const NOW = new Date(2026, 9, 6, 12, 0, 0);

function daysBefore(days: number) {
  const when = new Date(NOW);
  when.setDate(when.getDate() - days);
  return when.toISOString();
}

let database: TestDb;
let base: ReturnType<typeof seedBaseData>;
let platformAdmin: typeof schema.users.$inferSelect;

beforeEach(() => {
  database = createTestDb();
  base = seedBaseData(database);

  platformAdmin = database
    .insert(schema.users)
    .values({
      name: "Pat Admin",
      email: "pat@example.com",
      role: UserRole.Admin,
    })
    .returning()
    .get();
});

function addLearner(name: string) {
  return database
    .insert(schema.users)
    .values({
      name,
      email: `${name.toLowerCase()}@example.com`,
      role: UserRole.Student,
    })
    .returning()
    .get();
}

function buyForSelf(userId: number, daysAgo = 3, amountPaid = 7900) {
  const purchase = database
    .insert(schema.purchases)
    .values({
      userId,
      courseId: base.course.id,
      amountPaid,
      createdAt: daysBefore(daysAgo),
    })
    .returning()
    .get();
  database
    .insert(schema.enrollments)
    .values({ userId, courseId: base.course.id })
    .run();
  return purchase;
}

function buySeats(userId: number, seats: number, daysAgo = 3) {
  const team = database.insert(schema.teams).values({}).returning().get();
  const purchase = database
    .insert(schema.purchases)
    .values({
      userId,
      courseId: base.course.id,
      amountPaid: 7900 * seats,
      createdAt: daysBefore(daysAgo),
    })
    .returning()
    .get();
  const seatRows = Array.from({ length: seats }, (_, index) =>
    database
      .insert(schema.coupons)
      .values({
        teamId: team.id,
        courseId: base.course.id,
        code: `SEAT-${purchase.id}-${index}`,
        purchaseId: purchase.id,
      })
      .returning()
      .get()
  );
  return { purchase, seats: seatRows };
}

function raise(purchaseId: number, buyerId: number) {
  const result = raiseRefundRequest(
    database,
    purchaseId,
    buyerId,
    "It was not what I expected.",
    NOW
  );
  if (!result.ok) throw new Error(result.error);
  return result.refundRequestId;
}

describe("refund-request-opened Notifications", () => {
  function addPlatformAdmin(name: string) {
    return database
      .insert(schema.users)
      .values({
        name,
        email: `${name.toLowerCase().replace(" ", ".")}@example.com`,
        role: UserRole.Admin,
      })
      .returning()
      .get();
  }

  it("does not notify a Platform Admin who raises a Refund Request for their own Purchase", async () => {
    const morgan = addPlatformAdmin("Morgan Admin");
    const purchase = buyForSelf(platformAdmin.id);
    const notifier = fakeNotifier();

    const result = raiseRefundRequest(
      database,
      purchase.id,
      platformAdmin.id,
      "It was not what I expected.",
      NOW
    );
    if (!result.ok) throw new Error(result.error);
    await deliver(result, notifier);

    expect(notifier.sent).toHaveLength(1);
    expect(notifier.sent[0].recipients).toEqual([
      { id: morgan.id, name: "Morgan Admin" },
    ]);
  });

  async function raiseAndDeliver(
    notifier: FakeNotifier,
    {
      purchaseId,
      buyerId,
      reason = "It was not what I expected.",
    }: { purchaseId: number; buyerId: number; reason?: string }
  ) {
    const result = raiseRefundRequest(
      database,
      purchaseId,
      buyerId,
      reason,
      NOW
    );
    await deliverAnyway(result, notifier);
    return result;
  }

  it("sends nothing when the raise fails, such as a second Open Refund Request on the same Purchase", async () => {
    const purchase = buyForSelf(base.user.id);
    raise(purchase.id, base.user.id);
    const notifier = fakeNotifier();

    const second = await raiseAndDeliver(notifier, {
      purchaseId: purchase.id,
      buyerId: base.user.id,
    });

    expect(second.ok).toBe(false);
    expect(notifier.sent).toEqual([]);
  });

  it("sends nothing when the only Platform Admin raises a Refund Request", async () => {
    const purchase = buyForSelf(platformAdmin.id);
    const notifier = fakeNotifier();

    await raiseAndDeliver(notifier, {
      purchaseId: purchase.id,
      buyerId: platformAdmin.id,
    });

    expect(notifier.sent).toEqual([]);
  });

  it("notifies every Platform Admin, with the buyer as actor", async () => {
    const morgan = addPlatformAdmin("Morgan Admin");
    const purchase = buyForSelf(base.user.id);
    const notifier = fakeNotifier();

    await raiseAndDeliver(notifier, {
      purchaseId: purchase.id,
      buyerId: base.user.id,
    });

    expect(notifier.sent).toMatchObject([
      {
        type: "refund-request-opened",
        actor: { id: base.user.id, name: "Test User" },
        recipients: [
          { id: platformAdmin.id, name: "Pat Admin" },
          { id: morgan.id, name: "Morgan Admin" },
        ],
      },
    ]);
  });

  it("tells the Platform Admins who asked, for which course and why, and links to the refunds page", async () => {
    const purchase = buyForSelf(base.user.id);
    const notifier = fakeNotifier();

    const result = await raiseAndDeliver(notifier, {
      purchaseId: purchase.id,
      buyerId: base.user.id,
      reason: "The course moved too fast for me.",
    });
    if (!result.ok) throw new Error(result.error);

    expect(notifier.sent[0].data).toEqual({
      refundRequestId: result.refundRequestId,
      buyerName: "Test User",
      courseTitle: "Test Course",
      purchaseKind: "individual_purchase",
      reasonExcerpt: "The course moved too fast for me.",
      url: "/admin/refunds",
    });
  });

  it("names the purchase kind of a Team Licence", async () => {
    const priya = addLearner("Priya");
    const { purchase } = buySeats(priya.id, 2);
    const notifier = fakeNotifier();

    await raiseAndDeliver(notifier, {
      purchaseId: purchase.id,
      buyerId: priya.id,
    });

    expect(notifier.sent[0].data).toMatchObject({
      buyerName: "Priya",
      purchaseKind: "team_licence",
    });
  });

  it("keeps the Refund Request when the Notifier fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const purchase = buyForSelf(base.user.id);
    const result = raiseRefundRequest(
      database,
      purchase.id,
      base.user.id,
      "It was not what I expected.",
      NOW
    );
    if (!result.ok) throw new Error(result.error);

    await deliver(result, {
      notify: () => Promise.reject(new Error("Knock is down")),
      markRead: () => Promise.reject(new Error("Knock is down")),
    });

    expect(listRefundRequestsForBuyer(database, base.user.id)).toMatchObject([
      { id: result.refundRequestId, status: RefundStatus.Open },
    ]);
    vi.restoreAllMocks();
  });

  it("cuts a long reason to a 140-character excerpt", async () => {
    const purchase = buyForSelf(base.user.id);
    const notifier = fakeNotifier();
    const reason = `${"word ".repeat(40)}and the end of my reason.`;

    await raiseAndDeliver(notifier, {
      purchaseId: purchase.id,
      buyerId: base.user.id,
      reason: reason,
    });

    // 28 words fill 139 characters, then an ellipsis makes 140.
    const expected = `${"word ".repeat(28).trimEnd()}…`;
    expect(expected).toHaveLength(140);
    expect(notifier.sent[0]).toMatchObject({
      data: { reasonExcerpt: expected },
    });
  });
});

describe("refund-request-decided Notifications", () => {
  // Decides the way the admin refunds route does: delivers only a decision
  // that succeeded.
  async function decideAndDeliver(
    notifier: FakeNotifier,
    {
      decision,
      refundRequestId,
      note = null,
      deciderId = platformAdmin.id,
    }: {
      decision: "approve" | "decline";
      refundRequestId: number;
      note?: string | null;
      deciderId?: number;
    }
  ) {
    const result =
      decision === "approve"
        ? approveRefundRequest(database, refundRequestId, deciderId, note, NOW)
        : declineRefundRequest(
            database,
            refundRequestId,
            deciderId,
            note ?? "",
            NOW
          );
    await deliverAnyway(result, notifier);
    return result;
  }

  it.each(["approve", "decline"] as const)(
    "marks the Refund Request's refund-request-opened Notifications read when admins %s it",
    async (decision) => {
      const purchase = buyForSelf(base.user.id);
      const refundRequestId = raise(purchase.id, base.user.id);
      const notifier = fakeNotifier();

      await decideAndDeliver(notifier, {
        decision: decision,
        refundRequestId: refundRequestId,
        note: "Sorry it did not work out.",
      });

      expect(notifier.marked).toEqual([
        { type: "refund-request-opened", subjectId: refundRequestId },
      ]);
    }
  );

  it("sends and marks nothing when the decision fails, such as a Refund Request already decided", async () => {
    const purchase = buyForSelf(base.user.id);
    const refundRequestId = raise(purchase.id, base.user.id);
    approveRefundRequest(
      database,
      refundRequestId,
      platformAdmin.id,
      null,
      NOW
    );
    const notifier = fakeNotifier();

    const second = await decideAndDeliver(notifier, {
      decision: "decline",
      refundRequestId: refundRequestId,
      note: "Changed my mind.",
    });

    expect(second.ok).toBe(false);
    expect(notifier.sent).toEqual([]);
    expect(notifier.marked).toEqual([]);
  });

  it("notifies the Student who made an Individual Purchase, with the deciding Platform Admin as actor", async () => {
    const purchase = buyForSelf(base.user.id);
    const refundRequestId = raise(purchase.id, base.user.id);
    const notifier = fakeNotifier();

    await decideAndDeliver(notifier, {
      decision: "approve",
      refundRequestId: refundRequestId,
    });

    expect(notifier.sent).toEqual([
      {
        type: "refund-request-decided",
        actor: { id: platformAdmin.id, name: "Pat Admin" },
        recipients: [{ id: base.user.id, name: "Test User" }],
        data: {
          decision: "approved",
          courseTitle: "Test Course",
          note: null,
          purchaseKind: "individual_purchase",
          url: "/courses/test-course",
        },
      },
    ]);
  });

  it("does not notify a Platform Admin who decides a Refund Request on their own Purchase", async () => {
    const purchase = buyForSelf(platformAdmin.id);
    const refundRequestId = raise(purchase.id, platformAdmin.id);
    const notifier = fakeNotifier();

    await decideAndDeliver(notifier, {
      decision: "approve",
      refundRequestId: refundRequestId,
    });

    expect(notifier.sent).toEqual([]);
    expect(notifier.marked).toEqual([
      { type: "refund-request-opened", subjectId: refundRequestId },
    ]);
  });

  it("notifies the Team Admin of a declined Team Licence, with the note and a link to the team page", async () => {
    const priya = addLearner("Priya");
    const { purchase } = buySeats(priya.id, 2);
    const refundRequestId = raise(purchase.id, priya.id);
    const notifier = fakeNotifier();

    await decideAndDeliver(notifier, {
      decision: "decline",
      refundRequestId: refundRequestId,
      note: "  The team has used most of the course.  ",
    });

    expect(notifier.sent).toMatchObject([
      {
        type: "refund-request-decided",
        recipients: [{ id: priya.id, name: "Priya" }],
        data: {
          decision: "declined",
          courseTitle: "Test Course",
          note: "The team has used most of the course.",
          purchaseKind: "team_licence",
          url: "/team",
        },
      },
    ]);
  });

  it("notifies the Team Admin of an approved Team Licence with a link to the team page", async () => {
    const priya = addLearner("Priya");
    const { purchase } = buySeats(priya.id, 2);
    const refundRequestId = raise(purchase.id, priya.id);
    const notifier = fakeNotifier();

    await decideAndDeliver(notifier, {
      decision: "approve",
      refundRequestId: refundRequestId,
      note: "Refunded.",
    });

    expect(notifier.sent[0].data).toEqual({
      decision: "approved",
      courseTitle: "Test Course",
      note: "Refunded.",
      purchaseKind: "team_licence",
      url: "/team",
    });
  });

  it("notifies the Student of a declined Individual Purchase with a link to the course page", async () => {
    const purchase = buyForSelf(base.user.id);
    const refundRequestId = raise(purchase.id, base.user.id);
    const notifier = fakeNotifier();

    await decideAndDeliver(notifier, {
      decision: "decline",
      refundRequestId: refundRequestId,
      note: "You finished the course.",
    });

    expect(notifier.sent[0].data).toEqual({
      decision: "declined",
      courseTitle: "Test Course",
      note: "You finished the course.",
      purchaseKind: "individual_purchase",
      url: "/courses/test-course",
    });
  });
});
