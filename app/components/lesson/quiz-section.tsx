import {
  CheckCircle2,
  HelpCircle,
  RotateCcw,
  Trophy,
  XCircle,
} from "lucide-react";
import { useEffect, useState } from "react";
import type { useFetcher } from "react-router";
import { toast } from "sonner";

import { Button } from "~/components/ui/button";
import { Card, CardContent } from "~/components/ui/card";

interface Quiz {
  id: number;
  title: string;
  passingScore: number;
  questions: Array<{
    id: number;
    questionText: string;
    questionType: string;
    position: number;
    options: Array<{ id: number; optionText: string }>;
  }>;
}

interface QuestionResult {
  questionId: number;
  correct: boolean;
  selectedOptionId: number | null;
  correctOptionId: number | null;
}

interface QuizResult {
  attemptId: number;
  score: number;
  passed: boolean;
  grade: string;
  totalCorrect: number;
  totalQuestions: number;
  questionResults: QuestionResult[];
}

type Question = Quiz["questions"][number];

function QuizTitle({ title }: { title: string }) {
  return (
    <div className="mb-4 flex items-center gap-2">
      <HelpCircle className="size-5 text-primary" />
      <h2 className="text-xl font-semibold">{title}</h2>
    </div>
  );
}

function ResultSummary({ quizResult }: { quizResult: QuizResult }) {
  const percent = Math.round(quizResult.score * 100);
  return (
    <div
      className={`mb-6 rounded-lg p-4 ${quizResult.passed ? "bg-green-50 dark:bg-green-950" : "bg-red-50 dark:bg-red-950"}`}
    >
      <div className="flex items-center gap-3">
        {quizResult.passed ? (
          <Trophy className="size-8 text-green-600" />
        ) : (
          <XCircle className="size-8 text-red-600" />
        )}
        <div>
          <p
            className={`text-lg font-semibold ${quizResult.passed ? "text-green-700 dark:text-green-400" : "text-red-700 dark:text-red-400"}`}
          >
            {quizResult.passed ? "You passed!" : "Not quite — try again!"}
          </p>
          <p className="text-sm text-muted-foreground">
            Score: {quizResult.totalCorrect}/{quizResult.totalQuestions} (
            {percent}%) — Grade: {quizResult.grade}
          </p>
        </div>
      </div>
    </div>
  );
}

function OptionResult({
  optionText,
  isSelected,
  isCorrect,
  isAnsweredCorrectly,
}: {
  optionText: string;
  isSelected: boolean;
  isCorrect: boolean;
  isAnsweredCorrectly: boolean;
}) {
  let className = "text-sm";
  if (isCorrect) {
    className += " font-medium text-green-700 dark:text-green-400";
  } else if (isSelected && !isAnsweredCorrectly) {
    className += " text-red-600 dark:text-red-400 line-through";
  }
  const mark = isCorrect ? "✓ " : isSelected ? "✗ " : "  ";
  return (
    <p className={className}>
      {mark}
      {optionText}
    </p>
  );
}

function QuestionResultCard({
  question,
  number,
  result,
}: {
  question: Question;
  number: number;
  result: QuestionResult | undefined;
}) {
  return (
    <div className="rounded-lg border p-4">
      <div className="mb-2 flex items-start gap-2">
        {result?.correct ? (
          <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-green-600" />
        ) : (
          <XCircle className="mt-0.5 size-5 shrink-0 text-red-600" />
        )}
        <p className="font-medium">
          {number}. {question.questionText}
        </p>
      </div>
      <div className="ml-7 space-y-1">
        {question.options.map((option) => (
          <OptionResult
            key={option.id}
            optionText={option.optionText}
            isSelected={result?.selectedOptionId === option.id}
            isCorrect={result?.correctOptionId === option.id}
            isAnsweredCorrectly={result?.correct ?? false}
          />
        ))}
      </div>
    </div>
  );
}

