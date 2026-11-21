import { data } from "react-router";

import {
  createOption,
  createQuestion,
  createQuiz,
  type Database,
  deleteQuiz,
  getQuizByLessonId,
} from "./queries.server";
import { wizardDataSchema } from "./schemas";

function parseWizardData(wizardJson: string) {
  try {
    const result = wizardDataSchema.safeParse(JSON.parse(wizardJson));
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}

/** Deletes the lesson's quiz, if it has one, with its questions and attempts. */
export function deleteQuizOfLesson(database: Database, lessonId: number) {
  const existingQuiz = getQuizByLessonId(database, lessonId);
  if (existingQuiz) {
    deleteQuiz(database, existingQuiz.id);
  }
}

/** Replaces the lesson's quiz with the one the wizard built. */
export function saveQuiz(
  database: Database,
  lessonId: number,
  wizardJson: string
) {
  const wizardData = parseWizardData(wizardJson);
  if (wizardData === null) {
    return data({ error: "Invalid quiz data." }, { status: 400 });
  }

  deleteQuizOfLesson(database, lessonId);

  const quiz = createQuiz(database, {
    lessonId,
    title: wizardData.title,
    passingScore: wizardData.passingScore / 100,
  });

  for (const [index, wizardQuestion] of wizardData.questions.entries()) {
    const question = createQuestion(database, {
      quizId: quiz.id,
      questionText: wizardQuestion.text.trim(),
      questionType: wizardQuestion.type,
      position: index + 1,
    });

    for (const option of wizardQuestion.options) {
      createOption(database, {
        questionId: question.id,
        optionText: option.text.trim(),
        isCorrect: option.isCorrect,
      });
    }
  }

  return { success: true };
}
