import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import * as schema from "~/db/schema";
import { UserRole } from "~/db/schema";
import { createTestDb, seedBaseData, type TestDb } from "~/test/setup";

import { isBookmarked, toggleBookmark } from "./bookmarks.server";
import { getNote, saveNote } from "./notes.server";
import { approveRefundRequest, raiseRefundRequest } from "./refunds.server";

const NOW = new Date(2026, 9, 6, 12, 0, 0);

let database: TestDb;
let base: ReturnType<typeof seedBaseData>;

beforeEach(() => {
  database = createTestDb();
  base = seedBaseData(database);
});

function addLesson() {
  const module = database
    .insert(schema.modules)
    .values({ courseId: base.course.id, title: "Basics", position: 1 })
    .returning()
    .get();
  return database
    .insert(schema.lessons)
    .values({ moduleId: module.id, title: "Lesson 1", position: 1 })
    .returning()
    .get().id;
}

function buyForSelf(userId: number) {
  const purchase = database
    .insert(schema.purchases)
    .values({
      userId,
      courseId: base.course.id,
      amountPaid: 7900,
      createdAt: new Date(2026, 9, 3, 12, 0, 0).toISOString(),
    })
    .returning()
    .get();
  database
    .insert(schema.enrollments)
    .values({ userId, courseId: base.course.id })
    .run();
  return purchase;
}

function isEnrolled(userId: number) {
  return !!database
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

describe("approving a Refund Request", () => {
  it("keeps the buyer's Bookmarks and Notes", () => {
    const lessonId = addLesson();
    const platformAdmin = database
      .insert(schema.users)
      .values({
        name: "Pat Admin",
        email: "pat@example.com",
        role: UserRole.Admin,
      })
      .returning()
      .get();
    const purchase = buyForSelf(base.user.id);
    toggleBookmark(database, base.user.id, lessonId, NOW);
    saveNote(database, base.user.id, lessonId, "Come back to this", NOW);
    const raised = raiseRefundRequest(
      database,
      purchase.id,
      base.user.id,
      "It was not what I expected.",
      NOW
    );
    if (!raised.ok) throw new Error(raised.error);

    approveRefundRequest(
      database,
      raised.refundRequestId,
      platformAdmin.id,
      null,
      NOW
    );

    expect(isEnrolled(base.user.id)).toBe(false);
    expect(isBookmarked(database, base.user.id, lessonId)).toBe(true);
    expect(getNote(database, base.user.id, lessonId)?.body).toBe(
      "Come back to this"
    );
  });
});
