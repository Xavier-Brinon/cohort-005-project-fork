type CourseLevel = "beginner" | "intermediate" | "advanced";

const BADGE_LABELS: Record<CourseLevel, string> = {
  beginner: "Beginner",
  intermediate: "Intermediate",
  advanced: "Advanced",
};

export function formatCourseBadge(level: CourseLevel): string {
  return BADGE_LABELS[level];
}
