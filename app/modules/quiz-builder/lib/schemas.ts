import { z } from "zod";

import { QuestionType } from "~/db/schema";

export const quizParametersSchema = z.object({
  courseId: z.coerce.number().int(),
  lessonId: z.coerce.number().int(),
});

export const wizardDataSchema = z.object({
  title: z.string().trim().min(1, "Quiz title is required."),
  passingScore: z.number(),
  questions: z
    .array(
      z.object({
        id: z.string(),
        text: z.string(),
        type: z.nativeEnum(QuestionType),
        options: z.array(
          z.object({
            id: z.string(),
            text: z.string(),
            isCorrect: z.boolean(),
          })
        ),
      })
    )
    .min(1, "At least one question is required."),
});

export const quizActionSchema = z.discriminatedUnion("intent", [
  z.object({
    intent: z.literal("save-quiz"),
    wizardData: z.string(),
  }),
  z.object({
    intent: z.literal("delete-quiz"),
  }),
]);
