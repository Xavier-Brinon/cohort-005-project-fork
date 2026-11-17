// Entry point: the instructor analytics with its database and clock injected.
// Tests use this with an in-memory database and a fixed day. App code should
// use index.server.ts, which supplies the live ones.
export {
  getInstructorAnalytics,
  type AnalyticsViewer,
  type InstructorAnalytics,
} from "./lib/instructor-analytics.server";
