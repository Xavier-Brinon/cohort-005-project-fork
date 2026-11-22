import { beforeEach, describe, expect, it, vi } from "vitest";

import { MAX_NOTE_LENGTH } from "~/lib/notes";
import { seedEnrollment, seedUser } from "~/test/setup";

import {
  createWorld,
  NOW,
  post,
  rejectionOf,
  view,
  type World,
} from "./fixtures";

// Comment bodies go through renderComment, the sanitising renderer, which has
// its own tests. This stand-in marks its output, so a test can tell it was
// used, and keeps shiki out: under Stryker's test runner, shiki highlighters
// in several test files at once crashed the worker with SIGSEGV.
vi.mock("~/lib/comment-markdown.server", () => ({
  renderComment: async (body: string) => `renderComment:${body}`,
}));

let world: World;

beforeEach(() => {
  world = createWorld();
});

function asStudent(fields: Record<string, string | number>) {
  return post(world, { userId: world.student.id }, fields);
}

async function threadAs(userId: number) {
  return (await view(world, { userId })).comments;
}

describe("comments", () => {
  it("posts a question and notifies the instructor", async () => {
    expect(await asStudent({ intent: "create-comment", body: "Why?" })).toEqual(
      {
        ok: true,
      }
    );

    const [question] = await threadAs(world.student.id);
    expect(question).toMatchObject({
      body: "Why?",
      author: { id: world.student.id, isInstructor: false },
    });
    expect(world.notifier.sent).toMatchObject([
      {
        type: "lesson-question-posted",
        recipients: [{ id: world.instructor.id }],
      },
    ]);
  });

  it("posts a reply under its question", async () => {
    await asStudent({ intent: "create-comment", body: "Why?" });
    const [question] = await threadAs(world.student.id);

    await post(
      world,
      { userId: world.instructor.id },
      { intent: "create-comment", body: "Because.", parentId: question.id }
    );

    const [withReply] = await threadAs(world.student.id);
    expect(withReply.replies).toMatchObject([
      { body: "Because.", author: { isInstructor: true } },
    ]);
  });

  it("asks for a body when the form has none", async () => {
    expect(await asStudent({ intent: "create-comment" })).toEqual({
      ok: false,
      error: "Enter a comment before posting.",
    });
  });

  it("passes on the service's refusal", async () => {
    expect(await asStudent({ intent: "create-comment", body: "   " })).toEqual({
      ok: false,
      error: "Comment cannot be empty",
    });
  });

  it("edits the author's own comment", async () => {
    await asStudent({ intent: "create-comment", body: "Why?" });
    const [question] = await threadAs(world.student.id);

    expect(
      await asStudent({
        intent: "edit-comment",
        commentId: question.id,
        body: "How?",
      })
    ).toEqual({ ok: true });
    expect(await threadAs(world.student.id)).toMatchObject([
      { body: "How?", editedAt: NOW.toISOString() },
    ]);
  });

  it("refuses an edit with no body, and someone else's edit", async () => {
    await asStudent({ intent: "create-comment", body: "Why?" });
    const [question] = await threadAs(world.student.id);

    expect(
      await asStudent({ intent: "edit-comment", commentId: question.id })
    ).toEqual({
      ok: false,
      error: "Enter a comment before saving.",
    });
    expect(
      await post(
        world,
        { userId: world.instructor.id },
        { intent: "edit-comment", commentId: question.id, body: "Mine now" }
      )
    ).toEqual({ ok: false, error: "You can only edit your own comments" });
  });

  it("lets staff delete a student's comment, and blanks it", async () => {
    await asStudent({ intent: "create-comment", body: "Why?" });
    await asStudent({ intent: "create-comment", body: "And?" });
    const [first] = await threadAs(world.student.id);

    expect(
      await post(
        world,
        { userId: world.instructor.id },
        { intent: "delete-comment", commentId: first.id }
      )
    ).toEqual({ ok: true });
    expect(await threadAs(world.student.id)).toMatchObject([{ body: "And?" }]);
    expect(world.notifier.marked).toEqual([
      { type: "lesson-question-posted", subjectId: first.id },
    ]);
  });

  it("refuses to let another student delete a comment", async () => {
    await asStudent({ intent: "create-comment", body: "Why?" });
    const [question] = await threadAs(world.student.id);
    const classmate = seedUser(world.database, {
      name: "Kai",
      role: "student",
    });
    seedEnrollment(world.database, {
      userId: classmate.id,
      courseId: world.course.id,
    });

    expect(
      await post(
        world,
        { userId: classmate.id },
        { intent: "delete-comment", commentId: question.id }
      )
    ).toEqual({ ok: false, error: "You can only delete your own comments" });
    expect(
      await asStudent({ intent: "delete-comment", commentId: "x" })
    ).toEqual({
      ok: false,
      error: "Could not delete that comment.",
    });
  });

  it.each(["edit-comment", "delete-comment"])(
    "rejects %s on a comment that does not exist with 404",
    async (intent) => {
      expect(
        await rejectionOf(asStudent({ intent, commentId: 999, body: "Hm" }))
      ).toEqual({ status: 404, body: "Comment not found" });
    }
  );

  it.each(["edit-comment", "delete-comment"])(
    "rejects %s on a comment from another lesson with 404",
    async (intent) => {
      const otherLesson = {
        slug: world.otherCourse.slug,
        lessonId: world.otherLesson.id,
      };
      await post(
        world,
        { userId: world.instructor.id, ...otherLesson },
        { intent: "create-comment", body: "Elsewhere" }
      );
      const [elsewhere] = (
        await view(world, { userId: world.instructor.id, ...otherLesson })
      ).comments;

      expect(
        await rejectionOf(
          post(
            world,
            { userId: world.instructor.id },
            { intent, commentId: elsewhere.id, body: "Moved" }
          )
        )
      ).toEqual({ status: 404, body: "Comment not found" });
    }
  );
});

