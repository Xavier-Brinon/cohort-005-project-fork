// Entry point: the lesson page with its database, viewer, clock and
// notifications injected. Tests use this with an in-memory database. App code
// should use index.server.ts, which supplies the live ones.
export {
  applyLessonAction,
  type LessonActionRequest,
} from "./lib/lesson-action.server";
export {
  getLessonPage,
  type LessonPageRequest,
} from "./lib/lesson-page.server";
