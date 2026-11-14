import { describe, it, expect } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb } from "~/test/setup";
import {
  purchases,
  refunds,
  users,
  courses,
  categories,
  RefundStatus,
  CourseStatus,
  UserRole,
} from "~/db/schema";
import { decideRefundRequest } from "./refunds.server";

function seed(db: ReturnType<typeof createTestDb>) {
  const learner = db
    .insert(users)
    .values({
      name: "Refund Learner",
      email: "refund-learner@example.com",
      role: UserRole.Student,
    })
    .returning()
    .get();

  const admin = db
    .insert(users)
    .values({
      name: "Platform Admin",
      email: "admin@example.com",
      role: UserRole.Admin,
    })
    .returning()
    .get();

  const category = db
    .insert(categories)
    .values({ name: "Programming", slug: "programming" })
    .returning()
    .get();

  const course = db
    .insert(courses)
    .values({
      title: "Test Course",
      slug: "test-course",
      description: "A test course",
      salesCopy: "## Test",
      instructorId: learner.id,
      categoryId: category.id,
      status: CourseStatus.Published,
    })
    .returning()
    .get();

  const purchase = db
    .insert(purchases)
    .values({
      userId: learner.id,
      courseId: course.id,
      amountPaid: 7900,
      country: null,
    })
    .returning()
    .get();

  return { learner, admin, course, purchase };
}

function openRequest(
  db: ReturnType<typeof createTestDb>,
  purchaseId: number
) {
  return db
    .insert(refunds)
    .values({ purchaseId, status: RefundStatus.Open, reason: "Not for me." })
    .returning()
    .get();
}

describe("decideRefundRequest", () => {
  it("approving a request sets the full amount paid as the amount refunded", () => {
    const db = createTestDb();
    const { admin, purchase } = seed(db);
    const request = openRequest(db, purchase.id);

    decideRefundRequest(db, {
      refundId: request.id,
      decision: "approve",
      decidedByUserId: admin.id,
    });

    const after = db.select().from(refunds).where(eq(refunds.id, request.id)).get();
    expect(after?.status).toBe(RefundStatus.Approved);
    expect(after?.amountRefunded).toBe(7900);
    expect(after?.resolvedByUserId).toBe(admin.id);
    expect(after?.resolvedAt).not.toBeNull();
  });

  it("declining a request refunds nothing", () => {
    const db = createTestDb();
    const { admin, purchase } = seed(db);
    const request = openRequest(db, purchase.id);

    decideRefundRequest(db, {
      refundId: request.id,
      decision: "decline",
      decidedByUserId: admin.id,
    });

    const after = db.select().from(refunds).where(eq(refunds.id, request.id)).get();
    expect(after?.status).toBe(RefundStatus.Declined);
    expect(after?.amountRefunded).toBeNull();
    expect(after?.resolvedByUserId).toBe(admin.id);
    expect(after?.resolvedAt).not.toBeNull();
  });

  it("does not change a decision that is already made", () => {
    const db = createTestDb();
    const { admin, purchase } = seed(db);
    const request = openRequest(db, purchase.id);

    decideRefundRequest(db, {
      refundId: request.id,
      decision: "approve",
      decidedByUserId: admin.id,
    });

    // A second decision, even to the opposite outcome, must be a no-op.
    decideRefundRequest(db, {
      refundId: request.id,
      decision: "decline",
      decidedByUserId: admin.id,
    });

    const after = db.select().from(refunds).where(eq(refunds.id, request.id)).get();
    expect(after?.status).toBe(RefundStatus.Approved);
    expect(after?.amountRefunded).toBe(7900);
  });

  it("returns null for a request that does not exist", () => {
    const db = createTestDb();
    const { admin } = seed(db);

    expect(
      decideRefundRequest(db, {
        refundId: 999,
        decision: "approve",
        decidedByUserId: admin.id,
      })
    ).toBeNull();
  });
});