describe("bookmark and note", () => {
  it("toggles the bookmark on and off", async () => {
    expect(await asStudent({ intent: "toggle-bookmark" })).toEqual({
      ok: true,
      bookmarked: true,
    });
    expect((await view(world, { userId: world.student.id })).bookmarked).toBe(
      true
    );
    expect(await asStudent({ intent: "toggle-bookmark" })).toEqual({
      ok: true,
      bookmarked: false,
    });
  });

  it("saves the note, trimmed", async () => {
    expect(
      await asStudent({ intent: "save-note", body: "  Remember  " })
    ).toEqual({
      ok: true,
    });
    expect((await view(world, { userId: world.student.id })).note).toEqual({
      body: "Remember",
      updatedAt: NOW.toISOString(),
    });
  });

  it("explains why a note over the limit was not saved", async () => {
    expect(
      await asStudent({
        intent: "save-note",
        body: "x".repeat(MAX_NOTE_LENGTH + 1),
      })
    ).toEqual({
      ok: false,
      error: `Your note is over ${MAX_NOTE_LENGTH.toLocaleString("en")} characters, so it was not saved.`,
    });
  });

  it("explains why an empty note was not saved", async () => {
    expect(await asStudent({ intent: "save-note", body: "  " })).toEqual({
      ok: false,
      error: "Write something before saving your note.",
    });
  });
});

describe("marking a lesson complete", () => {
  it("completes a lesson the student is viewing", async () => {
    await view(world, { userId: world.student.id });
    expect(await asStudent({ intent: "mark-complete" })).toEqual({
      success: true,
    });

    const page = await view(world, { userId: world.student.id });
    expect(page.lessonStatus).toBe("completed");
    expect(page.lessonProgressMap).toEqual({ [world.lesson.id]: "completed" });
  });

  it("completes a lesson the student never opened", async () => {
    await asStudent({ intent: "mark-complete" });
    const page = await view(world, { userId: world.student.id });
    expect(page.lessonStatus).toBe("completed");
  });
});
