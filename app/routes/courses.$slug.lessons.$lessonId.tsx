import {
  AlertTriangle,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock,
  Github,
  MapPin,
  ShieldAlert,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import {
  isRouteErrorResponse,
  Link,
  useFetcher,
  useNavigate,
} from "react-router";

import { CommentThread } from "~/components/comment-thread";
import { BookmarkToggle } from "~/components/lesson/bookmark-toggle";
import { CurriculumSidebar } from "~/components/lesson/curriculum-sidebar";
import { LessonNote } from "~/components/lesson/lesson-note";
import { QuizSection } from "~/components/lesson/quiz-section";
import { Button } from "~/components/ui/button";
import { Card, CardContent } from "~/components/ui/card";
import { YouTubePlayer } from "~/components/youtube-player";
import { LessonProgressStatus } from "~/db/schema";
import { COUNTRIES } from "~/lib/ppp";
import { formatDuration } from "~/lib/utils";
import {
  loadLessonPage,
  runLessonAction,
} from "~/modules/lesson-page/index.server";

import type { Route } from "./+types/courses.$slug.lessons.$lessonId";

export function meta({ loaderData }: Route.MetaArgs) {
  const title = loaderData?.lesson?.title ?? "Lesson";
  const courseTitle = loaderData?.course?.title ?? "Course";
  return [{ title: `${title} — ${courseTitle} — Cadence` }];
}

export async function loader({ params, request }: Route.LoaderArgs) {
  return loadLessonPage(request, params);
}

export async function action({ params, request }: Route.ActionArgs) {
  return runLessonAction(request, params);
}

const AUTOPLAY_KEY = "cadence-autoplay";

function useAutoplay() {
  const [enabled, setEnabled] = useState(false);

  useEffect(() => {
    try {
      setEnabled(localStorage.getItem(AUTOPLAY_KEY) === "true");
    } catch {
      /* silently fail */
    }
  }, []);

  const toggle = useCallback(() => {
    setEnabled((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(AUTOPLAY_KEY, String(next));
      } catch {
        /* silently fail */
      }
      return next;
    });
  }, []);

  return [enabled, toggle] as const;
}

