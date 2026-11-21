import {
  DragDropContext,
  Draggable,
  Droppable,
  type DropResult,
} from "@hello-pangea/dnd";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  GripVertical,
  Plus,
  Trash2,
} from "lucide-react";
import { useState } from "react";
import {
  isRouteErrorResponse,
  Link,
  useFetcher,
  useNavigate,
} from "react-router";
import { toast } from "sonner";

import { AnswersStep } from "~/components/quiz-builder/answers-step";
import { ReviewStep } from "~/components/quiz-builder/review-step";
import { StepIndicator } from "~/components/quiz-builder/step-indicator";
import {
  generateId,
  type WizardQuestion,
  type WizardState,
} from "~/components/quiz-builder/wizard-state";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardHeader } from "~/components/ui/card";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import { QuestionType } from "~/db/schema";
import {
  loadQuizBuilder,
  runQuizBuilderAction,
} from "~/modules/quiz-builder/index.server";

import type { Route } from "./+types/instructor.$courseId.lessons.$lessonId.quiz";

export function meta({ loaderData }: Route.MetaArgs) {
  const lessonTitle = loaderData?.lesson?.title ?? "Lesson";
  const hasQuiz = !!loaderData?.existingQuiz;
  return [
    {
      title: `${hasQuiz ? "Edit" : "Create"} Quiz: ${lessonTitle} — Cadence`,
    },
  ];
}

// ─── Loader and action ───

export function loader({ params, request }: Route.LoaderArgs) {
  return loadQuizBuilder(request, params);
}

export function action({ params, request }: Route.ActionArgs) {
  return runQuizBuilderAction(request, params);
}

// ─── Component ───

