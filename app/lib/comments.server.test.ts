import { beforeEach, describe, expect, it } from "vitest";
import { createTestDb, seedBaseData } from "~/test/setup";
import * as schema from "~/db/schema";
import {
  createLessonComment,
  deleteLessonComment,
  editLessonComment,
} from "./comments.server";
import { deliver, fakeNotifier } from "./notifications.server";

let db: ReturnType<typeof createTestDb>;
let base: ReturnType<typeof seedBaseData>;
let moduleId: number;
let lessonId: number;

function addLesson(title: string): number {
  return db
    .insert(schema.lessons)
    .values({ moduleId, title, position: 1 })
    .returning()
    .get().id;
}

beforeEach(() => {
  db = createTestDb();
  base = seedBaseData(db);
  moduleId = db
    .insert(schema.modules)
    .values({ courseId: base.course.id, title: "Basics", position: 1 })
    .returning()
    .get().id;
  lessonId = addLesson("Lesson 1");
});

describe("createLessonComment", () => {
  it("posts a Lesson Question with the body trimmed", () => {
    const question = createLessonComment(
      db,
      base.user.id,
      lessonId,
      null,
      "  How do generics work?  "
    );

    expect(question.body).toBe("How do generics work?");
    expect(question.parentId).toBeNull();
    expect(question.userId).toBe(base.user.id);
    expect(question.lessonId).toBe(lessonId);
  });

  it("refuses a body that is only whitespace", () => {
    expect(() =>
      createLessonComment(db, base.user.id, lessonId, null, "   \n ")
    ).toThrow("Comment cannot be empty");
  });

  it("accepts a body of exactly 5000 characters", () => {
    const question = createLessonComment(
      db,
      base.user.id,
      lessonId,
      null,
      "a".repeat(5000)
    );
    expect(question.body).toHaveLength(5000);
  });

  it("refuses a body longer than 5000 characters once trimmed", () => {
    expect(() =>
      createLessonComment(db, base.user.id, lessonId, null, "a".repeat(5001))
    ).toThrow("Comment must be 5000 characters or fewer");
  });

  it("refuses a Lesson Comment on a lesson that does not exist", () => {
    expect(() =>
      createLessonComment(db, base.user.id, lessonId + 999, null, "Hello")
    ).toThrow("Lesson not found");
  });

  it("posts a Lesson Reply under a Lesson Question on the same lesson", () => {
    const question = createLessonComment(
      db,
      base.user.id,
      lessonId,
      null,
      "Why?"
    );
    const reply = createLessonComment(
      db,
      base.instructor.id,
      lessonId,
      question.id,
      "Because."
    );
    expect(reply.parentId).toBe(question.id);
    expect(reply.body).toBe("Because.");
  });

  it("refuses a Lesson Reply whose parent does not exist", () => {
    expect(() =>
      createLessonComment(db, base.user.id, lessonId, 999, "Hello")
    ).toThrow("Parent comment not found");
  });

  it("refuses a Lesson Reply whose parent is on a different lesson", () => {
    const otherLessonId = addLesson("Lesson 2");
    const question = createLessonComment(
      db,
      base.user.id,
      otherLessonId,
      null,
      "Why?"
    );
    expect(() =>
      createLessonComment(
        db,
        base.instructor.id,
        lessonId,
        question.id,
        "Because."
      )
    ).toThrow("Parent comment belongs to a different lesson");
  });

  it("refuses a Lesson Reply to a Lesson Reply", () => {
    const question = createLessonComment(
      db,
      base.user.id,
      lessonId,
      null,
      "Why?"
    );
    const reply = createLessonComment(
      db,
      base.instructor.id,
      lessonId,
      question.id,
      "Because."
    );
    expect(() =>
      createLessonComment(db, base.user.id, lessonId, reply.id, "Thanks!")
    ).toThrow("Replies can only be one level deep");
  });
});

