// ADR-0001: A Refund reclaims the seat, not the learner.
// One test per bullet under "## Decisions", named after the bullet.
import { describe, it, expect } from "vitest";
import { and, eq } from "drizzle-orm";
import { createTestDb } from "~/test/setup";
import {
  categories,
  courses,
  enrollments,
  lessonProgress,
  lessons,
  modules,
  purchases,
  refunds,
  users,
  videoWatchEvents,
  CourseStatus,
  LessonProgressStatus,
  RefundStatus,
  UserRole,
} from "~/db/schema";
import {
  canAccessCourse,
  canRaiseRefundRequest,
  decideRefundRequest,
  failRefund,
  issueRefund,
  purchaseCourse,
} from "./refunds.server";

type TestDb = ReturnType<typeof createTestDb>;

function seedCourse(db: TestDb, instructorId: number, categoryId: number, slug: string) {
  const course = db
    .insert(courses)
    .values({
      title: slug,
      slug,
      description: "A course",
      salesCopy: "## Course",
      instructorId,
      categoryId,
      status: CourseStatus.Published,
      price: 7900,
    })
    .returning()
    .get();

  const mod = db
    .insert(modules)
    .values({ courseId: course.id, title: "Module 1", position: 1 })
    .returning()
    .get();

  const lesson = db
    .insert(lessons)
    .values({ moduleId: mod.id, title: "Lesson 1", position: 1 })
    .returning()
    .get();

  return { course, lesson };
}

function buyAndEnroll(db: TestDb, userId: number, courseId: number) {
  const purchase = db
    .insert(purchases)
    .values({ userId, courseId, amountPaid: 7900, country: null })
    .returning()
    .get();
  db.insert(enrollments).values({ userId, courseId }).run();
  return purchase;
}

function seed(db: TestDb) {
  const learner = db
    .insert(users)
    .values({ name: "Refund Learner", email: "learner@example.com", role: UserRole.Student })
    .returning()
    .get();
  const instructor = db
    .insert(users)
    .values({ name: "Course Instructor", email: "instructor@example.com", role: UserRole.Instructor })
    .returning()
    .get();
  const admin = db
    .insert(users)
    .values({ name: "Platform Admin", email: "admin@example.com", role: UserRole.Admin })
    .returning()
    .get();
  const category = db
    .insert(categories)
    .values({ name: "Programming", slug: "programming" })
    .returning()
    .get();

  const firstCourse = seedCourse(db, instructor.id, category.id, "refunded-course");
  const secondCourse = seedCourse(db, instructor.id, category.id, "kept-course");

  const firstPurchase = buyAndEnroll(db, learner.id, firstCourse.course.id);
  const secondPurchase = buyAndEnroll(db, learner.id, secondCourse.course.id);

  return { learner, admin, firstCourse, secondCourse, firstPurchase, secondPurchase };
}

/** Raises a Refund Request on the purchase and approves it: a Pending Refund. */
function approvedRefundRequest(db: TestDb, purchaseId: number, adminId: number) {
  const refundRequest = db
    .insert(refunds)
    .values({ purchaseId, status: RefundStatus.Open, reason: "Not for me." })
    .returning()
    .get();
  decideRefundRequest(db, { refundId: refundRequest.id, decision: "approve", decidedByUserId: adminId });
  return refundRequest;
}

