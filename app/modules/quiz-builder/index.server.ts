import { data } from "react-router";

import { UserRole } from "~/db/schema";
import { parseFormData, parseParams } from "~/lib/validation";

import { requireInstructor, requireLessonInCourse } from "./lib/access.server";
import {
  getCourseById,
  getQuizByLessonId,
  getQuizWithQuestions,
} from "./lib/queries.server";
import { deleteQuizOfLesson, saveQuiz } from "./lib/save-quiz.server";
import { quizActionSchema, quizParametersSchema } from "./lib/schemas";

type RouteParameters = Record<string, string | undefined>;

// Entry point: the quiz builder page's data. Throws a 4xx response when the
// viewer may not edit this lesson's quiz.
export async function loadQuizBuilder(
  request: Request,
  params: RouteParameters
) {
  const { currentUserId, user } = await requireInstructor(request, {
    signedOut: "Select a user from the DevUI panel.",
    notInstructor: "Only instructors and admins can access this page.",
  });

  const courseId = Number.parseInt(params.courseId ?? "", 10);
  if (Number.isNaN(courseId)) {
    throw data("Invalid course ID.", { status: 400 });
  }

  const course = getCourseById(courseId);
  if (!course) {
    throw data("Course not found.", { status: 404 });
  }

  if (course.instructorId !== currentUserId && user.role !== UserRole.Admin) {
    throw data("You can only edit your own courses.", { status: 403 });
  }

  const lessonId = Number.parseInt(params.lessonId ?? "", 10);
  if (Number.isNaN(lessonId)) {
    throw data("Invalid lesson ID.", { status: 400 });
  }

  const { lesson, lessonModule } = requireLessonInCourse(lessonId, courseId);

  const existingQuizBasic = getQuizByLessonId(lessonId);
  const existingQuiz = existingQuizBasic
    ? getQuizWithQuestions(existingQuizBasic.id)
    : null;

  return { course, lesson, module: lessonModule, existingQuiz };
}

// Entry point: the quiz builder's form posts, "save-quiz" and "delete-quiz".
export async function runQuizBuilderAction(
  request: Request,
  params: RouteParameters
) {
  const { currentUserId, user } = await requireInstructor(request, {
    signedOut: "You must be logged in.",
    notInstructor: "Only instructors and admins can manage quizzes.",
  });

  const { courseId, lessonId } = parseParams(params, quizParametersSchema);

  const course = getCourseById(courseId);
  if (
    !course ||
    (course.instructorId !== currentUserId && user.role !== UserRole.Admin)
  ) {
    throw data("Course not found or not yours.", { status: 403 });
  }

  requireLessonInCourse(lessonId, courseId);

  const parsed = parseFormData(await request.formData(), quizActionSchema);
  if (!parsed.success) {
    return data(
      { error: Object.values(parsed.errors)[0] ?? "Invalid input." },
      { status: 400 }
    );
  }

  if (parsed.data.intent === "save-quiz") {
    return saveQuiz(lessonId, parsed.data.wizardData);
  }

  deleteQuizOfLesson(lessonId);
  return { success: true, deleted: true };
}
