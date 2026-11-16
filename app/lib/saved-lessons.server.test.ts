import { describe, it, expect, beforeEach } from "vitest";
import { createTestDb, seedBaseData } from "~/test/setup";
import * as schema from "~/db/schema";
import {
  MAX_NOTE_LENGTH,
  getNote,
  isBookmarked,
  listBookmarks,
  listNotes,
  saveNote,
  toggleBookmark,
} from "./saved-lessons.server";

type TestDb = ReturnType<typeof createTestDb>;

const EARLIER = new Date(2026, 9, 6, 12, 0, 0);
const LATER = new Date(2026, 9, 7, 9, 30, 0);

let db: TestDb;
let base: ReturnType<typeof seedBaseData>;
let firstLessonId: number;
let secondLessonId: number;

beforeEach(() => {
  db = createTestDb();
  base = seedBaseData(db);

  const module = db
    .insert(schema.modules)
    .values({ courseId: base.course.id, title: "Basics", position: 1 })
    .returning()
    .get();

  [firstLessonId, secondLessonId] = db
    .insert(schema.lessons)
    .values([
      { moduleId: module.id, title: "Lesson 1", position: 1 },
      { moduleId: module.id, title: "Lesson 2", position: 2 },
    ])
    .returning()
    .all()
    .map((lesson) => lesson.id);
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

describe("bookmarking a Lesson", () => {
  it("adds a Bookmark on the first press and removes it on the second", () => {
    expect(toggleBookmark(db, base.user.id, firstLessonId, EARLIER)).toBe(true);
    expect(isBookmarked(db, base.user.id, firstLessonId)).toBe(true);

    expect(toggleBookmark(db, base.user.id, firstLessonId, LATER)).toBe(false);
    expect(isBookmarked(db, base.user.id, firstLessonId)).toBe(false);
  });

  it("never leaves two Bookmarks on the same Lesson", () => {
    toggleBookmark(db, base.user.id, firstLessonId, EARLIER);
    toggleBookmark(db, base.user.id, firstLessonId, EARLIER);
    toggleBookmark(db, base.user.id, firstLessonId, EARLIER);

    expect(listBookmarks(db, base.user.id)).toHaveLength(1);
  });

  it("is refused by the database when a second row is forced in", () => {
    toggleBookmark(db, base.user.id, firstLessonId, EARLIER);

    expect(() =>
      db
        .insert(schema.bookmarks)
        .values({ userId: base.user.id, lessonId: firstLessonId })
        .run()
    ).toThrow(/UNIQUE/);
  });
});

describe("saving a Note", () => {
  it("creates the Note, trimmed, on a Lesson with none", () => {
    const result = saveNote(db, base.user.id, firstLessonId, "  # not a heading  ", EARLIER);

    expect(result).toEqual({
      ok: true,
      note: { body: "# not a heading", updatedAt: EARLIER.toISOString() },
    });
    expect(getNote(db, base.user.id, firstLessonId)).toEqual({
      body: "# not a heading",
      updatedAt: EARLIER.toISOString(),
    });
  });

  it("replaces the body and moves the last-edited time on when saved again", () => {
    saveNote(db, base.user.id, firstLessonId, "first draft", EARLIER);
    saveNote(db, base.user.id, firstLessonId, "second draft", LATER);

    expect(getNote(db, base.user.id, firstLessonId)).toEqual({
      body: "second draft",
      updatedAt: LATER.toISOString(),
    });
    const rows = db.select().from(schema.notes).all();
    expect(rows).toHaveLength(1);
    expect(rows[0].createdAt).toBe(EARLIER.toISOString());
  });

  it("removes the Note when saved empty", () => {
    saveNote(db, base.user.id, firstLessonId, "something", EARLIER);

    expect(saveNote(db, base.user.id, firstLessonId, "   ", LATER)).toEqual({
      ok: true,
      note: null,
    });
    expect(getNote(db, base.user.id, firstLessonId)).toBeUndefined();
  });

  it("accepts a Note of exactly 2,000 characters", () => {
    const result = saveNote(db, base.user.id, firstLessonId, "a".repeat(MAX_NOTE_LENGTH), EARLIER);

    expect(result.ok).toBe(true);
  });

  it("refuses a Note over 2,000 characters and keeps the old one", () => {
    saveNote(db, base.user.id, firstLessonId, "keep me", EARLIER);

    const result = saveNote(
      db,
      base.user.id,
      firstLessonId,
      "a".repeat(MAX_NOTE_LENGTH + 1),
      LATER
    );

    expect(result).toEqual({
      ok: false,
      error: "A note can be at most 2,000 characters.",
    });
    expect(getNote(db, base.user.id, firstLessonId)?.body).toBe("keep me");
  });
});

describe("the Saved lists", () => {
  it("hold only the Student's own rows, newest first, with Lesson and Course", () => {
    const other = addStudent("Priya");
    toggleBookmark(db, base.user.id, firstLessonId, EARLIER);
    toggleBookmark(db, base.user.id, secondLessonId, LATER);
    toggleBookmark(db, other.id, firstLessonId, LATER);
    saveNote(db, base.user.id, secondLessonId, "older", EARLIER);
    saveNote(db, base.user.id, firstLessonId, "newer", LATER);
    saveNote(db, other.id, firstLessonId, "not yours", LATER);

    expect(listBookmarks(db, base.user.id)).toMatchObject([
      { lessonId: secondLessonId, lessonTitle: "Lesson 2", courseTitle: "Test Course", courseSlug: "test-course" },
      { lessonId: firstLessonId, lessonTitle: "Lesson 1", courseTitle: "Test Course", courseSlug: "test-course" },
    ]);
    expect(listNotes(db, base.user.id)).toMatchObject([
      { lessonId: firstLessonId, body: "newer", courseTitle: "Test Course" },
      { lessonId: secondLessonId, body: "older", courseTitle: "Test Course" },
    ]);
  });

  it("put a re-edited Note back at the top", () => {
    saveNote(db, base.user.id, firstLessonId, "one", EARLIER);
    saveNote(db, base.user.id, secondLessonId, "two", EARLIER);
    saveNote(db, base.user.id, firstLessonId, "one, edited", LATER);

    expect(listNotes(db, base.user.id).map((note) => note.body)).toEqual([
      "one, edited",
      "two",
    ]);
  });
});
