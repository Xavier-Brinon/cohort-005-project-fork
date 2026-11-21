import { data } from "react-router";

import { UserRole } from "~/db/schema";
import { getCurrentUserId } from "~/lib/session";

import { getLessonById, getModuleById, getUserById } from "./queries.server";

interface AccessMessages {
  signedOut: string;
  notInstructor: string;
}

/** The signed-in instructor or admin, or a thrown 401 or 403 with `messages`. */
export async function requireInstructor(
  request: Request,
  messages: AccessMessages
) {
  const currentUserId = await getCurrentUserId(request);

  if (!currentUserId) {
    throw data(messages.signedOut, { status: 401 });
  }

  const user = getUserById(currentUserId);
  if (
    !user ||
    (user.role !== UserRole.Instructor && user.role !== UserRole.Admin)
  ) {
    throw data(messages.notInstructor, { status: 403 });
  }

  return { currentUserId, user };
}

/** The lesson and its module, or a thrown 404 if the lesson is not in the course. */
export function requireLessonInCourse(lessonId: number, courseId: number) {
  const lesson = getLessonById(lessonId);
  if (!lesson) {
    throw data("Lesson not found.", { status: 404 });
  }

  const lessonModule = getModuleById(lesson.moduleId);
  if (!lessonModule || lessonModule.courseId !== courseId) {
    throw data("Lesson not found in this course.", { status: 404 });
  }

  return { lesson, lessonModule };
}
