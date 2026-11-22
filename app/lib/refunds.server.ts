import {
  and,
  asc,
  desc,
  eq,
  inArray,
  isNotNull,
  isNull,
  sql,
} from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";

import type { Db, Queryable } from "~/db";
import {
  coupons,
  courses,
  enrollments,
  lessonProgress,
  LessonProgressStatus,
  lessons,
  modules,
  purchases,
  refunds,
  RefundStatus,
  UserRole,
  users,
  videoWatchEvents,
} from "~/db/schema";
import {
  excerpt,
  type MarkReadIntent,
  type NotifyIntent,
} from "~/lib/notifications.server";
import { findPerson, toPerson } from "~/lib/people.server";
import {
  type PurchaseKind,
  REFUND_COMPLETION_LIMIT,
  REFUND_WATCH_LIMIT_SECONDS,
  REFUND_WINDOW_DAYS,
  type RuleBreak,
} from "~/lib/refund-rules";
import { formatPrice } from "~/lib/utils";

// docs/adr/0001–0004 explain why Refunds work the way they do.

type Purchase = typeof purchases.$inferSelect;
type Seat = typeof coupons.$inferSelect;

// ─── Calendar days ───

// The fourteen-day window is counted in whole days, not hours — someone who
// buys at 23:00 should still get the whole of their fourteenth day.
//
// Days are UTC days, the same days as the date prefix of the ISO timestamps we
// store. Reading the server's local zone would make the answer depend on where
// the process happens to run, and disagree with analytics' UTC day buckets.
export function calendarDay(when: Date): string {
  return when.toISOString().slice(0, 10);
}

export function lastDayOfWindow(purchasedAtIso: string): string {
  const deadline = new Date(purchasedAtIso);
  deadline.setUTCDate(deadline.getUTCDate() + REFUND_WINDOW_DAYS);
  return calendarDay(deadline);
}

function isWithinWindow(purchasedAtIso: string, on: Date): boolean {
  const day = calendarDay(on);
  return (
    day >= calendarDay(new Date(purchasedAtIso)) &&
    day <= lastDayOfWindow(purchasedAtIso)
  );
}

// ─── Purchases and Seats ───

function getPurchase(database: Queryable, purchaseId: number) {
  return database
    .select()
    .from(purchases)
    .where(eq(purchases.id, purchaseId))
    .get();
}

function getSeats(database: Queryable, purchaseId: number): Seat[] {
  return database
    .select()
    .from(coupons)
    .where(eq(coupons.purchaseId, purchaseId))
    .all();
}

function isClaimed(seat: Seat) {
  return seat.redeemedAt !== null;
}

// There is no column saying which kind a Purchase is: a Team Licence is the
// Purchase that granted Seats, and every Team Licence grants at least one.
function kindOf(seats: Seat[]): PurchaseKind {
  return seats.length > 0 ? "team_licence" : "individual_purchase";
}

function getRefundRequestWithStatus(
  database: Queryable,
  purchaseId: number,
  status: RefundStatus
) {
  return database
    .select()
    .from(refunds)
    .where(and(eq(refunds.purchaseId, purchaseId), eq(refunds.status, status)))
    .get();
}

export type SeatAvailability = "available" | "claimed" | "on_hold" | "refunded";

/**
 * Whether a Seat can be claimed right now. A Team Licence's Unclaimed Seats are
 * on hold while it has an Open Refund Request, and can never be claimed once
 * that request is approved.
 */
export function getSeatAvailability(
  database: Queryable,
  seat: Seat
): SeatAvailability {
  if (isClaimed(seat)) return "claimed";
  if (seat.refundedAt !== null) return "refunded";
  if (
    getRefundRequestWithStatus(database, seat.purchaseId, RefundStatus.Open)
  ) {
    return "on_hold";
  }
  return "available";
}

// ─── Figures and rules ───

function getLessonIds(database: Queryable, courseId: number): number[] {
  return database
    .select({ id: lessons.id })
    .from(lessons)
    .innerJoin(modules, eq(lessons.moduleId, modules.id))
    .where(eq(modules.courseId, courseId))
    .all()
    .map((row) => row.id);
}

