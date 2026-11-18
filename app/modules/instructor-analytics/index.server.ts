import { db } from "~/db";

import {
  type AnalyticsViewer,
  getInstructorAnalytics,
} from "./lib/instructor-analytics.server";

// Entry point: the instructor analytics page's data, read from the live
// database as of now. Callers pass only who is looking and the page's query.
export function loadInstructorAnalytics(
  viewer: AnalyticsViewer,
  searchParams: URLSearchParams
) {
  return getInstructorAnalytics(db, viewer, searchParams, new Date());
}

export type {
  AnalyticsViewer,
  CourseCountryRevenue,
  CourseFunnel,
  CourseProgressSummary,
  FunnelLesson,
  InstructorAnalytics,
  QuizPassRate,
  RefundExposure,
  RevenueSeries,
} from "./lib/instructor-analytics.server";