function QuizResultCard({
  quiz,
  quizResult,
  onRetake,
}: {
  quiz: Quiz;
  quizResult: QuizResult;
  onRetake: () => void;
}) {
  return (
    <Card className="mb-8">
      <CardContent className="p-6">
        <QuizTitle title={quiz.title} />
        <ResultSummary quizResult={quizResult} />

        <div className="space-y-4">
          {quiz.questions.map((question, index) => (
            <QuestionResultCard
              key={question.id}
              question={question}
              number={index + 1}
              result={quizResult.questionResults.find(
                (result) => result.questionId === question.id
              )}
            />
          ))}
        </div>

        {!quizResult.passed && (
          <div className="mt-6">
            <Button variant="outline" onClick={onRetake}>
              <RotateCcw className="mr-2 size-4" />
              Retake Quiz
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function PassedSummary({
  title,
  bestScore,
  onRetake,
}: {
  title: string;
  bestScore: number;
  onRetake: () => void;
}) {
  return (
    <Card className="mb-8">
      <CardContent className="p-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Trophy className="size-5 text-green-600" />
            <span className="font-medium">{title}</span>
            <span className="text-sm text-muted-foreground">
              — Best score: {Math.round(bestScore * 100)}%
            </span>
          </div>
          <Button variant="outline" size="sm" onClick={onRetake}>
            <RotateCcw className="mr-2 size-4" />
            Retake
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function QuestionField({
  question,
  number,
  selectedOptionId,
  onSelect,
}: {
  question: Question;
  number: number;
  selectedOptionId: number | undefined;
  onSelect: (optionId: number) => void;
}) {
  return (
    <div className="rounded-lg border p-4">
      <p className="mb-3 font-medium">
        {number}. {question.questionText}
      </p>
      <div className="space-y-2">
        {question.options.map((option) => (
          <label
            key={option.id}
            className="flex cursor-pointer items-center gap-3 rounded-md px-3 py-2 hover:bg-muted"
          >
            <input
              type="radio"
              name={`question-${question.id}`}
              value={option.id}
              checked={selectedOptionId === option.id}
              onChange={() => onSelect(option.id)}
              className="size-4 accent-primary"
            />
            <span className="text-sm">{option.optionText}</span>
          </label>
        ))}
      </div>
    </div>
  );
}

function SubmitRow({
  hasAnsweredAll,
  isSubmitting,
}: {
  hasAnsweredAll: boolean;
  isSubmitting: boolean;
}) {
  return (
    <div className="mt-6">
      <Button type="submit" disabled={!hasAnsweredAll || isSubmitting}>
        {isSubmitting ? "Submitting..." : "Submit Quiz"}
      </Button>
      {!hasAnsweredAll && (
        <p className="mt-2 text-sm text-muted-foreground">
          Please answer all questions before submitting.
        </p>
      )}
    </div>
  );
}

function QuizForm({
  quiz,
  quizFetcher,
  isSubmitting,
  selectedAnswers,
  onSelect,
  onSubmit,
}: {
  quiz: Quiz;
  quizFetcher: ReturnType<typeof useFetcher>;
  isSubmitting: boolean;
  selectedAnswers: Record<number, number>;
  onSelect: (questionId: number, optionId: number) => void;
  onSubmit: () => void;
}) {
  const hasAnsweredAll = quiz.questions.every(
    (question) => selectedAnswers[question.id] !== undefined
  );

  return (
    <Card className="mb-8">
      <CardContent className="p-6">
        <QuizTitle title={quiz.title} />
        <p className="mb-6 text-sm text-muted-foreground">
          Answer all questions and submit. Passing score:{" "}
          {Math.round(quiz.passingScore * 100)}%.
        </p>

        <quizFetcher.Form method="post" onSubmit={onSubmit}>
          <input type="hidden" name="intent" value="submit-quiz" />
          <input type="hidden" name="quizId" value={quiz.id} />

          <div className="space-y-6">
            {quiz.questions.map((question, index) => (
              <QuestionField
                key={question.id}
                question={question}
                number={index + 1}
                selectedOptionId={selectedAnswers[question.id]}
                onSelect={(optionId) => onSelect(question.id, optionId)}
              />
            ))}
          </div>

          <SubmitRow
            hasAnsweredAll={hasAnsweredAll}
            isSubmitting={isSubmitting}
          />
        </quizFetcher.Form>
      </CardContent>
    </Card>
  );
}

function useResultToast(quizResult: QuizResult | null, isRetaking: boolean) {
  useEffect(() => {
    if (!quizResult || isRetaking) return;
    const percent = Math.round(quizResult.score * 100);
    if (quizResult.passed) {
      toast.success(`Quiz passed! Score: ${percent}%`);
    } else {
      toast.error(`Quiz not passed. Score: ${percent}%`);
    }
  }, [quizResult, isRetaking]);
}

interface QuizSectionProps {
  quiz: Quiz;
  bestAttempt: { score: number; passed: boolean } | null;
  quizResult: QuizResult | null;
  quizFetcher: ReturnType<typeof useFetcher>;
  isSubmitting: boolean;
}

export function QuizSection({
  quiz,
  bestAttempt,
  quizResult,
  quizFetcher,
  isSubmitting,
}: QuizSectionProps) {
  const [selectedAnswers, setSelectedAnswers] = useState<
    Record<number, number>
  >({});
  const [isQuizShown, setIsQuizShown] = useState(!bestAttempt?.passed);
  const [isRetaking, setIsRetaking] = useState(false);
  useResultToast(quizResult, isRetaking);

  if (quizResult && !isRetaking) {
    return (
      <QuizResultCard
        quiz={quiz}
        quizResult={quizResult}
        onRetake={() => {
          setSelectedAnswers({});
          setIsRetaking(true);
        }}
      />
    );
  }

  if (!isQuizShown && bestAttempt?.passed) {
    return (
      <PassedSummary
        title={quiz.title}
        bestScore={bestAttempt.score}
        onRetake={() => setIsQuizShown(true)}
      />
    );
  }

  return (
    <QuizForm
      quiz={quiz}
      quizFetcher={quizFetcher}
      isSubmitting={isSubmitting}
      selectedAnswers={selectedAnswers}
      onSelect={(questionId, optionId) =>
        setSelectedAnswers((previous) => ({
          ...previous,
          [questionId]: optionId,
        }))
      }
      onSubmit={() => setIsRetaking(false)}
    />
  );
}