function getCompletedLessonCount(
  database: Queryable,
  userId: number,
  lessonIds: number[]
) {
  if (lessonIds.length === 0) return 0;

  const result = database
    .select({ count: sql<number>`count(*)` })
    .from(lessonProgress)
    .where(
      and(
        eq(lessonProgress.userId, userId),
        eq(lessonProgress.status, LessonProgressStatus.Completed),
        inArray(lessonProgress.lessonId, lessonIds)
      )
    )
    .get();

  return result?.count ?? 0;
}

function getSecondsWatched(
  database: Queryable,
  userId: number,
  lessonIds: number[]
) {
  if (lessonIds.length === 0) return 0;

  const furthestPerLesson = database
    .select({
      furthest: sql<number>`max(${videoWatchEvents.positionSeconds})`,
    })
    .from(videoWatchEvents)
    .where(
      and(
        eq(videoWatchEvents.userId, userId),
        inArray(videoWatchEvents.lessonId, lessonIds)
      )
    )
    .groupBy(videoWatchEvents.lessonId)
    .all();

  return furthestPerLesson.reduce((total, row) => total + row.furthest, 0);
}

/**
 * How far the buyer has got with what they bought. For an Individual Purchase
 * that is their own progress. A Team Licence gives its buyer nothing to watch,
 * so for one it is how many of its Seats have been claimed.
 */
export type RefundFigures =
  | {
      kind: "individual_purchase";
      lessonsCompleted: number;
      lessonCount: number;
      secondsWatched: number;
    }
  | {
      kind: "team_licence";
      seatCount: number;
      claimedSeatCount: number;
    };

function getRefundFigures(
  database: Queryable,
  purchase: Purchase
): RefundFigures {
  const seats = getSeats(database, purchase.id);

  if (kindOf(seats) === "team_licence") {
    return {
      kind: "team_licence",
      seatCount: seats.length,
      claimedSeatCount: seats.filter(isClaimed).length,
    };
  }

  const lessonIds = getLessonIds(database, purchase.courseId);
  return {
    kind: "individual_purchase",
    lessonsCompleted: getCompletedLessonCount(
      database,
      purchase.userId,
      lessonIds
    ),
    lessonCount: lessonIds.length,
    secondsWatched: getSecondsWatched(database, purchase.userId, lessonIds),
  };
}

/** What the buyer is told when they can't raise a Refund Request. */
const RULE_BREAK_ERRORS: Record<RuleBreak, string> = {
  window_closed: `The ${REFUND_WINDOW_DAYS}-day window has closed.`,
  watched_too_much: "You have watched too much of this course to get a refund.",
  completed_too_much:
    "You have completed too much of this course to request a refund.",
  seat_claimed: "A Team Licence with a claimed Seat cannot be refunded.",
};

/**
 * The eligibility rules a Purchase breaks. `windowCheckedOn` is the day the
 * window is judged against: today when a buyer asks, and the day it was raised
 * when a Platform Admin looks at a Refund Request.
 */
function findRuleBreaks(
  purchase: Purchase,
  figures: RefundFigures,
  windowCheckedOn: Date
): RuleBreak[] {
  const breaks: RuleBreak[] = [];

  if (!isWithinWindow(purchase.createdAt, windowCheckedOn)) {
    breaks.push("window_closed");
  }

  if (figures.kind === "team_licence") {
    if (figures.claimedSeatCount > 0) breaks.push("seat_claimed");
    return breaks;
  }

  if (figures.secondsWatched >= REFUND_WATCH_LIMIT_SECONDS) {
    breaks.push("watched_too_much");
  }

  if (
    figures.lessonCount > 0 &&
    figures.lessonsCompleted / figures.lessonCount >= REFUND_COMPLETION_LIMIT
  ) {
    breaks.push("completed_too_much");
  }

  return breaks;
}

// ─── Raising a Refund Request ───

export interface Failure {
  ok: false;
  status: 400 | 403 | 404 | 409;
  error: string;
}

type RefundCheck = { ok: true; purchase: Purchase } | Failure;

/**
 * Whether this buyer may raise a Refund Request on this Purchase today. Only
 * the person who paid may, and only one Refund Request can be open at once.
 */
