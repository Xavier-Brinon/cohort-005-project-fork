import { beforeEach, describe, expect, it } from "vitest";

import {
  seedCourse,
  seedEnrollment,
  seedLessonProgress,
  seedModule,
  seedUser,
} from "~/test/setup";

import { createWorld, post, rejectionOf, view, type World } from "./fixtures";

let world: World;

beforeEach(() => {
  world = createWorld();
});

describe("finding the lesson", () => {
  it("rejects a lesson id that is not a number with 400", async () => {
    expect(
      await rejectionOf(view(world, { userId: null, lessonId: "abc" }))
    ).toEqual({ status: 400, body: "Invalid lesson ID" });
  });

  it("rejects an unknown course with 404", async () => {
    expect(
      await rejectionOf(view(world, { userId: null, slug: "nope" }))
    ).toEqual({ status: 404, body: "Course not found" });
  });

  it.each([
    ["another course's lesson", () => world.otherLesson.id],
    ["a missing lesson", () => 999],
  ])("rejects %s with 404", async (_name, lessonId) => {
    expect(
      await rejectionOf(view(world, { userId: null, lessonId: lessonId() }))
    ).toEqual({ status: 404, body: "Lesson not found in this course" });
  });
});

describe("the paywall preview", () => {
  it("shows a signed-out visitor the lesson but nothing private", async () => {
    const page = await view(world, { userId: null });

    expect(page).toMatchObject({
      course: { id: world.course.id, slug: world.course.slug },
      lesson: { id: world.lesson.id },
      module: { title: "Module 1" },
      enrolled: false,
      currentUserId: null,
      canViewContent: false,
      canModerate: false,
      comments: [],
      bookmarked: false,
      note: null,
      lessonStatus: null,
      lessonProgressMap: {},
      instructorName: "Test Instructor",
    });
  });

  it("hides the discussion from a signed-in outsider and records nothing", async () => {
    await post(
      world,
      { userId: world.student.id },
      {
        intent: "create-comment",
        body: "Why?",
      }
    );

    const page = await view(world, { userId: world.outsider.id });

    expect(page).toMatchObject({
      currentUserId: world.outsider.id,
      canViewContent: false,
      comments: [],
      lessonStatus: null,
    });
  });
});

describe("an enrolled student", () => {
  it("marks the lesson in progress on viewing", async () => {
    const page = await view(world, { userId: world.student.id });

    expect(page).toMatchObject({
      enrolled: true,
      canViewContent: true,
      canModerate: false,
      lessonStatus: "in_progress",
      lessonProgressMap: { [world.lesson.id]: "in_progress" },
    });
  });

  it("moves a not-started lesson to in progress on viewing", async () => {
    seedLessonProgress(world.database, {
      userId: world.student.id,
      lessonId: world.lesson.id,
      status: "not_started",
    });

    const page = await view(world, { userId: world.student.id });

    expect(page.lessonStatus).toBe("in_progress");
    expect(page.lessonProgressMap).toEqual({
      [world.lesson.id]: "in_progress",
    });

    // The row was updated, not duplicated: completing it shows everywhere.
    await post(
      world,
      { userId: world.student.id },
      { intent: "mark-complete" }
    );
    expect(
      (await view(world, { userId: world.student.id })).lessonProgressMap
    ).toEqual({ [world.lesson.id]: "completed" });
  });

  it("keeps a completed lesson completed on viewing it again", async () => {
    await post(
      world,
      { userId: world.student.id },
      { intent: "mark-complete" }
    );

    const page = await view(world, { userId: world.student.id });

    expect(page.lessonStatus).toBe("completed");
  });

  it("only maps progress on this course's lessons", async () => {
    seedEnrollment(world.database, {
      userId: world.student.id,
      courseId: world.otherCourse.id,
    });
    await view(world, {
      userId: world.student.id,
      slug: world.otherCourse.slug,
      lessonId: world.otherLesson.id,
    });

    const page = await view(world, { userId: world.student.id });

    expect(page.lessonProgressMap).toEqual({
      [world.lesson.id]: "in_progress",
    });
  });

  it("is blocked from a PPP purchase made in another country", async () => {
    const paid = seedCourse(world.database, {
      slug: "paid",
      instructorId: world.instructor.id,
      categoryId: world.category.id,
      price: 10_000,
    });
    const [lesson] = seedModule(
      world.database,
      { courseId: paid.id, position: 1 },
      [{}]
    );
    seedEnrollment(world.database, {
      userId: world.student.id,
      courseId: paid.id,
      country: "IN",
    });
    const visit = {
      userId: world.student.id,
      slug: "paid",
      lessonId: lesson.id,
    };

    expect(await view(world, { ...visit, country: "IN" })).toMatchObject({
      pppBlocked: false,
      canViewContent: true,
    });
    expect(await view(world, { ...visit, country: "US" })).toMatchObject({
      pppBlocked: true,
      pppBlockedCountry: "US",
      pppPurchaseCountry: "IN",
      canViewContent: false,
      comments: [],
    });
  });
});

describe("staff", () => {
  it.each([
    ["the course's instructor", () => world.instructor.id],
    ["an admin", () => world.admin.id],
  ])(
    "lets %s read and moderate without an enrollment",
    async (_name, userId) => {
      expect(await view(world, { userId: userId() })).toMatchObject({
        enrolled: false,
        canViewContent: true,
        canModerate: true,
        lessonStatus: null,
      });
    }
  );

  it("does not make another course's instructor staff here", async () => {
    const stranger = seedUser(world.database, {
      name: "Ines",
      role: "instructor",
    });
    expect(await view(world, { userId: stranger.id })).toMatchObject({
      canViewContent: false,
      canModerate: false,
    });
  });
});
