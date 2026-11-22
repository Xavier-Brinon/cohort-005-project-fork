import { quizAnswers, quizAttempts } from "~/db/schema";
import type { Database } from "~/lib/access.server";

import { getQuizQuestions } from "./queries.server";

/** The option id the student picked, by question id. */
export type SelectedAnswers = Map<number, number>;

export interface QuestionResult {
  questionId: number;
  correct: boolean;
  selectedOptionId: number | null;
  correctOptionId: number | null;
}

const GRADES = [
  { minimum: 0.9, grade: "A" },
  { minimum: 0.8, grade: "B" },
  { minimum: 0.7, grade: "C" },
  { minimum: 0.6, grade: "D" },
] as const;

export function gradeFor(score: number) {
  return GRADES.find(({ minimum }) => score >= minimum)?.grade ?? "F";
}

/** Reads the quiz form's "question-<questionId>" fields, whose values are option ids. */
export function readSelectedAnswers(formData: FormData): SelectedAnswers {
  const selected: SelectedAnswers = new Map();
  for (const [key, value] of formData.entries()) {
    if (!key.startsWith("question-")) continue;
    const questionId = Number(key.slice("question-".length));
    const optionId = Number(value);
    if (!Number.isNaN(questionId) && !Number.isNaN(optionId)) {
      selected.set(questionId, optionId);
    }
  }
  return selected;
}

function scoreQuestions(
  database: Database,
  quizId: number,
  selected: SelectedAnswers
): QuestionResult[] {
  return getQuizQuestions(database, quizId).map((question) => {
    const selectedOptionId = selected.get(question.id) ?? null;
    if (selectedOptionId === null) {
      return {
        questionId: question.id,
        correct: false,
        selectedOptionId,
        correctOptionId: null,
      };
    }
    const correctOptionId =
      question.options.find((option) => option.isCorrect)?.id ?? null;
    return {
      questionId: question.id,
      correct: selectedOptionId === correctOptionId,
      selectedOptionId,
      correctOptionId,
    };
  });
}

/**
 * Scores the student's answers to the quiz, stores the attempt and its
 * answers, and returns the result with every question's correct option.
 * Passing needs more than 70% correct.
 */
export function scoreQuiz(
  database: Database,
  { userId, quizId }: { userId: number; quizId: number },
  selected: SelectedAnswers
) {
  const questionResults = scoreQuestions(database, quizId, selected);
  const totalCorrect = questionResults.filter(
    (result) => result.correct
  ).length;
  const totalQuestions = questionResults.length;
  const score = totalQuestions > 0 ? totalCorrect / totalQuestions : 0;
  const isPassing = score > 0.7;

  const attempt = database
    .insert(quizAttempts)
    .values({ userId, quizId, score, passed: isPassing })
    .returning()
    .get();

  for (const result of questionResults) {
    if (result.selectedOptionId === null) continue;
    database
      .insert(quizAnswers)
      .values({
        attemptId: attempt.id,
        questionId: result.questionId,
        selectedOptionId: result.selectedOptionId,
      })
      .run();
  }

  return {
    attemptId: attempt.id,
    score,
    passed: isPassing,
    grade: gradeFor(score),
    totalCorrect,
    totalQuestions,
    questionResults,
  };
}