export function checkRefundRequest(
  database: Queryable,
  purchaseId: number,
  buyerId: number,
  now: Date
): RefundCheck {
  const purchase = getPurchase(database, purchaseId);

  if (!purchase || purchase.userId !== buyerId) {
    return { ok: false, status: 404, error: "Purchase not found." };
  }

  if (getRefundRequestWithStatus(database, purchase.id, RefundStatus.Open)) {
    return {
      ok: false,
      status: 409,
      error: "You already have an open refund request on this purchase.",
    };
  }

  if (
    getRefundRequestWithStatus(database, purchase.id, RefundStatus.Approved)
  ) {
    return {
      ok: false,
      status: 409,
      error: "This purchase has already been refunded.",
    };
  }

  const [firstBreak] = findRuleBreaks(
    purchase,
    getRefundFigures(database, purchase),
    now
  );

  if (firstBreak) {
    return { ok: false, status: 403, error: RULE_BREAK_ERRORS[firstBreak] };
  }

  return { ok: true, purchase };
}

export interface RefundOffer {
  purchaseId: number;
  amount: number;
  lastDayInWindow: string;
}

/**
 * What the course page offers a student who wants their money back: their
 * newest Individual Purchase of the course, if it can be refunded. Team
 * Licences are refunded from the team page instead.
 */
export function getRefundOffer(
  database: Queryable,
  buyerId: number,
  courseId: number,
  now: Date
): RefundOffer | null {
  const newestFirst = database
    .select()
    .from(purchases)
    .where(and(eq(purchases.userId, buyerId), eq(purchases.courseId, courseId)))
    .orderBy(desc(purchases.createdAt), desc(purchases.id))
    .all();

  const individualPurchase = newestFirst.find(
    (purchase) =>
      kindOf(getSeats(database, purchase.id)) === "individual_purchase"
  );

  if (!individualPurchase) return null;

  const check = checkRefundRequest(
    database,
    individualPurchase.id,
    buyerId,
    now
  );
  if (!check.ok) return null;

  return {
    purchaseId: individualPurchase.id,
    amount: individualPurchase.amountPaid,
    lastDayInWindow: lastDayOfWindow(individualPurchase.createdAt),
  };
}

export interface Email {
  to: string;
  subject: string;
  body: string;
}

export type RaiseResult =
  | {
      ok: true;
      refundRequestId: number;
      kind: PurchaseKind;
      email: Email;
      notify: NotifyIntent[];
    }
  | Failure;

// Every Platform Admin, queried when the Refund Request is raised so a new
// Platform Admin gets the next one.
function listPlatformAdmins(database: Queryable) {
  return database
    .select({ id: users.id, name: users.name })
    .from(users)
    .where(eq(users.role, UserRole.Admin))
    .orderBy(asc(users.id))
    .all();
}

export function raiseRefundRequest(
  database: Db,
  purchaseId: number,
  buyerId: number,
  reason: string,
  now: Date
): RaiseResult {
  const check = checkRefundRequest(database, purchaseId, buyerId, now);
  if (!check.ok) return check;

  const { purchase } = check;
  const buyer = findPerson(database, buyerId);
  const course = database
    .select()
    .from(courses)
    .where(eq(courses.id, purchase.courseId))
    .get();

  if (!buyer || !course) {
    return { ok: false, status: 404, error: "Purchase not found." };
  }

  const refundRequest = database
    .insert(refunds)
    .values({
      purchaseId: purchase.id,
      status: RefundStatus.Open,
      reason,
      requestedAt: now.toISOString(),
    })
    .returning()
    .get();

  const kind = kindOf(getSeats(database, purchase.id));

  return {
    ok: true,
    refundRequestId: refundRequest.id,
    kind,
    notify: [
      {
        type: "refund-request-opened",
        actor: toPerson(buyer),
        recipients: listPlatformAdmins(database),
        data: {
          refundRequestId: refundRequest.id,
          buyerName: buyer.name,
          courseTitle: course.title,
          purchaseKind: kind,
          reasonExcerpt: excerpt(reason),
          url: "/admin/refunds",
        },
      },
    ],
    email: {
      to: buyer.email,
      subject: `Refund requested — ${course.title}`,
      body: [
        `Hi ${buyer.name},`,
        "",
        `We have your refund request for "${course.title}".`,
        `The refund is for ${formatPrice(purchase.amountPaid)}, the amount you paid.`,
        "",
        "Our team reviews every refund request by hand. You do not need to do anything else — we will email you again when it is done.",
        "",
        "— The Cadence team",
      ].join("\n"),
    },
  };
}

