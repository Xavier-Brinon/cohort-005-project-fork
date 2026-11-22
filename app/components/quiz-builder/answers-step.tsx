import { Check, Plus, Trash2 } from "lucide-react";

import { Button } from "~/components/ui/button";
import { Card, CardContent, CardHeader } from "~/components/ui/card";
import { Input } from "~/components/ui/input";
import { QuestionType } from "~/db/schema";

import {
  generateId,
  type SetWizard,
  type WizardOption,
  type WizardQuestion,
  type WizardState,
} from "./wizard-state";

// Step 3 of the quiz builder: each question's answer options, and which one
// is correct.

function changeOptions(
  setWizard: SetWizard,
  questionId: string,
  change: (options: WizardOption[]) => WizardOption[]
) {
  setWizard((previous) => ({
    ...previous,
    questions: previous.questions.map((question) =>
      question.id === questionId
        ? { ...question, options: change(question.options) }
        : question
    ),
  }));
}

interface OptionRowProps {
  question: WizardQuestion;
  option: WizardOption;
  setWizard: SetWizard;
}

function CorrectToggle({ question, option, setWizard }: OptionRowProps) {
  return (
    <button
      type="button"
      onClick={() =>
        changeOptions(setWizard, question.id, (options) =>
          options.map((other) => ({
            ...other,
            isCorrect: other.id === option.id,
          }))
        )
      }
      className={`flex size-5 shrink-0 items-center justify-center rounded-full border-2 transition-colors ${
        option.isCorrect
          ? "border-green-500 bg-green-500 text-white"
          : "border-muted-foreground/30 hover:border-green-500/50"
      }`}
    >
      {option.isCorrect && <Check className="size-3" />}
    </button>
  );
}

function OptionRow({ question, option, setWizard }: OptionRowProps) {
  return (
    <div className="flex items-center gap-2">
      <CorrectToggle
        question={question}
        option={option}
        setWizard={setWizard}
      />
      {question.type === QuestionType.TrueFalse ? (
        <span className="text-sm">{option.text}</span>
      ) : (
        <Input
          value={option.text}
          onChange={(event) =>
            changeOptions(setWizard, question.id, (options) =>
              options.map((other) =>
                other.id === option.id
                  ? { ...other, text: event.target.value }
                  : other
              )
            )
          }
          placeholder="Enter option text..."
          className="flex-1"
        />
      )}
      {question.type === QuestionType.MultipleChoice &&
        question.options.length > 2 && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() =>
              changeOptions(setWizard, question.id, (options) =>
                options.filter((other) => other.id !== option.id)
              )
            }
            className="text-destructive hover:text-destructive"
          >
            <Trash2 className="size-3" />
          </Button>
        )}
    </div>
  );
}

interface QuestionOptionsProps {
  question: WizardQuestion;
  position: number;
  setWizard: SetWizard;
}

function QuestionOptions({
  question,
  position,
  setWizard,
}: QuestionOptionsProps) {
  return (
    <div className="rounded-lg border p-4">
      <div className="mb-3 flex items-center gap-2">
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

      <div className="space-y-2">
        {question.options.map((option) => (
          <OptionRow
            key={option.id}
            question={question}
            option={option}
            setWizard={setWizard}
          />
        ))}
      </div>

      {question.type === QuestionType.MultipleChoice && (
        <Button
          variant="ghost"
          size="sm"
          onClick={() =>
            changeOptions(setWizard, question.id, (options) => [
              ...options,
              { id: generateId(), text: "", isCorrect: false },
            ])
          }
          className="mt-2"
        >
          <Plus className="mr-1 size-3" />
          Add Option
        </Button>
      )}
    </div>
  );
}

export function AnswersStep({
  wizard,
  setWizard,
}: {
  wizard: WizardState;
  setWizard: SetWizard;
}) {
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <h2 className="text-lg font-semibold">Answer Options</h2>
          <p className="text-sm text-muted-foreground">
            Set answer options for each question and mark the correct answer.
          </p>
        </CardHeader>
        <CardContent className="space-y-6">
          {wizard.questions.length === 0 && (
            <p className="text-sm text-muted-foreground">
              Go back and add questions first.
            </p>
          )}

          {wizard.questions.map((question, index) => (
            <QuestionOptions
              key={question.id}
              question={question}
              position={index + 1}
              setWizard={setWizard}
            />
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
