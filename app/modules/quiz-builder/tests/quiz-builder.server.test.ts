import { beforeEach, describe, expect, it } from "vitest";

import {
  createTestDb,
  seedBaseData,
  seedCourse,
  seedLesson,
  seedQuizAttempt,
  seedUser,
  type TestDb,
} from "~/test/setup";

import {
  applyQuizBuilderAction,
  getQuizBuilder,
  type QuizBuilderRequest,
} from "../quiz-builder.server";

let database: TestDb;
let base: ReturnType<typeof seedBaseData>;
let lessonId: number;
let otherCourseLessonId: number;

beforeEach(() => {
  database = createTestDb();
  base = seedBaseData(database);
  lessonId = seedLesson(database, base.course.id).id;
  const otherCourse = seedCourse(database, {
    slug: "other-course",
    instructorId: base.instructor.id,
    categoryId: base.category.id,
  });
  otherCourseLessonId = seedLesson(database, otherCourse.id).id;
});

function parameters(
  courseId: unknown = base.course.id,
  lesson: unknown = lessonId
) {
  return { courseId: String(courseId), lessonId: String(lesson) };
}

function asInstructor(
  params: QuizBuilderRequest["params"] = parameters()
): QuizBuilderRequest {
  return { viewerId: base.instructor.id, params };
}

function asNew(role: "instructor" | "admin") {
  const user = seedUser(database, { name: `New ${role}`, role });
  return { viewerId: user.id, params: parameters() };
}

// react-router's data() as a loader or action throws or returns it.
function response(value: unknown) {
  const { data, init } = value as { data: unknown; init: ResponseInit };
  return { body: data, status: init.status };
}

function thrownBy(run: () => unknown) {
  try {
    run();
  } catch (error) {
    return response(error);
  }
  throw new Error("expected a thrown response");
}

function form(fields: Record<string, string>) {
  const formData = new FormData();
  for (const [name, value] of Object.entries(fields)) {
    formData.set(name, value);
  }
  return formData;
}

const trueFalse = {
  id: "q1",
  text: "  Is the sky blue?  ",
  type: "true_false",
  options: [
    { id: "o1", text: "True", isCorrect: true },
    { id: "o2", text: "False", isCorrect: false },
  ],
};

const multipleChoice = {
  id: "q2",
  text: "Pick a prime",
  type: "multiple_choice",
  options: [
    { id: "o3", text: " 4 ", isCorrect: false },
    { id: "o4", text: "7", isCorrect: true },
  ],
};

function wizard(overrides: Record<string, unknown> = {}) {
  return JSON.stringify({
    title: "  Basics quiz  ",
    passingScore: 70,
    questions: [trueFalse, multipleChoice],
    ...overrides,
  });
}

function post(
  fields: Record<string, string>,
  request: QuizBuilderRequest = asInstructor()
) {
  return applyQuizBuilderAction(database, request, form(fields));
}

function save(wizardData = wizard()) {
  return post({ intent: "save-quiz", wizardData });
}

function quizOfLesson() {
  return getQuizBuilder(database, asInstructor()).existingQuiz;
}

describe("getQuizBuilder access", () => {
  function load(request: QuizBuilderRequest) {
    return () => getQuizBuilder(database, request);
  }

  it("rejects a signed-out viewer with 401", () => {
    expect(thrownBy(load({ viewerId: null, params: parameters() }))).toEqual({
      body: "Select a user from the DevUI panel.",
      status: 401,
    });
  });

  it("rejects a student and an unknown user with 403", () => {
    for (const viewerId of [base.user.id, 999]) {
      expect(thrownBy(load({ viewerId, params: parameters() }))).toEqual({
        body: "Only instructors and admins can access this page.",
        status: 403,
      });
    }
  });

  it("rejects ids that are not numbers with 400", () => {
    expect(thrownBy(load(asInstructor(parameters("x"))))).toEqual({
      body: "Invalid course ID.",
      status: 400,
    });
    expect(thrownBy(load(asInstructor({ courseId: "1" })))).toEqual({
      body: "Invalid lesson ID.",
      status: 400,
    });
  });

  it("rejects an unknown course with 404", () => {
    expect(thrownBy(load(asInstructor(parameters(999))))).toEqual({
      body: "Course not found.",
      status: 404,
    });
  });

  it("rejects another instructor's course with 403", () => {
    expect(thrownBy(load(asNew("instructor")))).toEqual({
      body: "You can only edit your own courses.",
      status: 403,
    });
  });

  it("rejects a lesson that is missing or in another course with 404", () => {
    expect(thrownBy(load(asInstructor(parameters(undefined, 999))))).toEqual({
      body: "Lesson not found.",
      status: 404,
    });
    expect(
      thrownBy(load(asInstructor(parameters(undefined, otherCourseLessonId))))
    ).toEqual({ body: "Lesson not found in this course.", status: 404 });
  });
});

