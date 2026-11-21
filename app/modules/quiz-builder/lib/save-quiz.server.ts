import { data } from "react-router";

import {
  createOption,
  createQuestion,
  createQuiz,
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
export function deleteQuizOfLesson(lessonId: number) {
  const existingQuiz = getQuizByLessonId(lessonId);
  if (existingQuiz) {
    deleteQuiz(existingQuiz.id);
  }
}

/** Replaces the lesson's quiz with the one the wizard built. */
export function saveQuiz(lessonId: number, wizardJson: string) {
  const wizardData = parseWizardData(wizardJson);
  if (!wizardData) {
    return data({ error: "Invalid quiz data." }, { status: 400 });
  }

  deleteQuizOfLesson(lessonId);

  const quiz = createQuiz(
    lessonId,
    wizardData.title.trim(),
    wizardData.passingScore / 100
  );

  for (const [index, wizardQuestion] of wizardData.questions.entries()) {
    const question = createQuestion({
      quizId: quiz.id,
      questionText: wizardQuestion.text.trim(),
      questionType: wizardQuestion.type,
      position: index + 1,
    });

    for (const option of wizardQuestion.options) {
      createOption(question.id, option.text.trim(), option.isCorrect);
    }
  }

  return { success: true };
}