// ─── Listing Refund Requests ───

const deciders = alias(users, "deciders");

function selectRefundRequests(database: Queryable) {
  return database
    .select({
      id: refunds.id,
      status: refunds.status,
      reason: refunds.reason,
      decisionNote: refunds.decisionNote,
      requestedAt: refunds.requestedAt,
      resolvedAt: refunds.resolvedAt,
      decidedByName: deciders.name,
      purchase: purchases,
      courseTitle: courses.title,
      courseSlug: courses.slug,
      buyerName: users.name,
      buyerEmail: users.email,
    })
    .from(refunds)
    .innerJoin(purchases, eq(refunds.purchaseId, purchases.id))
    .innerJoin(courses, eq(purchases.courseId, courses.id))
    .innerJoin(users, eq(purchases.userId, users.id))
    .leftJoin(deciders, eq(refunds.resolvedByUserId, deciders.id));
}

export interface RefundRequestForReview {
  id: number;
  status: RefundStatus;
  reason: string;
  decisionNote: string | null;
  requestedAt: string;
  resolvedAt: string | null;
  decidedByName: string | null;
  buyerName: string;
  buyerEmail: string;
  courseTitle: string;
  courseSlug: string;
  amountPaid: number;
  purchasedAt: string;
  daysSincePurchase: number;
  figures: RefundFigures;
  ruleBreaks: RuleBreak[];
  canApprove: boolean;
}

/**
 * The Refund Requests a Platform Admin reviews, oldest first. The figures are
 * live, not a snapshot from when the request was raised: the buyer keeps the
 * course while it is open, so what matters is how far they have got now.
 */
export function listRefundRequestsForReview(
  database: Queryable,
  status: RefundStatus,
  now: Date
): RefundRequestForReview[] {
  const rows = selectRefundRequests(database)
    .where(eq(refunds.status, status))
    .orderBy(asc(refunds.requestedAt), asc(refunds.id))
    .all();

  return rows.map((row) => {
    const figures = getRefundFigures(database, row.purchase);
    const ruleBreaks = findRuleBreaks(
      row.purchase,
      figures,
      new Date(row.requestedAt)
    );
    const msSincePurchase =
      now.getTime() - new Date(row.purchase.createdAt).getTime();

    return {
      id: row.id,
      status: row.status,
      reason: row.reason,
      decisionNote: row.decisionNote,
      requestedAt: row.requestedAt,
      resolvedAt: row.resolvedAt,
      decidedByName: row.decidedByName,
      buyerName: row.buyerName,
      buyerEmail: row.buyerEmail,
      courseTitle: row.courseTitle,
      courseSlug: row.courseSlug,
      amountPaid: row.purchase.amountPaid,
      purchasedAt: row.purchase.createdAt,
      daysSincePurchase: Math.max(0, Math.floor(msSincePurchase / 86_400_000)),
      figures,
      ruleBreaks,
      // A Claimed Seat belongs to another student, so the only way out of
      // that request is a decline. See docs/adr/0003.
      canApprove:
        row.status === RefundStatus.Open &&
        !ruleBreaks.includes("seat_claimed"),
    };
  });
}

/** A buyer's own Refund Requests, newest first, for their Settings page. */
export function listRefundRequestsForBuyer(
  database: Queryable,
  buyerId: number
) {
  return selectRefundRequests(database)
    .where(eq(purchases.userId, buyerId))
    .orderBy(desc(refunds.requestedAt), desc(refunds.id))
    .all()
    .map((row) => ({
      id: row.id,
      status: row.status,
      reason: row.reason,
      decisionNote: row.decisionNote,
      requestedAt: row.requestedAt,
      resolvedAt: row.resolvedAt,
      courseTitle: row.courseTitle,
      courseSlug: row.courseSlug,
      amountPaid: row.purchase.amountPaid,
    }));
}

