import { data } from "react-router";

import {
  type Access,
  type Database,
  resolveAccess,
  type Viewer,
} from "~/lib/access.server";
import { isBookmarked } from "~/lib/bookmarks.server";
import { renderMarkdown } from "~/lib/markdown.server";
import { getNote } from "~/lib/notes.server";

import {
  getBestAttempt,
  getCourseBySlug,
  getCurriculum,
  getProgressByLesson,
  getQuizByLessonId,
  getQuizQuestions,
  getUserById,
  getWatchPositions,
  markLessonInProgress,
  requireLessonInCourse,
} from "./queries.server";
import { getRenderedThread } from "./thread.server";

export type { Database } from "~/lib/access.server";
export type { Viewer } from "~/lib/access.server";

/** Who is asking and the route's parameters. */
export interface LessonPageRequest {
  viewer: Viewer;
  params: Record<string, string | undefined>;
}

type Lesson = ReturnType<typeof requireLessonInCourse>["lesson"];
type Curriculum = ReturnType<typeof getCurriculum>;

/** The previous and next lessons across the whole course, in order. */
function findNeighbours(curriculum: Curriculum, lessonId: number) {
  const flat = curriculum.flatMap((courseModule) =>
    courseModule.lessons.map((lesson) => ({
      id: lesson.id,
      title: lesson.title,
      moduleId: courseModule.id,
      moduleTitle: courseModule.title,
    }))
  );
  const index = flat.findIndex((lesson) => lesson.id === lessonId);
  return {
    prevLesson: flat[index - 1] ?? null,
    nextLesson: flat[index + 1] ?? null,
  };
}

/**
 * An enrolled student's progress: viewing the lesson marks it in progress.
 * Everyone else gets no progress and records nothing.
 */
function loadProgress(
  database: Database,
  access: Access,
  { lesson, courseId }: { lesson: Lesson; courseId: number }
) {
  if (!access.userId || !access.enrolled) {
    return {
      lessonStatus: null,
      lessonProgressMap: {},
      lastWatchPosition: 0,
      watchProgress: 0,
    };
  }

  const student = { userId: access.userId, lessonId: lesson.id };
  const lessonStatus = markLessonInProgress(database, student);
  const videoSeconds = (lesson.durationMinutes ?? 0) * 60;
  const watched = lesson.videoUrl
    ? getWatchPositions(database, student)
    : { last: 0, furthest: 0 };

  return {
    lessonStatus,
    lessonProgressMap: getProgressByLesson(database, access.userId, courseId),
    lastWatchPosition: watched.last,
    watchProgress:
      videoSeconds > 0
        ? Math.min(Math.round((watched.furthest / videoSeconds) * 100), 100)
        : 0,
  };
}

/**
 * The lesson's quiz without the answers (isCorrect stays on the server), and
 * the viewer's best attempt at it.
 */
function loadQuiz(database: Database, userId: number | null, lessonId: number) {
  const quiz = getQuizByLessonId(database, lessonId);
  if (!quiz) return { quiz: null, bestAttempt: null };

  const questions = getQuizQuestions(database, quiz.id).map((question) => ({
    id: question.id,
    questionText: question.questionText,
    questionType: question.questionType,
    position: question.position,
    options: question.options.map(({ id, optionText }) => ({ id, optionText })),
  }));
  const best = userId ? getBestAttempt(database, userId, quiz.id) : undefined;

  return {
    quiz: {
      id: quiz.id,
      title: quiz.title,
      passingScore: quiz.passingScore,
      questions,
    },
    bestAttempt: best ? { score: best.score, passed: best.passed } : null,
  };
}

/**
 * The student's own Bookmark and Note on this lesson, and the discussion,
 * behind the content-access bar. A signed-out visitor gets none of them.
 */
async function loadPrivateContent(
  database: Database,
  access: Access,
  { lessonId, instructorId }: { lessonId: number; instructorId: number }
) {
  // Only a signed-in user can view content, so a reader always has an id.
  const readerId = access.canViewContent ? access.userId : null;
  if (readerId === null) {
    return { comments: [], bookmarked: false, note: null };
  }

  const note = getNote(database, readerId, lessonId);
  return {
    comments: await getRenderedThread(database, lessonId, instructorId),
    bookmarked: isBookmarked(database, readerId, lessonId),
    note: note ? { body: note.body, updatedAt: note.updatedAt } : null,
  };
}

function requireCourseAndLesson(
  database: Database,
  params: LessonPageRequest["params"]
) {
  const lessonId = Number(params.lessonId);
  if (Number.isNaN(lessonId)) {
    throw data("Invalid lesson ID", { status: 400 });
  }
  const course = getCourseBySlug(database, String(params.slug));
  if (!course) {
    throw data("Course not found", { status: 404 });
  }
  return { course, ...requireLessonInCourse(database, lessonId, course.id) };
}

/**
 * The lesson page's data. Anyone may load it: without content access it is
 * the paywall preview, with no discussion, notes or progress.
 */
export async function getLessonPage(
  database: Database,
  { viewer, params }: LessonPageRequest
) {
  const { course, lesson, lessonModule } = requireCourseAndLesson(
    database,
    params
  );
  const access = resolveAccess(database, viewer, course.id);
  const curriculum = getCurriculum(database, course.id);

  return {
    course: { id: course.id, title: course.title, slug: course.slug },
    curriculum: curriculum.map((courseModule) => ({
      id: courseModule.id,
      title: courseModule.title,
      lessons: courseModule.lessons.map(({ id, title }) => ({ id, title })),
    })),
    module: { id: lessonModule.id, title: lessonModule.title },
    lesson,
    contentHtml: lesson.content ? await renderMarkdown(lesson.content) : null,
    enrolled: access.enrolled,
    currentUserId: access.userId,
    ...findNeighbours(curriculum, lesson.id),
    ...loadProgress(database, access, { lesson, courseId: course.id }),
    ...loadQuiz(database, access.userId, lesson.id),
    ...(await loadPrivateContent(database, access, {
      lessonId: lesson.id,
      instructorId: course.instructorId,
    })),
    pppBlocked: access.pppBlocked,
    pppBlockedCountry: access.pppBlockedCountry,
    pppPurchaseCountry: access.pppPurchaseCountry,
    canViewContent: access.canViewContent,
    canModerate: access.isStaff,
    instructorName:
      getUserById(database, course.instructorId)?.name ?? "your instructor",
  };
}
