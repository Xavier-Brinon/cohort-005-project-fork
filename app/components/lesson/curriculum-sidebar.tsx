import { CheckCircle2, ChevronDown, Circle, PlayCircle } from "lucide-react";
import { type ReactNode, useState } from "react";
import { Link } from "react-router";

import { LessonProgressStatus } from "~/db/schema";
import { cn } from "~/lib/utils";

interface CurriculumModule {
  id: number;
  title: string;
  lessons: Array<{ id: number; title: string }>;
}

function LessonStatusIcon({
  isEnrolled,
  status,
}: {
  isEnrolled: boolean;
  status: string | undefined;
}) {
  if (isEnrolled && status === LessonProgressStatus.Completed) {
    return <CheckCircle2 className="size-3.5 shrink-0 text-green-500" />;
  }
  if (isEnrolled && status === LessonProgressStatus.InProgress) {
    return <PlayCircle className="size-3.5 shrink-0 text-blue-500" />;
  }
  return <Circle className="size-3.5 shrink-0" />;
}

function LessonLink({
  courseSlug,
  lesson,
  isCurrent,
  icon,
}: {
  courseSlug: string;
  lesson: { id: number; title: string };
  isCurrent: boolean;
  icon: ReactNode;
}) {
  return (
    <Link
      to={`/courses/${courseSlug}/lessons/${lesson.id}`}
      className={cn(
        "flex items-center gap-2 rounded-md px-3 py-1.5 text-sm transition-colors",
        isCurrent
          ? "bg-primary/10 font-medium text-primary"
          : "text-muted-foreground hover:bg-muted hover:text-foreground"
      )}
    >
      {icon}
      <span className="truncate">{lesson.title}</span>
    </Link>
  );
}

interface ModuleGroupProps {
  courseSlug: string;
  courseModule: CurriculumModule;
  currentLessonId: number;
  lessonProgressMap: Record<number, string>;
  isEnrolled: boolean;
  isExpanded: boolean;
  onToggle: () => void;
}

function ModuleGroup({
  courseSlug,
  courseModule,
  currentLessonId,
  lessonProgressMap,
  isEnrolled,
  isExpanded,
  onToggle,
}: ModuleGroupProps) {
  return (
    <div className="mb-1">
      <button
        onClick={onToggle}
        className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm font-medium text-foreground/80 hover:bg-muted"
      >
        <ChevronDown
          className={cn(
            "size-4 shrink-0 transition-transform",
            !isExpanded && "-rotate-90"
          )}
        />
        <span className="flex-1 text-left">{courseModule.title}</span>
      </button>

      {isExpanded && (
        <ul className="ml-4 space-y-0.5 py-1">
          {courseModule.lessons.map((lesson) => (
            <li key={lesson.id}>
              <LessonLink
                courseSlug={courseSlug}
                lesson={lesson}
                isCurrent={lesson.id === currentLessonId}
                icon={
                  <LessonStatusIcon
                    isEnrolled={isEnrolled}
                    status={lessonProgressMap[lesson.id]}
                  />
                }
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Starts with the current lesson's module open. */
function useExpandedModules(curriculum: CurriculumModule[], lessonId: number) {
  const [expanded, setExpanded] = useState<Set<number>>(() => {
    const currentModule = curriculum.find((courseModule) =>
      courseModule.lessons.some((lesson) => lesson.id === lessonId)
    );
    return new Set(currentModule ? [currentModule.id] : []);
  });

  function toggle(moduleId: number) {
    setExpanded((previous) => {
      const next = new Set(previous);
      if (next.has(moduleId)) {
        next.delete(moduleId);
      } else {
        next.add(moduleId);
      }
      return next;
    });
  }

  return [expanded, toggle] as const;
}

export function CurriculumSidebar({
  course,
  curriculum,
  currentLessonId,
  lessonProgressMap,
  isEnrolled,
}: {
  course: { id: number; title: string; slug: string };
  curriculum: CurriculumModule[];
  currentLessonId: number;
  lessonProgressMap: Record<number, string>;
  isEnrolled: boolean;
}) {
  const [expanded, toggle] = useExpandedModules(curriculum, currentLessonId);

  return (
    <aside className="hidden w-72 shrink-0 border-r border-border lg:block">
      <div className="sticky top-0 flex h-screen flex-col overflow-y-auto">
        <div className="border-b border-border p-4">
          <Link
            to={`/courses/${course.slug}`}
            className="text-sm font-semibold hover:text-primary"
          >
            {course.title}
          </Link>
        </div>

        <nav className="flex-1 p-2">
          {curriculum.map((courseModule) => (
            <ModuleGroup
              key={courseModule.id}
              courseSlug={course.slug}
              courseModule={courseModule}
              currentLessonId={currentLessonId}
              lessonProgressMap={lessonProgressMap}
              isEnrolled={isEnrolled}
              isExpanded={expanded.has(courseModule.id)}
              onToggle={() => toggle(courseModule.id)}
            />
          ))}
        </nav>
      </div>
    </aside>
  );
}
