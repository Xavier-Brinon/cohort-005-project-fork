import { data } from "react-router";

import { parseFormData, parseParams } from "~/lib/validation";

import {
  findOwnCourse,
  requireInstructor,
  requireLessonInCourse,
} from "./access.server";
import {
  type Database,
  getQuizByLessonId,
  getQuizWithQuestions,
} from "./queries.server";
import { deleteQuizOfLesson, saveQuiz } from "./save-quiz.server";
import { quizActionSchema, quizParametersSchema } from "./schemas";

export type { Database } from "./queries.server";

/** Who is asking (null when signed out) and the route's parameters. */
export interface QuizBuilderRequest {
  viewerId: number | null;
  params: Record<string, string | undefined>;
}

function parseId(value: string | undefined, message: string) {
  const id = Number.parseInt(String(value), 10);
  if (Number.isNaN(id)) {
    throw data(message, { status: 400 });
  }
  return id;
}

/**
 * The quiz builder page's data. Throws a 4xx response when the viewer may not
 * edit this lesson's quiz.
 */
export function getQuizBuilder(
  database: Database,
  { viewerId, params }: QuizBuilderRequest
) {
  const user = requireInstructor(database, viewerId, {
    signedOut: "Select a user from the DevUI panel.",
    notInstructor: "Only instructors and admins can access this page.",
  });

  const courseId = parseId(params.courseId, "Invalid course ID.");
  const course = findOwnCourse(database, user, courseId);
  if (course === undefined) {
    throw data("Course not found.", { status: 404 });
  }
  if (course === null) {
    throw data("You can only edit your own courses.", { status: 403 });
  }

  const lessonId = parseId(params.lessonId, "Invalid lesson ID.");
  const { lesson, lessonModule } = requireLessonInCourse(
    database,
    lessonId,
    courseId
  );

  const quiz = getQuizByLessonId(database, lessonId);
  const existingQuiz = quiz ? getQuizWithQuestions(database, quiz) : null;

  return { course, lesson, module: lessonModule, existingQuiz };
}

/** The quiz builder's form posts, "save-quiz" and "delete-quiz". */
export function applyQuizBuilderAction(
  database: Database,
  { viewerId, params }: QuizBuilderRequest,
  formData: FormData
) {
  const user = requireInstructor(database, viewerId, {
    signedOut: "You must be logged in.",
    notInstructor: "Only instructors and admins can manage quizzes.",
  });

  const { courseId, lessonId } = parseParams(params, quizParametersSchema);

  if (!findOwnCourse(database, user, courseId)) {
    throw data("Course not found or not yours.", { status: 403 });
  }

  requireLessonInCourse(database, lessonId, courseId);

  const parsed = parseFormData(formData, quizActionSchema);
  if (!parsed.success) {
    return data(
      { error: Object.values(parsed.errors)[0] ?? "Invalid input." },
      { status: 400 }
    );
  }

  if (parsed.data.intent === "save-quiz") {
    return saveQuiz(database, lessonId, parsed.data.wizardData);
  }

  deleteQuizOfLesson(database, lessonId);
  return { success: true, deleted: true };
}
