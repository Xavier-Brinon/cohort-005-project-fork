import { beforeEach, describe, expect, it } from "vitest";

import { readQuizAnswers, seedQuiz } from "~/test/setup";

import { createWorld, post, view, type World } from "./fixtures";

let world: World;

beforeEach(() => {
  world = createWorld();
});

/** A quiz of `count` true/false questions whose first option is correct. */
function seedTrueFalseQuiz(count: number) {
  return seedQuiz(
    world.database,
    world.lesson.id,
    Array.from({ length: count }, () => ({
      type: "true_false" as const,
      options: [true, false],
    }))
  );
}

/** Answers the first `right` questions correctly and the rest wrongly. */
function answers(quiz: ReturnType<typeof seedTrueFalseQuiz>, right: number) {
  return Object.fromEntries(
    quiz.questions.map((question, index) => [
      `question-${question.id}`,
      question.optionIds[index < right ? 0 : 1],
    ])
  );
}

function submit(quizId: number, fields: Record<string, string | number>) {
  return post(
    world,
    { userId: world.student.id },
    { intent: "submit-quiz", quizId, ...fields }
  );
}

describe("scoring a quiz", () => {
  it.each([
    { right: 10, score: 1, grade: "A", passed: true },
    { right: 9, score: 0.9, grade: "A", passed: true },
    { right: 8, score: 0.8, grade: "B", passed: true },
    { right: 7, score: 0.7, grade: "C", passed: false },
    { right: 6, score: 0.6, grade: "D", passed: false },
    { right: 5, score: 0.5, grade: "F", passed: false },
  ])(
    "scores $right of 10 as $grade, passed: $passed",
    async ({ right, ...expected }) => {
      const quiz = seedTrueFalseQuiz(10);

      const { quizResult } = (await submit(quiz.id, answers(quiz, right))) as {
        quizResult: Record<string, unknown>;
      };

      expect(quizResult).toMatchObject({
        ...expected,
        totalCorrect: right,
        totalQuestions: 10,
      });
    }
  );

  it("reports each question with the picked and the correct option", async () => {
    const quiz = seedQuiz(world.database, world.lesson.id, [
      { type: "multiple_choice", options: [false, true, false] },
      { type: "true_false", options: [true, false] },
      { type: "true_false", options: [false, true] },
    ]);
    const [choice, trueFalse, unanswered] = quiz.questions;

    const result = await submit(quiz.id, {
      [`question-${choice.id}`]: choice.optionIds[1],
      [`question-${trueFalse.id}`]: trueFalse.optionIds[1],
      "question-x": 1,
      unrelated: 1,
    });

    expect(result).toMatchObject({
      quizResult: {
        totalCorrect: 1,
        questionResults: [
          {
            questionId: choice.id,
            correct: true,
            selectedOptionId: choice.optionIds[1],
            correctOptionId: choice.optionIds[1],
          },
          {
            questionId: trueFalse.id,
            correct: false,
            selectedOptionId: trueFalse.optionIds[1],
            correctOptionId: trueFalse.optionIds[0],
          },
          {
            questionId: unanswered.id,
            correct: false,
            selectedOptionId: null,
            correctOptionId: null,
          },
        ],
      },
    });
  });

  it("ignores an answer that is not an option id, and fields that are not answers", async () => {
    const quiz = seedTrueFalseQuiz(2);
    const [first, second] = quiz.questions;

    const result = await submit(quiz.id, {
      [`question-${first.id}`]: "abc",
      // Not an answer, though its name is as long as "question-" before the id.
      [`selected-${second.id}`]: second.optionIds[0],
    });

    expect(result).toMatchObject({
      quizResult: {
        questionResults: [
          { questionId: first.id, selectedOptionId: null },
          { questionId: second.id, selectedOptionId: null },
        ],
      },
    });
  });

  it("marks an answer wrong when the question has no correct option", async () => {
    const quiz = seedQuiz(world.database, world.lesson.id, [
      { type: "multiple_choice", options: [false, false] },
    ]);
    const [question] = quiz.questions;

    expect(
      await submit(quiz.id, {
        [`question-${question.id}`]: question.optionIds[0],
      })
    ).toMatchObject({
      quizResult: {
        totalCorrect: 0,
        questionResults: [{ correct: false, correctOptionId: null }],
      },
    });
  });

  it("scores a quiz with no questions as 0, not passed", async () => {
    const quiz = seedQuiz(world.database, world.lesson.id, []);
    expect(await submit(quiz.id, {})).toMatchObject({
      quizResult: { score: 0, passed: false, grade: "F", totalQuestions: 0 },
    });
  });

  it("stores the attempt's answers, skipping unanswered questions", async () => {
    const quiz = seedTrueFalseQuiz(3);
    const [first, second] = quiz.questions;

    const { quizResult } = (await submit(quiz.id, {
      [`question-${first.id}`]: first.optionIds[0],
      [`question-${second.id}`]: second.optionIds[1],
    })) as { quizResult: { attemptId: number } };

    expect(readQuizAnswers(world.database, quizResult.attemptId)).toEqual([
      { questionId: first.id, selectedOptionId: first.optionIds[0] },
      { questionId: second.id, selectedOptionId: second.optionIds[1] },
    ]);
  });

  it("stores the attempt, so the page shows the best one", async () => {
    const quiz = seedTrueFalseQuiz(2);
    await submit(quiz.id, answers(quiz, 1));
    await submit(quiz.id, answers(quiz, 2));
    await submit(quiz.id, answers(quiz, 0));

    expect(
      (await view(world, { userId: world.student.id })).bestAttempt
    ).toEqual({ score: 1, passed: true });
  });
});
