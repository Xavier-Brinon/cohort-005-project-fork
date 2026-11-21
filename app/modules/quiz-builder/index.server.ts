import { db } from "~/db";
import { getCurrentUserId } from "~/lib/session";

import {
  applyQuizBuilderAction,
  getQuizBuilder,
} from "./lib/quiz-builder.server";

type RouteParameters = Record<string, string | undefined>;

// Entry point: the quiz builder page's data, for the session's user, from the
// live database. Throws a 4xx response when the viewer may not edit the quiz.
export async function loadQuizBuilder(
  request: Request,
  params: RouteParameters
) {
  const viewerId = await getCurrentUserId(request);
  return getQuizBuilder(db, { viewerId, params });
}

// Entry point: the quiz builder's form posts, "save-quiz" and "delete-quiz".
export async function runQuizBuilderAction(
  request: Request,
  params: RouteParameters
) {
  const viewerId = await getCurrentUserId(request);
  return applyQuizBuilderAction(
    db,
    { viewerId, params },
    await request.formData()
  );
}
