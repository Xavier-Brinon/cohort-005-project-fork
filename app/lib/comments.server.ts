import { eq } from "drizzle-orm";
import { comments, lessons } from "~/db/schema";
import type { Db } from "~/lib/refunds.server";
import { MAX_COMMENT_LENGTH, MIN_COMMENT_LENGTH } from "~/lib/comments";

// ─── Lesson Comments ───
// Creating, editing and soft-deleting Lesson Questions and Lesson Replies.
// See GLOSSARY.md for the language. The lesson page and the Instructor's
// unanswered-questions page both go through here.
//
// Every function takes the database first, so tests can hand in an in-memory
// one. Rule breaks throw an Error whose message is shown to the person as-is.

export function findLessonComment(db: Db, commentId: number) {
  return db.select().from(comments).where(eq(comments.id, commentId)).get();
}

// The body is stored trimmed and must be 1–5000 characters once trimmed.
function validBody(body: string): string {
  const trimmed = body.trim();
  if (trimmed.length < MIN_COMMENT_LENGTH) {
    throw new Error("Comment cannot be empty");
  }
  if (trimmed.length > MAX_COMMENT_LENGTH) {
    throw new Error(
      `Comment must be ${MAX_COMMENT_LENGTH} characters or fewer`
    );
  }
  return trimmed;
}

export function createLessonComment(
  db: Db,
  authorId: number,
  lessonId: number,
  parentId: number | null,
  body: string
) {
  const trimmed = validBody(body);

  const lesson = db
    .select()
    .from(lessons)
    .where(eq(lessons.id, lessonId))
    .get();
  if (!lesson) {
    throw new Error("Lesson not found");
  }

  if (parentId !== null) {
    const parent = findLessonComment(db, parentId);
    if (!parent) {
      throw new Error("Parent comment not found");
    }
    if (parent.lessonId !== lessonId) {
      throw new Error("Parent comment belongs to a different lesson");
    }
    if (parent.parentId !== null) {
      throw new Error("Replies can only be one level deep");
    }
  }

  return db
    .insert(comments)
    .values({ userId: authorId, lessonId, parentId, body: trimmed })
    .returning()
    .get();
}

// Only the author or staff (Platform Admin or the course's Instructor) may
// delete. Deleting an already deleted Lesson Comment changes nothing.
export function deleteLessonComment(
  db: Db,
  commentId: number,
  userId: number,
  isStaff: boolean,
  now: Date
) {
  const existing = findLessonComment(db, commentId);
  if (!existing) {
    throw new Error("Comment not found");
  }
  if (existing.userId !== userId && !isStaff) {
    throw new Error("You can only delete your own comments");
  }
  if (existing.deletedAt !== null) {
    return existing;
  }

  return db
    .update(comments)
    .set({ deletedAt: now.toISOString() })
    .where(eq(comments.id, commentId))
    .returning()
    .get();
}

// Only the author may edit, and only while the Lesson Comment is not deleted.
export function editLessonComment(
  db: Db,
  commentId: number,
  userId: number,
  body: string,
  now: Date
) {
  const trimmed = validBody(body);

  const existing = findLessonComment(db, commentId);
  if (!existing) {
    throw new Error("Comment not found");
  }
  if (existing.deletedAt !== null) {
    throw new Error("Comment has been deleted");
  }
  if (existing.userId !== userId) {
    throw new Error("You can only edit your own comments");
  }

  return db
    .update(comments)
    .set({ body: trimmed, editedAt: now.toISOString() })
    .where(eq(comments.id, commentId))
    .returning()
    .get();
}
