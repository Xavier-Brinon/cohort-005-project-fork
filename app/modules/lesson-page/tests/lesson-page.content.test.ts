import { beforeEach, describe, expect, it, vi } from "vitest";

import { markdown } from "~/lib/text";
import { seedLesson, seedModule, seedQuiz, seedWatchEvent } from "~/test/setup";

import { createWorld, post, view, type World } from "./fixtures";

// Comment bodies go through renderComment, the sanitising renderer, and lesson
// content through renderMarkdown; both have their own tests. These stand-ins
// mark their output, so a test can tell which one was used, and keep shiki
// out: under Stryker's test runner, shiki highlighters in several test files
// at once crashed the worker with SIGSEGV.
vi.mock("~/lib/comment-markdown.server", () => ({
  renderComment: async (body: string) => `renderComment:${body}`,
}));
vi.mock("~/lib/markdown.server", () => ({
  renderMarkdown: async (content: string) => `renderMarkdown:${content}`,
}));

let world: World;

beforeEach(() => {
  world = createWorld();
});

describe("navigation", () => {
  it("links the previous and next lessons across modules", async () => {
    const courseId = world.course.id;
    const [second, third] = seedModule(
      world.database,
      { courseId, position: 2 },
      [{ title: "Second" }, { title: "Third" }]
    );

    const first = await view(world, { userId: null });
    const middle = await view(world, { userId: null, lessonId: second.id });
    const last = await view(world, { userId: null, lessonId: third.id });

    expect(first).toMatchObject({
      prevLesson: null,
      nextLesson: { id: second.id },
    });
    expect(middle).toMatchObject({
      prevLesson: { id: world.lesson.id, moduleTitle: "Module 1" },
      nextLesson: { id: third.id, title: "Third", moduleTitle: "Module 2" },
    });
    expect(last).toMatchObject({
      prevLesson: { id: second.id },
      nextLesson: null,
    });
    expect(first.curriculum).toEqual([
      {
        id: world.lesson.moduleId,
        title: "Module 1",
        lessons: [{ id: world.lesson.id, title: "Lesson" }],
      },
      {
        id: second.moduleId,
        title: "Module 2",
        lessons: [
          { id: second.id, title: "Second" },
          { id: third.id, title: "Third" },
        ],
      },
    ]);
  });
});

describe("lesson content", () => {
  it("renders the lesson's Markdown, or gives null without any", async () => {
    const withContent = seedLesson(world.database, world.course.id, {
      content: markdown("# Hello"),
    });

    expect((await view(world, { userId: null })).contentHtml).toBeNull();
    expect(
      (await view(world, { userId: null, lessonId: withContent.id }))
        .contentHtml
    ).toBe("renderMarkdown:# Hello");
  });

  it("gives the quiz without its answers, and no best attempt yet", async () => {
    const quiz = seedQuiz(world.database, world.lesson.id, [
      { type: "true_false", options: [true, false] },
    ]);
    const [question] = quiz.questions;

    const page = await view(world, { userId: world.student.id });

    expect(page.bestAttempt).toBeNull();
    expect(page.quiz).toEqual({
      id: quiz.id,
      title: "Quiz",
      passingScore: 0.7,
      questions: [
        {
          id: question.id,
          questionText: "Question 1",
          questionType: "true_false",
          position: 1,
          options: [
            { id: question.optionIds[0], optionText: "Option 1" },
            { id: question.optionIds[1], optionText: "Option 2" },
          ],
        },
      ],
    });
  });

  it("gives no quiz on a lesson without one", async () => {
    expect(await view(world, { userId: world.student.id })).toMatchObject({
      quiz: null,
      bestAttempt: null,
    });
  });
});

describe("video progress", () => {
  function seedVideoLesson(durationMinutes: number | null) {
    return seedLesson(world.database, world.course.id, {
      videoUrl: "https://www.youtube.com/watch?v=abc",
      durationMinutes,
    });
  }

  function watch(lessonId: number, positionSeconds: number, minute: number) {
    seedWatchEvent(world.database, {
      userId: world.student.id,
      lessonId,
      positionSeconds,
      createdAt: new Date(2026, 0, 1, 0, minute).toISOString(),
    });
  }

  it("resumes at the last position and counts the furthest one", async () => {
    const lesson = seedVideoLesson(10);
    watch(lesson.id, 300, 1);
    watch(lesson.id, 120, 2);

    expect(
      await view(world, { userId: world.student.id, lessonId: lesson.id })
    ).toMatchObject({ lastWatchPosition: 120, watchProgress: 50 });
  });

  it("caps progress at 100%", async () => {
    const lesson = seedVideoLesson(1);
    watch(lesson.id, 90, 1);

    expect(
      await view(world, { userId: world.student.id, lessonId: lesson.id })
    ).toMatchObject({ lastWatchPosition: 90, watchProgress: 100 });
  });

  it("gives no progress for a video without a duration, or no video", async () => {
    const noDuration = seedVideoLesson(null);
    watch(noDuration.id, 90, 1);
    watch(world.lesson.id, 90, 1);

    expect(
      await view(world, { userId: world.student.id, lessonId: noDuration.id })
    ).toMatchObject({ lastWatchPosition: 90, watchProgress: 0 });
    expect(await view(world, { userId: world.student.id })).toMatchObject({
      lastWatchPosition: 0,
      watchProgress: 0,
    });
  });

  it("gives an unwatched video no position", async () => {
    const lesson = seedVideoLesson(10);
    expect(
      await view(world, { userId: world.student.id, lessonId: lesson.id })
    ).toMatchObject({ lastWatchPosition: 0, watchProgress: 0 });
  });
});

describe("the discussion", () => {
  async function ask(userId: number, body: string, parentId?: number) {
    await post(
      world,
      { userId },
      {
        intent: "create-comment",
        body,
        ...(parentId === undefined ? {} : { parentId }),
      }
    );
    const thread = (await view(world, { userId })).comments;
    return thread[thread.length - 1];
  }

  it("renders bodies and keeps a deleted question that has replies, blanked", async () => {
    const question = await ask(world.student.id, "**Why?**");
    await ask(world.instructor.id, "Because.", question.id);
    const lone = await ask(world.student.id, "Lone");
    for (const commentId of [question.id, lone.id]) {
      await post(
        world,
        { userId: world.student.id },
        { intent: "delete-comment", commentId }
      );
    }

    const thread = (await view(world, { userId: world.admin.id })).comments;

    expect(thread).toMatchObject([
      {
        id: question.id,
        deleted: true,
        body: "",
        bodyHtml: "",
        editedAt: null,
        replies: [
          {
            body: "Because.",
            bodyHtml: "renderComment:Because.",
            author: {
              id: world.instructor.id,
              isInstructor: true,
              isAdmin: false,
            },
          },
        ],
      },
    ]);
  });

  it("drops a deleted reply and marks an admin's comment", async () => {
    const question = await ask(world.admin.id, "Read this");
    await ask(world.student.id, "Ok", question.id);
    const [withReply] = (await view(world, { userId: world.student.id }))
      .comments;
    await post(
      world,
      { userId: world.student.id },
      {
        intent: "delete-comment",
        commentId: withReply.replies[0].id,
      }
    );

    const [shown] = (await view(world, { userId: world.student.id })).comments;

    expect(shown).toMatchObject({
      deleted: false,
      bodyHtml: "renderComment:Read this",
      author: { id: world.admin.id, isAdmin: true, isInstructor: false },
      replies: [],
    });
  });
});
