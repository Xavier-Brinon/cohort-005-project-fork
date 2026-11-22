import { beforeEach, describe, expect, it } from "vitest";

import * as schema from "~/db/schema";
import { createTestDb, seedBaseData, type TestDb } from "~/test/setup";

import { enrollStudent, isEnrolled } from "./enrollments.server";
import { approveRefundRequest, raiseRefundRequest } from "./refunds.server";
import { claimSeat } from "./seat-claims.server";

const NOW = new Date(2026, 9, 6, 12, 0, 0);

let db: TestDb;
let base: ReturnType<typeof seedBaseData>;
let teamAdmin: typeof schema.users.$inferSelect;

beforeEach(() => {
  db = createTestDb();
  base = seedBaseData(db);

  teamAdmin = db
    .insert(schema.users)
    .values({
      name: "Tess Admin",
      email: "tess@example.com",
      role: schema.UserRole.Student,
    })
    .returning()
    .get();
});

function buySeats(seats: number, country: string | null = null) {
  const team = db.insert(schema.teams).values({}).returning().get();
  const purchase = db
    .insert(schema.purchases)
    .values({
      userId: teamAdmin.id,
      courseId: base.course.id,
      amountPaid: 7900 * seats,
      country,
      createdAt: NOW.toISOString(),
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

describe("claiming a Seat", () => {
  it("enrols the Student and marks the Seat claimed", () => {
    const { seats } = buySeats(1);

    const result = claimSeat(db, seats[0].code, base.user.id, "GB", NOW);

    expect(result).toMatchObject({
      ok: true,
      seat: { redeemedByUserId: base.user.id, redeemedAt: NOW.toISOString() },
      enrollment: { userId: base.user.id, courseId: base.course.id },
    });
    expect(isEnrolled(db, base.user.id, base.course.id)).toBe(true);
  });

  it("refuses a code that does not exist", () => {
    expect(claimSeat(db, "NOPE", base.user.id, "GB", NOW)).toEqual({
      ok: false,
      error: "Seat not found",
    });
  });

  it("refuses a Seat someone else has claimed", () => {
    const { seats } = buySeats(1);
    claimSeat(db, seats[0].code, addStudent("Ben").id, "GB", NOW);

    expect(claimSeat(db, seats[0].code, base.user.id, "GB", NOW)).toEqual({
      ok: false,
      error: "This Seat has already been claimed",
    });
    expect(isEnrolled(db, base.user.id, base.course.id)).toBe(false);
  });

  it("refuses a Seat on hold while its Team Licence has an Open Refund Request", () => {
    const { purchase, seats } = buySeats(2);
    raise(purchase.id);

    expect(claimSeat(db, seats[0].code, base.user.id, "GB", NOW)).toEqual({
      ok: false,
      error:
        "This Seat can't be claimed right now. Ask the person who shared it with you.",
    });
    expect(isEnrolled(db, base.user.id, base.course.id)).toBe(false);
  });

  it("refuses a Seat whose Team Licence was refunded", () => {
    const { purchase, seats } = buySeats(2);
    const platformAdmin = addStudent("Pat");
    approveRefundRequest(db, raise(purchase.id), platformAdmin.id, null, NOW);

    expect(claimSeat(db, seats[0].code, base.user.id, "GB", NOW)).toEqual({
      ok: false,
      error:
        "This Seat is no longer available. Ask the person who shared it with you.",
    });
    expect(isEnrolled(db, base.user.id, base.course.id)).toBe(false);
  });

  it("refuses a Student already enrolled and leaves the Seat unclaimed", () => {
    const { seats } = buySeats(1);
    enrollStudent(db, base.user.id, base.course.id, NOW);

    expect(claimSeat(db, seats[0].code, base.user.id, "GB", NOW)).toEqual({
      ok: false,
      error: "You are already enrolled in this course",
    });
    expect(
      claimSeat(db, seats[0].code, addStudent("Ben").id, "GB", NOW).ok
    ).toBe(true);
  });

  it("refuses a Student in a different country from the Team Admin", () => {
    const { seats } = buySeats(1, "GB");

    expect(claimSeat(db, seats[0].code, base.user.id, "IN", NOW)).toEqual({
      ok: false,
      error:
        "This Seat can only be claimed from the same country as the Team Licence was bought in",
    });
    expect(isEnrolled(db, base.user.id, base.course.id)).toBe(false);
  });

  it("refuses an enrolled Student for that reason, before the country", () => {
    const { seats } = buySeats(1, "GB");
    enrollStudent(db, base.user.id, base.course.id, NOW);

    expect(claimSeat(db, seats[0].code, base.user.id, "IN", NOW)).toEqual({
      ok: false,
      error: "You are already enrolled in this course",
    });
  });
});

function addStudent(name: string) {
  return db
    .insert(schema.users)
    .values({
      name,
      email: `${name.toLowerCase()}@example.com`,
      role: schema.UserRole.Student,
    })
    .returning()
    .get();
}

function raise(purchaseId: number) {
  const result = raiseRefundRequest(db, purchaseId, teamAdmin.id, "No.", NOW);
  if (!result.ok) throw new Error(result.error);
  return result.refundRequestId;
}
