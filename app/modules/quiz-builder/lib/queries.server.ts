import { eq } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";

import type * as schema from "~/db/schema";
import {
  courses,
  lessons,
  modules,
  type QuestionType,
  quizAnswers,
  quizAttempts,
  quizOptions,
  quizQuestions,
  quizzes,
  users,
} from "~/db/schema";

export type Database = BetterSQLite3Database<typeof schema>;

export function getUserById(database: Database, id: number) {
  return database.select().from(users).where(eq(users.id, id)).get();
}

export function getCourseById(database: Database, id: number) {
  return database.select().from(courses).where(eq(courses.id, id)).get();
}

export function getModuleById(database: Database, id: number) {
  return database.select().from(modules).where(eq(modules.id, id)).get();
}

export function getLessonById(database: Database, id: number) {
  return database.select().from(lessons).where(eq(lessons.id, id)).get();
}

export function getQuizByLessonId(database: Database, lessonId: number) {
  return database
    .select()
    .from(quizzes)
    .where(eq(quizzes.lessonId, lessonId))
    .get();
}

function getQuestionsByQuiz(database: Database, quizId: number) {
  return database
    .select()
    .from(quizQuestions)
    .where(eq(quizQuestions.quizId, quizId))
    .orderBy(quizQuestions.position)
    .all();
}

type Quiz = typeof quizzes.$inferSelect;

export function getQuizWithQuestions(database: Database, quiz: Quiz) {
  const questions = getQuestionsByQuiz(database, quiz.id).map((question) => {
    const options = database
      .select()
      .from(quizOptions)
      .where(eq(quizOptions.questionId, question.id))
      .all();
    return { ...question, options };
  });

  return { ...quiz, questions };
}

interface NewQuiz {
  lessonId: number;
  title: string;
  passingScore: number;
}

export function createQuiz(database: Database, quiz: NewQuiz) {
  return database.insert(quizzes).values(quiz).returning().get();
}

export function deleteQuiz(database: Database, id: number) {
  // Children before parents: answers point at options, so options can only go
  // once the answers (and their attempts) are gone.
  const attempts = database
    .select()
    .from(quizAttempts)
    .where(eq(quizAttempts.quizId, id))
    .all();
  for (const attempt of attempts) {
    database
      .delete(quizAnswers)
      .where(eq(quizAnswers.attemptId, attempt.id))
      .run();
  }
  database.delete(quizAttempts).where(eq(quizAttempts.quizId, id)).run();

  for (const question of getQuestionsByQuiz(database, id)) {
    database
      .delete(quizOptions)
      .where(eq(quizOptions.questionId, question.id))
      .run();
  }
  database.delete(quizQuestions).where(eq(quizQuestions.quizId, id)).run();
  database.delete(quizzes).where(eq(quizzes.id, id)).run();
}

interface NewQuestion {
  quizId: number;
  questionText: string;
  questionType: QuestionType;
  position: number;
}

export function createQuestion(database: Database, question: NewQuestion) {
  return database.insert(quizQuestions).values(question).returning().get();
}

interface NewOption {
  questionId: number;
  optionText: string;
  isCorrect: boolean;
}

export function createOption(database: Database, option: NewOption) {
  database.insert(quizOptions).values(option).run();
}
