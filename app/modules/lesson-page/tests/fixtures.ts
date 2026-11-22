import { fakeNotifier } from "~/lib/notifications.server";
import {
  createTestDb,
  seedBaseData,
  seedCourse,
  seedEnrollment,
  seedLesson,
  seedUser,
  type TestDb,
} from "~/test/setup";

import {
  applyLessonAction,
  getLessonPage,
  type LessonActionRequest,
} from "../lesson-page.server";

export const NOW = new Date(2026, 10, 22, 9, 0, 0);

/**
 * A course with one lesson, and a student enrolled in it; another course by
 * the same instructor with its own lesson; an admin; and a signed-in
 * outsider enrolled in nothing.
 */
export function createWorld() {
  const database = createTestDb();
  const base = seedBaseData(database);
  const lesson = seedLesson(database, base.course.id);
  const otherCourse = seedCourse(database, {
    slug: "other-course",
    instructorId: base.instructor.id,
    categoryId: base.category.id,
  });
  const otherLesson = seedLesson(database, otherCourse.id);
  seedEnrollment(database, { userId: base.user.id, courseId: base.course.id });

  return {
    database,
    ...base,
    student: base.user,
    lesson,
    otherCourse,
    otherLesson,
    admin: seedUser(database, { name: "Ada", role: "admin" }),
    outsider: seedUser(database, { name: "Olu", role: "student" }),
    notifier: fakeNotifier(),
  };
}

export type World = ReturnType<typeof createWorld>;

export interface Visit {
  userId: number | null;
  lessonId?: number | string;
  slug?: string;
  country?: string | null;
}

export function requestFor(world: World, visit: Visit): LessonActionRequest {
  return {
    viewer: { userId: visit.userId, country: visit.country ?? null },
    params: {
      slug: visit.slug ?? world.course.slug,
      lessonId: String(visit.lessonId ?? world.lesson.id),
    },
    now: NOW,
    notifier: world.notifier,
  };
}

export function form(fields: Record<string, string | number>) {
  const formData = new FormData();
  for (const [name, value] of Object.entries(fields)) {
    formData.set(name, String(value));
  }
  return formData;
}

/** Posts `fields` to the lesson page as `visit` describes. */
export function post(
  world: World,
  visit: Visit,
  fields: Record<string, string | number>
) {
  return applyLessonAction(
    world.database,
    requestFor(world, visit),
    form(fields)
  );
}

/** Loads the lesson page as `visit` describes. */
export function view(world: World, visit: Visit) {
  return getLessonPage(world.database, requestFor(world, visit));
}

/** The status and body of a react-router data() response a promise threw. */
export async function rejectionOf(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (error) {
    const { data, init } = error as { data: unknown; init: ResponseInit };
    return { status: init.status, body: data };
  }
  throw new Error("expected a thrown response");
}

export type { TestDb };