export default function QuizBuilderWizard({
  loaderData,
}: Route.ComponentProps) {
  const { course, lesson, module: mod, existingQuiz } = loaderData;
  const fetcher = useFetcher();
  const navigate = useNavigate();
  const [step, setStep] = useState(1);

  // Initialize wizard state from existing quiz or defaults
  const [wizard, setWizard] = useState<WizardState>(() => {
    if (existingQuiz) {
      return {
        title: existingQuiz.title,
        passingScore: Math.round(existingQuiz.passingScore * 100),
        questions: existingQuiz.questions.map((q) => ({
          id: generateId(),
          text: q.questionText,
          type: q.questionType as QuestionType,
          options: q.options.map((o) => ({
            id: generateId(),
            text: o.optionText,
            isCorrect: o.isCorrect,
          })),
        })),
      };
    }
    return {
      title: "",
      passingScore: 70,
      questions: [],
    };
  });

  const isEditing = !!existingQuiz;

  // Toast on success
  const fetcherData = fetcher.data as
    | { success?: boolean; deleted?: boolean; error?: string }
    | undefined;

  if (fetcher.state === "idle" && fetcherData?.success) {
    if (fetcherData.deleted) {
      toast.success("Quiz deleted.");
      navigate(`/instructor/${course.id}/lessons/${lesson.id}`);
    } else {
      toast.success("Quiz saved.");
      navigate(`/instructor/${course.id}/lessons/${lesson.id}`);
    }
  }

  // ─── Step 1: Settings ───
  function renderStep1() {
    return (
      <Card>
        <CardHeader>
          <h2 className="text-lg font-semibold">Quiz Settings</h2>
          <p className="text-sm text-muted-foreground">
            Set the quiz title and passing score.
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="quizTitle">Quiz Title</Label>
            <Input
              id="quizTitle"
              value={wizard.title}
              onChange={(e) =>
                setWizard((prev) => ({ ...prev, title: e.target.value }))
              }
              placeholder="e.g. Module 1 Quiz"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="passingScore">Passing Score (%)</Label>
            <Input
              id="passingScore"
              type="number"
              min={0}
              max={100}
              value={wizard.passingScore}
              onChange={(e) =>
                setWizard((prev) => ({
                  ...prev,
                  passingScore: parseInt(e.target.value, 10) || 0,
                }))
              }
              className="max-w-32"
            />
          </div>
        </CardContent>
      </Card>
    );
  }

  // ─── Step 2: Questions ───
  function addQuestion() {
    setWizard((prev) => ({
      ...prev,
      questions: [
        ...prev.questions,
        {
          id: generateId(),
          text: "",
          type: QuestionType.MultipleChoice,
          options: [
            { id: generateId(), text: "", isCorrect: true },
            { id: generateId(), text: "", isCorrect: false },
          ],
        },
      ],
    }));
  }

  function removeQuestion(questionId: string) {
    setWizard((prev) => ({
      ...prev,
      questions: prev.questions.filter((q) => q.id !== questionId),
    }));
  }

  function updateQuestion(
    questionId: string,
    updates: Partial<WizardQuestion>
  ) {
    setWizard((prev) => ({
      ...prev,
      questions: prev.questions.map((q) => {
        if (q.id !== questionId) return q;
        const updated = { ...q, ...updates };
        // When switching to TrueFalse, reset options to True/False
        if (
          updates.type === QuestionType.TrueFalse &&
          q.type !== QuestionType.TrueFalse
        ) {
          updated.options = [
            { id: generateId(), text: "True", isCorrect: true },
            { id: generateId(), text: "False", isCorrect: false },
          ];
        }
        // When switching to MultipleChoice from TrueFalse, add blank options
        if (
          updates.type === QuestionType.MultipleChoice &&
          q.type !== QuestionType.MultipleChoice
        ) {
          updated.options = [
            { id: generateId(), text: "", isCorrect: true },
            { id: generateId(), text: "", isCorrect: false },
          ];
        }
        return updated;
      }),
    }));
  }

  function handleQuestionDragEnd(result: DropResult) {
    if (!result.destination) return;
    const fromIndex = result.source.index;
    const toIndex = result.destination.index;
    if (fromIndex === toIndex) return;

    setWizard((prev) => {
      const reordered = [...prev.questions];
      const [moved] = reordered.splice(fromIndex, 1);
      reordered.splice(toIndex, 0, moved);
      return { ...prev, questions: reordered };
    });
  }

  function renderStep2() {
    return (
      <div className="space-y-4">
        <Card>
          <CardHeader>
            <h2 className="text-lg font-semibold">Questions</h2>
            <p className="text-sm text-muted-foreground">
              Add questions to your quiz. Drag to reorder. You&apos;ll set
              answer options in the next step.
            </p>
          </CardHeader>
          <CardContent className="space-y-4">
            {wizard.questions.length === 0 && (
              <p className="text-sm text-muted-foreground">
                No questions added yet. Click &quot;Add Question&quot; to get
                started.
              </p>
            )}

            <DragDropContext onDragEnd={handleQuestionDragEnd}>
              <Droppable droppableId="quiz-questions" type="question">
                {(provided) => (
                  <div
                    ref={provided.innerRef}
                    {...provided.droppableProps}
                    className="space-y-4"
                  >
                    {wizard.questions.map((q, idx) => (
                      <Draggable key={q.id} draggableId={q.id} index={idx}>
                        {(dragProvided, snapshot) => (
                          <div
                            ref={dragProvided.innerRef}
                            {...dragProvided.draggableProps}
                            className={`flex items-start gap-3 rounded-lg border p-4 ${
                              snapshot.isDragging
                                ? "bg-muted shadow-lg ring-2 ring-primary/20"
                                : ""
                            }`}
                          >
                            <div
                              {...dragProvided.dragHandleProps}
                              className="mt-2 cursor-grab text-muted-foreground hover:text-foreground"
                            >
                              <GripVertical className="size-4" />
                            </div>
                            <span className="mt-2 flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium">
                              {idx + 1}
                            </span>
                            <div className="flex-1 space-y-3">
                              <Input
                                value={q.text}
                                onChange={(e) =>
                                  updateQuestion(q.id, {
                                    text: e.target.value,
                                  })
                                }
                                placeholder="Enter question text..."
                              />
                              <div className="flex items-center gap-2">
                                <Label className="text-xs text-muted-foreground">
                                  Type:
                                </Label>
                                <Select
                                  value={q.type}
                                  onValueChange={(val) =>
                                    updateQuestion(q.id, {
                                      type: val as QuestionType,
                                    })
                                  }
                                >
                                  <SelectTrigger className="w-48">
                                    <SelectValue />
                                  </SelectTrigger>
                                  <SelectContent>
                                    <SelectItem
                                      value={QuestionType.MultipleChoice}
                                    >
                                      Multiple Choice
                                    </SelectItem>
                                    <SelectItem value={QuestionType.TrueFalse}>
                                      True / False
                                    </SelectItem>
                                  </SelectContent>
                                </Select>
                              </div>
                            </div>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => removeQuestion(q.id)}
                              className="text-destructive hover:text-destructive"
                            >
                              <Trash2 className="size-4" />
                            </Button>
                          </div>
                        )}
                      </Draggable>
                    ))}
                    {provided.placeholder}
                  </div>
                )}
              </Droppable>
            </DragDropContext>

            <Button variant="outline" onClick={addQuestion}>
              <Plus className="mr-1.5 size-4" />
              Add Question
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  // ─── Navigation ───
  function canGoNext() {
    if (step === 1) return wizard.title.trim().length > 0;
    if (step === 2) return wizard.questions.length > 0;
    if (step === 3) return true;
    return false;
  }

  return (
    <div className="mx-auto max-w-7xl p-6 lg:p-8">
      {/* Breadcrumb */}
      <nav className="mb-6 text-sm text-muted-foreground">
        <Link to="/instructor" className="hover:text-foreground">
          My Courses
        </Link>
        <span className="mx-2">/</span>
        <Link to={`/instructor/${course.id}`} className="hover:text-foreground">
          {course.title}
        </Link>
        <span className="mx-2">/</span>
        <Link
          to={`/instructor/${course.id}/lessons/${lesson.id}`}
          className="hover:text-foreground"
        >
          {lesson.title}
        </Link>
        <span className="mx-2">/</span>
        <span className="text-foreground">
          {isEditing ? "Edit Quiz" : "Create Quiz"}
        </span>
      </nav>

      <Link
        to={`/instructor/${course.id}/lessons/${lesson.id}`}
        className="mb-4 inline-flex items-center text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="mr-1 size-4" />
        Back to Lesson Editor
      </Link>

      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">
            {isEditing ? "Edit Quiz" : "Create Quiz"}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Lesson: {lesson.title}
          </p>
        </div>
        {isEditing && (
          <Button
            variant="outline"
            className="text-destructive hover:text-destructive"
            onClick={() => {
              if (
                confirm(
                  "Are you sure you want to delete this quiz? All student attempts will be lost."
                )
              ) {
                fetcher.submit({ intent: "delete-quiz" }, { method: "post" });
              }
            }}
          >
            <Trash2 className="mr-1.5 size-4" />
            Delete Quiz
          </Button>
        )}
      </div>

      {/* Step indicator */}
      <StepIndicator currentStep={step} onStepClick={setStep} />

      {/* Step content */}
      {step === 1 && renderStep1()}
      {step === 2 && renderStep2()}
      {step === 3 && <AnswersStep wizard={wizard} setWizard={setWizard} />}
      {step === 4 && (
        <ReviewStep
          wizard={wizard}
          isEditing={isEditing}
          isSaving={fetcher.state !== "idle"}
          error={fetcherData?.error}
          onSave={() =>
            fetcher.submit(
              { intent: "save-quiz", wizardData: JSON.stringify(wizard) },
              { method: "post" }
            )
          }
        />
      )}

      {/* Step navigation */}
      <div className="mt-6 flex items-center justify-between">
        <Button
          variant="outline"
          onClick={() => setStep((s) => s - 1)}
          disabled={step === 1}
        >
          <ArrowLeft className="mr-1.5 size-4" />
          Previous
        </Button>
        {step < 4 && (
          <Button onClick={() => setStep((s) => s + 1)} disabled={!canGoNext()}>
            Next
            <ArrowRight className="ml-1.5 size-4" />
          </Button>
        )}
      </div>
    </div>
  );
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  let title = "Something went wrong";
  let message = "An unexpected error occurred while loading the quiz builder.";

  if (isRouteErrorResponse(error)) {
    if (error.status === 404) {
      title = "Not found";
      message = "The quiz, lesson, or course you're looking for doesn't exist.";
    } else if (error.status === 401) {
      title = "Sign in required";
      message =
        typeof error.data === "string"
          ? error.data
          : "Please select a user from the DevUI panel.";
    } else if (error.status === 403) {
      title = "Access denied";
      message =
        typeof error.data === "string"
          ? error.data
          : "You don't have permission to access this page.";
    } else {
      title = `Error ${error.status}`;
      message = typeof error.data === "string" ? error.data : error.statusText;
    }
  }

  return (
    <div className="flex min-h-[50vh] items-center justify-center p-6">
      <div className="text-center">
        <AlertTriangle className="mx-auto mb-4 size-12 text-muted-foreground" />
        <h1 className="mb-2 text-2xl font-bold">{title}</h1>
        <p className="mb-6 text-muted-foreground">{message}</p>
        <div className="flex items-center justify-center gap-3">
          <Link to="/instructor">
            <Button variant="outline">My Courses</Button>
          </Link>
          <Link to="/">
            <Button>Go Home</Button>
          </Link>
        </div>
      </div>
    </div>
  );
}
