import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { data } from "react-router";

import {
  comments,
  courses,
  lessonProgress,
  LessonProgressStatus,
  lessons,
  modules,
  quizAttempts,
  quizOptions,
  quizQuestions,
  quizzes,
  users,
  videoWatchEvents,
} from "~/db/schema";
import type { Database } from "~/lib/access.server";

export type { Database } from "~/lib/access.server";

export function getCourseBySlug(database: Database, slug: string) {
  return database.select().from(courses).where(eq(courses.slug, slug)).get();
}

/** The course's modules in order, each holding its lessons in order. */
export function getCurriculum(database: Database, courseId: number) {
  const courseModules = database
    .select()
    .from(modules)
    .where(eq(modules.courseId, courseId))
    .orderBy(modules.position)
    .all();

  const courseLessons = database
    .select()
    .from(lessons)
    .where(
      inArray(
        lessons.moduleId,
        courseModules.map((courseModule) => courseModule.id)
      )
    )
    .orderBy(lessons.position)
    .all();

  return courseModules.map((courseModule) => ({
    ...courseModule,
    lessons: courseLessons.filter(
      (lesson) => lesson.moduleId === courseModule.id
    ),
  }));
}

export function getLessonById(database: Database, id: number) {
  return database.select().from(lessons).where(eq(lessons.id, id)).get();
}

export function getModuleById(database: Database, id: number) {
  return database.select().from(modules).where(eq(modules.id, id)).get();
}

/**
 * Throws 404 unless the lesson is in the course, so content access to one
 * course can't reach a lesson in another by posting its id to this route.
 * Returns the lesson and its module.
 */
export function requireLessonInCourse(
  database: Database,
  lessonId: number,
  courseId: number
) {
  const lesson = getLessonById(database, lessonId);
  const lessonModule = lesson
    ? getModuleById(database, lesson.moduleId)
    : undefined;
  if (!lesson || lessonModule?.courseId !== courseId) {
    throw data("Lesson not found in this course", { status: 404 });
  }
  return { lesson, lessonModule };
}

export function getUserById(database: Database, id: number) {
  return database.select().from(users).where(eq(users.id, id)).get();
}

export function getCommentById(database: Database, commentId: number) {
  return database
    .select()
    .from(comments)
    .where(eq(comments.id, commentId))
    .get();
}

/** One student's lesson, as the progress and quiz queries take it. */
export interface StudentLesson {
  userId: number;
  lessonId: number;
}

function getLessonProgress(
  database: Database,
  { userId, lessonId }: StudentLesson
) {
  return database
    .select()
    .from(lessonProgress)
    .where(
      and(
        eq(lessonProgress.userId, userId),
        eq(lessonProgress.lessonId, lessonId)
      )
    )
    .get();
}

/** The student's progress status on every lesson of the course, by lesson id. */
export function getProgressByLesson(
  database: Database,
  userId: number,
  courseId: number
) {
  const rows = database
    .select({
      lessonId: lessonProgress.lessonId,
      status: lessonProgress.status,
    })
    .from(lessonProgress)
    .innerJoin(lessons, eq(lessonProgress.lessonId, lessons.id))
    .innerJoin(modules, eq(lessons.moduleId, modules.id))
    .where(
      and(eq(lessonProgress.userId, userId), eq(modules.courseId, courseId))
    )
    .all();

  return Object.fromEntries(
    rows.map((row) => [row.lessonId, row.status])
  ) as Record<number, string>;
}

export function markLessonComplete(
  database: Database,
  student: StudentLesson,
  now: Date
) {
  const completed = {
    status: LessonProgressStatus.Completed,
    completedAt: now.toISOString(),
  };
  const existing = getLessonProgress(database, student);

  if (existing) {
    database
      .update(lessonProgress)
      .set(completed)
      .where(eq(lessonProgress.id, existing.id))
      .run();
    return;
  }

  database
    .insert(lessonProgress)
    .values({ ...student, ...completed })
    .run();
}

/**
 * Marks the lesson in progress, unless the student already completed it.
 * Returns the student's status on it.
 */
export function markLessonInProgress(
  database: Database,
  student: StudentLesson
) {
  const existing = getLessonProgress(database, student);
  if (existing?.status === LessonProgressStatus.Completed) {
    return existing.status;
  }

  const inProgress = { status: LessonProgressStatus.InProgress };
  if (existing) {
    database
      .update(lessonProgress)
      .set(inProgress)
      .where(eq(lessonProgress.id, existing.id))
      .run();
  } else {
    database
      .insert(lessonProgress)
      .values({ ...student, ...inProgress })
      .run();
  }
  return inProgress.status;
}

/** Where the student last was in the video, and the furthest they got. */
export function getWatchPositions(
  database: Database,
  { userId, lessonId }: StudentLesson
) {
  const watchedThisLesson = and(
    eq(videoWatchEvents.userId, userId),
    eq(videoWatchEvents.lessonId, lessonId)
  );

  const lastEvent = database
    .select({ positionSeconds: videoWatchEvents.positionSeconds })
    .from(videoWatchEvents)
    .where(watchedThisLesson)
    .orderBy(desc(videoWatchEvents.createdAt))
    .limit(1)
    .get();

  const furthest = database
    .select({
      positionSeconds: sql<
        number | null
      >`max(${videoWatchEvents.positionSeconds})`,
    })
    .from(videoWatchEvents)
    .where(watchedThisLesson)
    .get();

  return {
    last: lastEvent?.positionSeconds ?? 0,
    furthest: furthest?.positionSeconds ?? 0,
  };
}

export function getQuizByLessonId(database: Database, lessonId: number) {
  return database
    .select()
    .from(quizzes)
    .where(eq(quizzes.lessonId, lessonId))
    .get();
}

/** The quiz's questions in order, each with its options. */
export function getQuizQuestions(database: Database, quizId: number) {
  const questions = database
    .select()
    .from(quizQuestions)
    .where(eq(quizQuestions.quizId, quizId))
    .orderBy(quizQuestions.position)
    .all();

  return questions.map((question) => ({
    ...question,
    options: database
      .select()
      .from(quizOptions)
      .where(eq(quizOptions.questionId, question.id))
      .all(),
  }));
}

export function getBestAttempt(
  database: Database,
  userId: number,
  quizId: number
) {
  return database
    .select()
    .from(quizAttempts)
    .where(
      and(eq(quizAttempts.userId, userId), eq(quizAttempts.quizId, quizId))
    )
    .orderBy(desc(quizAttempts.score))
    .limit(1)
    .get();
}
