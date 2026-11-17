import { describe, it, expect, beforeEach } from "vitest";
import { createTestDb, seedBaseData, type TestDb } from "~/test/setup";
import * as schema from "~/db/schema";
import { markdown } from "~/lib/text";
import { getInstructorAnalytics } from "../analytics.server";

const NOW = new Date("2026-06-15T12:00:00.000Z");

function daysBefore(days: number) {
  return new Date(NOW.getTime() - days * 86_400_000).toISOString();
}

let db: TestDb;
let base: ReturnType<typeof seedBaseData>;

beforeEach(() => {
  db = createTestDb();
  base = seedBaseData(db);
});

function buy(courseId: number, amountPaid: number, createdAt: string) {
  db.insert(schema.purchases)
    .values({ userId: base.user.id, courseId, amountPaid, createdAt })
    .run();
}

function analyticsFor(
  viewer: { userId: number; isAdmin: boolean },
  query = ""
) {
  return getInstructorAnalytics(db, viewer, new URLSearchParams(query), NOW);
}

const asInstructor = () => ({ userId: base.instructor.id, isAdmin: false });

describe("getInstructorAnalytics", () => {
  describe("ranges", () => {
    it("measures the range back from the given now, not the clock", () => {
      buy(base.course.id, 1000, daysBefore(5));
      buy(base.course.id, 2000, daysBefore(40));

      expect(analyticsFor(asInstructor(), "range=30d").summary.grossCents).toBe(
        1000
      );
      expect(analyticsFor(asInstructor(), "range=90d").summary.grossCents).toBe(
        3000
      );
    });

    it("runs the revenue chart up to the day holding now", () => {
      buy(base.course.id, 1000, daysBefore(2));

      const { points } = analyticsFor(asInstructor(), "range=7d").series;

      expect(points.at(-1)?.bucket).toBe("2026-06-15");
    });
  });

  describe("refund exposure", () => {
    it("counts only purchases still inside their window on now's day", () => {
      buy(base.course.id, 1000, daysBefore(10));
      buy(base.course.id, 2000, daysBefore(14));
      buy(base.course.id, 4000, daysBefore(15));

      const exposure = analyticsFor(asInstructor(), "range=all").refundExposure;

      expect(exposure.grossCents).toBe(3000);
      expect(exposure.purchaseCount).toBe(2);
      // Bought fourteen days ago: today is the last day it can be refunded.
      expect(exposure.closingTodayCount).toBe(1);
      expect(exposure.courses).toEqual([
        expect.objectContaining({ courseId: base.course.id, daysLeft: 0 }),
      ]);
    });
  });

  describe("access", () => {
    let rival: typeof schema.users.$inferSelect;
    let rivalCourse: typeof schema.courses.$inferSelect;

    beforeEach(() => {
      rival = db
        .insert(schema.users)
        .values({
          name: "Rival Instructor",
          email: "rival@example.com",
          role: schema.UserRole.Instructor,
        })
        .returning()
        .get();

      rivalCourse = db
        .insert(schema.courses)
        .values({
          title: "Rival Course",
          slug: "rival-course",
          description: "Someone else's course",
          salesCopy: markdown("## Rival Course"),
          instructorId: rival.id,
          categoryId: base.category.id,
          status: schema.CourseStatus.Published,
        })
        .returning()
        .get();

      buy(base.course.id, 1000, daysBefore(1));
      buy(rivalCourse.id, 9000, daysBefore(1));
    });

    it("pins an instructor to their own figures whatever the URL asks for", () => {
      const result = analyticsFor(asInstructor(), `instructor=${rival.id}`);

      expect(result.instructorId).toBe(base.instructor.id);
      expect(result.summary.grossCents).toBe(1000);
    });

    it("ignores a course the instructor doesn't own", () => {
      const result = analyticsFor(
        asInstructor(),
        `tab=course&course=${rivalCourse.id}`
      );

      expect(result.selectedCourseId).toBeNull();
      expect(result.funnel).toBeNull();
    });

    it("lets an admin pick any instructor, or everyone", () => {
      const admin = { userId: base.user.id, isAdmin: true };

      expect(
        analyticsFor(admin, `instructor=${rival.id}`).summary.grossCents
      ).toBe(9000);
      expect(analyticsFor(admin).summary.grossCents).toBe(10000);
    });
  });
});