export default function LessonViewer({ loaderData }: Route.ComponentProps) {
  const {
    course,
    curriculum,
    module: mod,
    lesson,
    contentHtml,
    lessonStatus,
    enrolled,
    currentUserId,
    prevLesson,
    nextLesson,
    quiz,
    bestAttempt,
    lastWatchPosition,
    watchProgress,
    lessonProgressMap,
    pppBlocked,
    pppBlockedCountry,
    pppPurchaseCountry,
    comments,
    canViewContent,
    canModerate,
    instructorName,
    bookmarked,
    note,
  } = loaderData;
  const [autoplay, toggleAutoplay] = useAutoplay();
  const fetcher = useFetcher({ key: `mark-complete-${lesson.id}` });
  const quizFetcher = useFetcher({ key: `quiz-${lesson.id}` });
  const navigate = useNavigate();

  const isMarking =
    fetcher.state !== "idle" &&
    fetcher.formData?.get("intent") === "mark-complete";

  const justCompleted = fetcher.data?.success;

  const isCompleted =
    lessonStatus === LessonProgressStatus.Completed || justCompleted;

  // Navigate to next lesson after marking complete
  useEffect(() => {
    if (justCompleted && nextLesson) {
      navigate(`/courses/${course.slug}/lessons/${nextLesson.id}`);
    }
  }, [justCompleted, nextLesson, course.slug, navigate]);

  const quizResult = quizFetcher.data?.quizResult ?? null;
  const isSubmittingQuiz = quizFetcher.state !== "idle";

  if (pppBlocked) {
    const purchaseCountryName = pppPurchaseCountry
      ? (COUNTRIES.find((c) => c.code === pppPurchaseCountry)?.name ??
        pppPurchaseCountry)
      : "your original country";
    const currentCountryName = pppBlockedCountry
      ? (COUNTRIES.find((c) => c.code === pppBlockedCountry)?.name ??
        pppBlockedCountry)
      : "a different country";

    return (
      <div className="flex min-h-[60vh] items-center justify-center p-6">
        <div className="max-w-md text-center">
          <ShieldAlert className="mx-auto mb-4 size-16 text-amber-500" />
          <h1 className="mb-3 text-2xl font-bold">Access Restricted</h1>
          <p className="mb-4 text-muted-foreground">
            You purchased this course with a Purchasing Power Parity discount
            while in <strong>{purchaseCountryName}</strong>, but you're
            currently accessing from <strong>{currentCountryName}</strong>.
          </p>
          <p className="mb-6 text-sm text-muted-foreground">
            PPP-discounted courses can only be accessed from the country where
            the purchase was made. This helps keep courses affordable for
            students in lower-income regions.
          </p>
          <div className="flex items-center justify-center gap-3">
            <Link to={`/courses/${course.slug}`}>
              <Button variant="outline">
                <MapPin className="mr-2 size-4" />
                Back to Course
              </Button>
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex">
      {/* Curriculum Sidebar */}
      <CurriculumSidebar
        course={course}
        curriculum={curriculum}
        currentLessonId={lesson.id}
        lessonProgressMap={lessonProgressMap}
        isEnrolled={enrolled}
      />

      <div className="flex-1 p-6 lg:p-8">
        {/* Breadcrumb */}
        <nav className="mb-6 text-sm text-muted-foreground">
          <Link to="/courses" className="hover:text-foreground">
            Courses
          </Link>
          <span className="mx-2">/</span>
          <Link
            to={`/courses/${course.slug}`}
            className="hover:text-foreground"
          >
            {course.title}
          </Link>
          <span className="mx-2">/</span>
          <Link
            to={`/courses/${course.slug}/${mod.id}`}
            className="hover:text-foreground"
          >
            {mod.title}
          </Link>
          <span className="mx-2">/</span>
          <span className="text-foreground">{lesson.title}</span>
        </nav>

        <div className="mx-auto max-w-4xl">
          {/* Lesson Title */}
          <div className="mb-2 flex items-start justify-between gap-3">
            <h1 className="text-3xl font-bold">{lesson.title}</h1>
            {canViewContent && currentUserId && (
              <BookmarkToggle isBookmarked={bookmarked} />
            )}
          </div>
          <div className="mb-6 flex items-center gap-3">
            {lesson.durationMinutes && (
              <div className="flex items-center gap-1 text-sm text-muted-foreground">
                <Clock className="size-4" />
                {formatDuration(lesson.durationMinutes, true, false, false)}
              </div>
            )}
            {lesson.githubRepoUrl && (
              <a
                href={lesson.githubRepoUrl}
                target="_blank"
                rel="noopener noreferrer"
              >
                <Button variant="outline" size="sm">
                  <Github className="mr-1.5 size-4" />
                  Open Code
                </Button>
              </a>
            )}
          </div>

          {/* YouTube Video */}
          {lesson.videoUrl && (
            <YouTubePlayer
              videoUrl={lesson.videoUrl}
              lessonId={lesson.id}
              title={lesson.title}
              startPosition={lastWatchPosition}
              durationMinutes={lesson.durationMinutes}
              watchProgress={watchProgress}
              trackingEnabled={enrolled && !!currentUserId}
              autoplay={autoplay}
              onToggleAutoplay={toggleAutoplay}
            />
          )}

          {/* Note — under the video, so the Student can write while they watch */}
          {canViewContent && currentUserId && <LessonNote note={note} />}

          {/* Lesson Content */}
          {contentHtml && (
            <div
              className="prose prose-neutral dark:prose-invert mb-8 max-w-none"
              dangerouslySetInnerHTML={{ __html: contentHtml }}
            />
          )}

          {!contentHtml && !lesson.videoUrl && (
            <Card className="mb-8">
              <CardContent className="py-12 text-center text-muted-foreground">
                No content has been added to this lesson yet.
              </CardContent>
            </Card>
          )}

          {/* Quiz Section */}
          {quiz && enrolled && currentUserId && (
            <QuizSection
              quiz={quiz}
              bestAttempt={bestAttempt}
              quizResult={quizResult}
              quizFetcher={quizFetcher}
              isSubmitting={isSubmittingQuiz}
            />
          )}

          {/* Mark Complete / Up Next */}
          {enrolled && currentUserId && (
            <div className="mb-8">
              {isCompleted ? (
                <div className="flex items-center gap-3">
                  <div className="flex items-center gap-2 text-green-600">
                    <CheckCircle2 className="size-5" />
                    <span className="font-medium">Lesson completed</span>
                  </div>
                  {nextLesson && (
                    <Link
                      to={`/courses/${course.slug}/lessons/${nextLesson.id}`}
                    >
                      <Button variant="outline" size="sm">
                        Up next: {nextLesson.title}
                        <ChevronRight className="ml-1 size-4" />
                      </Button>
                    </Link>
                  )}
                </div>
              ) : nextLesson ? (
                <fetcher.Form method="post">
                  <input type="hidden" name="intent" value="mark-complete" />
                  <Button disabled={isMarking}>
                    {isMarking ? (
                      "Completing..."
                    ) : (
                      <>
                        Up next: {nextLesson.title}
                        <ChevronRight className="ml-1 size-4" />
                      </>
                    )}
                  </Button>
                </fetcher.Form>
              ) : (
                <fetcher.Form method="post">
                  <input type="hidden" name="intent" value="mark-complete" />
                  <Button disabled={isMarking}>
                    <CheckCircle2 className="mr-2 size-4" />
                    {isMarking ? "Marking..." : "Mark as Complete"}
                  </Button>
                </fetcher.Form>
              )}
            </div>
          )}

          {/* Questions & Discussion — confidential to people with access */}
          {canViewContent && (
            <CommentThread
              comments={comments}
              currentUserId={currentUserId}
              canModerate={canModerate}
              canPost
              instructorName={instructorName}
            />
          )}

          {/* Prev/Next Navigation */}
          <div className="flex items-center justify-between border-t pt-6">
            {prevLesson ? (
              <Link
                to={`/courses/${course.slug}/lessons/${prevLesson.id}`}
                className="flex items-center gap-2 text-sm hover:text-foreground text-muted-foreground"
              >
                <ChevronLeft className="size-4" />
                <div>
                  <div className="text-xs text-muted-foreground">Previous</div>
                  <div className="font-medium text-foreground">
                    {prevLesson.title}
                  </div>
                </div>
              </Link>
            ) : (
              <div />
            )}

            {nextLesson ? (
              <Link
                to={`/courses/${course.slug}/lessons/${nextLesson.id}`}
                className="flex items-center gap-2 text-right text-sm hover:text-foreground text-muted-foreground"
              >
                <div>
                  <div className="text-xs text-muted-foreground">Next</div>
                  <div className="font-medium text-foreground">
                    {nextLesson.title}
                  </div>
                </div>
                <ChevronRight className="size-4" />
              </Link>
            ) : (
              <Link
                to={`/courses/${course.slug}`}
                className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
              >
                <div>
                  <div className="text-xs text-muted-foreground">Back to</div>
                  <div className="font-medium text-foreground">
                    {course.title}
                  </div>
                </div>
                <ChevronRight className="size-4" />
              </Link>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  let title = "Something went wrong";
  let message = "An unexpected error occurred while loading this lesson.";

  if (isRouteErrorResponse(error)) {
    if (error.status === 404) {
      title = "Lesson not found";
      message =
        "The lesson you're looking for doesn't exist or may have been removed.";
    } else if (error.status === 401) {
      title = "Sign in required";
      message =
        typeof error.data === "string"
          ? error.data
          : "Please select a user from the DevUI panel.";
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
          <Link to="/courses">
            <Button variant="outline">Browse Courses</Button>
          </Link>
          <Link to="/dashboard">
            <Button>My Dashboard</Button>
          </Link>
        </div>
      </div>
    </div>
  );
}