/** A Team Admin's Team Licences, with what the team page needs to refund one. */
export function listTeamLicences(
  database: Queryable,
  buyerId: number,
  now: Date
) {
  const bought = database
    .select({
      purchase: purchases,
      courseTitle: courses.title,
      courseSlug: courses.slug,
    })
    .from(purchases)
    .innerJoin(courses, eq(purchases.courseId, courses.id))
    .where(eq(purchases.userId, buyerId))
    .orderBy(desc(purchases.createdAt), desc(purchases.id))
    .all();

  return bought.flatMap(({ purchase, courseTitle, courseSlug }) => {
    const seats = getSeats(database, purchase.id);
    if (kindOf(seats) !== "team_licence") return [];

    const latestRefundRequest = database
      .select({ status: refunds.status, decisionNote: refunds.decisionNote })
      .from(refunds)
      .where(eq(refunds.purchaseId, purchase.id))
      .orderBy(desc(refunds.requestedAt), desc(refunds.id))
      .get();

    return [
      {
        purchaseId: purchase.id,
        courseTitle,
        courseSlug,
        amountPaid: purchase.amountPaid,
        purchasedAt: purchase.createdAt,
        seatCount: seats.length,
        claimedSeatCount: seats.filter(isClaimed).length,
        latestRefundRequest: latestRefundRequest ?? null,
        canRequestRefund: checkRefundRequest(
          database,
          purchase.id,
          buyerId,
          now
        ).ok,
        lastDayInWindow: lastDayOfWindow(purchase.createdAt),
      },
    ];
  });
}

// ─── Deciding a Refund Request ───

export type DecisionResult =
  | {
      ok: true;
      email: Email;
      notify: NotifyIntent[];
      markRead: MarkReadIntent[];
    }
  | Failure;

function findOpenRefundRequest(
  tx: Queryable,
  refundRequestId: number
): { ok: true; purchase: Purchase } | Failure {
  const refundRequest = tx
    .select()
    .from(refunds)
    .where(eq(refunds.id, refundRequestId))
    .get();

  if (!refundRequest) {
    return { ok: false, status: 404, error: "Refund request not found." };
  }

  // The first decision wins. A second Platform Admin deciding the same
  // request lands here and is told what already happened.
  if (refundRequest.status !== RefundStatus.Open) {
    return {
      ok: false,
      status: 409,
      error: `This refund request was already ${refundRequest.status}.`,
    };
  }

  const purchase = getPurchase(tx, refundRequest.purchaseId);
  if (!purchase) {
    return { ok: false, status: 404, error: "Purchase not found." };
  }

  return { ok: true, purchase };
}

/**
 * Approves an Open Refund Request and ends what its Purchase granted.
 *
 * - An Individual Purchase: the buyer loses their Enrollment, unless
 *   they also hold a Claimed Seat for the course (docs/adr/0004). Their progress stays
 *   (docs/adr/0001).
 * - A Team Licence: its Unclaimed Seats can never be claimed. Refused if any
 *   Seat has been claimed (docs/adr/0003).
 */
export function approveRefundRequest(
  database: Db,
  refundRequestId: number,
  platformAdminId: number,
  note: string | null,
  now: Date
): DecisionResult {
  return database.transaction((tx): DecisionResult => {
    const found = findOpenRefundRequest(tx, refundRequestId);
    if (!found.ok) return found;

    const { purchase } = found;
    const seats = getSeats(tx, purchase.id);

    if (kindOf(seats) === "team_licence") {
      if (seats.some(isClaimed)) {
        return {
          ok: false,
          status: 409,
          error:
            "A Seat on this Team Licence has been claimed, so this refund request can only be declined.",
        };
      }

      tx.update(coupons)
        .set({ refundedAt: now.toISOString() })
        .where(
          and(eq(coupons.purchaseId, purchase.id), isNull(coupons.redeemedAt))
        )
        .run();
    } else {
      const claimedSeat = tx
        .select({ id: coupons.id })
        .from(coupons)
        .where(
          and(
            eq(coupons.redeemedByUserId, purchase.userId),
            eq(coupons.courseId, purchase.courseId),
            isNotNull(coupons.redeemedAt)
          )
        )
        .get();

      if (!claimedSeat) {
        tx.delete(enrollments)
          .where(
            and(
              eq(enrollments.userId, purchase.userId),
              eq(enrollments.courseId, purchase.courseId)
            )
          )
          .run();
      }
    }

    tx.update(refunds)
      .set({
        status: RefundStatus.Approved,
        amountRefunded: purchase.amountPaid,
        decisionNote: note,
        resolvedAt: now.toISOString(),
        resolvedByUserId: platformAdminId,
      })
      .where(eq(refunds.id, refundRequestId))
      .run();

    return decisionResult(
      tx,
      { refundRequestId, purchase, platformAdminId },
      { status: RefundStatus.Approved, note }
    );
  });
}