describe("ADR-0001: a Refund reclaims the seat, not the learner", () => {
  it("Course-scoped", () => {
    const db = createTestDb();
    const {
      learner,
      admin,
      firstCourse: refundedCourse,
      secondCourse: untouchedCourse,
      firstPurchase: refundedPurchase,
    } = seed(db);
    // Precondition: the learner starts inside the course that gets refunded.
    expect(canAccessCourse(db, learner.id, refundedCourse.course.id)).toBe(true);
    const refundRequest = approvedRefundRequest(db, refundedPurchase.id, admin.id);

    issueRefund(db, { refundId: refundRequest.id });

    expect(canAccessCourse(db, learner.id, refundedCourse.course.id)).toBe(false);
    expect(canAccessCourse(db, learner.id, untouchedCourse.course.id)).toBe(true);
  });

  it("Decoupled from the decision", () => {
    const db = createTestDb();
    const {
      learner,
      admin,
      firstCourse: failedRefundCourse,
      firstPurchase: failedRefundPurchase,
      secondCourse: issuedRefundCourse,
      secondPurchase: issuedRefundPurchase,
    } = seed(db);

    // Approved, money not yet sent: a Pending Refund leaves the learner inside.
    const failedRefundRequest = approvedRefundRequest(db, failedRefundPurchase.id, admin.id);
    expect(canAccessCourse(db, learner.id, failedRefundCourse.course.id)).toBe(true);

    // A Failed Refund keeps the learner inside: the money was never sent.
    failRefund(db, { refundId: failedRefundRequest.id });
    expect(canAccessCourse(db, learner.id, failedRefundCourse.course.id)).toBe(true);

    // Only Issued ends access. Shown on the other course, whose only purchase is
    // the one refunded: the Failed purchase above is still paid, so it must keep
    // its course open.
    const issuedRefundRequest = approvedRefundRequest(db, issuedRefundPurchase.id, admin.id);
    expect(canAccessCourse(db, learner.id, issuedRefundCourse.course.id)).toBe(true);
    issueRefund(db, { refundId: issuedRefundRequest.id });
    expect(canAccessCourse(db, learner.id, issuedRefundCourse.course.id)).toBe(false);
  });

  it("Progress is preserved", () => {
    const db = createTestDb();
    const {
      learner,
      admin,
      firstCourse: refundedCourse,
      firstPurchase: refundedPurchase,
    } = seed(db);
    db.insert(lessonProgress)
      .values({
        userId: learner.id,
        lessonId: refundedCourse.lesson.id,
        status: LessonProgressStatus.Completed,
        completedAt: new Date().toISOString(),
      })
      .run();
    const refundRequest = approvedRefundRequest(db, refundedPurchase.id, admin.id);

    issueRefund(db, { refundId: refundRequest.id });

    const enrollment = db
      .select()
      .from(enrollments)
      .where(and(eq(enrollments.userId, learner.id), eq(enrollments.courseId, refundedCourse.course.id)))
      .get();
    // Marked as a Revoked Enrollment, not removed.
    expect(enrollment).toBeDefined();
    expect(enrollment?.revokedAt).toEqual(expect.any(String));

    const progress = db
      .select()
      .from(lessonProgress)
      .where(eq(lessonProgress.userId, learner.id))
      .all();
    expect(progress).toHaveLength(1);
    expect(progress[0].status).toBe(LessonProgressStatus.Completed);
  });

  it("Re-purchase resumes", () => {
    const db = createTestDb();
    const {
      learner,
      admin,
      firstCourse: repurchasedCourse,
      firstPurchase: refundedPurchase,
    } = seed(db);
    db.insert(lessonProgress)
      .values({
        userId: learner.id,
        lessonId: repurchasedCourse.lesson.id,
        status: LessonProgressStatus.Completed,
        completedAt: new Date().toISOString(),
      })
      .run();
    // 90 minutes watched before the refund: under the 2-hour cap on its own.
    db.insert(videoWatchEvents)
      .values({ userId: learner.id, lessonId: repurchasedCourse.lesson.id, eventType: "progress", positionSeconds: 90 * 60 })
      .run();
    const refundRequest = approvedRefundRequest(db, refundedPurchase.id, admin.id);
    issueRefund(db, { refundId: refundRequest.id });
    // Precondition: the seat was really reclaimed, so "resumes" means something.
    expect(canAccessCourse(db, learner.id, repurchasedCourse.course.id)).toBe(false);

    const repurchase = purchaseCourse(db, {
      userId: learner.id,
      courseId: repurchasedCourse.course.id,
      amountPaid: 7900,
      country: null,
    });

    expect(canAccessCourse(db, learner.id, repurchasedCourse.course.id)).toBe(true);
    const progress = db
      .select()
      .from(lessonProgress)
      .where(eq(lessonProgress.userId, learner.id))
      .all();
    expect(progress.map((p) => p.status)).toEqual([LessonProgressStatus.Completed]);
    // Precondition: under the cap, the repurchase is refundable.
    expect(canRaiseRefundRequest(db, { purchaseId: repurchase.id }).ok).toBe(true);

    // 31 more minutes on another lesson: over the cap only if the kept 90 minutes count.
    const secondLesson = db
      .insert(lessons)
      .values({ moduleId: repurchasedCourse.lesson.moduleId, title: "Lesson 2", position: 2 })
      .returning()
      .get();
    db.insert(videoWatchEvents)
      .values({ userId: learner.id, lessonId: secondLesson.id, eventType: "progress", positionSeconds: 31 * 60 })
      .run();
    expect(canRaiseRefundRequest(db, { purchaseId: repurchase.id }).ok).toBe(false);
  });

  it("No double refund", () => {
    const db = createTestDb();
    const {
      admin,
      firstPurchase: issuedRefundPurchase,
      secondPurchase: failedRefundPurchase,
    } = seed(db);

    // Declined most recently: a new Open request is allowed.
    const declinedRefundRequest = db
      .insert(refunds)
      .values({ purchaseId: issuedRefundPurchase.id, status: RefundStatus.Open, reason: "Not for me." })
      .returning()
      .get();
    decideRefundRequest(db, { refundId: declinedRefundRequest.id, decision: "decline", decidedByUserId: admin.id });
    expect(canRaiseRefundRequest(db, { purchaseId: issuedRefundPurchase.id }).ok).toBe(true);

    // Approved: blocked.
    const issuedRefundRequest = approvedRefundRequest(db, issuedRefundPurchase.id, admin.id);
    expect(canRaiseRefundRequest(db, { purchaseId: issuedRefundPurchase.id }).ok).toBe(false);

    // Issued: still blocked.
    issueRefund(db, { refundId: issuedRefundRequest.id });
    expect(canRaiseRefundRequest(db, { purchaseId: issuedRefundPurchase.id }).ok).toBe(false);

    // Failed: still blocked. The request stays Approved; only the money didn't move.
    expect(canRaiseRefundRequest(db, { purchaseId: failedRefundPurchase.id }).ok).toBe(true);
    const failedRefundRequest = approvedRefundRequest(db, failedRefundPurchase.id, admin.id);
    failRefund(db, { refundId: failedRefundRequest.id });
    expect(canRaiseRefundRequest(db, { purchaseId: failedRefundPurchase.id }).ok).toBe(false);
  });
});