describe("getQuizBuilder data", () => {
  it("gives the course, lesson and module, and no quiz before one is saved", () => {
    const page = getQuizBuilder(database, asInstructor());

    expect(page.course.id).toBe(base.course.id);
    expect(page.lesson.id).toBe(lessonId);
    expect(page.module.courseId).toBe(base.course.id);
    expect(page.existingQuiz).toBeNull();
  });

  it("lets an admin open any instructor's course", () => {
    const page = getQuizBuilder(database, asNew("admin"));
    expect(page.course.id).toBe(base.course.id);
  });
});

describe("applyQuizBuilderAction access", () => {
  function deleteAs(viewerId: number | null, params = parameters()) {
    return () => post({ intent: "delete-quiz" }, { viewerId, params });
  }

  it("rejects signed-out and non-instructor viewers", () => {
    expect(thrownBy(deleteAs(null))).toEqual({
      body: "You must be logged in.",
      status: 401,
    });
    expect(thrownBy(deleteAs(base.user.id))).toEqual({
      body: "Only instructors and admins can manage quizzes.",
      status: 403,
    });
  });

  it("rejects bad parameters with 400", () => {
    expect(thrownBy(deleteAs(base.instructor.id, parameters("x")))).toEqual({
      body: "Invalid parameters",
      status: 400,
    });
  });

  it("rejects a missing or someone else's course with 403", () => {
    const notYours = { body: "Course not found or not yours.", status: 403 };
    expect(thrownBy(deleteAs(base.instructor.id, parameters(999)))).toEqual(
      notYours
    );
    expect(thrownBy(deleteAs(asNew("instructor").viewerId))).toEqual(notYours);
  });

  it("rejects a lesson from another course with 404", () => {
    expect(
      thrownBy(
        deleteAs(base.instructor.id, parameters(undefined, otherCourseLessonId))
      )
    ).toEqual({ body: "Lesson not found in this course.", status: 404 });
  });

  it("lets an admin manage any course", () => {
    expect(post({ intent: "delete-quiz" }, asNew("admin"))).toEqual({
      success: true,
      deleted: true,
    });
  });
});

describe("saving a quiz", () => {
  it("stores the trimmed quiz, its questions in order and their options", () => {
    expect(save()).toEqual({ success: true });

    const quiz = quizOfLesson();
    expect(quiz).toMatchObject({
      lessonId,
      title: "Basics quiz",
      passingScore: 0.7,
    });
    expect(quiz?.questions).toEqual([
      expect.objectContaining({
        questionText: "Is the sky blue?",
        questionType: "true_false",
        position: 1,
        options: [
          expect.objectContaining({ optionText: "True", isCorrect: true }),
          expect.objectContaining({ optionText: "False", isCorrect: false }),
        ],
      }),
      expect.objectContaining({
        questionText: "Pick a prime",
        questionType: "multiple_choice",
        position: 2,
        options: [
          expect.objectContaining({ optionText: "4", isCorrect: false }),
          expect.objectContaining({ optionText: "7", isCorrect: true }),
        ],
      }),
    ]);
  });

  it("replaces the lesson's quiz instead of adding a second one", () => {
    save();
    save(wizard({ title: "Second", questions: [multipleChoice] }));

    expect(quizOfLesson()?.title).toBe("Second");
    expect(quizOfLesson()?.questions).toHaveLength(1);
  });

  it("rejects wizard data that is not JSON or fails the schema", () => {
    for (const wizardData of [
      "{not json",
      wizard({ title: "   " }),
      wizard({ questions: [] }),
    ]) {
      expect(response(save(wizardData))).toEqual({
        body: { error: "Invalid quiz data." },
        status: 400,
      });
    }
    expect(quizOfLesson()).toBeNull();
  });

  it("rejects a post without a known intent with the field's error", () => {
    expect(response(post({ intent: "publish" }))).toEqual({
      body: {
        error:
          "Invalid discriminator value. Expected 'save-quiz' | 'delete-quiz'",
      },
      status: 400,
    });
  });
});

describe("deleting a quiz", () => {
  // A student's attempt and answer point at the quiz's question and option.
  function takeQuiz() {
    const quiz = quizOfLesson();
    const question = quiz?.questions[0];
    const option = question?.options[0];
    if (!quiz || !question || !option) throw new Error("no quiz saved");
    seedQuizAttempt(database, {
      userId: base.user.id,
      quizId: quiz.id,
      questionId: question.id,
      optionId: option.id,
    });
  }

  it("removes a quiz that students have taken", () => {
    save();
    takeQuiz();

    expect(post({ intent: "delete-quiz" })).toEqual({
      success: true,
      deleted: true,
    });
    expect(quizOfLesson()).toBeNull();
  });

  it("succeeds when the lesson has no quiz", () => {
    expect(post({ intent: "delete-quiz" })).toEqual({
      success: true,
      deleted: true,
    });
  });

  it("replaces a quiz that students have taken", () => {
    save();
    takeQuiz();

    expect(save(wizard({ title: "Retake" }))).toEqual({ success: true });
    expect(quizOfLesson()?.title).toBe("Retake");
  });
});