/**
 * Declines an Open Refund Request. Nothing the Purchase granted is lost, and
 * the buyer may raise a new Refund Request. The note is required: it is how
 * the buyer learns whether another request is worth raising.
 */
export function declineRefundRequest(
  database: Db,
  refundRequestId: number,
  platformAdminId: number,
  note: string,
  now: Date
): DecisionResult {
  const trimmedNote = note.trim();

  if (trimmedNote.length === 0) {
    return {
      ok: false,
      status: 400,
      error: "Write the buyer a note saying why it was declined.",
    };
  }

  return database.transaction((tx): DecisionResult => {
    const found = findOpenRefundRequest(tx, refundRequestId);
    if (!found.ok) return found;

    tx.update(refunds)
      .set({
        status: RefundStatus.Declined,
        decisionNote: trimmedNote,
        resolvedAt: now.toISOString(),
        resolvedByUserId: platformAdminId,
      })
      .where(eq(refunds.id, refundRequestId))
      .run();

    return decisionResult(
      tx,
      { refundRequestId, purchase: found.purchase, platformAdminId },
      { status: RefundStatus.Declined, note: trimmedNote }
    );
  });
}

// What a Platform Admin decided, and the note they wrote the buyer.
interface Decision {
  status: typeof RefundStatus.Approved | typeof RefundStatus.Declined;
  note: string | null;
}

/**
 * What a decided Refund Request hands the route: the buyer's email, their
 * refund-request-decided Notification, and the mark-read intent that clears
 * every Platform Admin's refund-request-opened Notification for it.
 */
function decisionResult(
  database: Queryable,
  {
    refundRequestId,
    purchase,
    platformAdminId,
  }: { refundRequestId: number; purchase: Purchase; platformAdminId: number },
  decision: Decision
): DecisionResult {
  const buyer = findPerson(database, purchase.userId);
  const platformAdmin = findPerson(database, platformAdminId);
  const course = database
    .select()
    .from(courses)
    .where(eq(courses.id, purchase.courseId))
    .get();
  const purchaseKind = kindOf(getSeats(database, purchase.id));

  const notify: NotifyIntent[] =
    buyer && platformAdmin && course
      ? [
          {
            type: "refund-request-decided",
            actor: toPerson(platformAdmin),
            recipients: [toPerson(buyer)],
            data: {
              decision: decision.status,
              courseTitle: course.title,
              note: decision.note,
              purchaseKind,
              // A Team Admin manages a Team Licence from the team page.
              url:
                purchaseKind === "team_licence"
                  ? "/team"
                  : `/courses/${course.slug}`,
            },
          },
        ]
      : [];

  return {
    ok: true,
    email: buildDecisionEmail(purchase, buyer, course, decision),
    notify,
    markRead: [{ type: "refund-request-opened", subjectId: refundRequestId }],
  };
}

/** The email the buyer gets once their Refund Request is decided. */
function buildDecisionEmail(
  purchase: Purchase,
  buyer: { name: string; email: string } | undefined,
  course: { title: string } | undefined,
  { status, note }: Decision
): Email {
  const courseTitle = course?.title ?? "your course";
  const noteLines = note ? ["", note] : [];

  const middle =
    status === RefundStatus.Approved
      ? [
          `We have approved your refund request for "${courseTitle}".`,
          `${formatPrice(purchase.amountPaid)}, the full amount you paid, is on its way back to you.`,
          ...noteLines,
        ]
      : [
          `We have looked at your refund request for "${courseTitle}" and decided not to refund it.`,
          ...noteLines,
          "",
          "You still have everything you bought. If something changes, you can raise a new refund request.",
        ];

  return {
    to: buyer?.email ?? "",
    subject: `Refund ${status} — ${courseTitle}`,
    body: [
      `Hi ${buyer?.name ?? "there"},`,
      "",
      ...middle,
      "",
      "— The Cadence team",
    ].join("\n"),
  };
}
