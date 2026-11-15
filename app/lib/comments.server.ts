import { eq } from "drizzle-orm";
import {
  comments,
  courses,
  lessons,
  modules,
  UserRole,
  type users,
} from "~/db/schema";
import type { Db } from "~/db";
import { MAX_COMMENT_LENGTH, MIN_COMMENT_LENGTH } from "~/lib/comments";
import {
  excerpt,
  type Deliverable,
  type MarkReadIntent,
  type NotifyIntent,
} from "~/lib/notifications.server";
import { findPerson, toPerson } from "~/lib/people.server";

type LessonComment = typeof comments.$inferSelect;
type User = typeof users.$inferSelect;

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

  const lessonCourse = findLessonCourse(db, lessonId);
  if (!lessonCourse) {
    throw new Error("Lesson not found");
  }

  let parent: LessonComment | undefined;
  if (parentId !== null) {
    parent = findLessonComment(db, parentId);
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

  const comment = db
    .insert(comments)
    .values({ userId: authorId, lessonId, parentId, body: trimmed })
    .returning()
    .get();

  // Notification intents for `deliver`, to hand over after the write. A
  // Lesson Question's Notification was already marked read when it was
  // deleted, so answering it afterwards marks nothing.
  const notify: NotifyIntent[] = parent
    ? lessonReplyPosted(db, comment, parent, lessonCourse)
    : lessonQuestionPosted(db, comment, lessonCourse);
  const markRead: MarkReadIntent[] =
    parent &&
    parent.deletedAt === null &&
    isAnswerer(findPerson(db, authorId), lessonCourse)
      ? [{ type: "lesson-question-posted", subjectId: parent.id }]
      : [];

  return { ...comment, notify, markRead };
}

type LessonCourse = NonNullable<ReturnType<typeof findLessonCourse>>;

// A lesson with the course it belongs to.
function findLessonCourse(db: Db, lessonId: number) {
  return db
    .select({
      lessonTitle: lessons.title,
      courseTitle: courses.title,
      courseSlug: courses.slug,
      instructorId: courses.instructorId,
    })
    .from(lessons)
    .innerJoin(modules, eq(modules.id, lessons.moduleId))
    .innerJoin(courses, eq(courses.id, modules.courseId))
    .where(eq(lessons.id, lessonId))
    .get();
}

// The course's Instructor and every Platform Admin answer its Lesson
// Questions: a Lesson Reply from them answers the Lesson Question, and a
// Lesson Question from them never waits for an answer (see
// `getUnansweredQuestions` in instructor.questions.tsx).
function isAnswerer(
  person: { id: number; role: User["role"] } | undefined,
  lessonCourse: LessonCourse
): boolean {
  if (!person) return false;
  return (
    person.role === UserRole.Admin || person.id === lessonCourse.instructorId
  );
}

// A Lesson Reply tells the Lesson Question's author, whichever page it was
// posted from. Nobody hears about a reply under a deleted Lesson Question,
// and `deliver` drops the author replying in their own thread.
function lessonReplyPosted(
  db: Db,
  reply: LessonComment,
  question: LessonComment,
  lessonCourse: LessonCourse
): NotifyIntent[] {
  if (question.deletedAt !== null) return [];

  const replier = findPerson(db, reply.userId);
  const author = findPerson(db, question.userId);
  if (!replier || !author) return [];

  return [
    {
      type: "lesson-reply-posted",
      actor: toPerson(replier),
      recipients: [toPerson(author)],
      data: {
        replierName: replier.name,
        lessonTitle: lessonCourse.lessonTitle,
        excerpt: excerpt(reply.body),
        url: `/courses/${lessonCourse.courseSlug}/lessons/${reply.lessonId}#comment-${question.id}`,
      },
    },
  ];
}

// The course's Instructor hears of a Lesson Question only when it enters
// their unanswered-questions queue: not when an answerer posted it.
function lessonQuestionPosted(
  db: Db,
  question: LessonComment,
  lessonCourse: LessonCourse
): NotifyIntent[] {
  const author = findPerson(db, question.userId);
  if (!author || isAnswerer(author, lessonCourse)) return [];

  const instructor = findPerson(db, lessonCourse.instructorId);
  if (!instructor) return [];

  return [
    {
      type: "lesson-question-posted",
      actor: toPerson(author),
      recipients: [toPerson(instructor)],
      data: {
        lessonQuestionId: question.id,
        authorName: author.name,
        courseTitle: lessonCourse.courseTitle,
        lessonTitle: lessonCourse.lessonTitle,
        excerpt: excerpt(question.body),
        url: "/instructor/questions",
      },
    },
  ];
}

// Only the author, a Platform Admin or the course's Instructor may delete.
// Deleting an already deleted Lesson Comment changes nothing. Deleting
// notifies nobody.
export function deleteLessonComment(
  db: Db,
  commentId: number,
  userId: number,
  isStaff: boolean,
  now: Date
): LessonComment & Deliverable {
  const existing = findLessonComment(db, commentId);
  if (!existing) {
    throw new Error("Comment not found");
  }
  if (existing.userId !== userId && !isStaff) {
    throw new Error("You can only delete your own comments");
  }
  if (existing.deletedAt !== null) {
    return { ...existing, markRead: [] };
  }

  const deleted = db
    .update(comments)
    .set({ deletedAt: now.toISOString() })
    .where(eq(comments.id, commentId))
    .returning()
    .get();

  // A deleted Lesson Question needs no answer. Deleting a Lesson Reply marks
  // nothing, and never marks a Notification unread.
  const markRead: MarkReadIntent[] =
    deleted.parentId === null
      ? [{ type: "lesson-question-posted", subjectId: deleted.id }]
      : [];

  return { ...deleted, markRead };
}

// Only the author may edit, and only while the Lesson Comment is not deleted.
// Editing notifies nobody.
export function editLessonComment(
  db: Db,
  commentId: number,
  userId: number,
  body: string,
  now: Date
): LessonComment & Deliverable {
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
