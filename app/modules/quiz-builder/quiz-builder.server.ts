// Entry point: the quiz builder with its database and viewer injected. Tests
// use this with an in-memory database. App code should use index.server.ts,
// which supplies the live database and the session's user.
export {
  applyQuizBuilderAction,
  getQuizBuilder,
  type QuizBuilderRequest,
} from "./lib/quiz-builder.server";
