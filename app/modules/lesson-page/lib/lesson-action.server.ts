import { data } from "react-router";

import {
  type Access,
  assertContentAccess,
  type Database,
  resolveAccess,
} from "~/lib/access.server";
import { toggleBookmark } from "~/lib/bookmarks.server";
import {
  createComment,
  deleteComment,
  editComment,
} from "~/lib/comments.server";
import { saveNote } from "~/lib/notes.server";
import type { Notifications } from "~/lib/notifications.port";
import { parseFormData, parseParams } from "~/lib/validation";

import type { LessonPageRequest } from "./lesson-page.server";
import {
  getCommentById,
  getCourseBySlug,
  getQuizByLessonId,
  markLessonComplete,
  requireLessonInCourse,
} from "./queries.server";
import { readSelectedAnswers, scoreQuiz } from "./quiz-scoring.server";
import {
  createCommentSchema,
  deleteCommentSchema,
  editCommentSchema,
  lessonParametersSchema,
  saveNoteSchema,
} from "./schemas";

/** A lesson page post: who, where, when, and how to notify people. */
export interface LessonActionRequest extends LessonPageRequest {
  now: Date;
  notifications: Notifications;
}

/** Everything an intent needs once access to the lesson is checked. */
interface LessonPost {
  database: Database;
  request: LessonActionRequest;
  access: Access & { userId: number };
  lessonId: number;
  formData: FormData;
}

/** Throws 404 unless the comment is on this lesson. */
function requireCommentOnLesson(post: LessonPost, commentId: number) {
  const comment = getCommentById(post.database, commentId);
  if (comment?.lessonId !== post.lessonId) {
    throw data("Comment not found", { status: 404 });
  }
}

async function createLessonComment(post: LessonPost) {
  const parsed = parseFormData(post.formData, createCommentSchema);
  if (!parsed.success) {
    return { ok: false, error: "Enter a comment before posting." };
  }
  const created = await createComment(
    post.database,
    post.access.userId,
    post.lessonId,
    parsed.data.parentId ?? null,
    parsed.data.body,
    post.request.now,
    post.request.notifications
  );
  return created.ok ? { ok: true } : created;
}

function editLessonComment(post: LessonPost) {
  const parsed = parseFormData(post.formData, editCommentSchema);
  if (!parsed.success) {
    return { ok: false, error: "Enter a comment before saving." };
  }
  requireCommentOnLesson(post, parsed.data.commentId);
  const edited = editComment(
    post.database,
    parsed.data.commentId,
    post.access.userId,
    parsed.data.body,
    post.request.now
  );
  return edited.ok ? { ok: true } : edited;
}

async function deleteLessonComment(post: LessonPost) {
  const parsed = parseFormData(post.formData, deleteCommentSchema);
  if (!parsed.success) {
    return { ok: false, error: "Could not delete that comment." };
  }
  requireCommentOnLesson(post, parsed.data.commentId);
  const deleted = await deleteComment(
    post.database,
    parsed.data.commentId,
    post.access.userId,
    post.access.isStaff,
    post.request.now,
    post.request.notifications
  );
  return deleted.ok ? { ok: true } : deleted;
}

function saveLessonNote(post: LessonPost) {
  const parsed = parseFormData(post.formData, saveNoteSchema);
  if (!parsed.success) {
    return { ok: false, error: parsed.errors.body };
  }
  const saved = saveNote(
    post.database,
    post.access.userId,
    post.lessonId,
    parsed.data.body,
    post.request.now
  );
  return saved.ok ? { ok: true } : saved;
}

function submitQuiz(post: LessonPost) {
  const quizId = Number(post.formData.get("quizId"));
  if (Number.isNaN(quizId)) {
    throw data("Invalid quiz ID", { status: 400 });
  }
  // Only this lesson's quiz: scoring another one would reveal its answers.
  if (getQuizByLessonId(post.database, post.lessonId)?.id !== quizId) {
    throw data("Quiz not found", { status: 404 });
  }
  const quizResult = scoreQuiz(
    post.database,
    { userId: post.access.userId, quizId },
    readSelectedAnswers(post.formData)
  );
  return { quizResult };
}

function runIntent(post: LessonPost) {
  const intent = post.formData.get("intent");
  switch (intent) {
    case "create-comment": {
      return createLessonComment(post);
    }
    case "edit-comment": {
      return editLessonComment(post);
    }
    case "delete-comment": {
      return deleteLessonComment(post);
    }
    case "toggle-bookmark": {
      const { database, access, lessonId, request } = post;
      const student = access.userId;
      return {
        ok: true,
        bookmarked: toggleBookmark(database, student, lessonId, request.now),
      };
    }
    case "save-note": {
      return saveLessonNote(post);
    }
    case "mark-complete": {
      const student = { userId: post.access.userId, lessonId: post.lessonId };
      markLessonComplete(post.database, student, post.request.now);
      return { success: true };
    }
    case "submit-quiz": {
      return submitQuiz(post);
    }
    default: {
      throw data("Invalid action", { status: 400 });
    }
  }
}

/**
 * The lesson page's form posts. Every intent reads or writes this lesson for
 * the viewer, so each needs content access to the course in the URL, and the
 * lesson must be in that course: access to one course must not reach another
 * course's lessons by posting their ids here.
 */
export async function applyLessonAction(
  database: Database,
  request: LessonActionRequest,
  formData: FormData
) {
  const { slug, lessonId } = parseParams(
    request.params,
    lessonParametersSchema
  );
  const course = getCourseBySlug(database, slug);
  if (!course) {
    throw data("Course not found", { status: 404 });
  }
  if (!request.viewer.userId) {
    throw data("You must be logged in", { status: 401 });
  }

  const access = assertContentAccess(
    resolveAccess(database, request.viewer, course.id)
  );
  requireLessonInCourse(database, lessonId, course.id);

  return runIntent({
    database,
    request,
    access: { ...access, userId: request.viewer.userId },
    lessonId,
    formData,
  });
}
