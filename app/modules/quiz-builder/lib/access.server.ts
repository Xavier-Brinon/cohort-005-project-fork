import { data } from "react-router";

import { UserRole } from "~/db/schema";

import {
  type Database,
  getCourseById,
  getLessonById,
  getModuleById,
  getUserById,
} from "./queries.server";

interface AccessMessages {
  signedOut: string;
  notInstructor: string;
}

/** The signed-in instructor or admin, or a thrown 401 or 403 with `messages`. */
export function requireInstructor(
  database: Database,
  viewerId: number | null,
  messages: AccessMessages
) {
  if (viewerId === null) {
    throw data(messages.signedOut, { status: 401 });
  }

  const user = getUserById(database, viewerId);
  if (
    !user ||
    (user.role !== UserRole.Instructor && user.role !== UserRole.Admin)
  ) {
    throw data(messages.notInstructor, { status: 403 });
  }

  return user;
}

/** The course if `user` teaches it or is an admin, otherwise undefined. */
export function findOwnCourse(
  database: Database,
  user: { id: number; role: UserRole },
  courseId: number
) {
  const course = getCourseById(database, courseId);
  if (!course) return undefined;
  return course.instructorId === user.id || user.role === UserRole.Admin
    ? course
    : null;
}

/** The lesson and its module, or a thrown 404 if the lesson is not in the course. */
export function requireLessonInCourse(
  database: Database,
  lessonId: number,
  courseId: number
) {
  const lesson = getLessonById(database, lessonId);
  if (!lesson) {
    throw data("Lesson not found.", { status: 404 });
  }

  const lessonModule = getModuleById(database, lesson.moduleId);
  if (!lessonModule || lessonModule.courseId !== courseId) {
    throw data("Lesson not found in this course.", { status: 404 });
  }

  return { lesson, lessonModule };
}
