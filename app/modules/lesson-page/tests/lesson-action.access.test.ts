import { beforeEach, describe, expect, it } from "vitest";

import { seedQuiz } from "~/test/setup";

import { createWorld, post, rejectionOf, view, type World } from "./fixtures";

let world: World;

beforeEach(() => {
  world = createWorld();
});

const EVERY_INTENT: Array<Record<string, string | number>> = [
  { intent: "create-comment", body: "Hello" },
  { intent: "toggle-bookmark" },
  { intent: "save-note", body: "Mine" },
  { intent: "mark-complete" },
  { intent: "submit-quiz", quizId: 1 },
];

describe("who may post to a lesson", () => {
  it("rejects bad route parameters with 400", async () => {
    expect(
      await rejectionOf(
        post(world, { userId: world.student.id, lessonId: "abc" }, {})
      )
    ).toEqual({ status: 400, body: "Invalid parameters" });
  });

  it("rejects an unknown course with 404", async () => {
    expect(
      await rejectionOf(
        post(world, { userId: world.student.id, slug: "nope" }, {})
      )
    ).toEqual({ status: 404, body: "Course not found" });
  });

  it("rejects a signed-out visitor with 401", async () => {
    expect(
      await rejectionOf(
        post(world, { userId: null }, { intent: "mark-complete" })
      )
    ).toEqual({ status: 401, body: "You must be logged in" });
  });

  it("rejects a session whose user no longer exists with 401", async () => {
    expect(
      await rejectionOf(
        post(world, { userId: 999 }, { intent: "mark-complete" })
      )
    ).toEqual({ status: 401, body: "Select a user from the DevUI panel." });
  });

  it.each(EVERY_INTENT)(
    "rejects $intent from someone not enrolled with 403",
    async (fields) => {
      expect(
        await rejectionOf(post(world, { userId: world.outsider.id }, fields))
      ).toEqual({ status: 403, body: "You must be enrolled in this course." });
    }
  );

  it.each(EVERY_INTENT)(
    "rejects $intent on another course's lesson with 404",
    async (fields) => {
      const visit = {
        userId: world.student.id,
        lessonId: world.otherLesson.id,
      };
      expect(await rejectionOf(post(world, visit, fields))).toEqual({
        status: 404,
        body: "Lesson not found in this course",
      });
    }
  );

  it("lets the course's instructor post without an enrollment", async () => {
    expect(
      await post(
        world,
        { userId: world.instructor.id },
        { intent: "mark-complete" }
      )
    ).toEqual({ success: true });
  });

  it("lets an admin post without an enrollment", async () => {
    expect(
      await post(world, { userId: world.admin.id }, { intent: "mark-complete" })
    ).toEqual({ success: true });
  });

  it("does not let staff of one course reach another course's lesson", async () => {
    const visit = {
      userId: world.instructor.id,
      lessonId: world.otherLesson.id,
    };
    const page = await view(world, {
      userId: world.instructor.id,
      slug: world.otherCourse.slug,
      lessonId: world.otherLesson.id,
    });
    expect(page.comments).toEqual([]);

    expect(
      await rejectionOf(
        post(world, visit, { intent: "create-comment", body: "x" })
      )
    ).toMatchObject({ status: 404 });
  });

  it("rejects an unknown intent with 400", async () => {
    expect(
      await rejectionOf(
        post(world, { userId: world.student.id }, { intent: "nope" })
      )
    ).toEqual({ status: 400, body: "Invalid action" });
  });
});

describe("submitting a quiz", () => {
  it("rejects a quiz id that is not a number with 400", async () => {
    expect(
      await rejectionOf(
        post(
          world,
          { userId: world.student.id },
          { intent: "submit-quiz", quizId: "x" }
        )
      )
    ).toEqual({ status: 400, body: "Invalid quiz ID" });
  });

  it("rejects another lesson's quiz with 404, so its answers stay hidden", async () => {
    seedQuiz(world.database, world.lesson.id, [
      { type: "true_false", options: [true, false] },
    ]);
    const otherQuiz = seedQuiz(world.database, world.otherLesson.id, [
      { type: "true_false", options: [true, false] },
    ]);

    expect(
      await rejectionOf(
        post(
          world,
          { userId: world.student.id },
          { intent: "submit-quiz", quizId: otherQuiz.id }
        )
      )
    ).toEqual({ status: 404, body: "Quiz not found" });
  });

  it("rejects a quiz id on a lesson with no quiz with 404", async () => {
    expect(
      await rejectionOf(
        post(
          world,
          { userId: world.student.id },
          { intent: "submit-quiz", quizId: 1 }
        )
      )
    ).toEqual({ status: 404, body: "Quiz not found" });
  });
});
