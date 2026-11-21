import Database from "better-sqlite3";
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

/** Inserts a published course taught by `instructorId`, in `categoryId`. */
export function seedCourse(
  testDatabase: TestDb,
  course: { slug: string; instructorId: number; categoryId: number }
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

/** Inserts a module holding one lesson in `courseId`; returns the lesson. */
export function seedLesson(testDatabase: TestDb, courseId: number) {
  const lessonModule = testDatabase
    .insert(schema.modules)
    .values({ courseId, title: "Module", position: 1 })
    .returning()
    .get();

  return testDatabase
    .insert(schema.lessons)
    .values({ moduleId: lessonModule.id, title: "Lesson", position: 1 })
    .returning()
    .get();
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