describe("deleteLessonComment", () => {
  const NOW = new Date("2026-10-06T12:00:00.000Z");
  const LATER = new Date("2026-10-07T12:00:00.000Z");

  it("lets the author soft-delete their Lesson Comment", () => {
    const question = createLessonComment(
      db,
      base.user.id,
      lessonId,
      null,
      "Why?"
    );
    const deleted = deleteLessonComment(
      db,
      question.id,
      base.user.id,
      false,
      NOW
    );
    expect(deleted.deletedAt).toBe("2026-10-06T12:00:00.000Z");
    expect(deleted.body).toBe("Why?");
  });

  it("lets staff delete someone else's Lesson Comment", () => {
    const question = createLessonComment(
      db,
      base.user.id,
      lessonId,
      null,
      "Why?"
    );
    const deleted = deleteLessonComment(
      db,
      question.id,
      base.instructor.id,
      true,
      NOW
    );
    expect(deleted.deletedAt).toBe("2026-10-06T12:00:00.000Z");
  });

  it("refuses anyone else who is not staff", () => {
    const question = createLessonComment(
      db,
      base.user.id,
      lessonId,
      null,
      "Why?"
    );
    expect(() =>
      deleteLessonComment(db, question.id, base.instructor.id, false, NOW)
    ).toThrow("You can only delete your own comments");
  });

  it("refuses a Lesson Comment that does not exist", () => {
    expect(() => deleteLessonComment(db, 999, base.user.id, true, NOW)).toThrow(
      "Comment not found"
    );
  });

  it("does nothing when the Lesson Comment is already deleted", () => {
    const question = createLessonComment(
      db,
      base.user.id,
      lessonId,
      null,
      "Why?"
    );
    deleteLessonComment(db, question.id, base.user.id, false, NOW);
    const again = deleteLessonComment(
      db,
      question.id,
      base.user.id,
      false,
      LATER
    );
    expect(again.deletedAt).toBe("2026-10-06T12:00:00.000Z");
  });
});

describe("editLessonComment", () => {
  const NOW = new Date("2026-10-06T12:00:00.000Z");

  it("lets the author change the body, trimmed, and marks it edited", () => {
    const question = createLessonComment(
      db,
      base.user.id,
      lessonId,
      null,
      "Why?"
    );
    const edited = editLessonComment(
      db,
      question.id,
      base.user.id,
      "  Why not?  ",
      NOW
    );
    expect(edited.body).toBe("Why not?");
    expect(edited.editedAt).toBe("2026-10-06T12:00:00.000Z");
  });

  it("applies the same body rules as posting", () => {
    const question = createLessonComment(
      db,
      base.user.id,
      lessonId,
      null,
      "Why?"
    );
    expect(() =>
      editLessonComment(db, question.id, base.user.id, "  ", NOW)
    ).toThrow("Comment cannot be empty");
  });

  it("refuses anyone but the author, staff included", () => {
    const question = createLessonComment(
      db,
      base.user.id,
      lessonId,
      null,
      "Why?"
    );
    expect(() =>
      editLessonComment(db, question.id, base.instructor.id, "Changed", NOW)
    ).toThrow("You can only edit your own comments");
  });

  it("refuses a deleted Lesson Comment", () => {
    const question = createLessonComment(
      db,
      base.user.id,
      lessonId,
      null,
      "Why?"
    );
    deleteLessonComment(db, question.id, base.user.id, false, NOW);
    expect(() =>
      editLessonComment(db, question.id, base.user.id, "Changed", NOW)
    ).toThrow("Comment has been deleted");
  });

  it("refuses a Lesson Comment that does not exist", () => {
    expect(() =>
      editLessonComment(db, 999, base.user.id, "Changed", NOW)
    ).toThrow("Comment not found");
  });
});

describe("lesson-question-posted Notifications", () => {
  const NOW = new Date("2026-10-06T12:00:00.000Z");

  function addPlatformAdmin() {
    return db
      .insert(schema.users)
      .values({
        name: "Pat Admin",
        email: "pat@example.com",
        role: schema.UserRole.Admin,
      })
      .returning()
      .get();
  }

  it("notifies nobody when the Instructor posts on their own lesson", async () => {
    const notifier = fakeNotifier();
    await deliver(
      createLessonComment(db, base.instructor.id, lessonId, null, "Note"),
      notifier
    );
    expect(notifier.sent).toEqual([]);
  });

  it("notifies nobody when a Platform Admin posts a Lesson Question", async () => {
    const admin = addPlatformAdmin();
    const notifier = fakeNotifier();
    await deliver(
      createLessonComment(db, admin.id, lessonId, null, "Heads up"),
      notifier
    );
    expect(notifier.sent).toEqual([]);
  });

  it("notifies the course's Instructor when a Student posts a Lesson Question", async () => {
    const notifier = fakeNotifier();
    const question = createLessonComment(
      db,
      base.user.id,
      lessonId,
      null,
      `How do   generics\nwork? ${"x".repeat(200)}`
    );
    await deliver(question, notifier);

    expect(notifier.sent).toEqual([
      {
        type: "lesson-question-posted",
        actor: { id: base.user.id, name: "Test User" },
        recipients: [{ id: base.instructor.id, name: "Test Instructor" }],
        data: {
          lessonQuestionId: question.id,
          authorName: "Test User",
          courseTitle: "Test Course",
          lessonTitle: "Lesson 1",
          excerpt: `How do generics work? ${"x".repeat(117)}…`,
          url: "/instructor/questions",
        },
      },
    ]);
  });

  it("creates no Notification when a Lesson Question is edited or deleted", () => {
    const question = createLessonComment(
      db,
      base.user.id,
      lessonId,
      null,
      "Why?"
    );
    const edited = editLessonComment(
      db,
      question.id,
      base.user.id,
      "Why not?",
      NOW
    );
    const deleted = deleteLessonComment(
      db,
      question.id,
      base.user.id,
      false,
      NOW
    );

    expect(edited).not.toHaveProperty("notify");
    expect(deleted).not.toHaveProperty("notify");
  });
});

