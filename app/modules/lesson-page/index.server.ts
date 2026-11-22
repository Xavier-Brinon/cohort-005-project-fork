import { db } from "~/db";
import { getViewer } from "~/lib/access.server";
import { defaultNotifications } from "~/lib/notifications.server";

import { applyLessonAction } from "./lib/lesson-action.server";
import { getLessonPage } from "./lib/lesson-page.server";

type RouteParameters = Record<string, string | undefined>;

// Entry point: the lesson page's data, for the session's user and country,
// from the live database.
export async function loadLessonPage(
  request: Request,
  params: RouteParameters
) {
  return getLessonPage(db, { viewer: await getViewer(request), params });
}

// Entry point: the lesson page's form posts (comments, bookmark, note,
// mark-complete, quiz).
export async function runLessonAction(
  request: Request,
  params: RouteParameters
) {
  return applyLessonAction(
    db,
    {
      viewer: await getViewer(request),
      params,
      now: new Date(),
      notifications: await defaultNotifications(),
    },
    await request.formData()
  );
}
