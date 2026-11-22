import Database from "better-sqlite3";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import path from "path";
import { fileURLToPath } from "url";

import * as schema from "~/db/schema";
import { markdown } from "~/lib/text";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const migrationsFolder = path.resolve(__dirname, "../../drizzle");

/**
 * Creates a fresh in-memory SQLite database with all tables for testing.
 * Each call returns a new isolated database instance.
 *
 * Uses the same Drizzle migrations as the live database, ensuring
 * test and production schemas are always in sync.
 */
export function createTestDb() {
  const sqlite = new Database(":memory:");
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");

  const testDb = drizzle(sqlite, { schema });

  migrate(testDb, { migrationsFolder });

  return testDb;
}

export type TestDb = ReturnType<typeof createTestDb>;

/**
 * Seeds a minimal set of base data (user, category, course) that most tests need.
 * Returns the created IDs for use in test assertions.
 */
export function seedBaseData(testDb: TestDb) {
  const user = testDb
    .insert(schema.users)
    .values({
      name: "Test User",
      email: "test@example.com",
      role: schema.UserRole.Student,
    })
    .returning()
    .get();

  const instructor = testDb
    .insert(schema.users)
    .values({
      name: "Test Instructor",
      email: "instructor@example.com",
      role: schema.UserRole.Instructor,
    })
    .returning()
    .get();

  const category = testDb
    .insert(schema.categories)
    .values({ name: "Programming", slug: "programming" })
    .returning()
    .get();

  const course = testDb
    .insert(schema.courses)
    .values({
      title: "Test Course",
      slug: "test-course",
      description: "A test course",
      salesCopy: markdown("## Test Course\n\nSales copy for the test course."),
      instructorId: instructor.id,
      categoryId: category.id,
      status: schema.CourseStatus.Published,
    })
    .returning()
    .get();

  return { user, instructor, category, course };
}

/** Inserts a user with `role`; the email is derived from the name. */
export function seedUser(
  testDatabase: TestDb,
  user: { name: string; role: schema.UserRole }
) {
  return testDatabase
    .insert(schema.users)
    .values({ ...user, email: `${user.name.toLowerCase()}@example.com` })
    .returning()
    .get();
}

/**
 * Inserts a published course taught by `instructorId`, in `categoryId`.
 * Free unless `price` is given.
 */
export function seedCourse(
  testDatabase: TestDb,
  course: {
    slug: string;
    instructorId: number;
    categoryId: number;
    price?: number;
  }
) {
  return testDatabase
    .insert(schema.courses)
    .values({
      ...course,
      title: course.slug,
      description: `The ${course.slug} course`,
      salesCopy: markdown(`## ${course.slug}`),
      status: schema.CourseStatus.Published,
    })
    .returning()
    .get();
}

type SeededLesson = Partial<
  Pick<
    typeof schema.lessons.$inferInsert,
    "title" | "content" | "videoUrl" | "durationMinutes"
  >
>;

/** Inserts a module holding one lesson in `courseId`; returns the lesson. */
export function seedLesson(
  testDatabase: TestDb,
  courseId: number,
  lesson: SeededLesson = {}
) {
  return seedModule(testDatabase, { courseId, position: 1 }, [lesson])[0];
}

/** Inserts a module at `position` holding `lessons` in order; returns them. */
export function seedModule(
  testDatabase: TestDb,
  lessonModule: { courseId: number; position: number },
  lessons: SeededLesson[]
) {
  const { id: moduleId } = testDatabase
    .insert(schema.modules)
    .values({ ...lessonModule, title: `Module ${lessonModule.position}` })
    .returning()
    .get();

  return lessons.map((lesson, index) =>
    testDatabase
      .insert(schema.lessons)
      .values({ title: "Lesson", ...lesson, moduleId, position: index + 1 })
      .returning()
      .get()
  );
}

/** Enrolls `userId` in `courseId`; with `country`, records the purchase there. */
export function seedEnrollment(
  testDatabase: TestDb,
  enrollment: { userId: number; courseId: number; country?: string }
) {
  const { userId, courseId, country } = enrollment;
  testDatabase.insert(schema.enrollments).values({ userId, courseId }).run();
  if (country !== undefined) {
    testDatabase
      .insert(schema.purchases)
      .values({ userId, courseId, country, amountPaid: 1000 })
      .run();
  }
}

/**
 * Inserts a quiz on `lessonId` with one question per entry of `questions`,
 * each listing whether its options are correct. Returns the quiz with its
 * question and option ids.
 */
export function seedQuiz(
  testDatabase: TestDb,
  lessonId: number,
  questions: Array<{ type: schema.QuestionType; options: boolean[] }>
) {
  const quiz = testDatabase
    .insert(schema.quizzes)
    .values({ lessonId, title: "Quiz", passingScore: 0.7 })
    .returning()
    .get();

  const seeded = questions.map((question, index) => {
    const { id } = testDatabase
      .insert(schema.quizQuestions)
      .values({
        quizId: quiz.id,
        questionText: `Question ${index + 1}`,
        questionType: question.type,
        position: index + 1,
      })
      .returning()
      .get();
    const optionIds = question.options.map(
      (isCorrect, optionIndex) =>
        testDatabase
          .insert(schema.quizOptions)
          .values({
            questionId: id,
            optionText: `Option ${optionIndex + 1}`,
            isCorrect,
          })
          .returning()
          .get().id
    );
    return { id, optionIds };
  });

  return { ...quiz, questions: seeded };
}

/** Records `userId`'s progress `status` on `lessonId`. */
export function seedLessonProgress(
  testDatabase: TestDb,
  progress: {
    userId: number;
    lessonId: number;
    status: schema.LessonProgressStatus;
  }
) {
  testDatabase.insert(schema.lessonProgress).values(progress).run();
}

/** Records a video watch event at `positionSeconds`, at `createdAt`. */
export function seedWatchEvent(
  testDatabase: TestDb,
  event: {
    userId: number;
    lessonId: number;
    positionSeconds: number;
    createdAt: string;
  }
) {
  testDatabase
    .insert(schema.videoWatchEvents)
    .values({ ...event, eventType: "progress" })
    .run();
}

/** The answers stored for quiz attempt `attemptId`, in question order. */
export function readQuizAnswers(testDatabase: TestDb, attemptId: number) {
  return testDatabase
    .select({
      questionId: schema.quizAnswers.questionId,
      selectedOptionId: schema.quizAnswers.selectedOptionId,
    })
    .from(schema.quizAnswers)
    .where(eq(schema.quizAnswers.attemptId, attemptId))
    .orderBy(schema.quizAnswers.questionId)
    .all();
}

/** Records that `userId` took `quizId` and picked `optionId` for `questionId`. */
export function seedQuizAttempt(
  testDatabase: TestDb,
  attempt: {
    userId: number;
    quizId: number;
    questionId: number;
    optionId: number;
  }
) {
  const { userId, quizId, questionId, optionId } = attempt;
  const row = testDatabase
    .insert(schema.quizAttempts)
    .values({ userId, quizId, score: 1, passed: true })
    .returning()
    .get();

  testDatabase
    .insert(schema.quizAnswers)
    .values({ attemptId: row.id, questionId, selectedOptionId: optionId })
    .run();
}