describe("lesson-reply-posted Notifications", () => {
  it("notifies nobody when the author replies in their own thread", async () => {
    const question = createLessonComment(
      db,
      base.user.id,
      lessonId,
      null,
      "Why?"
    );
    const reply = createLessonComment(
      db,
      base.user.id,
      lessonId,
      question.id,
      "Never mind, I found it."
    );

    const notifier = fakeNotifier();
    await deliver(reply, notifier);

    expect(notifier.sent).toEqual([]);
  });

  it("notifies the Lesson Question's author when the Instructor replies", async () => {
    const question = createLessonComment(
      db,
      base.user.id,
      lessonId,
      null,
      "Why?"
    );
    const reply = createLessonComment(
      db,
      base.instructor.id,
      lessonId,
      question.id,
      "Because the compiler\n\nsays so."
    );

    const notifier = fakeNotifier();
    await deliver(reply, notifier);

    expect(notifier.sent).toEqual([
      {
        type: "lesson-reply-posted",
        actor: { id: base.instructor.id, name: "Test Instructor" },
        recipients: [{ id: base.user.id, name: "Test User" }],
        data: {
          replierName: "Test Instructor",
          lessonTitle: "Lesson 1",
          excerpt: "Because the compiler says so.",
          url: `/courses/test-course/lessons/${lessonId}#comment-${question.id}`,
        },
      },
    ]);
  });

  it("notifies the author when another Student replies, with the reply cut to an excerpt", async () => {
    const other = db
      .insert(schema.users)
      .values({
        name: "Priya Student",
        email: "priya@example.com",
        role: schema.UserRole.Student,
      })
      .returning()
      .get();
    const question = createLessonComment(
      db,
      base.user.id,
      lessonId,
      null,
      "Why?"
    );
    const reply = createLessonComment(
      db,
      other.id,
      lessonId,
      question.id,
      "x".repeat(300)
    );

    const notifier = fakeNotifier();
    await deliver(reply, notifier);

    expect(notifier.sent).toHaveLength(1);
    const [sent] = notifier.sent;
    expect(sent.actor).toEqual({ id: other.id, name: "Priya Student" });
    expect(sent.recipients).toEqual([{ id: base.user.id, name: "Test User" }]);
    expect(sent.data).toMatchObject({
      replierName: "Priya Student",
      excerpt: `${"x".repeat(139)}…`,
    });
  });

  it("notifies nobody about a Lesson Reply under a deleted Lesson Question", async () => {
    const question = createLessonComment(
      db,
      base.user.id,
      lessonId,
      null,
      "Why?"
    );
    deleteLessonComment(
      db,
      question.id,
      base.user.id,
      false,
      new Date("2026-10-06T12:00:00.000Z")
    );
    const reply = createLessonComment(
      db,
      base.instructor.id,
      lessonId,
      question.id,
      "Because."
    );

    const notifier = fakeNotifier();
    await deliver(reply, notifier);

    expect(notifier.sent).toEqual([]);
  });

  it("creates no Notification when a Lesson Reply is edited or deleted", async () => {
    const question = createLessonComment(
      db,
      base.user.id,
      lessonId,
      null,
      "Why?"
    );
    const reply = createLessonComment(
      db,
      base.instructor.id,
      lessonId,
      question.id,
      "Because."
    );

    const notifier = fakeNotifier();
    await deliver(
      editLessonComment(
        db,
        reply.id,
        base.instructor.id,
        "Because, as the docs say.",
        new Date("2026-10-06T12:00:00.000Z")
      ),
      notifier
    );
    await deliver(
      deleteLessonComment(
        db,
        reply.id,
        base.instructor.id,
        true,
        new Date("2026-10-07T12:00:00.000Z")
      ),
      notifier
    );

    expect(notifier.sent).toEqual([]);
  });
});
