import { CheckCircle2, Save, XCircle } from "lucide-react";

import { Button } from "~/components/ui/button";
import { Card, CardContent, CardHeader } from "~/components/ui/card";
import { QuestionType } from "~/db/schema";

import type { WizardQuestion, WizardState } from "./wizard-state";

// Step 4 of the quiz builder: the whole quiz, what still blocks saving, and
// the save button.

/** Why the quiz cannot be saved yet, one message per problem. */
export function quizValidationErrors(wizard: WizardState): string[] {
  const errors: string[] = [];
  if (!wizard.title.trim()) errors.push("Quiz title is required.");
  if (wizard.questions.length === 0)
    errors.push("At least one question is required.");
  for (const [index, question] of wizard.questions.entries()) {
    const label = `Question ${index + 1}`;
    if (!question.text.trim()) errors.push(`${label} has no text.`);
    if (question.options.length < 2)
      errors.push(`${label} needs at least 2 options.`);
    if (!question.options.some((option) => option.isCorrect))
      errors.push(`${label} has no correct answer.`);
    if (question.options.some((option) => !option.text.trim()))
      errors.push(`${label} has an empty option.`);
  }
  return errors;
}

function QuizSummary({ wizard }: { wizard: WizardState }) {
  return (
    <div className="rounded-lg bg-muted/50 p-4">
      <div className="space-y-1 text-sm">
        <div>
          <span className="font-medium">Title:</span>{" "}
          {wizard.title || "(empty)"}
        </div>
        <div>
          <span className="font-medium">Passing Score:</span>{" "}
          {wizard.passingScore}%
        </div>
        <div>
          <span className="font-medium">Questions:</span>{" "}
          {wizard.questions.length}
        </div>
      </div>
    </div>
  );
}

function QuestionReview({
  question,
  position,
}: {
  question: WizardQuestion;
  position: number;
}) {
  return (
    <div className="rounded-lg border p-4">
      <div className="mb-2 flex items-center gap-2">
        <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium">
          {position}
        </span>
        <span className="font-medium">
          {question.text || "(No question text)"}
        </span>
        <span className="ml-auto text-xs text-muted-foreground">
          {question.type === QuestionType.TrueFalse
            ? "True/False"
            : "Multiple Choice"}
        </span>
      </div>
      <div className="ml-8 space-y-1">
        {question.options.map((option) => (
          <div key={option.id} className="flex items-center gap-2 text-sm">
            {option.isCorrect ? (
              <CheckCircle2 className="size-4 text-green-500" />
            ) : (
              <XCircle className="size-4 text-muted-foreground/40" />
            )}
            <span
              className={option.isCorrect ? "font-medium text-green-700" : ""}
            >
              {option.text || "(empty)"}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function ValidationErrorList({ errors }: { errors: string[] }) {
  if (errors.length === 0) return null;
  return (
    <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-4">
      <p className="mb-2 text-sm font-medium text-destructive">
        Please fix these issues before saving:
      </p>
      <ul className="list-inside list-disc space-y-1 text-sm text-destructive">
        {errors.map((error) => (
          <li key={error}>{error}</li>
        ))}
      </ul>
    </div>
  );
}

interface ReviewStepProps {
  wizard: WizardState;
  isEditing: boolean;
  isSaving: boolean;
  error: string | undefined;
  onSave: () => void;
}

export function ReviewStep({
  wizard,
  isEditing,
  isSaving,
  error,
  onSave,
}: ReviewStepProps) {
  const validationErrors = quizValidationErrors(wizard);
  const isValid = validationErrors.length === 0;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <h2 className="text-lg font-semibold">Review Quiz</h2>
          <p className="text-sm text-muted-foreground">
            Review your quiz before saving.
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          <QuizSummary wizard={wizard} />
          {wizard.questions.map((question, index) => (
            <QuestionReview
              key={question.id}
              question={question}
              position={index + 1}
            />
          ))}
          <ValidationErrorList errors={validationErrors} />
          <div className="flex items-center gap-3">
            <Button disabled={!isValid || isSaving} onClick={onSave}>
              <Save className="mr-1.5 size-4" />
              {isSaving
                ? "Saving..."
                : isEditing
                  ? "Update Quiz"
                  : "Create Quiz"}
            </Button>
            {error && <span className="text-sm text-destructive">{error}</span>}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
