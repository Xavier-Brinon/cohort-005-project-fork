import { describe, it, expect, beforeEach, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { createTestDb, seedBaseData } from "~/test/setup";
import * as schema from "~/db/schema";
import { LessonProgressStatus, RefundStatus, UserRole } from "~/db/schema";
import {
  approveRefundRequest,
  checkRefundRequest,
  declineRefundRequest,
  getRefundOffer,
  getSeatAvailability,
  listRefundRequestsForBuyer,
  listRefundRequestsForReview,
  listTeamLicences,
  raiseRefundRequest,
  type DecisionResult,
  type RaiseResult,
} from "./refunds.server";
import {
  deliver,
  fakeNotifier,
  type FakeNotifier,
} from "./notifications.server";

type TestDb = ReturnType<typeof createTestDb>;

// Hands `deliver` whatever a write returned, failed or not, so a Failure that
// carried intents would show up in the fake notifier. Routes skip `deliver`
// on a Failure; these tests do not, or they could never fail.
function deliverAnyway(
  result: RaiseResult | DecisionResult,
  notifier: FakeNotifier
) {
  return deliver({ notify: undefined, markRead: undefined, ...result }, notifier);
}

const NOW = new Date(2026, 9, 6, 12, 0, 0);

function daysBefore(days: number) {
  const when = new Date(NOW);
  when.setDate(when.getDate() - days);
  return when.toISOString();
}

let db: TestDb;
let base: ReturnType<typeof seedBaseData>;
let platformAdmin: typeof schema.users.$inferSelect;
let lessonIds: number[];

beforeEach(() => {
  db = createTestDb();
  base = seedBaseData(db);

  platformAdmin = db
    .insert(schema.users)
    .values({ name: "Pat Admin", email: "pat@example.com", role: UserRole.Admin })
    .returning()
    .get();

  const module = db
    .insert(schema.modules)
    .values({ courseId: base.course.id, title: "Basics", position: 1 })
    .returning()
    .get();

  lessonIds = [1, 2, 3, 4].map(
    (position) =>
      db
        .insert(schema.lessons)
        .values({ moduleId: module.id, title: `Lesson ${position}`, position })
        .returning()
        .get().id
  );
});

function addLearner(name: string) {
  return db
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
  const purchase = db
    .insert(schema.purchases)
    .values({
      userId,
      courseId: base.course.id,
      amountPaid,
      createdAt: daysBefore(daysAgo),
    })
    .returning()
    .get();
  db.insert(schema.enrollments)
    .values({ userId, courseId: base.course.id })
    .run();
  return purchase;
}

function buySeats(userId: number, seats: number, daysAgo = 3) {
  const team = db.insert(schema.teams).values({}).returning().get();
  const purchase = db
    .insert(schema.purchases)
    .values({
      userId,
      courseId: base.course.id,
      amountPaid: 7900 * seats,
      createdAt: daysBefore(daysAgo),
    })
    .returning()
    .get();
  const seatRows = Array.from({ length: seats }, (_, i) =>
    db
      .insert(schema.coupons)
      .values({
        teamId: team.id,
        courseId: base.course.id,
        code: `SEAT-${purchase.id}-${i}`,
        purchaseId: purchase.id,
      })
      .returning()
      .get()
  );
  return { purchase, seats: seatRows };
}

function claimSeat(seatId: number, userId: number) {
  db.update(schema.coupons)
    .set({ redeemedByUserId: userId, redeemedAt: daysBefore(1) })
    .where(eq(schema.coupons.id, seatId))
    .run();
  db.insert(schema.enrollments)
    .values({ userId, courseId: base.course.id })
    .run();
}

function isEnrolled(userId: number) {
  return !!db
    .select()
    .from(schema.enrollments)
    .where(
      and(
        eq(schema.enrollments.userId, userId),
        eq(schema.enrollments.courseId, base.course.id)
      )
    )
    .get();
}

function raise(purchaseId: number, buyerId: number) {
  const result = raiseRefundRequest(
    db,
    purchaseId,
    buyerId,
    "It was not what I expected.",
    NOW
  );
  if (!result.ok) throw new Error(result.error);
  return result.refundRequestId;
}

function getSeat(seatId: number) {
  const seat = db
    .select()
    .from(schema.coupons)
    .where(eq(schema.coupons.id, seatId))
    .get();
  if (!seat) throw new Error("Seat not found");
  return seat;
}

describe("raising a Refund Request", () => {
  it("lets the buyer raise one on an Individual Purchase inside the window", () => {
    const purchase = buyForSelf(base.user.id);

    const result = raiseRefundRequest(db, purchase.id, base.user.id, "Nope.", NOW);

    expect(result).toMatchObject({ ok: true, kind: "individual_purchase" });
  });

  it("refuses anyone but the buyer", () => {
    const purchase = buyForSelf(base.user.id);
    const someoneElse = addLearner("Ben");

    expect(checkRefundRequest(db, purchase.id, someoneElse.id, NOW)).toMatchObject(
      { ok: false, status: 404 }
    );
  });

  it("allows only one Open Refund Request per Purchase", () => {
    const purchase = buyForSelf(base.user.id);
    raise(purchase.id, base.user.id);

    expect(checkRefundRequest(db, purchase.id, base.user.id, NOW)).toMatchObject(
      { ok: false, status: 409 }
    );
  });

  it("keeps the fourteenth day open and closes the fifteenth", () => {
    const onDay14 = buyForSelf(base.user.id, 14);
    const onDay15 = buyForSelf(addLearner("Ben").id, 15);

    expect(checkRefundRequest(db, onDay14.id, onDay14.userId, NOW).ok).toBe(true);
    expect(
      checkRefundRequest(db, onDay15.id, onDay15.userId, NOW)
    ).toMatchObject({ ok: false, error: "The 14-day window has closed." });
  });

  it("refuses a buyer who has completed half the lessons", () => {
    const purchase = buyForSelf(base.user.id);
    db.insert(schema.lessonProgress)
      .values(
        lessonIds.slice(0, 2).map((lessonId) => ({
          userId: base.user.id,
          lessonId,
          status: LessonProgressStatus.Completed,
        }))
      )
      .run();

    expect(checkRefundRequest(db, purchase.id, base.user.id, NOW)).toMatchObject(
      { ok: false, status: 403 }
    );
  });

  it("refuses a buyer who has watched two hours", () => {
    const purchase = buyForSelf(base.user.id);
    db.insert(schema.videoWatchEvents)
      .values([
        { userId: base.user.id, lessonId: lessonIds[0], eventType: "progress", positionSeconds: 3600 },
        { userId: base.user.id, lessonId: lessonIds[1], eventType: "progress", positionSeconds: 3600 },
      ])
      .run();

    expect(checkRefundRequest(db, purchase.id, base.user.id, NOW)).toMatchObject(
      { ok: false, status: 403 }
    );
  });

  it("refuses a Team Licence with a Claimed Seat", () => {
    const teamAdmin = addLearner("Priya");
    const { purchase, seats } = buySeats(teamAdmin.id, 3);
    claimSeat(seats[0].id, addLearner("Ben").id);

    expect(checkRefundRequest(db, purchase.id, teamAdmin.id, NOW)).toMatchObject({
      ok: false,
      status: 403,
    });
  });
});

describe("the refund offer on the course page", () => {
  it("offers the newest Individual Purchase, not a newer Team Licence", () => {
    const individual = buyForSelf(base.user.id, 3);
    buySeats(base.user.id, 5, 1);

    expect(getRefundOffer(db, base.user.id, base.course.id, NOW)).toMatchObject({
      purchaseId: individual.id,
      amount: 7900,
    });
  });

  it("offers nothing once the purchase has been refunded", () => {
    const purchase = buyForSelf(base.user.id);
    const id = raise(purchase.id, base.user.id);
    approveRefundRequest(db, id, platformAdmin.id, null, NOW);

    expect(getRefundOffer(db, base.user.id, base.course.id, NOW)).toBeNull();
  });
});

describe("approving a Refund Request", () => {
  it("removes the buyer's Enrollment but keeps their progress", () => {
    const purchase = buyForSelf(base.user.id);
    db.insert(schema.lessonProgress)
      .values({
        userId: base.user.id,
        lessonId: lessonIds[0],
        status: LessonProgressStatus.Completed,
      })
      .run();
    const id = raise(purchase.id, base.user.id);

    const result = approveRefundRequest(db, id, platformAdmin.id, null, NOW);

    expect(result.ok).toBe(true);
    expect(isEnrolled(base.user.id)).toBe(false);
    expect(
      db
        .select()
        .from(schema.lessonProgress)
        .where(eq(schema.lessonProgress.userId, base.user.id))
        .all()
    ).toHaveLength(1);

    const refundRequest = db
      .select()
      .from(schema.refunds)
      .where(eq(schema.refunds.id, id))
      .get();
    expect(refundRequest).toMatchObject({
      status: RefundStatus.Approved,
      amountRefunded: 7900,
      resolvedByUserId: platformAdmin.id,
    });
  });

  it("keeps the buyer's Enrollment if they also hold a Claimed Seat for the course", () => {
    const priya = addLearner("Priya");
    const { seats } = buySeats(priya.id, 2);
    // Liam claims a Seat first, so his Enrollment came from it.
    claimSeat(seats[0].id, base.user.id);
    const purchase = db
      .insert(schema.purchases)
      .values({
        userId: base.user.id,
        courseId: base.course.id,
        amountPaid: 7900,
        createdAt: daysBefore(2),
      })
      .returning()
      .get();
    const id = raise(purchase.id, base.user.id);

    approveRefundRequest(db, id, platformAdmin.id, null, NOW);

    expect(isEnrolled(base.user.id)).toBe(true);
  });

  it("makes a Team Licence's Unclaimed Seats unclaimable", () => {
    const priya = addLearner("Priya");
    const { purchase, seats } = buySeats(priya.id, 2);
    const id = raise(purchase.id, priya.id);

    const result = approveRefundRequest(db, id, platformAdmin.id, null, NOW);

    expect(result.ok).toBe(true);
    for (const seat of seats) {
      expect(getSeatAvailability(db, getSeat(seat.id))).toBe("refunded");
    }
  });

  it("refuses a Team Licence whose Seat was claimed after the request", () => {
    const priya = addLearner("Priya");
    const { purchase, seats } = buySeats(priya.id, 2);
    const id = raise(purchase.id, priya.id);
    // Seats are on hold while Open, but older data can still hold a claim.
    claimSeat(seats[0].id, addLearner("Ben").id);

    expect(approveRefundRequest(db, id, platformAdmin.id, null, NOW)).toMatchObject({
      ok: false,
      status: 409,
    });
    expect(getSeatAvailability(db, getSeat(seats[1].id))).toBe("on_hold");
  });

  it("lets the first decision win", () => {
    const purchase = buyForSelf(base.user.id);
    const id = raise(purchase.id, base.user.id);
    approveRefundRequest(db, id, platformAdmin.id, null, NOW);

    expect(
      declineRefundRequest(db, id, platformAdmin.id, "Too late.", NOW)
    ).toMatchObject({
      ok: false,
      status: 409,
      error: "This refund request was already approved.",
    });
  });

  it("emails the buyer that the refund is on its way", () => {
    const purchase = buyForSelf(base.user.id);
    const id = raise(purchase.id, base.user.id);

    const result = approveRefundRequest(db, id, platformAdmin.id, null, NOW);

    if (!result.ok) throw new Error(result.error);
    expect(result.email.to).toBe("test@example.com");
    expect(result.email.subject).toBe("Refund approved — Test Course");
    expect(result.email.body).toContain("$79.00");
  });
});

describe("declining a Refund Request", () => {
  it("needs a note", () => {
    const purchase = buyForSelf(base.user.id);
    const id = raise(purchase.id, base.user.id);

    expect(declineRefundRequest(db, id, platformAdmin.id, "  ", NOW)).toMatchObject({
      ok: false,
      status: 400,
    });
  });

  it("keeps the buyer's Enrollment and lets them raise a new Refund Request", () => {
    const purchase = buyForSelf(base.user.id);
    const id = raise(purchase.id, base.user.id);

    const result = declineRefundRequest(
      db,
      id,
      platformAdmin.id,
      "You finished the course.",
      NOW
    );

    if (!result.ok) throw new Error(result.error);
    expect(result.email.body).toContain("You finished the course.");
    expect(isEnrolled(base.user.id)).toBe(true);
    expect(checkRefundRequest(db, purchase.id, base.user.id, NOW).ok).toBe(true);
  });

  it("frees a Team Licence's Seats again", () => {
    const priya = addLearner("Priya");
    const { purchase, seats } = buySeats(priya.id, 1);
    const id = raise(purchase.id, priya.id);
    expect(getSeatAvailability(db, getSeat(seats[0].id))).toBe("on_hold");

    declineRefundRequest(db, id, platformAdmin.id, "Seats are in use.", NOW);

    expect(getSeatAvailability(db, getSeat(seats[0].id))).toBe("available");
  });
});

describe("listing Refund Requests", () => {
  it("shows a Platform Admin live figures and the rules a request breaks", () => {
    const purchase = buyForSelf(base.user.id);
    const id = raise(purchase.id, base.user.id);
    // Since raising the request, the buyer has finished half the course.
    db.insert(schema.lessonProgress)
      .values(
        lessonIds.slice(0, 2).map((lessonId) => ({
          userId: base.user.id,
          lessonId,
          status: LessonProgressStatus.Completed,
        }))
      )
      .run();

    const [row] = listRefundRequestsForReview(db, RefundStatus.Open, NOW);

    expect(row).toMatchObject({
      id,
      buyerName: "Test User",
      daysSincePurchase: 3,
      figures: {
        kind: "individual_purchase",
        lessonsCompleted: 2,
        lessonCount: 4,
      },
      ruleBreaks: ["completed_too_much"],
      canApprove: true,
    });
  });

  it("shows a Team Licence's Seats instead of the buyer's progress", () => {
    const priya = addLearner("Priya");
    const { purchase } = buySeats(priya.id, 3);
    raise(purchase.id, priya.id);

    const [row] = listRefundRequestsForReview(db, RefundStatus.Open, NOW);

    expect(row.figures).toEqual({
      kind: "team_licence",
      seatCount: 3,
      claimedSeatCount: 0,
    });
  });

  it("lists only the requested status, oldest first", () => {
    const first = buyForSelf(base.user.id);
    const ben = addLearner("Ben");
    const second = buyForSelf(ben.id);
    const firstId = raise(first.id, base.user.id);
    const secondId = raiseRefundRequest(
      db,
      second.id,
      ben.id,
      "Changed my mind.",
      new Date(NOW.getTime() + 60_000)
    );
    if (!secondId.ok) throw new Error(secondId.error);

    expect(
      listRefundRequestsForReview(db, RefundStatus.Open, NOW).map((r) => r.id)
    ).toEqual([firstId, secondId.refundRequestId]);

    approveRefundRequest(db, firstId, platformAdmin.id, null, NOW);

    expect(
      listRefundRequestsForReview(db, RefundStatus.Approved, NOW)
    ).toMatchObject([{ id: firstId, decidedByName: "Pat Admin" }]);
  });

  it("shows a buyer their decided requests with the decline note", () => {
    const purchase = buyForSelf(base.user.id);
    const id = raise(purchase.id, base.user.id);
    declineRefundRequest(db, id, platformAdmin.id, "Past half way.", NOW);

    expect(listRefundRequestsForBuyer(db, base.user.id)).toMatchObject([
      { id, status: RefundStatus.Declined, decisionNote: "Past half way." },
    ]);
  });

  it("lists a Team Admin's Team Licences and whether each can be refunded", () => {
    const priya = addLearner("Priya");
    buySeats(priya.id, 2);
    const { seats } = buySeats(priya.id, 2);
    claimSeat(seats[0].id, addLearner("Ben").id);

    expect(listTeamLicences(db, priya.id, NOW)).toMatchObject([
      { seatCount: 2, claimedSeatCount: 1, canRequestRefund: false },
      { seatCount: 2, claimedSeatCount: 0, canRequestRefund: true },
    ]);
  });
});

describe("refund-request-opened Notifications", () => {
  function addPlatformAdmin(name: string) {
    return db
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
      db,
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
    purchaseId: number,
    buyerId: number,
    reason = "It was not what I expected."
  ) {
    const result = raiseRefundRequest(db, purchaseId, buyerId, reason, NOW);
    await deliverAnyway(result, notifier);
    return result;
  }

  it("sends nothing when the raise fails, such as a second Open Refund Request on the same Purchase", async () => {
    const purchase = buyForSelf(base.user.id);
    raise(purchase.id, base.user.id);
    const notifier = fakeNotifier();

    const second = await raiseAndDeliver(notifier, purchase.id, base.user.id);

    expect(second.ok).toBe(false);
    expect(notifier.sent).toEqual([]);
  });

  it("sends nothing when the only Platform Admin raises a Refund Request", async () => {
    const purchase = buyForSelf(platformAdmin.id);
    const notifier = fakeNotifier();

    await raiseAndDeliver(notifier, purchase.id, platformAdmin.id);

    expect(notifier.sent).toEqual([]);
  });

  it("notifies every Platform Admin, with the buyer as actor", async () => {
    const morgan = addPlatformAdmin("Morgan Admin");
    const purchase = buyForSelf(base.user.id);
    const notifier = fakeNotifier();

    await raiseAndDeliver(notifier, purchase.id, base.user.id);

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

    const result = await raiseAndDeliver(
      notifier,
      purchase.id,
      base.user.id,
      "The course moved too fast for me."
    );
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

    await raiseAndDeliver(notifier, purchase.id, priya.id);

    expect(notifier.sent[0].data).toMatchObject({
      buyerName: "Priya",
      purchaseKind: "team_licence",
    });
  });

  it("keeps the Refund Request when the Notifier fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const purchase = buyForSelf(base.user.id);
    const result = raiseRefundRequest(
      db,
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

    expect(listRefundRequestsForBuyer(db, base.user.id)).toMatchObject([
      { id: result.refundRequestId, status: RefundStatus.Open },
    ]);
    vi.restoreAllMocks();
  });

  it("cuts a long reason to a 140-character excerpt", async () => {
    const purchase = buyForSelf(base.user.id);
    const notifier = fakeNotifier();
    const reason = `${"word ".repeat(40)}and the end of my reason.`;

    await raiseAndDeliver(notifier, purchase.id, base.user.id, reason);

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
    decision: "approve" | "decline",
    refundRequestId: number,
    note: string | null = null,
    deciderId = platformAdmin.id
  ) {
    const result =
      decision === "approve"
        ? approveRefundRequest(db, refundRequestId, deciderId, note, NOW)
        : declineRefundRequest(db, refundRequestId, deciderId, note ?? "", NOW);
    await deliverAnyway(result, notifier);
    return result;
  }

  it.each(["approve", "decline"] as const)(
    "marks the Refund Request's refund-request-opened Notifications read when admins %s it",
    async (decision) => {
      const purchase = buyForSelf(base.user.id);
      const refundRequestId = raise(purchase.id, base.user.id);
      const notifier = fakeNotifier();

      await decideAndDeliver(
        notifier,
        decision,
        refundRequestId,
        "Sorry it did not work out."
      );

      expect(notifier.marked).toEqual([
        { type: "refund-request-opened", subjectId: refundRequestId },
      ]);
    }
  );

  it("sends and marks nothing when the decision fails, such as a Refund Request already decided", async () => {
    const purchase = buyForSelf(base.user.id);
    const refundRequestId = raise(purchase.id, base.user.id);
    approveRefundRequest(db, refundRequestId, platformAdmin.id, null, NOW);
    const notifier = fakeNotifier();

    const second = await decideAndDeliver(
      notifier,
      "decline",
      refundRequestId,
      "Changed my mind."
    );

    expect(second.ok).toBe(false);
    expect(notifier.sent).toEqual([]);
    expect(notifier.marked).toEqual([]);
  });

  it("notifies the Student who made an Individual Purchase, with the deciding Platform Admin as actor", async () => {
    const purchase = buyForSelf(base.user.id);
    const refundRequestId = raise(purchase.id, base.user.id);
    const notifier = fakeNotifier();

    await decideAndDeliver(notifier, "approve", refundRequestId);

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

    await decideAndDeliver(notifier, "approve", refundRequestId);

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

    await decideAndDeliver(
      notifier,
      "decline",
      refundRequestId,
      "  The team has used most of the course.  "
    );

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

    await decideAndDeliver(notifier, "approve", refundRequestId, "Refunded.");

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

    await decideAndDeliver(
      notifier,
      "decline",
      refundRequestId,
      "You finished the course."
    );

    expect(notifier.sent[0].data).toEqual({
      decision: "declined",
      courseTitle: "Test Course",
      note: "You finished the course.",
      purchaseKind: "individual_purchase",
      url: "/courses/test-course",
    });
  });
});
